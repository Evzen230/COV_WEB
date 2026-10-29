const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server.cjs");
test("Každý zapnutý senzor má nezávislý alarm výpadku, obnovu a volitelné meze", async () => {
  let time = Date.now(),
    seq = 0;
  const app = createApp({
    security: require("./security-helper.cjs"),
    dbPath: ":memory:",
    now: () => time,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (url, method = "GET", body) => {
    const res = await fetch(base + url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };
  const good = {
    temperature: 18.7,
    level: 64,
    ph: 7.2,
    ec: 842,
    turbidity: 12.4,
    orp: 185,
  };
  const send = async (measurements) => {
    time += 1000;
    return call("/api/v1/telemetry", "POST", {
      device_id: "cov-monitor-01",
      sample_id: "sensor-test-" + seq++,
      timestamp: new Date(time).toISOString(),
      measurements,
    });
  };
  try {
    let state = (await call("/api/state")).data;
    const rules = Object.fromEntries(
      Object.keys(good).map((key) => [
        key,
        { enabled: true, min: null, max: null },
      ]),
    );
    state = (
      await call("/api/settings", "PUT", {
        ...state.settings,
        alarmDelaySeconds: 0,
        mode: "live",
        sensorRules: rules,
      })
    ).data;
    await send(good);
    assert.equal((await call("/api/state")).data.alarms.length, 0);
    for (const key of Object.keys(good)) {
      const id = key === "temperature" ? "sensor" : "sensor" + key;
      await send({ ...good, [key]: null });
      let alarms = (await call("/api/state")).data.alarms;
      assert.deepEqual(
        alarms.map((a) => a.id),
        [id],
      );
      assert.equal(
        (await call("/api/alarms/" + id + "/ack", "POST")).status,
        200,
      );
      await send(good);
      assert.equal((await call("/api/state")).data.alarms.length, 0);
      await send({ ...good, [key]: null });
      assert.equal(
        (await call("/api/state")).data.alarms.find((a) => a.id === id)
          .acknowledged,
        0,
      );
      await send(good);
    }
    const missing = { ...good };
    delete missing.ec;
    await send(missing);
    assert.ok(
      (await call("/api/state")).data.alarms.some((a) => a.id === "sensorec"),
    );
    rules.ec.enabled = false;
    await call("/api/settings", "PUT", {
      ...state.settings,
      sensorRules: rules,
    });
    assert.equal((await call("/api/state")).data.alarms.length, 0);
    rules.ph.min = 6;
    rules.ph.max = 8;
    await call("/api/settings", "PUT", {
      ...state.settings,
      sensorRules: rules,
    });
    await send({ ...good, ph: 9 });
    assert.ok(
      (await call("/api/state")).data.alarms.some((a) => a.id === "rangeph"),
    );
    await send(good);
    assert.equal((await call("/api/state")).data.alarms.length, 0);
    assert.equal(
      (
        await call("/api/settings", "PUT", {
          ...state.settings,
          sensorRules: { ...rules, ph: { enabled: true, min: 9, max: 8 } },
        })
      ).status,
      400,
    );
    time += 16 * 60000;
    assert.deepEqual(
      (await call("/api/state")).data.alarms.map((a) => a.id),
      ["offline"],
    );
  } finally {
    app.close();
  }
});
