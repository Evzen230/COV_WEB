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
} = {}) {
  const base = "/opt/cov-monitor",
    queue = "/var/lib/cov-monitor/updates",
    data = "/var/lib/cov-monitor/data";
  const files = new Map(),
    links = new Map([[base + "/current", base + "/releases/old"]]);
  const dirs = new Set([queue]);
  const put = (p, b) => files.set(p, Buffer.from(b));
  put(base + "/releases/old/package.json", '{"version":"0.3.0"}');
  put(data + "/cov.sqlite", "old database");
  put(data + "/cov.sqlite-wal", "old wal");
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
      payload: payload.toString("base64"),
      signature: crypto
        .sign(null, tampered ? Buffer.from("wrong") : payload, privateKey)
        .toString("base64"),
    }),
  );
  put(queue + "/server.bundle", bundle);
  if (interrupted) {
    for (const name of ["cov.sqlite", "cov.sqlite-wal", "auth.json"])
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
  let nextFd = 1;
  const fakeFs = {
    constants: fs.constants,
    existsSync: (p) => files.has(p) || links.has(p) || dirs.has(p),
    lstatSync: (p) => ({ isSymbolicLink: () => links.has(p) }),
    realpathSync: (p) => links.get(p) || p,
    openSync: (p) => {
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
    readFileSync: (p) => {
      const b = files.get(typeof p === "number" ? fds.get(p) : p);
      if (!b) throw Error("missing " + p);
      return b;
    },
    writeFileSync: (p, b, o) => {
      if (o?.flag === "wx" && files.has(p)) throw Error("exists");
      put(p, b);
    },
    rmSync: (p) => {
      files.delete(p);
      links.delete(p);
    },
    unlinkSync: (p) => {
      if (!files.delete(p)) throw Error("missing unlink " + p);
    },
    mkdirSync: (p) => dirs.add(p),
    symlinkSync: (target, p) => links.set(p, target),
    renameSync: (a, b) => {
      if (links.has(a)) {
        links.set(b, links.get(a));
        links.delete(a);
      } else {
        put(b, files.get(a));
        files.delete(a);
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
      !links.get(base + "/current").endsWith("/old")
    )
      put(data + "/cov.sqlite", "new schema");
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
    process: { exitCode: 0 },
    setTimeout: (callback) => {
      callback();
    },
    fetch: async () => ({
      ok: healthy,
      json: async () => ({ ok: healthy, version: "0.4.0" }),
    }),
    AbortSignal,
  });
  return { files, links, calls, base, queue, data };
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
});
test("Pi failed health check restores old code, database, WAL and credentials", async () => {
  const s = await simulate({ healthy: false });
  assert.equal(s.links.get(s.base + "/current"), s.base + "/releases/old");
  assert.equal(s.files.get(s.data + "/cov.sqlite").toString(), "old database");
  assert.equal(s.files.get(s.data + "/cov.sqlite-wal").toString(), "old wal");
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
