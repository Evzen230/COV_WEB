const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("dist/js/theme-init.js", "utf8");
test("Motiv se nastaví před načtením aplikace, i podle systému a bez úložiště", () => {
  for (const [saved, system, expected] of [
    ["true", false, true],
    ["false", true, false],
    [null, true, true],
    [null, false, false],
  ]) {
    const classes = new Set();
    const root = {
      classList: {
        toggle(name, on) {
          if (on) classes.add(name);
          else classes.delete(name);
        },
      },
      style: {},
    };
    vm.runInNewContext(source, {
      document: { documentElement: root },
      localStorage: {
        getItem() {
          return saved;
        },
      },
      window: {
        matchMedia() {
          return { matches: system };
        },
      },
    });
    assert.equal(classes.has("dark"), expected);
    assert.equal(root.style.colorScheme, expected ? "dark" : "light");
  }
  assert.doesNotThrow(() =>
    vm.runInNewContext(source, {
      localStorage: {
        getItem() {
          throw Error("unavailable");
        },
      },
    }),
  );
  const html = fs.readFileSync("dist/index.html", "utf8");
  assert.ok(html.indexOf("/js/theme-init.js") < html.indexOf("/css/base.css"));
});
