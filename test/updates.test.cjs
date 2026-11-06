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
  download,
} = require("../server/updates.cjs");
const { createApp } = require("../server.cjs");
const { createSecurity, credentials } = require("../server/security.cjs");
test("Missing GitHub manifest explains release setup; other HTTP failures remain errors", async () => {
  const url =
    "https://github.com/Evzen230/COV_WEB/releases/latest/download/manifest.json";
  const missing = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    download(url, 1000, missing),
    (error) =>
      error.httpStatus === 404 && /vydání.*manifest.json/.test(error.message),
  );
  await assert.rejects(
    download("https://example.org/firmware.bin", 1000, missing),
    (error) => error.httpStatus === 404 && !/vydání/.test(error.message),
  );
  await assert.rejects(
    download(url, 1000, async () => ({ ok: false, status: 403 })),
    /HTTP 403/,
  );
  await assert.rejects(
    download(url, 1000, async () => ({
      ok: true,
      url: "http://example.org/manifest.json",
    })),
    /nezabezpečené/,
  );
});
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
    const result = await updates.stage("server");
    assert.deepEqual(
      fs.readFileSync(path.join(directory, "server.bundle")),
      bytes,
    );
    const request = JSON.parse(
      fs.readFileSync(path.join(directory, "request.json")),
    );
    assert.equal(request.payload, envelope.payload);
    assert.equal(request.signature, envelope.signature);
    assert.match(request.operationId, /^[a-f0-9-]{36}$/);
    assert.equal(result.operationId, request.operationId);
    assert.equal(updates.status().pending, true);
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
    for (const route of ["/api/updates/rollback", "/api/updates/history"]) {
      for (const headers of [{}, { "X-API-Key": "station-key" }])
        assert.equal(
          (
            await fetch(base + route, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: "{}",
            })
          ).status,
          401,
        );
    }
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
    assert.equal(
      (
        await fetch(base + "/api/updates/rollback", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: '{"kind":"firmware","acknowledge":true}',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/updates/rollback", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Origin: "https://evil.example",
          },
          body: '{"kind":"server","id":"test","acknowledgeDataLoss":true}',
        })
      ).status,
      403,
    );
  } finally {
    app.close();
  }
});

test("Manual firmware rollback verifies signed release, target, capabilities, acknowledgement and hash", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from("older ESP image");
  const releases = new Map();
  const makeEnvelope = (version, target = "esp32-nano-v1") => {
    const asset = {
      version,
      protocol: 1,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url: `https://example.org/${version}.bin`,
    };
    const payload = Buffer.from(
      JSON.stringify({
        schema: 1,
        server: asset,
        firmware: { ...asset, target },
      }),
    );
    return {
      payload: payload.toString("base64"),
      signature: sign(null, payload, privateKey).toString("base64"),
    };
  };
  releases.set("0.3.1", makeEnvelope("0.3.1"));
  releases.set("0.3.2", makeEnvelope("0.3.2"));
  releases.set("0.2.0", makeEnvelope("0.2.0", "esp32-ds18b20-v1"));
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cov-firmware-rollback-"),
  );
  const state = new Map([
    [
      "stationVersion",
      { version: "0.3.2", target: "esp32-nano-v1", rollback: false },
    ],
  ]);
  let corrupt = false;
  const updates = createUpdates({
    directory,
    publicKey,
    manifestUrl:
      "https://github.com/Evzen230/COV_WEB/releases/latest/download/manifest.json",
    get: (k, d) => (state.has(k) ? state.get(k) : d),
    put: (k, v) => state.set(k, v),
    fetchBytes: async (url) => {
      if (url.endsWith("manifest.json"))
        return Buffer.from(
          JSON.stringify(
            releases.get(
              url.includes("/latest/")
                ? "0.3.2"
                : url.match(/download\/v([^/]+)/)[1],
            ),
          ),
        );
      return corrupt ? Buffer.from("corrupt") : bytes;
    },
  });
  try {
    await updates.check();
    await updates.rememberRelease("0.3.1");
    assert.equal(updates.status().firmwareRollbacks[0].version, "0.3.1");
    await assert.rejects(updates.rememberRelease("../other"), /stabilní verzi/);
    await assert.rejects(updates.rememberRelease("0.2.0"), /typu stanice/);
    await assert.rejects(
      updates.stage("firmware", {
        rollbackVersion: "0.3.1",
        acknowledge: true,
      }),
      /nepodporuje/,
    );
    state.get("stationVersion").rollback = true;
    await assert.rejects(
      updates.stage("firmware", { rollbackVersion: "0.3.1" }),
      /potvrzený/,
    );
    corrupt = true;
    await assert.rejects(
      updates.stage("firmware", {
        rollbackVersion: "0.3.1",
        acknowledge: true,
      }),
      /součet/,
    );
    corrupt = false;
    await updates.stage("firmware", {
      rollbackVersion: "0.3.1",
      acknowledge: true,
    });
    assert.equal(updates.firmware().rollback, true);
    assert.equal(updates.firmware().version, "0.3.1");
    assert.deepEqual(
      fs.readFileSync(path.join(directory, "firmware.bin")),
      bytes,
    );
    state
      .get("updateHistory")
      .find((e) => e.release.firmware.version === "0.3.1").envelope.signature =
      Buffer.alloc(64).toString("base64");
    await assert.rejects(
      updates.stage("firmware", {
        rollbackVersion: "0.3.1",
        acknowledge: true,
      }),
      /podpis/,
    );
  } finally {
    updates.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Server rollback requires a published recovery point and acknowledgement; locks out a download in progress", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cov-server-rollback-"),
  );
  const id = "d327eb3f-566b-4058-bf16-bdf0d56fde21";
  const state = new Map();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from("new bundle");
  const asset = {
    version: "99.0.0",
    protocol: 1,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: "https://example.org/bundle",
  };
  const payload = Buffer.from(
    JSON.stringify({
      schema: 1,
      server: asset,
      firmware: { ...asset, target: "esp32-nano-v1" },
    }),
  );
  state.set("updateEnvelope", {
    payload: payload.toString("base64"),
    signature: sign(null, payload, privateKey).toString("base64"),
  });
  let finishDownload;
  const opts = {
    directory,
    publicKey,
    manifestUrl: "https://example.org/manifest",
    get: (k, d) => (state.has(k) ? state.get(k) : d),
    put: (k, v) => state.set(k, v),
    fetchBytes: () => new Promise((resolve) => (finishDownload = resolve)),
  };
  const first = createUpdates(opts),
    second = createUpdates(opts);
  try {
    assert.equal(first.status().serverRollbacks.supported, false);
    await assert.rejects(
      first.rollbackServer({ id, acknowledgeDataLoss: true }),
      /záloha není dostupná/,
    );
    fs.writeFileSync(
      path.join(directory, "server-rollback.json"),
      JSON.stringify({
        schema: 1,
        entries: [{ id, version: "0.3.0", created: "2026-11-06T10:00:00Z" }],
      }),
    );
    await assert.rejects(first.rollbackServer({ id }), /Potvrďte/);
    await assert.rejects(
      first.rollbackServer({ id: "../outside", acknowledgeDataLoss: true }),
      /záloha není dostupná/,
    );
    const download = first.stage("server");
    const queued = await second.rollbackServer({
      id,
      acknowledgeDataLoss: true,
    });
    finishDownload(bytes);
    await assert.rejects(download, /mezitím/);
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(directory, "rollback-request.json")),
      ),
      {
        schema: 1,
        id,
        acknowledgeDataLoss: true,
        operationId: queued.operationId,
      },
    );
    assert.equal(fs.existsSync(path.join(directory, "request.json")), false);
    await assert.rejects(
      second.rollbackServer({ id, acknowledgeDataLoss: true }),
      /Jiná operace/,
    );
  } finally {
    first.close();
    second.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
