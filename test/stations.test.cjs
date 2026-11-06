const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server.cjs");
const { credentials, createSecurity } = require("../server/security.cjs");

async function start(options) {
  const app = createApp(options);
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    app,
    request: async (url, method = "GET", body, headers = {}) => {
      const response = await fetch(base + url, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        headers: response.headers,
        data: await response.json(),
      };
    },
  };
}

test("Station outage timeout is configurable from two minutes and clears on recovery", async () => {
  let time = Date.now();
  const { app, request } = await start({
    dbPath: ":memory:",
    security: require("./security-helper.cjs"),
    now: () => time,
  });
  try {
    const settings = (await request("/api/state")).data.settings;
    const save = (stale) => request("/api/settings", "PUT", { ...settings, stale });
    assert.equal((await save(1)).status, 400);
    assert.equal((await save(121)).status, 400);
    assert.equal((await save(2)).status, 200);
    const send = (sample_id) => request("/api/v1/telemetry", "POST", {
      device_id: "cov-monitor-01",
      sample_id,
      measurements: { temperature: 20, level: 10 },
    });
    assert.equal((await send("before-outage")).status, 201);
    time += 119999;
    assert.ok(!(await request("/api/state")).data.alarms.some((a) => a.id === "offline"));
    time += 2;
    assert.ok((await request("/api/state")).data.alarms.some((a) => a.id === "offline"));
    assert.equal((await save(5)).status, 200);
    assert.ok(!(await request("/api/state")).data.alarms.some((a) => a.id === "offline"));
    time += 180000;
    assert.ok((await request("/api/state")).data.alarms.some((a) => a.id === "offline"));
    assert.equal((await send("after-outage")).status, 201);
    assert.ok(!(await request("/api/state")).data.alarms.some((a) => a.id === "offline"));
  } finally {
    app.close();
  }
});

test("Multiple ESPs combine assigned sensors in one plant, with independent freshness and shared records", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cov-stations-"));
  let time = Date.now();
  const options = {
    dbPath: path.join(directory, "cov.sqlite"),
    security: require("./security-helper.cjs"),
    now: () => time,
  };
  let { app, request } = await start(options);
  try {
    assert.equal(
      (await request("/api/stations", "POST", { id: "../bad", name: "Bad" }))
        .status,
      400,
    );
    assert.equal(
      (
        await request("/api/stations", "POST", {
          id: "outdoor",
          name: "Venkovní ESP",
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request("/api/stations", "POST", {
          id: "outdoor",
          name: "Duplicate",
        })
      ).status,
      409,
    );
    const initial = (await request("/api/state")).data;
    const settings = {
      ...initial.settings,
      alarmDelaySeconds: 0,
      sensorSources: {
        ...initial.settings.sensorSources,
        level: "outdoor",
        ph: "outdoor",
      },
      sensorRules: {
        ...initial.settings.sensorRules,
        level: { enabled: true, min: null, max: null },
        ph: { enabled: true, min: null, max: null },
      },
    };
    assert.equal(
      (
        await request("/api/settings", "PUT", {
          ...settings,
          sensorSources: { level: "unknown" },
        })
      ).status,
      400,
    );
    assert.equal((await request("/api/settings", "PUT", settings)).status, 200);
    const send = (id, sample_id, measurements, extra = {}) =>
      request("/api/v1/telemetry", "POST", {
        device_id: id,
        sample_id,
        measurements,
        ...extra,
      });
    const results = await Promise.all([
      send("cov-monitor-01", "same-id", { temperature: 20, level: 10 }),
      send("outdoor", "same-id", { temperature: 5, level: 70, ph: 7.1 }),
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      [201, 201],
    );
    assert.equal(
      (await send("outdoor", "same-id", { temperature: 5, level: 70, ph: 7.1 }))
        .data.duplicate,
      true,
    );
    let state = (await request("/api/state")).data;
    assert.equal(state.settings.name, initial.settings.name);
    assert.equal(state.station.latest.temperature, 20);
    assert.equal(state.station.latest.level, 70);
    assert.equal(state.station.latest.ph, 7.1);
    assert.equal(
      state.stations.find((s) => s.id === "outdoor").latest.temperature,
      5,
    );
    assert.equal(state.sensorStatus.level.station_id, "outdoor");
    assert.equal(state.alarms.length, 0);
    assert.deepEqual(
      new Set(state.history.map((r) => r.device_id)),
      new Set(["cov-monitor-01", "outdoor"]),
    );
    time += 1000;
    await send("cov-monitor-01", "next", { temperature: 21 });
    state = (await request("/api/state")).data;
    assert.equal(
      state.station.latest.level,
      70,
      "Missing fields from another ESP must not clear outdoor readings",
    );
    await send("outdoor", "null", { level: null, ph: 7.2 });
    state = (await request("/api/state")).data;
    assert.equal(state.station.latest.level, null);
    assert.equal(state.station.latest.temperature, 21);
    assert.ok(state.alarms.some((a) => a.id === "sensorlevel"));
    time += 16 * 60000;
    await send("outdoor", "fresh", { level: 75, ph: 7.3 });
    state = (await request("/api/state")).data;
    assert.equal(state.station.online, true);
    assert.equal(
      state.station.latest.temperature,
      null,
      "Offline primary must not borrow outdoor temperature",
    );
    assert.equal(state.station.latest.level, 75);
    assert.equal(state.sensorStatus.temperature.status, "stale");
    assert.deepEqual(
      state.alarms.map((a) => a.id),
      ["offline"],
    );
    await send("cov-monitor-01", "fresh", { temperature: 19 });
    // Replaying an old outdoor sample does not replace its newest reading.
    await send(
      "outdoor",
      "late",
      { level: 3 },
      { timestamp: new Date(time - 10 * 60000).toISOString() },
    );
    assert.equal((await request("/api/state")).data.station.latest.level, 75);
    time += 16 * 60000;
    await send("cov-monitor-01", "still-alive", { temperature: 19 });
    state = (await request("/api/state")).data;
    assert.equal(state.station.latest.temperature, 19);
    assert.equal(state.station.latest.level, null);
    assert.ok(state.alarms.some((a) => a.id === "offline-outdoor"));
    assert.equal(
      (await request("/api/alarms/offline-outdoor/ack", "POST")).status,
      200,
    );
    assert.equal(
      (await request("/api/v1/device/status?device_id=outdoor")).data.online,
      false,
    );
    assert.equal((await request("/api/v1/device/status")).data.online, true);
    await request("/api/service", "POST", {
      date: "2026-10-30",
      type: "Kontrola",
      device: "Venkovní ESP",
      note: "Provedena",
    });
    assert.equal(
      (await request("/api/state?station=outdoor")).data.service.length,
      1,
    );
    await request("/api/stations/outdoor", "PUT", { name: "Vnější měření" });
    const backup = (await request("/api/backup")).data;
    assert.equal(backup.all_samples.length, 8);
    app.close();
    ({ app, request } = await start(options));
    state = (await request("/api/state")).data;
    assert.equal(
      state.stations.find((s) => s.id === "outdoor").name,
      "Vnější měření",
    );
    assert.equal(state.settings.sensorSources.level, "outdoor");
    assert.equal(state.service.length, 1);
    assert.equal(state.history.length, 8);
    assert.equal(
      state.alarms.find((a) => a.id === "offline-outdoor").acknowledged,
      1,
    );
    const frontend = await import("../dist/js/core/state.js");
    const utils = await import("../dist/js/core/utils.js");
    frontend.applyState(state);
    frontend.setView({ metric: "temperature", chartStation: "" });
    assert.ok(
      utils.filtered().every((row) => row.device_id === "cov-monitor-01"),
    );
    frontend.setView({ metric: "level" });
    assert.ok(utils.filtered().every((row) => row.device_id === "outdoor"));
    frontend.setView({ metric: "temperature", chartStation: "outdoor" });
    assert.equal(
      utils.filtered()[0].temperature,
      5,
      "Graph can show the second temperature separately",
    );
    assert.deepEqual(
      utils.alarmLimits("temperature"),
      [],
      "Main sensor alarm limits must not be shown on a different source",
    );
  } finally {
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Station management and data require a session; device status accepts only a station key", async () => {
  const security = createSecurity(
    credentials("station-password", "telemetry-key"),
  );
  const { app, request } = await start({ dbPath: ":memory:", security });
  try {
    const station = { id: "outdoor", name: "Venkovní ESP" };
    assert.equal((await request("/api/stations", "POST", station)).status, 401);
    assert.equal(
      (
        await request("/api/stations", "POST", station, {
          "X-API-Key": "telemetry-key",
        })
      ).status,
      401,
    );
    const login = await request("/api/auth/login", "POST", {
      password: "station-password",
    });
    const Cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (
        await request("/api/stations", "POST", station, {
          Cookie,
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/stations", "POST", station, { Cookie })).status,
      201,
    );
    assert.equal(
      (await request("/api/stations/outdoor", "PUT", { name: "Other" })).status,
      401,
    );
    assert.equal(
      (await request("/api/state", "GET", null, { Cookie })).data.stations
        .length,
      2,
    );
    assert.equal(
      (
        await request("/api/v1/device/status?device_id=outdoor", "GET", null, {
          "X-API-Key": "telemetry-key",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/v1/device/status?device_id=unknown", "GET", null, {
          "X-API-Key": "telemetry-key",
        })
      ).status,
      400,
    );
    await request("/api/auth/logout", "POST", null, { Cookie });
    assert.equal(
      (await request("/api/state", "GET", null, { Cookie })).status,
      401,
    );
  } finally {
    app.close();
  }
});

test("Earlier separate station databases import once into the shared plant without losing records", async () => {
  const { DatabaseSync } = require("node:sqlite");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cov-station-migration-"),
  );
  const dbPath = path.join(directory, "cov.sqlite");
  const options = { dbPath, security: require("./security-helper.cjs") };
  let app = createApp(options);
  app.db
    .prepare("INSERT OR REPLACE INTO kv VALUES('stations',?)")
    .run(JSON.stringify(["outdoor"]));
  app.close();
  const previous = new DatabaseSync(dbPath + ".outdoor.sqlite");
  previous.exec(
    "CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE samples(source TEXT,sample_id TEXT,time INTEGER,received INTEGER,value TEXT);CREATE TABLE records(id TEXT,kind TEXT,value TEXT);",
  );
  previous
    .prepare("INSERT INTO kv VALUES('settings',?)")
    .run(JSON.stringify({ name: "Vnější měření" }));
  previous
    .prepare("INSERT INTO samples VALUES('live','old-1',?,?,?)")
    .run(Date.now(), Date.now(), JSON.stringify({ level: 60 }));
  const record = {
    id: "service-import",
    date: "2026-10-30",
    type: "Kontrola",
    device: "ESP",
    note: "OK",
  };
  previous
    .prepare("INSERT INTO records VALUES(?,?,?)")
    .run(record.id, "service", JSON.stringify(record));
  previous.close();
  try {
    for (let i = 0; i < 2; i++) {
      const started = await start(options);
      app = started.app;
      const state = (await started.request("/api/state")).data;
      assert.equal(
        state.stations.find((s) => s.id === "outdoor").name,
        "Vnější měření",
      );
      assert.equal(state.history.length, 1);
      assert.equal(state.history[0].device_id, "outdoor");
      assert.equal(state.service.length, 1);
      app.close();
      app = null;
    }
    assert.ok(fs.existsSync(dbPath + ".outdoor.sqlite"));
  } finally {
    app?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Removing a station preserves history, resets sources and persists across restart", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cov-remove-station-"),
  );
  const options = {
    dbPath: path.join(directory, "cov.sqlite"),
    security: require("./security-helper.cjs"),
  };
  let { app, request } = await start(options);
  try {
    await request("/api/stations", "POST", { id: "outdoor", name: "Outdoor" });
    // Legacy migration must not recreate a removed station on restart.
    app.db
      .prepare("INSERT OR REPLACE INTO kv VALUES('stations',?)")
      .run(JSON.stringify(["outdoor"]));
    const settings = (await request("/api/state")).data.settings;
    await request("/api/settings", "PUT", {
      ...settings,
      sensorSources: {
        ...settings.sensorSources,
        level: "outdoor",
        blower: "outdoor",
      },
    });
    await request("/api/v1/telemetry", "POST", {
      device_id: "outdoor",
      sample_id: "keep",
      measurements: { level: 70 },
    });
    assert.equal(
      (await request("/api/stations/cov-monitor-01", "DELETE")).status,
      409,
    );
    assert.equal(
      (await request("/api/stations/unknown", "DELETE")).status,
      404,
    );
    assert.equal(
      (await request("/api/stations/outdoor", "DELETE")).status,
      200,
    );
    let state = (await request("/api/state")).data;
    assert.deepEqual(
      state.stations.map((s) => s.id),
      ["cov-monitor-01"],
    );
    assert.equal(state.settings.sensorSources.level, "cov-monitor-01");
    assert.equal(state.settings.sensorSources.blower, "cov-monitor-01");
    assert.equal(
      state.history.filter((s) => s.device_id === "outdoor").length,
      1,
    );
    assert.equal(
      (
        await request("/api/v1/telemetry", "POST", {
          device_id: "outdoor",
          sample_id: "blocked",
          measurements: { level: 70 },
        })
      ).status,
      400,
    );
    app.close();
    ({ app, request } = await start(options));
    state = (await request("/api/state")).data;
    assert.equal(state.stations.length, 1);
    assert.equal(state.settings.sensorSources.level, "cov-monitor-01");
  } finally {
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
