const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { generateKeyPairSync, sign, createHash } = require("node:crypto");
const {
  createUpdates,
  decodeManifest,
  newer,
} = require("../server/updates.cjs");
const { createApp } = require("../server.cjs");
const { createSecurity, credentials } = require("../server/security.cjs");
test("Signed releases reject tampering, stage verified bytes, preserve state and reject downgrade", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from("test bundle");
  const asset = {
    version: "99.0.0",
    protocol: 1,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: "https://example.org/bundle",
  };
  const manifest = {
    schema: 1,
    server: asset,
    firmware: { ...asset, target: "esp32-ds18b20-v1" },
  };
  const payload = Buffer.from(JSON.stringify(manifest));
  const envelope = {
    payload: payload.toString("base64"),
    signature: sign(null, payload, privateKey).toString("base64"),
  };
  assert.equal(decodeManifest(envelope, publicKey).server.version, "99.0.0");
  assert.throws(
    () =>
      decodeManifest(
        { ...envelope, payload: Buffer.from("{}").toString("base64") },
        publicKey,
      ),
    /podpis/,
  );
  assert.equal(newer("0.10.0", "0.9.0"), true);
  assert.equal(newer("0.2.0", "0.3.0"), false);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cov-updates-"));
  const state = new Map();
  let corrupt = false;
  const updates = createUpdates({
    directory,
    publicKey,
    manifestUrl: "https://example.org/manifest",
    get: (k, d) => (state.has(k) ? state.get(k) : d),
    put: (k, v) => state.set(k, v),
    fetchBytes: async (url) =>
      url.endsWith("manifest")
        ? Buffer.from(JSON.stringify(envelope))
        : corrupt
          ? Buffer.from("bad")
          : bytes,
  });
  try {
    await updates.check();
    assert.equal(updates.status().available, true);
    await assert.rejects(updates.stage("firmware"), /kompatibilní/);
    corrupt = true;
    await assert.rejects(updates.stage("server"), /součet/);
    assert.equal(fs.existsSync(path.join(directory, "request.json")), false);
    corrupt = false;
    await updates.stage("server");
    assert.deepEqual(
      fs.readFileSync(path.join(directory, "server.bundle")),
      bytes,
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directory, "request.json"))),
      envelope,
    );
    await assert.rejects(updates.stage("server"), /čeká/);
  } finally {
    updates.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("Update administration requires session; firmware endpoints require station key", async () => {
  const app = createApp({
    dbPath: ":memory:",
    security: createSecurity(credentials("test-password", "station-key")),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    for (const route of [
      "/api/updates",
      "/api/v1/device/update",
      "/api/v1/device/firmware",
    ])
      assert.equal((await fetch(base + route)).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/updates", {
          headers: { "X-API-Key": "station-key" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + "/api/updates/install", {
          method: "POST",
          headers: {
            "X-API-Key": "station-key",
            "Content-Type": "application/json",
          },
          body: '{"kind":"server"}',
        })
      ).status,
      401,
    );
    const offer = await fetch(base + "/api/v1/device/update", {
      headers: { "X-API-Key": "station-key" },
    });
    assert.deepEqual(await offer.json(), { firmware: null });
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"password":"test-password"}',
    });
    const headers = { Cookie: login.headers.get("set-cookie").split(";")[0] };
    assert.equal((await fetch(base + "/api/updates", { headers })).status, 200);
    assert.equal(
      (await fetch(base + "/api/v1/device/update", { headers })).status,
      401,
    );
  } finally {
    app.close();
  }
});
