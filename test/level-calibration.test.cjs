const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server.cjs");

test("Nano distance calibration, invalid input, retries and independent stations", async () => {
  const app = createApp({
    dbPath: ":memory:",
    security: require("./security-helper.cjs"),
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, method = "GET", body) => {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  let sequence = 0;
  const message = (distance, device_id = "cov-monitor-01") => ({
    device_id,
    sample_id: `nano-${sequence++}`,
    measurements: { temperature: 18.5, distance_cm: distance },
    firmware_version: "0.3.0",
    hardware: "esp32-nano-v1",
  });
  const latest = async () => (await request("/api/state")).data.station.latest;
  try {
    assert.equal(
      (await request("/api/v1/telemetry", "POST", message(100))).status,
      201,
    );
    assert.equal((await latest()).level, null);
    assert.equal((await latest()).distance_cm, 100);
    const settings = (await request("/api/state")).data.settings;
    const calibration = { "cov-monitor-01": { emptyCm: 180, fullCm: 20 } };
    const configure = () =>
      request("/api/settings", "PUT", {
        ...settings,
        levelCalibration: calibration,
      });
    assert.equal((await configure()).status, 400);
    calibration["cov-monitor-01"].fullCm = 40;
    assert.equal((await configure()).status, 200);
    const original = message(110);
    assert.equal(
      (await request("/api/v1/telemetry", "POST", original)).status,
      201,
    );
    assert.equal((await latest()).level, 50);
    calibration["cov-monitor-01"].emptyCm = 250;
    assert.equal((await configure()).status, 200);
    assert.equal(
      (await request("/api/v1/telemetry", "POST", original)).data.duplicate,
      true,
    );
    assert.equal(
      (
        await request("/api/v1/telemetry", "POST", {
          ...original,
          measurements: { temperature: 19, distance_cm: 110 },
        })
      ).status,
      409,
    );
    for (const [distance, expected] of [
      [21, 100],
      [600, 0],
      [null, null],
    ]) {
      assert.equal(
        (await request("/api/v1/telemetry", "POST", message(distance))).status,
        201,
      );
      assert.equal((await latest()).level, expected);
    }
    for (const distance of [0, 20, 601, "110"])
      assert.equal(
        (await request("/api/v1/telemetry", "POST", message(distance))).status,
        400,
      );
    const ambiguous = message(100);
    ambiguous.measurements.level = 20;
    assert.equal(
      (await request("/api/v1/telemetry", "POST", ambiguous)).status,
      400,
    );
    assert.equal(
      (await request("/api/stations", "POST", { id: "outdoor", name: "Venku" }))
        .status,
      201,
    );
    assert.equal(
      (await request("/api/v1/telemetry", "POST", message(100, "outdoor")))
        .status,
      201,
    );
    const outdoor = (await request("/api/state")).data.stations.find(
      (s) => s.id === "outdoor",
    );
    assert.equal(outdoor.latest.level, null);
    calibration["cov-monitor-01"].fullCm = 250;
    assert.equal((await configure()).status, 400);
    calibration["cov-monitor-01"] = { emptyCm: 180, fullCm: 40 };
    calibration.unknown = { emptyCm: 180, fullCm: 40 };
    assert.equal((await configure()).status, 400);
    assert.equal(
      (
        await request("/api/settings", "PUT", {
          ...settings,
          levelCalibration: {},
        })
      ).status,
      200,
    );
    await request("/api/v1/telemetry", "POST", message(100));
    assert.equal((await latest()).level, null);
  } finally {
    await app.close();
  }
});
