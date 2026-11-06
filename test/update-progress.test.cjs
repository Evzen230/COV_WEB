const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../dist/js/components/update-progress.js");
const details = {
  component: "server",
  deviceId: "cov-monitor-01",
  monitor: true,
  expectedVersion: "0.3.2",
  initialVersion: "0.3.1",
  initialJobTime: "before",
};
test("Progress survives disconnect and temporary gateway failures, then confirms the matching completed job", async () => {
  const { createUpdateTracker } = await load();
  let current;
  const tracker = createUpdateTracker({
    read: async () => {
      if (current instanceof Error) throw current;
      return current;
    },
  });
  tracker.start(details);
  tracker.queued({ operationId: "ours", version: "0.3.2" });
  current = new TypeError("fetch failed");
  await tracker.poll();
  assert.equal(tracker.current().phase, "reconnecting");
  assert.equal(tracker.active(), true);
  current = Object.assign(Error("gateway unavailable"), { status: 503 });
  await tracker.poll();
  assert.equal(tracker.current().phase, "reconnecting");
  current = {
    current: "0.3.2",
    pending: true,
    job: {
      operationId: "ours",
      time: "after",
      state: "running",
      phase: "verifying",
      message: "Ověřuji spuštění…",
    },
  };
  await tracker.poll();
  assert.equal(tracker.current().phase, "verifying");
  assert.equal(tracker.active(), true);
  current = {
    ...current,
    pending: false,
    job: { ...current.job, state: "succeeded" },
  };
  await tracker.poll();
  assert.equal(tracker.current().phase, "success");
  assert.equal(tracker.active(), false);
  tracker.queued({ operationId: "late" });
  assert.equal(tracker.current().phase, "success");
});
test("Progress ignores stale or unrelated failures and reports actual rollback as failure", async () => {
  const { createUpdateTracker } = await load();
  let current = {
    current: "0.3.1",
    pending: true,
    job: { time: "before", state: "failed", message: "old failure" },
  };
  const tracker = createUpdateTracker({ read: async () => current });
  tracker.start(details);
  tracker.queued({ operationId: "ours" });
  await tracker.poll();
  assert.equal(tracker.current().phase, "queued");
  current.job = {
    operationId: "someone-else",
    time: "after",
    state: "failed",
    message: "another failure",
  };
  await tracker.poll();
  assert.equal(tracker.current().phase, "queued");
  current.job = {
    operationId: "ours",
    time: "after",
    state: "failed",
    message: "Aktualizace selhala; obnovena záloha",
  };
  await tracker.poll();
  assert.equal(tracker.current().phase, "error");
  assert.match(tracker.current().message, /obnovena záloha/);
});
test("Legacy updater messages work and a wrong final version is not called successful", async () => {
  const { createUpdateTracker } = await load();
  let current = {
    current: "0.3.1",
    pending: false,
    job: { time: "after", message: "Aktualizace dokončena: 0.3.2" },
  };
  const tracker = createUpdateTracker({ read: async () => current });
  tracker.start(details);
  tracker.queued({});
  await tracker.poll();
  assert.equal(tracker.current().phase, "error");
  tracker.start(details);
  tracker.queued({});
  current.current = "0.3.2";
  await tracker.poll();
  assert.equal(tracker.current().phase, "success");
});
test("ESP progress requires new telemetry with the expected version", async () => {
  const { createUpdateTracker } = await load();
  let current = { station: { version: "0.3.2", seen: "before" } };
  const tracker = createUpdateTracker({ read: async () => current });
  tracker.start({ ...details, component: "firmware", initialSeen: "before" });
  tracker.queued({});
  await tracker.poll();
  assert.equal(tracker.current().phase, "waiting-device");
  current.station.seen = "after";
  await tracker.poll();
  assert.equal(tracker.current().phase, "success");
});
test("Expired sessions pause progress until login; timeout remains an unconfirmed result", async () => {
  const { createUpdateTracker } = await load();
  let time = 0;
  let current = Object.assign(Error("login needed"), { status: 401 });
  const tracker = createUpdateTracker({
    now: () => time,
    read: async () => {
      if (current instanceof Error) throw current;
      return current;
    },
  });
  tracker.start(details);
  tracker.queued({});
  await tracker.poll();
  assert.equal(tracker.current().phase, "auth");
  assert.equal(tracker.active(), false);
  tracker.resume();
  assert.equal(tracker.active(), true);
  time = 300001;
  await tracker.poll();
  assert.equal(tracker.current().phase, "unknown");
  assert.notEqual(tracker.current().phase, "error");
});
test("A response from a cancelled operation cannot replace a new operation", async () => {
  const { createUpdateTracker } = await load();
  let finish;
  const tracker = createUpdateTracker({
    now: () => 0,
    read: () => new Promise((resolve) => (finish = resolve)),
  });
  tracker.start(details);
  tracker.queued({});
  const pending = tracker.poll();
  tracker.clear();
  tracker.start({ ...details, expectedVersion: "0.3.3" });
  finish({ current: "0.3.2", pending: false });
  await pending;
  assert.equal(tracker.current().expectedVersion, "0.3.3");
  assert.equal(tracker.current().phase, "preparing");
});
test("Progress banner shows an accessible spinner, blocks duplicate actions and safely restores station selection", async () => {
  const { updateTracker, mountUpdateProgress } = await load();
  const savedDocument = global.document;
  const picker = { disabled: false },
    controls = [{ disabled: false }, { disabled: false }];
  let banner;
  const close = {};
  const main = {
    before: (element) => {
      banner = element;
    },
  };
  global.document = {
    querySelector: (selector) =>
      selector === "#main"
        ? main
        : selector === "#update-progress"
          ? banner
          : selector === "#update-station"
            ? picker
            : null,
    querySelectorAll: () => controls,
    createElement: () => ({
      dataset: {},
      setAttribute(name, value) {
        this[name] = value;
      },
      querySelector: () => close,
      remove() {
        banner = null;
      },
    }),
  };
  try {
    updateTracker.start({
      component: "check",
      monitor: false,
      message: "Kontroluji aktualizace…",
    });
    mountUpdateProgress();
    assert.match(banner.innerHTML, /update-spinner/);
    assert.equal(banner["aria-busy"], "true");
    assert.equal(picker.disabled, true);
    assert.ok(controls.every((control) => control.disabled));
    updateTracker.finish("Chyba <script>test</script>");
    mountUpdateProgress();
    assert.ok(!banner.innerHTML.includes("update-spinner"));
    assert.ok(!banner.innerHTML.includes("<script>"));
    assert.equal(picker.disabled, false);
    assert.equal(banner["aria-busy"], "false");
    close.onclick();
    mountUpdateProgress();
    assert.equal(banner, null);
  } finally {
    updateTracker.clear();
    if (savedDocument === undefined) delete global.document;
    else global.document = savedDocument;
  }
});
