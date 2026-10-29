const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createApp } = require("../server.cjs");
test("HTTP příjem, SQLite, provoz bez vestavěného simulátoru, alarmy a deníky", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-test-")),
    dbPath = path.join(dir, "test.sqlite");
  let clock = Date.now(),
    app = createApp({
      security: require("./security-helper.cjs"),
      dbPath,
      now: () => clock,
    });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const req = async (p, method = "GET", body, headers = {}) => {
    let r = await fetch(base + p, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    let s = (await req("/api/state")).data;
    assert.equal(s.settings.mode, "live");
    s = (
      await req("/api/settings", "PUT", { ...s.settings, alarmDelaySeconds: 0 })
    ).data;
    assert.equal(s.history.length, 0);
    assert.equal(s.station.online, false);
    for (const id of ["readme", "api", "structure"]) {
      let doc = await req("/api/docs/" + id);
      assert.equal(doc.status, 200);
      assert.ok(doc.data.content.startsWith("# "));
    }
    assert.equal((await req("/api/docs/unknown")).status, 404);
    let download = await fetch(base + "/api/docs/readme?download=1");
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /README.md/);
    assert.match(await download.text(), /ČOV Monitor/);
    for (const file of [
      "/js/app.js",
      "/js/pages/guides.js",
      "/js/pages/overview.js",
      "/css/documentation.css",
    ]) {
      let asset = await fetch(base + file);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get("content-type"), /javascript|css/);
    }
    assert.equal((await fetch(base + "/data/cov.sqlite")).status, 404);
    const msg = {
      device_id: "cov-monitor-01",
      sample_id: "boot-a-1",
      timestamp: new Date(clock).toISOString(),
      measurements: { temperature: 18.7 },
      blower: false,
      rssi: -66,
    };
    assert.equal((await req("/api/v1/telemetry", "POST", msg)).status, 201);
    assert.equal(
      (await req("/api/v1/telemetry", "POST", msg)).data.duplicate,
      true,
    );
    assert.equal(
      (
        await req("/api/v1/telemetry", "POST", {
          ...msg,
          measurements: { temperature: 20 },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await req("/api/v1/telemetry", "POST", {
          ...msg,
          sample_id: "bad",
          measurements: { temperature: 999 },
        })
      ).status,
      400,
    );
    assert.equal(
      (await req("/api/v1/telemetry", "POST", { ...msg, device_id: "other" }))
        .status,
      400,
    );
    assert.equal(
      (
        await req("/api/v1/telemetry", "POST", {
          ...msg,
          sample_id: "future",
          timestamp: new Date(clock + 120000).toISOString(),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/api/v1/telemetry", "POST", {
          ...msg,
          sample_id: "null",
          measurements: { temperature: null },
        })
      ).status,
      201,
    );
    s = (await req("/api/state")).data;
    assert.equal(s.settings.mode, "live");
    assert.equal(s.history.length, 2);
    s = (await req("/api/settings", "PUT", { ...s.settings, mode: "live" }))
      .data;
    assert.equal(s.history.length, 2);
    assert.equal(s.station.latest.ph, null);
    assert.equal(s.station.latest.blower, false);
    clock += 16 * 60000;
    s = (await req("/api/state")).data;
    assert.equal(s.station.online, false);
    assert.ok(s.alarms.some((a) => a.id === "offline"));
    assert.equal((await req("/api/alarms/offline/ack", "POST")).status, 200);
    s = (await req("/api/state")).data;
    assert.equal(s.alarms.find((a) => a.id === "offline").acknowledged, 1);
    let high = {
      ...msg,
      sample_id: "boot-a-2",
      timestamp: new Date(clock).toISOString(),
      measurements: { temperature: 18.7, level: 93 },
    };
    await req("/api/v1/telemetry", "POST", high);
    s = (await req("/api/state")).data;
    assert.equal(s.station.online, true);
    assert.ok(!s.alarms.some((a) => a.id === "offline"));
    assert.ok(s.alarms.some((a) => a.id === "level"));
    clock += 1000;
    await req("/api/v1/telemetry", "POST", {
      ...high,
      sample_id: "boot-a-3",
      timestamp: new Date(clock).toISOString(),
      measurements: { temperature: null },
    });
    s = (await req("/api/state")).data;
    assert.ok(s.alarms.some((a) => a.id === "sensor"));
    assert.ok(!s.alarms.some((a) => a.id === "temp"));
    const service = {
      date: "2026-10-28",
      type: "Čištění",
      device: "Celá stanice",
      note: "Provedena kontrola",
    };
    assert.equal((await req("/api/service", "POST", service)).status, 201);
    assert.equal(
      (await req("/api/service", "POST", { ...service, date: "2026-02-31" }))
        .status,
      400,
    );
    assert.equal(
      (
        await req("/api/labs", "POST", {
          date: "2026-10-28",
          location: "Výpusť",
          parameter: "BSK5",
          value: 12.5,
          unit: "mg/l",
          lab: "Protokol 1",
          note: "",
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await req("/api/settings", "PUT", {
          ...s.settings,
          tempMin: 100,
          tempMax: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/api/settings", "PUT", s.settings, {
          Origin: "http://foreign.example",
        })
      ).status,
      403,
    );
    let backup = (await req("/api/backup")).data;
    assert.equal(
      backup.all_samples.filter((r) => r.source === "live").length,
      4,
    );
    assert.equal(backup.service.length, 1);
    // Upgrade an existing installation with an old demo setting/history.
    app.db
      .prepare("INSERT OR REPLACE INTO kv(key,value) VALUES('settings',?)")
      .run(JSON.stringify({ ...s.settings, mode: "demo" }));
    app.db
      .prepare(
        "INSERT INTO samples(source,sample_id,time,received,value) VALUES('demo','legacy-demo',?,?,?)",
      )
      .run(clock, clock, JSON.stringify({ temperature: 99 }));
    app.close();
    app = createApp({
      security: require("./security-helper.cjs"),
      dbPath,
      now: () => clock,
    });
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${app.server.address().port}`;
    s = (await req("/api/state")).data;
    assert.equal(s.settings.mode, "live");
    assert.equal(s.service.length, 1);
    assert.equal(s.labs.length, 1);
    assert.equal(s.history.length, 4);
    assert.equal(
      (await req("/api/service/" + s.service[0].id, "DELETE")).status,
      200,
    );
    assert.equal((await req("/api/state")).data.service.length, 0);
    assert.equal(
      (await req("/api/settings", "PUT", { ...s.settings, mode: "demo" }))
        .status,
      400,
    );
    assert.equal(
      (await req("/api/simulator", "PUT", { scenario: "high", paused: false }))
        .status,
      404,
    );
  } finally {
    app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
