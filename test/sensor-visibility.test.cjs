const { test } = require("node:test");
const assert = require("node:assert/strict");
test("Skryté senzory zmizí ze zobrazení a lze je obnovit bez ztráty dat", async () => {
  const state = await import("../dist/js/core/state.js");
  const dashboard = await import("../dist/js/components/dashboard.js");
  const { historyPage } = await import("../dist/js/pages/history.js");
  const { stationStatus } = await import("../dist/js/core/utils.js");
  const sample = { time: Date.now(), temperature: 18, level: 50, ph: null, ec: 800, turbidity: 12, orp: 180 };
  const data = {
    settings: { tempMin: 8, tempMax: 30, levelMax: 85, stale: 15, tankVolume: 2400, hiddenSensors: ["ph", "level"] },
    station: { online: true, latest: sample }, history: [sample], labs: [], service: [], events: [], alarms: [],
  };
  state.setView({ metric: "ph" });
  state.applyState(data);
  assert.equal(state.metric, "temperature");
  assert.equal(stationStatus().kind, "ok");
  for (const html of [dashboard.metrics(), dashboard.sensorTable(), historyPage()]) {
    assert.ok(!html.includes("pH vody"));
    assert.ok(!html.includes("Hladina nádrže"));
  }
  assert.ok(!dashboard.process().includes("AKTIVAČNÍ NÁDRŽ"));
  assert.equal(state.history[0].level, 50);
  state.applyState({ ...data, settings: { ...data.settings, hiddenSensors: state.sensors.map(s => s.id) } });
  assert.match(dashboard.chart(), /Všechny senzory jsou skryté/);
  state.applyState({ ...data, settings: { ...data.settings, hiddenSensors: [] } });
  assert.match(dashboard.sensorTable(), /pH vody/);
  assert.match(dashboard.process(), /AKTIVAČNÍ NÁDRŽ/);
});
