const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise the actual JS embedded in the ESP portal, without requiring an ESP
// radio. The firmware build separately verifies its C++ handlers.
async function portal({
  saved = false,
  servers = ["http://cov.local:4173"],
  wifiFails = false,
  scanFails = false,
  connected = false,
} = {}) {
  const source = fs.readFileSync(
    require.resolve("../examples/esp32_display/display_setup.h"),
    "utf8",
  );
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map(
    [...source.matchAll(/id="([^"]+)"/g)].map((m) => [
      m[1],
      {
        value: "",
        textContent: "",
        className: "",
        hidden: m[1] === "wifi",
        disabled: false,
        options: [],
        replaceChildren(...items) {
          this.options = items;
        },
        add(item) {
          this.options.push(item);
        },
      },
    ]),
  );
  const calls = [];
  const context = vm.createContext({
    document: {
      getElementById: (id) => {
        assert.ok(elements.has(id), id);
        return elements.get(id);
      },
    },
    Option: function (text, value) {
      this.text = text;
      this.value = value;
    },
    fetch: async (url, request) => {
      assert.equal(request.method, "POST");
      assert.equal(request.headers["X-Setup-Token"], "__TOKEN__");
      calls.push({ url, data: JSON.parse(request.body) });
      const failed =
        (url === "/connect" && wifiFails) || (url === "/scan" && scanFails);
      return {
        ok: !failed,
        json: async () =>
          failed
            ? { error: "Test connection error" }
            : {
                "/status": {
                  ssid: saved ? "Home" : "",
                  server: saved ? "http://saved.local:4173" : "",
                  hasKey: saved,
                  connected,
                  candidateSsid: "Home-New",
                },
                "/scan": {
                  networks: [
                    { ssid: "Home", rssi: -48 },
                    { ssid: "<unsafe-network>", rssi: -70 },
                  ],
                },
                "/discover": { servers },
              }[url] || { message: "Saved" },
      };
    },
  });
  await vm.runInContext(script, context);
  return { el: (id) => elements.get(id), calls };
}

test("Display portal scans Wi-Fi on opening and discovers the server after connecting", async () => {
  const p = await portal();
  assert.deepEqual(
    p.calls.map((c) => c.url),
    ["/status", "/scan"],
  );
  assert.equal(p.el("networks").options[2].text, "<unsafe-network> (-70 dBm)");
  assert.equal(p.el("save").disabled, true);
  p.el("networks").value = "Home";
  p.el("networks").onchange();
  assert.equal(p.el("ssid").value, "Home");
  p.el("password").value = "home-password";
  await p.el("connect").onclick();
  assert.deepEqual(
    p.calls.slice(-2).map((c) => c.url),
    ["/connect", "/discover"],
  );
  assert.equal(p.el("server").value, "http://cov.local:4173");
  assert.equal(p.el("save").disabled, false);
  p.el("code").value = "ABCD-EFGH";
  await p.el("save").onclick();
  assert.deepEqual(p.calls.at(-1), {
    url: "/save",
    data: { server: "http://cov.local:4173", code: "ABCD-EFGH" },
  });
  assert.equal(p.el("code").value, "");
  assert.equal(p.el("password").value, "");
});

test("Failed Wi-Fi prevents saving, and editing the connected network requires reconnecting", async () => {
  const bad = await portal({ wifiFails: true });
  await bad.el("connect").onclick();
  assert.equal(bad.el("save").disabled, true);
  assert.equal(bad.el("message").className, "error");
  assert.ok(!bad.calls.some((c) => c.url === "/discover"));
  const good = await portal();
  await good.el("connect").onclick();
  good.el("ssid").value = "Another";
  good.el("ssid").oninput();
  assert.equal(good.el("save").disabled, true);
  assert.equal(good.el("discover").disabled, true);
});

test("Missing discovery allows manual addresses and saved devices retain their credential", async () => {
  const p = await portal({ saved: true, servers: [] });
  assert.equal(p.el("ssid").value, "Home");
  assert.equal(p.el("wifi").hidden, false);
  await p.el("connect").onclick();
  assert.match(p.el("message").textContent, /ručně/);
  assert.equal(p.el("server").value, "http://saved.local:4173");
  assert.equal(p.el("save").disabled, false);
  await p.el("wifi").onclick();
  assert.deepEqual(p.calls.at(-1), { url: "/wifi", data: {} });
});

test("Scan failure can be retried and multiple discovered servers require a choice", async () => {
  const failed = await portal({ scanFails: true });
  assert.equal(failed.el("message").className, "error");
  assert.equal(failed.el("scan").disabled, false);
  const p = await portal({
    servers: ["http://one.local:4173", "http://two.local:4173"],
  });
  await p.el("connect").onclick();
  assert.equal(p.el("server").value, "");
  p.el("servers").value = "http://two.local:4173";
  p.el("servers").onchange();
  assert.equal(p.el("server").value, "http://two.local:4173");
});

test("Reopening the portal after an AP channel change resumes server discovery", async () => {
  const p = await portal({ saved: true, connected: true });
  assert.deepEqual(
    p.calls.map((c) => c.url),
    ["/status", "/scan", "/discover"],
  );
  assert.equal(p.el("ssid").value, "Home-New");
  assert.equal(p.el("save").disabled, false);
});
