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

test("Výpadek příjmu přeruší čáru i výplň a kurzor nenabízí měření uvnitř mezery", async () => {
  const { chartSegments, sampleAtTime } =
    await import("../dist/js/components/chart.js");
  const minute = 60000;
  const rows = [
    { time: 0, temperature: 18 },
    { time: minute, temperature: 19 },
    { time: 19 * 60 * minute, temperature: 20 },
    { time: 19 * 60 * minute + minute, temperature: 21 },
  ];
  assert.deepEqual(chartSegments(rows, "temperature", 15 * minute), [
    rows.slice(0, 2),
    rows.slice(2),
  ]);
  assert.equal(sampleAtTime(rows, 10 * 60 * minute, 15 * minute), -1);
  assert.equal(sampleAtTime(rows, rows[1].time, 15 * minute), 1);
  assert.equal(sampleAtTime(rows, rows[2].time, 15 * minute), 2);
  assert.equal(sampleAtTime(rows, minute / 2, 15 * minute), 0);
  assert.deepEqual(chartSegments([], "temperature"), []);
  assert.deepEqual(
    chartSegments([{ time: 0, temperature: null }], "temperature"),
    [],
  );
  const missing = [
    { time: 0, temperature: 18 },
    { time: minute, temperature: null },
    { time: 2 * minute, temperature: 19 },
  ];
  assert.deepEqual(chartSegments(missing, "temperature", 15 * minute), [
    [missing[0]],
    [missing[2]],
  ]);
  const boundary = [
    { time: 0, temperature: 18 },
    { time: 15 * minute, temperature: 19 },
  ];
  assert.equal(chartSegments(boundary, "temperature", 15 * minute).length, 1);
  boundary[1].time++;
  assert.equal(chartSegments(boundary, "temperature", 15 * minute).length, 2);
});
