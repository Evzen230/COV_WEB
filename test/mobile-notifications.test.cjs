const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createNotifications } = require("../server/notifications.cjs");

test("Alarm transitions enqueue once through the API; recovery follows and test uses the transport", async () => {
  const { createApp } = require("../server.cjs");
  const sent = [];
  const app = createApp({
    dbPath: ":memory:",
    security: require("./security-helper.cjs"),
    notificationFetch: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return { ok: true };
    },
  });
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const request = async (url, method = "GET", value) => {
      const response = await fetch(base + url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: value ? JSON.stringify(value) : undefined,
      });
      assert.ok(response.ok, `HTTP ${response.status}`);
      return response.json();
    };
    await request("/api/notifications", "PUT", {
      enabled: true,
      topic: "cov-integration-123456",
    });
    const state = await request("/api/state");
    await request("/api/settings", "PUT", {
      ...state.settings,
      alarmDelaySeconds: 0,
    });
    const sample = async (temperature, id) =>
      request("/api/v1/telemetry", "POST", {
        device_id: "cov-monitor-01",
        sample_id: id,
        measurements: { temperature },
      });
    await sample(35, "hot");
    const queue = () =>
      JSON.parse(
        app.db
          .prepare("SELECT value FROM kv WHERE key='notificationQueue'")
          .get().value,
      );
    const before = queue().filter((item) =>
      item.title.toLowerCase().includes("teplot"),
    );
    assert.equal(
      before.filter((item) => item.title.startsWith("Alarm:")).length,
      1,
    );
    await request("/api/state");
    await request("/api/state");
    assert.equal(
      queue().filter(
        (item) =>
          item.title.toLowerCase().includes("teplot") &&
          item.title.startsWith("Alarm:"),
      ).length,
      1,
    );
    await sample(20, "normal");
    assert.equal(
      queue().filter(
        (item) =>
          item.title.toLowerCase().includes("teplot") &&
          item.title.startsWith("Obnoveno:"),
      ).length,
      1,
    );
    await request("/api/notifications/test", "POST", {});
    assert.ok(sent.length > 0);
  } finally {
    app.close();
  }
});

test("Mobile outbox survives restart, retries, preserves Unicode and does not resend success", async () => {
  const data = new Map();
  let time = 1000,
    calls = 0;
  const options = {
    get: (key, fallback) => structuredClone(data.get(key) ?? fallback),
    put: (key, value) => data.set(key, structuredClone(value)),
    now: () => time,
    token: "test-token",
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, "https://ntfy.sh/");
      assert.equal(options.headers.Authorization, "Bearer test-token");
      assert.equal(JSON.parse(options.body).title, "ČOV – porucha");
      return { ok: calls > 1, status: 503 };
    },
  };
  let client = createNotifications(options);
  assert.equal(client.enqueue("ignored", "disabled"), false);
  assert.throws(() => client.configure({ enabled: true, topic: "short" }));
  client.configure({ enabled: true, topic: "cov-secret-1234567890" });
  client.enqueue("ČOV – porucha", "Hladina překročena");
  await client.tick();
  assert.equal(client.view().pending, 1);
  assert.match(client.view().error, /503/);
  await client.tick();
  assert.equal(calls, 1);
  client.close();
  client = createNotifications(options);
  time += 15000;
  await client.tick();
  assert.equal(calls, 2);
  assert.equal(client.view().pending, 0);
  assert.equal(client.view().lastSent, time);
  await client.tick();
  assert.equal(calls, 2);
});

test("Disabling clears pending messages and late network completion cannot restore them", async () => {
  const data = new Map();
  let complete;
  const client = createNotifications({
    get: (key, fallback) => data.get(key) ?? fallback,
    put: (key, value) => data.set(key, value),
    fetcher: () => new Promise((resolve) => (complete = resolve)),
  });
  client.configure({ enabled: true, topic: "cov-secret-1234567890" });
  client.enqueue("Alarm", "Body");
  const pending = client.tick();
  client.configure({ enabled: false, topic: "" });
  complete({ ok: true });
  await pending;
  assert.equal(client.view().pending, 0);
  assert.equal(client.view().lastSent, null);
});
