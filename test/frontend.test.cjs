const { test } = require("node:test");
const assert = require("node:assert/strict");
test("Moduly stránek zachovají dashboard a formuláře bez původních přepisů", async () => {
  const state = await import("../dist/js/core/state.js");
  state.applyState({
    settings: {
      name: "Domovní <ČOV>",
      mode: "live",
      interval: 5,
      tempMin: 8,
      tempMax: 30,
      levelMax: 85,
      stale: 15,
      tankVolume: 2400,
    },
    runtime: { scenario: "normal", paused: false },
    station: {
      online: true,
      latest: {
        temperature: 18.7,
        level: null,
        ph: null,
        ec: null,
        blower: null,
        rssi: -65,
      },
    },
    history: [
      { time: Date.now(), temperature: 18.7, level: null, ph: null, ec: null },
    ],
    labs: [],
    service: [],
    events: [],
    alarms: [],
  });
  global.location = { origin: "http://localhost:4173" };
  const overview = await import("../dist/js/pages/overview.js");
  const html = overview.overview();
  assert.match(html, /18,7/);
  assert.match(html, /Režim stanice/);
  assert.match(html, /Bez měření/);
  assert.match(html, /Neznámý stav/);
  assert.ok(!html.includes("Simulované měření"));
  const service = await import("../dist/js/pages/service.js");
  assert.ok(service.servicePage().includes("serviceform"));
  assert.ok(!service.servicePage().includes('name="author"'));
  const settings = await import("../dist/js/pages/settings.js");
  assert.ok(!settings.settingsPage().includes('name="mode"'));
  assert.ok(!settings.settingsPage().includes('id="scenario"'));
  assert.match(settings.settingsPage(), /name="tankVolume"/);
  assert.match(settings.settingsPage(), /sample_id/);
  for (const [filename, fn] of [
    ["history", "historyPage"],
    ["sensors", "sensorsPage"],
    ["alarms", "alarmsPage"],
    ["labs", "labsPage"],
  ]) {
    const page = await import("../dist/js/pages/" + filename + ".js");
    assert.match(page[fn](), /pagehead/);
  }
});
test("Dokumentace zobrazí kód, tabulky a bezpečné odkazy bez spouštění HTML", async () => {
  const { markdown } = await import("../dist/js/core/markdown.js");
  const html = markdown(
    '# Návod\n\n<script>alert(1)</script>\n\n[Škodlivý odkaz](javascript:alert)\n\n[API](docs/API.md)\n\n```js\nconst a = "<script>";\n```\n\n| Pole | Význam |\n| --- | --- |\n| value | Hodnota |\n\n1. Spustit server\n2. Připojit stanici',
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /href="#guides\/api"/);
  assert.match(html, /<pre><code>/);
  assert.match(html, /<table>/);
  assert.match(html, /<ol>/);
  assert.match(html, /&lt;script&gt;/);
});
