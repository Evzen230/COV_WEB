const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createHash,
  createHmac,
  createDecipheriv,
  randomBytes,
} = require("node:crypto");
const { createApp } = require("../server.cjs");
const { createSecurity, credentials } = require("../server/security.cjs");
const { createPairing } = require("../server/pairing.cjs");
const hash = (s) => createHash("sha256").update(s).digest("hex");
function request(code, nonce = randomBytes(16).toString("hex")) {
  const derived = hash(code);
  return {
    codeHash: hash(derived),
    nonce,
    proof: createHmac("sha256", Buffer.from(derived, "hex"))
      .update(nonce)
      .digest("hex"),
  };
}
function open(secret, envelope) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(hash(secret), "hex"),
    Buffer.from(envelope.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "hex")),
      decipher.final(),
    ]),
  );
}
test("Pairing expires, verifies proof, retries one claim, persists hashes and rotates only after confirmation", () => {
  let time = 0;
  const data = new Map();
  const options = {
    get: (k, d) => structuredClone(data.get(k) ?? d),
    put: (k, v) => data.set(k, structuredClone(v)),
    now: () => time,
    fleet: { has: (id) => id === "esp-1" },
  };
  let pairing = createPairing(options);
  const ticket = pairing.issue("esp-1");
  assert.match(ticket.code, /^[A-HJ-NP-Z2-9]{8}$/);
  const input = request(ticket.code);
  assert.throws(() => pairing.claim({ ...input, proof: "0".repeat(64) }, "a"), {
    status: 401,
  });
  const envelope = pairing.claim(input, "a"),
    key = open(ticket.code, envelope).apiKey;
  assert.equal(open(ticket.code, envelope).device_id, "esp-1");
  assert.equal(pairing.authenticate(key), "esp-1");
  assert.deepEqual(pairing.claim(input, "a"), envelope);
  assert.throws(() => pairing.claim(request(ticket.code), "a"), {
    status: 409,
  });
  assert.ok(!JSON.stringify([...data]).includes(key));
  const rotation = pairing.rotate(key, "esp-1"),
    next = open(key, rotation).apiKey;
  assert.deepEqual(pairing.rotate(key, "esp-1"), rotation);
  pairing = createPairing(options);
  assert.equal(pairing.authenticate(key), "esp-1");
  assert.equal(pairing.authenticate(next), "esp-1");
  assert.equal(pairing.authenticate(key), null);
  pairing.revoke("esp-1");
  assert.equal(pairing.authenticate(next), null);
  const expired = pairing.issue("esp-1");
  time += 600001;
  assert.throws(() => pairing.claim(request(expired.code), "a"), {
    status: 401,
  });
});

test("Pairing limits guesses across addresses and invalidates a replaced short code", () => {
  let time = 1;
  const data = new Map();
  const pairing = createPairing({
    get: (k, d) => structuredClone(data.get(k) ?? d),
    put: (k, v) => data.set(k, structuredClone(v)),
    now: () => time,
    fleet: { has: () => true },
  });
  const old = pairing.issue("test");
  const current = pairing.issue("test");
  assert.throws(() => pairing.claim(request(old.code), "old"), { status: 401 });
  for (let i = 0; i < 59; i++)
    assert.throws(() => pairing.claim({}, `client-${i}`), { status: 400 });
  assert.throws(() => pairing.claim(request(current.code), "another"), {
    status: 429,
  });
  time += 60001;
  assert.equal(
    open(current.code, pairing.claim(request(current.code), "another"))
      .device_id,
    "test",
  );
});
test("HTTP pairing requires admin to issue, binds telemetry to station and survives global key rotation", async () => {
  const security = createSecurity(
    credentials("test-password", "legacy-key"),
    Date.now,
    { save: () => {} },
  );
  const app = createApp({ dbPath: ":memory:", security });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function req(path, method = "GET", data, headers = {}) {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  try {
    assert.equal(
      (await req("/api/stations/cov-monitor-01/pairing", "POST", {})).status,
      401,
    );
    const login = await req("/api/auth/login", "POST", {
        password: "test-password",
      }),
      admin = { Cookie: login.cookie };
    const ticket = await req(
      "/api/stations/cov-monitor-01/pairing",
      "POST",
      {},
      admin,
    );
    assert.equal(ticket.status, 201);
    const claim = await req("/api/v1/pair", "POST", request(ticket.data.code));
    assert.equal(claim.status, 200);
    const key = open(ticket.data.code, claim.data).apiKey,
      headers = { "X-API-Key": key };
    assert.equal(
      (await req("/api/v1/device/status", "GET", undefined, headers)).status,
      200,
    );
    assert.equal(
      (await req("/api/state", "GET", undefined, headers)).status,
      401,
    );
    assert.equal(
      (await req("/api/v1/telemetry", "POST", { device_id: "other" }, headers))
        .status,
      403,
    );
    assert.equal(
      (
        await req(
          "/api/v1/device/status?device_id=other",
          "GET",
          undefined,
          headers,
        )
      ).status,
      403,
    );
    await req(
      "/api/auth/api-key",
      "POST",
      { currentPassword: "test-password" },
      admin,
    );
    assert.equal(
      (await req("/api/v1/device/status", "GET", undefined, headers)).status,
      200,
    );
    const rotation = await req(
      "/api/v1/device/credentials",
      "POST",
      {},
      headers,
    );
    assert.equal(rotation.status, 200);
    const next = open(key, rotation.data).apiKey;
    assert.equal(
      (
        await req("/api/v1/device/status", "GET", undefined, {
          "X-API-Key": next,
        })
      ).status,
      200,
    );
    assert.equal(
      (await req("/api/v1/device/status", "GET", undefined, headers)).status,
      401,
    );
    await req("/api/stations/cov-monitor-01/revoke", "POST", {}, admin);
    assert.equal(
      (
        await req("/api/v1/device/status", "GET", undefined, {
          "X-API-Key": next,
        })
      ).status,
      401,
    );
  } finally {
    app.close();
  }
});
