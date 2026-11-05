const { test } = require("node:test");
const assert = require("node:assert/strict");
test("Stavy, alarmové hranice a trend vycházejí ze stavu stanice", async () => {
  const state = await import("../dist/js/core/state.js");
  const ui = await import("../dist/js/core/utils.js");
  const chart = await import("../dist/js/components/chart.js");
  const now = Date.now();
  const snapshot = {
    settings: {
      tempMin: 8,
      tempMax: 30,
      levelMax: 85,
      stale: 15,
      sensorRules: {
        ph: { enabled: true, min: 6.5, max: 8 },
        ec: { enabled: false, min: 1, max: 3000 },
      },
    },
    station: {
      online: true,
      latest: {
        temperature: 18,
        level: 83,
        ph: 7,
        ec: 800,
        turbidity: 12,
        orp: 185,
      },
    },
    history: [
      { time: now - 600000, level: 70 },
      { time: now, level: 83 },
    ],
    alarms: [{ id: "level", title: "Vysoká hladina", acknowledged: true }],
    labs: [],
    service: [],
    events: [],
  };
  state.applyState(snapshot);
  assert.match(ui.status({ id: "level" }), /Aktivní alarm/);
  assert.match(ui.status({ id: "ph" }), /V pořádku/);
  assert.equal(ui.stationStatus().kind, "alarm");
  assert.match(ui.levelTrend(), /Stoupá/);
  assert.equal(ui.alarmLimits("temperature").length, 2);
  assert.deepEqual(ui.alarmLimits("level"), [
    { value: 85, label: "Horní mez" },
  ]);
  assert.equal(ui.alarmLimits("ph").length, 2);
  assert.equal(ui.alarmLimits("ec").length, 0);
  state.setView({ metric: "ph" });
  assert.match(chart.chart(), /Dolní mez: 6,5/);
  assert.match(chart.chart(), /class="chart-limit"/);
  snapshot.settings.sensorRules.ph.max = 20;
  assert.equal(chart.chartScale("ph", []).max, 21);
  for (const [id, sensor] of [
    ["temp", "temperature"],
    ["sensor", "temperature"],
    ["rangeph", "ph"],
    ["sensorlevel", "level"],
  ]) {
    snapshot.alarms = [{ id, title: "Alarm" }];
    state.applyState(snapshot);
    assert.equal(ui.sensorAlarms(sensor).length, 1);
  }
  snapshot.alarms = [];
  snapshot.history[0].level = 90;
  state.applyState(snapshot);
  assert.match(ui.levelTrend(), /Klesá/);
  snapshot.history[0].level = 83.2;
  assert.match(ui.levelTrend(), /Stabilní/);
  snapshot.history = [{ time: now, level: 83 }];
  state.applyState(snapshot);
  assert.match(ui.levelTrend(), /málo dat/);
  snapshot.station.latest.level = null;
  assert.match(ui.levelTrend(), /není dostupný/);
  assert.equal(ui.stationStatus().kind, "warning");
  snapshot.station.online = false;
  assert.equal(ui.stationStatus().kind, "offline");
  state.setConnected(false);
  assert.match(ui.stationStatus().text, /Spojení/);
});
