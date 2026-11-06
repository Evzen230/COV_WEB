const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server.cjs");
const { credentials, createSecurity } = require("../server/security.cjs");
const { createDisplays } = require("../server/displays.cjs");

test("Display credentials persist only hashes, are independent and revoke immediately", () => {
  const data = new Map(),
    options = {
      get: (k, fallback) => data.get(k) ?? fallback,
      put: (k, v) => data.set(k, v),
    };
  const displays = createDisplays(options),
    a = displays.issue("Kitchen"),
    b = displays.issue("Hall");
  assert.ok(!JSON.stringify([...data]).includes(a.key));
  assert.ok(!JSON.stringify(displays.list()).includes("hash"));
  const restored = createDisplays(options);
  restored.authenticate({ headers: { "x-api-key": a.key } });
  restored.revoke(a.id);
  assert.throws(
    () => restored.authenticate({ headers: { "x-api-key": a.key } }),
    { status: 401 },
  );
  restored.authenticate({ headers: { authorization: "Bearer " + b.key } });
  assert.throws(() => restored.issue(""), { status: 400 });
});

test("Display API reads assigned sensor values/timestamps and server alarms, but cannot administer or write", async () => {
  let now = Date.now();
  const security = createSecurity(
    credentials("test-password", "station-key"),
    () => now,
  );
  const app = createApp({ dbPath: ":memory:", now: () => now, security });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function req(url, method = "GET", body, headers = {}) {
    const r = await fetch(base + url, {
      method,
      headers: {
        ...headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  try {
    const login = await req("/api/auth/login", "POST", {
      password: "test-password",
    });
    const admin = { Cookie: login.cookie };
    const guide = await req("/api/docs/extensions", "GET", null, admin);
    assert.equal(guide.status, 200);
    assert.match(JSON.stringify(guide.data), /Servisní LED/);
    assert.equal(
      (await req("/api/displays", "POST", { name: "Kitchen" })).status,
      401,
    );
    const issued = await req(
      "/api/displays",
      "POST",
      { name: "Kitchen" },
      admin,
    );
    assert.equal(issued.status, 201);
    const display = { "X-API-Key": issued.data.key };
    assert.equal(
      (
        await req("/api/v1/display", "GET", null, {
          "X-API-Key": "station-key",
        })
      ).status,
      401,
    );
    for (const [url, method, input] of [
      ["/api/state", "GET"],
      ["/api/backup", "GET"],
      ["/api/displays", "POST", { name: "bad" }],
      ["/api/settings", "PUT", { name: "bad" }],
      ["/api/network/connect", "POST", { ssid: "bad" }],
      ["/api/alarms/offline/ack", "POST"],
      ["/api/v1/telemetry", "POST", { measurements: { temperature: 99 } }],
      ["/api/v1/display", "POST", {}],
    ])
      assert.equal((await req(url, method, input, display)).status, 401, url);
    await req(
      "/api/stations",
      "POST",
      { id: "outside", name: "Outside" },
      admin,
    );
    const current = (await req("/api/state", "GET", null, admin)).data.settings;
    await req(
      "/api/settings",
      "PUT",
      {
        ...current,
        sensorSources: { ...current.sensorSources, temperature: "outside" },
      },
      admin,
    );
    const oldTime = now - 60000;
    await req(
      "/api/v1/telemetry",
      "POST",
      {
        device_id: "outside",
        sample_id: "one",
        timestamp: new Date(oldTime).toISOString(),
        measurements: { temperature: 18.5 },
      },
      { "X-API-Key": "station-key" },
    );
    await req(
      "/api/v1/telemetry",
      "POST",
      {
        device_id: "cov-monitor-01",
        sample_id: "two",
        measurements: { temperature: 99, level: 65 },
      },
      { "X-API-Key": "station-key" },
    );
    const read = await req("/api/v1/display", "GET", null, display);
    assert.equal(read.status, 200);
    assert.equal(read.data.version, 1);
    assert.equal(read.data.temperature.value, 18.5);
    assert.equal(read.data.temperature.measured_at, oldTime);
    assert.equal(read.data.level.value, 65);
    assert.equal(read.data.temperature.station_id, "outside");
    assert.ok(!("history" in read.data));
    now += 16 * 60000;
    const stale = (await req("/api/v1/display", "GET", null, display)).data;
    assert.equal(stale.temperature.status, "stale");
    assert.ok(stale.alarms.some((item) => item.title.includes("neodpovídá")));
    await req("/api/displays/" + issued.data.id, "DELETE", null, admin);
    assert.equal(
      (await req("/api/v1/display", "GET", null, display)).status,
      401,
    );
  } finally {
    await app.close();
  }
});
