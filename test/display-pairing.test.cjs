const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createHash,
  createHmac,
  createDecipheriv,
  randomBytes,
} = require("node:crypto");
const { createDisplays } = require("../server/displays.cjs");
const hash = (s) => createHash("sha256").update(s).digest("hex");
function proof(code, nonce = randomBytes(16).toString("hex")) {
  return {
    codeHash: hash(hash(code)),
    nonce,
    proof: createHmac("sha256", Buffer.from(hash(code), "hex"))
      .update(nonce)
      .digest("hex"),
  };
}
function open(code, envelope) {
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(hash(code), "hex"),
    Buffer.from(envelope.iv, "hex"),
  );
  d.setAuthTag(Buffer.from(envelope.tag, "hex"));
  return JSON.parse(
    Buffer.concat([d.update(Buffer.from(envelope.data, "hex")), d.final()]),
  );
}
test("Short display codes expire, replace older codes and exchange an encrypted read-only credential", () => {
  let time = Date.now();
  const data = new Map();
  const options = {
    now: () => time,
    get: (k, f) => structuredClone(data.get(k) ?? f),
    put: (k, v) => data.set(k, structuredClone(v)),
  };
  const displays = createDisplays(options),
    issued = displays.pairNew("Kitchen");
  assert.match(issued.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(issued.expires, time + 600000);
  assert.equal(displays.list()[0].paired, false);
  assert.ok(!("key" in issued));
  const input = proof(issued.code);
  const sealed = displays.claim(input, "one"),
    credential = open(issued.code, sealed);
  assert.equal(credential.device_id, issued.device_id);
  assert.deepEqual(displays.claim(input, "one"), sealed);
  assert.throws(() => displays.claim(proof(issued.code), "one"), {
    status: 409,
  });
  displays.authenticate({ headers: { "x-api-key": credential.apiKey } });
  assert.equal(displays.list()[0].paired, true);
  assert.ok(!JSON.stringify([...data]).includes(credential.apiKey));
  assert.ok(!JSON.stringify([...data]).includes(issued.code));
  const replacement = displays.pair(issued.device_id);
  assert.throws(() => displays.claim(input, "one"), { status: 401 });
  // Requesting a replacement code does not break a currently connected display.
  displays.authenticate({ headers: { "x-api-key": credential.apiKey } });
  const next = open(
    replacement.code,
    displays.claim(proof(replacement.code), "two"),
  );
  assert.throws(
    () =>
      displays.authenticate({ headers: { "x-api-key": credential.apiKey } }),
    { status: 401 },
  );
  createDisplays(options).authenticate({
    headers: { "x-api-key": next.apiKey },
  });
  const expiring = displays.pair(issued.device_id);
  time += 600001;
  assert.throws(() => displays.claim(proof(expiring.code), "three"), {
    status: 401,
  });
  const revoked = displays.pair(issued.device_id);
  displays.revoke(issued.device_id);
  assert.throws(() => displays.claim(proof(revoked.code), "four"), {
    status: 401,
  });
  assert.throws(
    () => displays.authenticate({ headers: { "x-api-key": next.apiKey } }),
    { status: 401 },
  );
});

test("Display codes are rate limited and isolated from measurement-station credentials", () => {
  const values = new Map();
  const options = {
    now: Date.now,
    get: (k, f) => values.get(k) ?? f,
    put: (k, v) => values.set(k, v),
  };
  const displays = createDisplays(options),
    issued = displays.pairNew("Hall");
  const stations = require("../server/pairing.cjs").createPairing({
    ...options,
    fleet: { has: () => true },
  });
  assert.throws(() => stations.claim(proof(issued.code), "a"), { status: 401 });
  for (let i = 0; i < 10; i++)
    assert.throws(() => displays.claim(proof("ABCDEFGH"), "same"), {
      status: 401,
    });
  assert.throws(() => displays.claim(proof(issued.code), "same"), {
    status: 429,
  });
  const credential = open(
    issued.code,
    displays.claim(proof(issued.code), "other"),
  );
  assert.equal(stations.authenticate(credential.apiKey), null);
});

test("Web pairing card shows a short grouped code and never a permanent key", async () => {
  const { displayPairingCard, connectionPanels } =
    await import("../dist/js/components/connections.js");
  const html = displayPairingCard({
    code: "ABCDEFGH",
    expires: Date.now() + 600000,
  });
  assert.match(html, /ABCD-EFGH/);
  assert.match(html, /10 minut/);
  assert.ok(!connectionPanels().includes("Vytvořit klíč displeje"));
  assert.match(connectionPanels(), /Spárovat nový displej/);
});

test("HTTP short-code flow requires web login to issue, then grants only display reads", async () => {
  const { createApp } = require("../server.cjs");
  const { createSecurity, credentials } = require("../server/security.cjs");
  const app = createApp({
    dbPath: ":memory:",
    security: createSecurity(
      credentials("display-test-password", "station-secret"),
    ),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(url, method = "GET", data, headers = {}) {
    const response = await fetch(base + url, {
      method,
      headers: {
        ...headers,
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return {
      status: response.status,
      value: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  try {
    assert.equal(
      (await request("/api/displays/pairing", "POST", { name: "Kitchen" }))
        .status,
      401,
    );
    const login = await request("/api/auth/login", "POST", {
      password: "display-test-password",
    });
    const admin = { Cookie: login.cookie };
    const issued = await request(
      "/api/displays/pairing",
      "POST",
      { name: "Kitchen" },
      admin,
    );
    assert.equal(issued.status, 201);
    assert.ok(!issued.value.key);
    const input = proof(issued.value.code);
    const claimed = await request("/api/v1/display/pair", "POST", input);
    assert.equal(claimed.status, 200);
    const credential = open(issued.value.code, claimed.value);
    const reader = { "X-API-Key": credential.apiKey };
    assert.equal(
      (await request("/api/v1/display", "GET", null, reader)).status,
      200,
    );
    for (const [url, method, data] of [
      ["/api/state", "GET"],
      ["/api/displays/pairing", "POST", { name: "bad" }],
      ["/api/v1/telemetry", "POST", { measurements: { temperature: 18 } }],
    ])
      assert.equal((await request(url, method, data, reader)).status, 401, url);
    const again = await request(
      `/api/displays/${credential.device_id}/pairing`,
      "POST",
      {},
      admin,
    );
    assert.equal(again.status, 201);
    assert.equal(
      (await request("/api/v1/display", "GET", null, reader)).status,
      200,
    );
    await request(
      `/api/displays/${credential.device_id}`,
      "DELETE",
      null,
      admin,
    );
    assert.equal(
      (await request("/api/v1/display", "GET", null, reader)).status,
      401,
    );
    assert.equal(
      (await request("/api/v1/display/pair", "POST", proof(again.value.code)))
        .status,
      401,
    );
  } finally {
    await app.close();
  }
});
