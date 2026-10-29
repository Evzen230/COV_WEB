const { test } = require("node:test");
const assert = require("node:assert/strict");

test("Měřítko nezvětšuje malé rozdíly a nezakrývá hodnoty mimo rozsah", async () => {
  const { chartScale } = await import("../dist/js/components/chart.js");
  assert.deepEqual(
    chartScale("temperature", [{ temperature: 18.1 }, { temperature: 19.3 }]),
    { min: 0, max: 40, expanded: false },
  );
  assert.deepEqual(
    chartScale("temperature", [{ temperature: 18.6 }, { temperature: 18.7 }]),
    { min: 0, max: 40, expanded: false },
  );
  assert.deepEqual(chartScale("temperature", [{ temperature: null }]), {
    min: 0,
    max: 40,
    expanded: false,
  });
  assert.deepEqual(
    chartScale("temperature", [{ temperature: -2 }, { temperature: 47 }]),
    { min: -10, max: 50, expanded: true },
  );
  assert.deepEqual(chartScale("level", [{ level: 64 }]), {
    min: 0,
    max: 100,
    expanded: false,
  });
  assert.deepEqual(chartScale("ph", []), { min: 0, max: 14, expanded: false });
});

test("Kurzor vybírá nejbližší čas i při nepravidelných intervalech a výpadku čidla", async () => {
  const { nearestSample } = await import("../dist/js/components/chart.js");
  const rows = [
    { time: 100, temperature: 18.7 },
    { time: 110, temperature: null },
    { time: 900, temperature: 19.1 },
  ];
  assert.equal(nearestSample(rows, 109), 1);
  assert.equal(nearestSample(rows, 700), 2);
  assert.equal(nearestSample(rows, 0), 0);
  assert.equal(nearestSample(rows, 1000), 2);
  assert.equal(nearestSample(rows, 505), 1);
  assert.equal(nearestSample([], 100), -1);
  assert.equal(nearestSample([{ time: 100 }], 100), 0);
});
