const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  NetworkController,
  validateNetwork,
  splitNm,
} = require("../scripts/network-service.cjs");
const { networkRequest } = require("../server/network.cjs");

function fixture() {
  let clock = 0,
    uuid = "home",
    ethernet = false,
    rejectCandidate = false,
    rejectPrevious = false,
    pending = null;
  const calls = [],
    profiles = new Map();
  const nm = async (args) => {
    calls.push(args);
    const cmd = args.join(" ");
    if (cmd.includes("DEVICE,TYPE,STATE"))
      return `wlan0:wifi:${uuid ? "connected" : "disconnected"}\neth0:ethernet:${ethernet ? "connected" : "disconnected"}\n`;
    if (cmd.includes("GENERAL.CON-UUID")) return uuid + "\n";
    if (cmd.includes("802-11-wireless.ssid")) return "Home\n";
    if (cmd.includes("SSID,SIGNAL,SECURITY"))
      return "Home:80:WPA2\nMy\\:Network:60:WPA2\nHome:70:WPA2\n";
    if (cmd.includes("connection load")) return "";
    if (cmd.includes("connection delete")) {
      if (uuid === args.at(-1)) uuid = "";
      return "";
    }
    if (cmd.includes("connection up")) {
      const next = args.at(-1);
      if (
        (next !== "ap" && next !== "home" && rejectCandidate) ||
        (next === "home" && rejectPrevious)
      ) {
        uuid = "";
        throw Error("association failed");
      }
      uuid = next;
      return "";
    }
    throw Error("unexpected nmcli: " + cmd);
  };
  const controller = new NetworkController({
    config: { apUuid: "ap" },
    nm,
    now: () => clock,
    saveProfile: (id, text) => {
      profiles.set(id, text);
      return "/private/" + id;
    },
    removeProfile: (id) => profiles.delete(id),
    saveJob: (job) => {
      pending = job;
    },
  });
  return {
    controller,
    calls,
    profiles,
    disconnect: () => {
      uuid = "";
    },
    ethernet: (v) => {
      ethernet = v;
    },
    advance: (ms) => {
      clock += ms;
    },
    failCandidate: () => {
      rejectCandidate = true;
    },
    failPrevious: () => {
      rejectPrevious = true;
    },
    job: () => pending,
    uuid: () => uuid,
  };
}
test("Recovery waits five minutes for local connectivity and ignores an internet outage or connected Ethernet", async () => {
  const f = fixture();
  await f.controller.tick();
  f.advance(600000);
  await f.controller.tick();
  assert.equal(f.uuid(), "home");
  f.disconnect();
  f.ethernet(true);
  await f.controller.tick();
  f.advance(600000);
  await f.controller.tick();
  assert.equal(f.uuid(), "");
  f.ethernet(false);
  await f.controller.tick();
  f.advance(299999);
  await f.controller.tick();
  assert.equal(f.uuid(), "");
  f.advance(1);
  await f.controller.tick();
  assert.equal(f.uuid(), "ap");
});
test("Hidden WPA profiles keep passwords out of command arguments and persist successful changes", async () => {
  const f = fixture();
  await f.controller.connect({
    ssid: "My:Network",
    password: "private-password",
    hidden: true,
  });
  assert.equal(f.controller.lastResult, "connected");
  assert.equal(f.job(), null);
  assert.match([...f.profiles.values()][0], /hidden=true/);
  assert.ok(!JSON.stringify(f.calls).includes("private-password"));
  assert.equal((await f.controller.scan()).networks.length, 2);
  assert.equal((await f.controller.scan()).networks[1].ssid, "My:Network");
});
test("Wrong credentials restore the previous profile, or restore the setup AP when that is unavailable", async () => {
  for (const previousFails of [false, true]) {
    const f = fixture();
    f.failCandidate();
    if (previousFails) f.failPrevious();
    await f.controller.connect({ ssid: "Wrong", password: "wrong-password" });
    assert.equal(f.uuid(), previousFails ? "ap" : "home");
    assert.equal(f.profiles.size, 0);
    assert.equal(f.job(), null);
    assert.equal(f.controller.busy, false);
    assert.equal(f.controller.lastResult, "failed");
  }
  const f = fixture();
  f.failCandidate();
  f.failPrevious();
  const original = f.controller.nm;
  f.controller.nm = async (args) => {
    if (args.includes("up") && args.at(-1) === "ap")
      throw Error("temporary hotspot failure");
    return original(args);
  };
  await assert.rejects(
    f.controller.connect({ ssid: "Wrong", password: "wrong-password" }),
  );
  assert.ok(f.controller.pending);
  assert.ok(f.job());
  f.controller.nm = original;
  await f.controller.tick();
  assert.equal(f.uuid(), "ap");
  assert.equal(f.controller.pending, null);
  assert.equal(f.job(), null);
});
test("Interrupted Wi-Fi change rolls back on service restart", async () => {
  const f = fixture();
  f.disconnect();
  f.controller.pending = { candidate: "incomplete", previous: "home" };
  await f.controller.tick();
  assert.equal(f.uuid(), "home");
  assert.equal(f.controller.pending, null);
});

test("Ordinary watchdog polling does not reserve a network change or clear another operation", async () => {
  const f = fixture();
  const original = f.controller.nm;
  let resume;
  f.controller.nm = (args) =>
    args.includes("DEVICE,TYPE,STATE")
      ? new Promise((resolve) => {
          resume = async () => resolve(await original(args));
        })
      : original(args);
  const watcher = f.controller.tick();
  assert.equal(f.controller.busy, false);
  // Simulate a connection request claiming the transition during the read.
  f.controller.busy = true;
  await resume();
  await watcher;
  assert.equal(f.controller.busy, true);
  assert.equal(f.controller.checking, false);
});
test("Network input validation rejects keyfile injection; unsupported platforms are read-only", async () => {
  for (const ssid of ["bad\n[wifi-security]", "", "a".repeat(33)])
    assert.throws(() => validateNetwork({ ssid, password: "password123" }), {
      status: 400,
    });
  assert.throws(() => validateNetwork({ ssid: "home", password: "short" }), {
    status: 400,
  });
  assert.equal(
    validateNetwork({ ssid: "home", password: "a".repeat(64) }).ssid,
    "home",
  );
  assert.deepEqual(splitNm("My\\:Network:80:WPA2"), [
    "My:Network",
    "80",
    "WPA2",
  ]);
  assert.equal(
    (await networkRequest("status", null, { platform: "win32" })).available,
    false,
  );
  await assert.rejects(networkRequest("connect", {}, { platform: "win32" }), {
    status: 503,
  });
});
