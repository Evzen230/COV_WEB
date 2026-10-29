const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server.cjs");
const { credentials, createSecurity } = require("../server/security.cjs");
test("API vyžaduje přihlášení, klíč stanice nemůže číst správu, relace a odhlášení fungují", async () => {
  let time = Date.now();
  const security = createSecurity(
    credentials("test-password-123", "test-telemetry-key"),
    () => time,
  );
  const app = createApp({ dbPath: ":memory:", now: () => time, security });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const req = async (p, method = "GET", data, headers = {}) => {
    let r = await fetch(base + p, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: r.status, headers: r.headers, data: await r.json() };
  };
  try {
    assert.equal((await req("/api/health")).status, 200);
    for (const path of ["/api/state", "/api/backup", "/api/docs/readme"])
      assert.equal((await req(path)).status, 401);
    assert.equal(
      (
        await req("/api/state", "GET", null, {
          "X-API-Key": "test-telemetry-key",
        })
      ).status,
      401,
    );
    assert.equal(
      (await req("/api/auth/login", "POST", { password: "wrong" })).status,
      401,
    );
    const login = await req("/api/auth/login", "POST", {
      password: "test-password-123",
    });
    assert.equal(login.status, 200);
    const rawCookie = login.headers.get("set-cookie");
    assert.match(rawCookie, /HttpOnly/);
    assert.match(rawCookie, /SameSite=Strict/);
    const Cookie = rawCookie.split(";")[0];
    assert.equal(
      (await req("/api/state", "GET", null, { Cookie })).status,
      200,
    );
    assert.equal(
      (
        await req(
          "/api/settings",
          "PUT",
          { name: "ČOV" },
          { Cookie, Origin: "http://evil.example" },
        )
      ).status,
      403,
    );
    const sample = {
      device_id: "cov-monitor-01",
      sample_id: "auth-test",
      measurements: { temperature: 18.7 },
    };
    assert.equal((await req("/api/v1/telemetry", "POST", sample)).status, 401);
    assert.equal(
      (await req("/api/v1/telemetry", "POST", sample, { Cookie })).status,
      401,
    );
    assert.equal(
      (
        await req("/api/v1/telemetry", "POST", sample, {
          "X-API-Key": "test-telemetry-key",
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await req("/api/v1/device/status", "GET", null, {
          Authorization: "Bearer test-telemetry-key",
        })
      ).data.online,
      true,
    );
    time += 12 * 3600000 + 1;
    assert.equal(
      (await req("/api/state", "GET", null, { Cookie })).status,
      401,
    );
    const login2 = await req("/api/auth/login", "POST", {
        password: "test-password-123",
      }),
      cookie2 = login2.headers.get("set-cookie").split(";")[0];
    await req("/api/auth/logout", "POST", null, { Cookie: cookie2 });
    assert.equal(
      (await req("/api/state", "GET", null, { Cookie: cookie2 })).status,
      401,
    );
    for (let i = 0; i < 5; i++)
      await req("/api/auth/login", "POST", { password: "bad" });
    assert.equal(
      (await req("/api/auth/login", "POST", { password: "bad" })).status,
      429,
    );
  } finally {
    app.close();
  }
});
