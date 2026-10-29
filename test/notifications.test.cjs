const { test } = require("node:test");
const assert = require("node:assert/strict");
test("Globální upozornění: skrytí platí jen pro jeden výskyt a zdroj, potvrzené alarmy se nevnucují", async () => {
  const { AlarmInbox } =
    await import("../dist/js/components/alarm-notifications.js");
  const inbox = new AlarmInbox();
  const alarm = { id: "offline", started: 100, acknowledged: 0 };
  assert.equal(inbox.visible([alarm], "live").length, 1);
  inbox.dismiss(alarm, "live");
  assert.equal(inbox.visible([alarm], "live").length, 0);
  assert.equal(inbox.visible([alarm], "demo").length, 1);
  assert.equal(inbox.visible([{ ...alarm, started: 200 }], "live").length, 1);
  assert.equal(
    inbox.visible([{ ...alarm, started: 200, acknowledged: 1 }], "live").length,
    0,
  );
  assert.equal(inbox.visible([], "live").length, 0);
});
