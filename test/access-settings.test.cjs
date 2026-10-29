const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { createApp } = require("../server.cjs");
const {
  credentials,
  createSecurity,
  saveCredentials,
  loadCredentials,
} = require("../server/security.cjs");
test("Vlastní heslo a nový klíč: ověření, okamžitá změna, zápis na disk a zneplatnění starého přístupu", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-access-")),
    filename = path.join(dir, "auth.json");
  saveCredentials(credentials("original password", "original-key"), filename);
  const security = createSecurity(loadCredentials(filename), Date.now, {
    save: (config) => saveCredentials(config, filename),
  });
  const app = createApp({ dbPath: ":memory:", security });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function req(p, method = "GET", body, headers = {}) {
    const r = await fetch(base + p, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      data: await r.json(),
    };
  }
  try {
    assert.equal(
      (
        await req("/api/auth/api-key", "POST", {
          currentPassword: "original password",
        })
      ).status,
      401,
    );
    const a = await req("/api/auth/login", "POST", {
        password: "original password",
      }),
      b = await req("/api/auth/login", "POST", {
        password: "original password",
      });
    assert.equal(
      (
        await req(
          "/api/auth/api-key",
          "POST",
          { currentPassword: "wrong" },
          { Cookie: a.cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await req(
          "/api/auth/password",
          "POST",
          { currentPassword: "original password", newPassword: "1234567" },
          { Cookie: a.cookie },
        )
      ).status,
      400,
    );
    const changed = await req(
      "/api/auth/password",
      "POST",
      {
        currentPassword: "original password",
        newPassword: "heslo123",
      },
      { Cookie: a.cookie },
    );
    assert.equal(changed.status, 200);
    assert.equal(
      (await req("/api/state", "GET", null, { Cookie: b.cookie })).status,
      401,
    );
    assert.equal(
      (await req("/api/state", "GET", null, { Cookie: changed.cookie })).status,
      200,
    );
    assert.equal(
      (await req("/api/auth/login", "POST", { password: "original password" }))
        .status,
      401,
    );
    assert.equal(
      (
        await req("/api/auth/login", "POST", {
          password: "heslo123",
        })
      ).status,
      200,
    );
    const key = await req(
      "/api/auth/api-key",
      "POST",
      { currentPassword: "heslo123" },
      { Cookie: changed.cookie },
    );
    assert.equal(key.status, 200);
    assert.ok(key.data.apiKey.length >= 40);
    assert.equal(
      (
        await req("/api/v1/device/status", "GET", null, {
          "X-API-Key": "original-key",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await req("/api/v1/device/status", "GET", null, {
          "X-API-Key": key.data.apiKey,
        })
      ).status,
      200,
    );
    const file = fs.readFileSync(filename, "utf8");
    assert.ok(!file.includes(key.data.apiKey));
    assert.ok(!file.includes("heslo123"));
    const disk = loadCredentials(filename);
    assert.notEqual(
      disk.telemetryHash,
      credentials("unused", "original-key").telemetryHash,
    );
  } finally {
    app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
