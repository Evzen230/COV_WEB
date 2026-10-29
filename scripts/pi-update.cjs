// Install this file root-owned outside application releases. Invoked by systemd.
const fs = require("node:fs");
const path = require("node:path");
const { verify, createHash } = require("node:crypto");
const { execFileSync: run } = require("node:child_process");
const base = "/opt/cov-monitor",
  queue = "/var/lib/cov-monitor/updates";
const current = base + "/current",
  journal = base + "/transaction.json";
const status = (message) => {
  const temp = queue + "/status.next";
  fs.rmSync(temp, { force: true });
  fs.writeFileSync(
    temp,
    JSON.stringify({ message, time: new Date().toISOString() }),
    { flag: "wx", mode: 0o644 },
  );
  fs.renameSync(temp, queue + "/status.json");
};
function read(filename, max) {
  const fd = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max)
      throw Error("Neplatný aktualizační soubor");
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function switchTo(target) {
  fs.rmSync(base + "/next", { force: true });
  fs.symlinkSync(target, base + "/next");
  fs.renameSync(base + "/next", current);
}
function restore(t) {
  run("systemctl", ["stop", "cov-monitor.service"]);
  switchTo(t.previous);
  for (const name of [
    "cov.sqlite",
    "cov.sqlite-wal",
    "cov.sqlite-shm",
    "auth.json",
  ]) {
    const target = "/var/lib/cov-monitor/data/" + name;
    fs.rmSync(target, { force: true });
    if (fs.existsSync(t.backup + "/" + name)) {
      fs.copyFileSync(t.backup + "/" + name, target);
      run("chown", ["cov-monitor:cov-monitor", target]);
    }
  }
  run("sync", []);
  run("systemctl", ["start", "cov-monitor.service"]);
  fs.rmSync(journal, { force: true });
  run("sync", []);
  status("Obnovena předchozí verze a záloha dat.");
}
async function main() {
  if (fs.lstatSync(queue).isSymbolicLink() || fs.realpathSync(queue) !== queue)
    throw Error("Neplatný adresář fronty");
  if (fs.existsSync(journal)) {
    restore(JSON.parse(fs.readFileSync(journal)));
    return;
  }
  if (!fs.existsSync(queue + "/request.json")) return;
  let transaction;
  try {
    const envelope = JSON.parse(read(queue + "/request.json", 256 * 1024));
    const payload = Buffer.from(envelope.payload, "base64");
    const key = fs.readFileSync("/etc/cov-monitor/update-public.pem");
    if (!verify(null, payload, key, Buffer.from(envelope.signature, "base64")))
      throw Error("Neplatný podpis");
    const manifest = JSON.parse(payload),
      item = manifest.server;
    if (
      manifest.schema !== 1 ||
      item.protocol !== 1 ||
      !/^\d+\.\d+\.\d+$/.test(item.version)
    )
      throw Error("Neplatná verze");
    const previous = fs.realpathSync(current);
    const old = JSON.parse(fs.readFileSync(previous + "/package.json"))
      .version.split(".")
      .map(Number);
    const next = item.version.split(".").map(Number);
    const delta = next.findIndex((v, i) => v !== old[i]);
    if (delta < 0 || next[delta] <= old[delta])
      throw Error("Downgrade není povolen");
    const bytes = read(queue + "/server.bundle", 32 * 1024 * 1024);
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
      throw Error("Poškozený balíček");
    const bundle = JSON.parse(bytes);
    if (!bundle.files || Object.keys(bundle.files).length > 2000)
      throw Error("Neplatný balíček");
    for (const [name, value] of Object.entries(bundle.files)) {
      if (
        !/^(?:server\.cjs|package\.json|README\.md|(?:server|dist|docs|scripts)\/[a-zA-Z0-9_./-]+)$/.test(
          name,
        ) ||
        name.split("/").some((p) => !p || p === "." || p === "..") ||
        typeof value !== "string"
      )
        throw Error("Neplatná cesta v balíčku");
    }
    if (
      JSON.parse(Buffer.from(bundle.files["package.json"], "base64"))
        .version !== item.version ||
      !bundle.files["server.cjs"] ||
      !bundle.files["dist/index.html"]
    )
      throw Error("Neúplný balíček");
    const release = base + "/releases/" + item.version + "-" + Date.now();
    fs.mkdirSync(release, { recursive: true, mode: 0o755 });
    for (const [name, value] of Object.entries(bundle.files)) {
      const target = path.join(release, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(value, "base64"), {
        mode: 0o644,
        flag: "wx",
      });
    }
    status("Instalace: záloha a restart serveru.");
    run("systemctl", ["stop", "cov-monitor.service"]);
    const backup = base + "/backups/" + Date.now();
    try {
      fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
      // Server is stopped; copy database AND WAL before the new process can migrate data.
      for (const name of [
        "cov.sqlite",
        "cov.sqlite-wal",
        "cov.sqlite-shm",
        "auth.json",
      ])
        if (fs.existsSync("/var/lib/cov-monitor/data/" + name)) {
          const fd = fs.openSync(
            "/var/lib/cov-monitor/data/" + name,
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
          );
          try {
            if (!fs.fstatSync(fd).isFile())
              throw Error("Neplatný datový soubor");
            fs.copyFileSync("/proc/self/fd/" + fd, backup + "/" + name);
          } finally {
            fs.closeSync(fd);
          }
        }
      transaction = { previous, backup };
      run("sync", []);
      fs.writeFileSync(journal + ".tmp", JSON.stringify(transaction), {
        mode: 0o600,
      });
      run("sync", []);
      fs.renameSync(journal + ".tmp", journal);
      run("sync", []);
    } catch (e) {
      run("systemctl", ["start", "cov-monitor.service"]);
      throw e;
    }
    switchTo(release);
    run("sync", []);
    run("systemctl", ["start", "cov-monitor.service"]);
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch("http://127.0.0.1:4173/api/health", {
          signal: AbortSignal.timeout(1000),
        });
        const health = await r.json();
        if (r.ok && health.ok && health.version === item.version) {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!healthy) throw Error("Nová verze neprošla kontrolou");
    fs.unlinkSync(journal);
    transaction = null;
    run("sync", []);
    status("Aktualizace dokončena: " + item.version);
  } catch (error) {
    if (transaction) {
      restore(transaction);
      status("Aktualizace selhala; obnovena záloha: " + error.message);
    } else status("Aktualizace selhala: " + error.message);
  } finally {
    fs.rmSync(queue + "/request.json", { force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
