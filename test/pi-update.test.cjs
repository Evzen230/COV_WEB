const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
const crypto = require("node:crypto");
const source = fs.readFileSync(
  require.resolve("../scripts/pi-update.cjs"),
  "utf8",
);
async function simulate({
  healthy = true,
  tampered = false,
  interrupted = false,
  manual = false,
  acknowledge = true,
  invalidId = false,
  unsafePath = false,
  args = [],
} = {}) {
  const base = "/opt/cov-monitor",
    queue = "/var/lib/cov-monitor/updates",
    data = "/var/lib/cov-monitor/data";
  const files = new Map(),
    links = new Map([[base + "/current", base + "/releases/old"]]);
  const dirs = new Set([queue]);
  const modes = new Map();
  const put = (p, b) => files.set(p, Buffer.from(b));
  put(base + "/releases/old/package.json", '{"version":"0.3.0"}');
  put(data + "/cov.sqlite", "old database");
  put(data + "/cov.sqlite-wal", "old wal");
  put(data + "/cov.sqlite.second.sqlite", "station database");
  put(data + "/cov.sqlite.second.sqlite-wal", "station wal");
  put(data + "/auth.json", "original credentials");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  put(
    "/etc/cov-monitor/update-public.pem",
    publicKey.export({ type: "spki", format: "pem" }),
  );
  const bundle = Buffer.from(
    JSON.stringify({
      files: {
        "package.json": Buffer.from('{"version":"0.4.0"}').toString("base64"),
        "server.cjs": Buffer.from("// app").toString("base64"),
        "dist/index.html": Buffer.from("html").toString("base64"),
      },
    }),
  );
  const payload = Buffer.from(
    JSON.stringify({
      schema: 1,
      server: {
        version: "0.4.0",
        protocol: 1,
        sha256: crypto.createHash("sha256").update(bundle).digest("hex"),
      },
    }),
  );
  put(
    queue + "/request.json",
    JSON.stringify({
      operationId: "64880135-ecf7-4ca3-a75d-cef63a06cb32",
      payload: payload.toString("base64"),
      signature: crypto
        .sign(null, tampered ? Buffer.from("wrong") : payload, privateKey)
        .toString("base64"),
    }),
  );
  put(queue + "/server.bundle", bundle);
  if (manual) {
    const entry = {
      id: "d327eb3f-566b-4058-bf16-bdf0d56fde21",
      version: "0.2.0",
      created: "2026-11-06T08:00:00.000Z",
      previous: base + "/releases/older",
      backup: base + "/backups/earlier",
    };
    put(entry.previous + "/package.json", '{"version":"0.2.0"}');
    put(entry.backup + "/cov.sqlite", "earlier database");
    put(entry.backup + "/cov.sqlite-wal", "earlier wal");
    put(entry.backup + "/auth.json", "earlier credentials");
    put(entry.backup + "/cov.sqlite.second.sqlite", "earlier station");
    if (unsafePath) entry.previous = "/tmp/untrusted";
    put(base + "/rollback-history.json", JSON.stringify([entry]));
    put(
      queue + "/rollback-request.json",
      JSON.stringify({
        schema: 1,
        id: invalidId ? "../../other" : entry.id,
        acknowledgeDataLoss: acknowledge,
      }),
    );
    files.delete(queue + "/request.json");
  }
  if (interrupted) {
    for (const name of [
      "cov.sqlite",
      "cov.sqlite-wal",
      "auth.json",
      "cov.sqlite.second.sqlite",
      "cov.sqlite.second.sqlite-wal",
    ])
      put(base + "/backups/interrupted/" + name, files.get(data + "/" + name));
    put(
      base + "/transaction.json",
      JSON.stringify({
        previous: base + "/releases/old",
        backup: base + "/backups/interrupted",
      }),
    );
    put(data + "/cov.sqlite", "partially migrated");
    links.set(base + "/current", base + "/releases/broken");
  }
  const calls = [],
    fds = new Map();
  if (args.includes("--queue-rollback"))
    files.delete(queue + "/rollback-request.json");
  let nextFd = 1;
  const fakeFs = {
    constants: fs.constants,
    readdirSync: (directory) =>
      [...files.keys()]
        .filter(
          (p) =>
            p.startsWith(directory + "/") &&
            !p.slice(directory.length + 1).includes("/"),
        )
        .map((p) => p.slice(directory.length + 1)),
    existsSync: (p) => files.has(p) || links.has(p) || dirs.has(p),
    lstatSync: (p) => ({ isSymbolicLink: () => links.has(p) }),
    realpathSync: (p) => links.get(p) || p,
    openSync: (p, flags, mode = 0o666) => {
      if (flags & fs.constants.O_CREAT) {
        if (flags & fs.constants.O_EXCL && files.has(p)) throw Error("EEXIST");
        put(p, "");
        modes.set(p, mode & ~0o077);
      }
      if (!files.has(p)) throw Error("missing " + p);
      const fd = nextFd++;
      fds.set(fd, p);
      return fd;
    },
    fstatSync: (fd) => ({
      isFile: () => true,
      size: files.get(fds.get(fd)).length,
    }),
    closeSync: (fd) => fds.delete(fd),
    chmodSync: (p, mode) => modes.set(p, mode),
    fchmodSync: (fd, mode) => modes.set(fds.get(fd), mode),
    readFileSync: (p) => {
      const b = files.get(typeof p === "number" ? fds.get(p) : p);
      if (!b) throw Error("missing " + p);
      return b;
    },
    writeFileSync: (p, b, o) => {
      if (typeof p === "number") p = fds.get(p);
      if (o?.flag === "wx" && files.has(p)) throw Error("exists");
      if (!files.has(p)) modes.set(p, (o?.mode ?? 0o666) & ~0o077);
      put(p, b);
    },
    rmSync: (p) => {
      files.delete(p);
      links.delete(p);
    },
    unlinkSync: (p) => {
      if (!files.delete(p)) throw Error("missing unlink " + p);
    },
    mkdirSync: (p, options) => {
      let directory = p;
      while (!dirs.has(directory) && directory !== "/") {
        dirs.add(directory);
        modes.set(directory, (options?.mode ?? 0o777) & ~0o077);
        directory = require("node:path").posix.dirname(directory);
      }
    },
    symlinkSync: (target, p) => links.set(p, target),
    renameSync: (a, b) => {
      if (links.has(a)) {
        links.set(b, links.get(a));
        links.delete(a);
      } else {
        put(b, files.get(a));
        files.delete(a);
        modes.set(b, modes.get(a));
        modes.delete(a);
      }
    },
    copyFileSync: (a, b) =>
      put(
        b,
        files.get(
          a.startsWith("/proc/self/fd/")
            ? fds.get(Number(a.split("/").pop()))
            : a,
        ),
      ),
  };
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (
      command === "systemctl" &&
      args[0] === "start" &&
      /\/0\.4\.0-/.test(links.get(base + "/current"))
    ) {
      put(data + "/cov.sqlite", "new schema");
      put(data + "/cov.sqlite.second.sqlite", "new station schema");
      put(data + "/cov.sqlite.second.sqlite-wal", "new station wal");
    }
  };
  await vm.runInNewContext(source, {
    require: (name) =>
      name === "node:fs"
        ? fakeFs
        : name === "node:path"
          ? require("node:path").posix
          : name === "node:child_process"
            ? { execFileSync: run }
            : require(name),
    Buffer,
    console,
    process: { exitCode: 0, argv: ["node", "pi-update.cjs", ...args] },
    setTimeout: (callback) => {
      callback();
    },
    fetch: async () => ({
      ok: healthy,
      json: async () => ({
        ok: healthy,
        version: JSON.parse(
          files.get(links.get(base + "/current") + "/package.json"),
        ).version,
      }),
    }),
    AbortSignal,
  });
  return { files, links, calls, base, queue, data, modes };
}
test("Pi installer switches verified release and checks exact health version", async () => {
  const s = await simulate();
  assert.match(s.links.get(s.base + "/current"), /\/0\.4\.0-/);
  assert.equal(s.files.get(s.data + "/cov.sqlite").toString(), "new schema");
  assert.equal(s.files.has(s.base + "/transaction.json"), false);
  assert.equal(s.files.has(s.queue + "/request.json"), false);
  assert.match(
    JSON.parse(s.files.get(s.queue + "/status.json")).message,
    /dokončena/,
  );
  const job = JSON.parse(s.files.get(s.queue + "/status.json"));
  assert.equal(job.state, "succeeded");
  assert.equal(job.phase, "complete");
  assert.equal(job.version, "0.4.0");
  assert.equal(job.operationId, "64880135-ecf7-4ca3-a75d-cef63a06cb32");
});
test("Update under systemd UMask=0077 leaves code readable and public status visible while backups stay private", async () => {
  const s = await simulate();
  const release = s.links.get(s.base + "/current");
  for (const directory of [release, release + "/dist"])
    assert.equal(s.modes.get(directory), 0o755);
  for (const filename of ["server.cjs", "package.json", "dist/index.html"])
    assert.equal(s.modes.get(release + "/" + filename), 0o644);
  assert.equal(s.modes.get(s.queue + "/status.json"), 0o644);
  assert.equal(s.modes.get(s.queue + "/server-rollback.json"), 0o644);
  assert.equal(s.modes.get(s.base + "/rollback-history.json"), 0o600);
  const entry = JSON.parse(s.files.get(s.base + "/rollback-history.json"))[0];
  assert.equal(s.modes.get(entry.backup), 0o700);
});
test("Pi failed health check restores old code, database, WAL and credentials", async () => {
  const s = await simulate({ healthy: false });
  assert.equal(s.links.get(s.base + "/current"), s.base + "/releases/old");
  assert.equal(s.files.get(s.data + "/cov.sqlite").toString(), "old database");
  assert.equal(s.files.get(s.data + "/cov.sqlite-wal").toString(), "old wal");
  assert.equal(
    s.files.get(s.data + "/cov.sqlite.second.sqlite").toString(),
    "station database",
  );
  assert.equal(
    s.files.get(s.data + "/cov.sqlite.second.sqlite-wal").toString(),
    "station wal",
  );
  assert.equal(
    s.files.get(s.data + "/auth.json").toString(),
    "original credentials",
  );
  assert.match(
    JSON.parse(s.files.get(s.queue + "/status.json")).message,
    /obnovena záloha/,
  );
});
test("Pi rejects invalid signature before stopping monitoring", async () => {
  const s = await simulate({ tampered: true });
  assert.deepEqual(s.calls, []);
  assert.equal(s.links.get(s.base + "/current"), s.base + "/releases/old");
});
test("Pi recovers an interrupted installation from persistent transaction", async () => {
  const s = await simulate({ interrupted: true });
  assert.equal(s.links.get(s.base + "/current"), s.base + "/releases/old");
  assert.equal(s.files.get(s.data + "/cov.sqlite").toString(), "old database");
  assert.equal(s.files.has(s.base + "/transaction.json"), false);
});
test("Pi publishes recovery points after update without exposing backup paths", async () => {
  const s = await simulate();
  const catalogue = JSON.parse(s.files.get(s.queue + "/server-rollback.json"));
  assert.equal(catalogue.schema, 1);
  assert.equal(catalogue.entries[0].version, "0.3.0");
  assert.equal(catalogue.entries[0].backup, undefined);
  assert.equal(catalogue.entries[0].previous, undefined);
});
test("Manual rollback restores selected code, database, station data and credentials; preserves undo snapshot", async () => {
  const s = await simulate({ manual: true });
  assert.equal(s.links.get(s.base + "/current"), s.base + "/releases/older");
  assert.equal(
    s.files.get(s.data + "/cov.sqlite").toString(),
    "earlier database",
  );
  assert.equal(
    s.files.get(s.data + "/cov.sqlite.second.sqlite").toString(),
    "earlier station",
  );
  assert.equal(s.files.has(s.data + "/cov.sqlite.second.sqlite-wal"), false);
  assert.equal(
    s.files.get(s.data + "/auth.json").toString(),
    "earlier credentials",
  );
  const history = JSON.parse(s.files.get(s.base + "/rollback-history.json"));
  assert.equal(history.at(-1).version, "0.3.0");
  assert.equal(
    s.files.get(history.at(-1).backup + "/cov.sqlite").toString(),
    "old database",
  );
  assert.match(
    JSON.parse(s.files.get(s.queue + "/status.json")).message,
    /Obnova dokončena/,
  );
  assert.equal(s.files.has(s.base + "/transaction.json"), false);
  assert.equal(s.files.has(s.queue + "/rollback-request.json"), false);
});
test("Manual rollback failed startup restores the complete state before the attempt", async () => {
  const s = await simulate({ manual: true, healthy: false });
  assert.equal(s.links.get(s.base + "/current"), s.base + "/releases/old");
  assert.equal(s.files.get(s.data + "/cov.sqlite").toString(), "old database");
  assert.equal(
    s.files.get(s.data + "/cov.sqlite.second.sqlite").toString(),
    "station database",
  );
  assert.equal(
    s.files.get(s.data + "/auth.json").toString(),
    "original credentials",
  );
  assert.match(
    JSON.parse(s.files.get(s.queue + "/status.json")).message,
    /Obnova selhala/,
  );
});
test("Manual rollback requires explicit data-loss acknowledgement and a root-catalogue ID and path", async () => {
  for (const options of [
    { acknowledge: false },
    { invalidId: true },
    { unsafePath: true },
  ]) {
    const s = await simulate({ manual: true, ...options });
    assert.deepEqual(s.calls, []);
    assert.equal(s.links.get(s.base + "/current"), s.base + "/releases/old");
    assert.equal(
      s.files.get(s.data + "/cov.sqlite").toString(),
      "old database",
    );
  }
});
test("Offline CLI queues a selected recovery point without directly restarting the server", async () => {
  const s = await simulate({
    manual: true,
    args: [
      "--queue-rollback",
      "d327eb3f-566b-4058-bf16-bdf0d56fde21",
      "--accept-data-loss",
    ],
  });
  assert.equal(
    JSON.parse(s.files.get(s.queue + "/rollback-request.json"))
      .acknowledgeDataLoss,
    true,
  );
  assert.equal(s.links.get(s.base + "/current"), s.base + "/releases/old");
  assert.deepEqual(s.calls, []);
});
test("Interrupted manual rollback restores the pre-operation snapshot and consumes the pending request", async () => {
  const s = await simulate({ manual: true, interrupted: true });
  assert.equal(s.links.get(s.base + "/current"), s.base + "/releases/old");
  assert.equal(s.files.get(s.data + "/cov.sqlite").toString(), "old database");
  assert.equal(s.files.has(s.queue + "/rollback-request.json"), false);
  assert.equal(s.files.has(s.base + "/transaction.json"), false);
});
