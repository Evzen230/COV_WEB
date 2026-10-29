const { test } = require("node:test");
const assert = require("node:assert/strict");
const { outsideBand, stabilize } = require("../server/alarm-policy.cjs");
const { createApp } = require("../server.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");

test("Čekání na alarm přežije restart; změna mezí může alarm ukončit", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cov-pending-"));
  const dbPath = path.join(directory, "test.sqlite");
  let time = Date.now();
  const options = {
    dbPath,
    now: () => time,
    security: require("./security-helper.cjs"),
  };
  let app = createApp(options);
  const listen = async () => {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  try {
    let base = await listen();
    await fetch(base + "/api/v1/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: "cov-monitor-01",
        sample_id: "persist-1",
        measurements: { temperature: 35 },
      }),
    });
    assert.equal(
      JSON.parse(
        app.db.prepare("SELECT value FROM kv WHERE key='pendingAlarms'").get()
          .value,
      ).temp,
      time,
    );
    time += 30000;
    app.close();
    app = createApp(options);
    base = await listen();
    let state = await (await fetch(base + "/api/state")).json();
    assert.equal(state.alarms.length, 0);
    time += 30000;
    state = await (await fetch(base + "/api/state")).json();
    assert.ok(state.alarms.some((a) => a.id === "temp"));
    const result = await fetch(base + "/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...state.settings, tempMax: 40 }),
    });
    assert.equal(result.status, 200);
    state = await result.json();
    assert.equal(state.alarms.length, 0);
  } finally {
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("Prodleva potlačí krátkou špičku a hysterese ukončí alarm až uvnitř návratového pásma", () => {
  const pending = {},
    active = new Set(),
    condition = [["temp", "Teplota", "Vysoká"]];
  assert.equal(stabilize(condition, active, pending, 60, 1000).length, 0);
  assert.equal(stabilize([], active, pending, 60, 10000).length, 0);
  assert.equal(stabilize(condition, active, pending, 60, 20000).length, 0);
  assert.equal(stabilize(condition, active, pending, 60, 79999).length, 0);
  assert.equal(stabilize(condition, active, pending, 60, 80000).length, 1);
  assert.equal(outsideBand(29.8, 8, 30, true, 0.5), true);
  assert.equal(outsideBand(29.5, 8, 30, true, 0.5), false);
  assert.equal(outsideBand(8.2, 8, 30, true, 0.5), true);
  assert.equal(outsideBand(8.5, 8, 30, true, 0.5), false);
  assert.equal(outsideBand(84, null, 85, true, 2), true);
  assert.equal(outsideBand(83, null, 85, true, 2), false);
});
test("Server vyhodnocuje čekající alarmy a per-senzorové časy včetně null a starých dat", async () => {
  let time = Date.now(),
    seq = 0;
  const app = createApp({
    dbPath: ":memory:",
    now: () => time,
    security: require("./security-helper.cjs"),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const send = async (temperature) => {
    await fetch(base + "/api/v1/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: "cov-monitor-01",
        sample_id: "delay-" + seq++,
        timestamp: new Date(time).toISOString(),
        measurements: { temperature },
      }),
    });
  };
  const state = async () => await (await fetch(base + "/api/state")).json();
  try {
    await send(35);
    assert.equal((await state()).alarms.length, 0);
    time += 59000;
    assert.equal((await state()).alarms.length, 0);
    time += 1000;
    assert.ok((await state()).alarms.some((a) => a.id === "temp"));
    await send(29.8);
    assert.ok((await state()).alarms.some((a) => a.id === "temp"));
    await send(29.5);
    assert.equal((await state()).alarms.length, 0);
    const lastValid = time;
    time += 1000;
    await send(null);
    let s = await state();
    assert.equal(s.sensorStatus.temperature.status, "missing");
    assert.equal(s.sensorStatus.temperature.last_valid_at, lastValid);
    assert.equal(s.sensorStatus.ph.last_valid_at, null);
    time += 16 * 60000;
    s = await state();
    assert.equal(s.sensorStatus.temperature.status, "stale");
    assert.deepEqual(
      s.alarms.map((a) => a.id),
      ["offline"],
    );
  } finally {
    app.close();
  }
});
