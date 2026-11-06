// Install this file root-owned outside application releases. Invoked by systemd.
const fs = require("node:fs");
const path = require("node:path");
const { verify, createHash, randomUUID } = require("node:crypto");
const { execFileSync: run } = require("node:child_process");
const base = "/opt/cov-monitor",
  queue = "/var/lib/cov-monitor/updates";
const current = base + "/current",
  journal = base + "/transaction.json";
const historyFile = base + "/rollback-history.json";
let jobContext = {};
function identifyJob(request, version) {
  jobContext = { version };
  if (
    typeof request.operationId === "string" &&
    /^[a-f0-9-]{36}$/.test(request.operationId)
  )
    jobContext.operationId = request.operationId;
}
function atomicJson(filename, value, mode = 0o600) {
  const temp = filename + ".tmp";
  fs.rmSync(temp, { force: true });
  const fd = fs.openSync(
    temp,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
    mode,
  );
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    // systemd uses UMask=0077. Apply the intended mode to the open file, not
    // its replaceable path in the application's writable queue directory.
    fs.fchmodSync(fd, mode);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, filename);
}
function history() {
  return fs.existsSync(historyFile)
    ? JSON.parse(fs.readFileSync(historyFile))
    : [];
}
function publishHistory() {
  const entries = history().filter(
    (entry) =>
      fs.existsSync(entry.previous + "/package.json") &&
      fs.existsSync(entry.backup + "/cov.sqlite") &&
      fs.existsSync(entry.backup + "/auth.json"),
  );
  atomicJson(
    queue + "/server-rollback.json",
    {
      schema: 1,
      entries: entries.map(({ id, version, created }) => ({
        id,
        version,
        created,
      })),
    },
    0o644,
  );
}
function snapshot(previous) {
  const id = randomUUID(),
    backup = base + "/backups/" + id;
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const name of dataFiles("/var/lib/cov-monitor/data")) {
    const filename = "/var/lib/cov-monitor/data/" + name;
    if (!fs.existsSync(filename)) continue;
    const fd = fs.openSync(
      filename,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      if (!fs.fstatSync(fd).isFile()) throw Error("Neplatný datový soubor");
      fs.copyFileSync("/proc/self/fd/" + fd, backup + "/" + name);
    } finally {
      fs.closeSync(fd);
    }
  }
  if (
    !fs.existsSync(backup + "/cov.sqlite") ||
    !fs.existsSync(backup + "/auth.json")
  )
    throw Error("Záloha databáze nebo přístupu chybí");
  const version = JSON.parse(
    fs.readFileSync(previous + "/package.json"),
  ).version;
  const entry = {
    id,
    version,
    created: new Date().toISOString(),
    previous,
    backup,
  };
  run("sync", []);
  atomicJson(historyFile, [...history(), entry]);
  run("sync", []);
  publishHistory();
  return entry;
}
function saveTransaction(transaction) {
  fs.writeFileSync(journal + ".tmp", JSON.stringify(transaction), {
    mode: 0o600,
  });
  run("sync", []);
  fs.renameSync(journal + ".tmp", journal);
  run("sync", []);
}
async function checkHealth(version) {
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch("http://127.0.0.1:4173/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      const health = await response.json();
      if (response.ok && health.ok && health.version === version) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error("Verze neprošla kontrolou po spuštění");
}
const status = (message, state = "running", phase = "installing") => {
  atomicJson(
    queue + "/status.json",
    { message, time: new Date().toISOString(), state, phase, ...jobContext },
    0o644,
  );
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
function dataFiles(directory) {
  return [
    ...new Set([
      "cov.sqlite",
      "cov.sqlite-wal",
      "cov.sqlite-shm",
      "auth.json",
      ...fs
        .readdirSync(directory)
        .filter((name) =>
          /^cov\.sqlite\.[a-z0-9][a-z0-9-]{0,59}\.sqlite(?:-wal|-shm)?$/.test(
            name,
          ),
        ),
    ]),
  ];
}
function activateBackup(t) {
  run("systemctl", ["stop", "cov-monitor.service"]);
  switchTo(t.previous);
  for (const name of new Set([
    ...dataFiles("/var/lib/cov-monitor/data"),
    ...dataFiles(t.backup),
  ])) {
    const target = "/var/lib/cov-monitor/data/" + name;
    fs.rmSync(target, { force: true });
    if (fs.existsSync(t.backup + "/" + name)) {
      fs.copyFileSync(t.backup + "/" + name, target);
      run("chown", ["cov-monitor:cov-monitor", target]);
    }
  }
  run("sync", []);
  run("systemctl", ["start", "cov-monitor.service"]);
}
function restore(t) {
  activateBackup(t);
  fs.rmSync(journal, { force: true });
  run("sync", []);
  status("Obnovena předchozí verze a záloha dat.", "failed", "restored");
}
async function main() {
  if (fs.lstatSync(queue).isSymbolicLink() || fs.realpathSync(queue) !== queue)
    throw Error("Neplatný adresář fronty");
  publishHistory();
  const args = process.argv || [];
  if (args.includes("--list-rollbacks")) {
    console.log(
      JSON.stringify(
        JSON.parse(fs.readFileSync(queue + "/server-rollback.json")),
        null,
        2,
      ),
    );
    return;
  }
  if (args.includes("--queue-rollback")) {
    if (fs.existsSync(journal))
      throw Error(
        "Probíhá obnova rozpracované transakce; vyčkejte na aktualizační službu.",
      );
    const id = args[args.indexOf("--queue-rollback") + 1];
    if (
      !args.includes("--accept-data-loss") ||
      !history().some((entry) => entry.id === id)
    )
      throw Error("Vyberte existující zálohu a potvrďte --accept-data-loss");
    if (
      fs.existsSync(queue + "/request.json") ||
      fs.existsSync(queue + "/rollback-request.json")
    )
      throw Error("Jiná operace již čeká");
    atomicJson(queue + "/rollback-request.json", {
      schema: 1,
      id,
      acknowledgeDataLoss: true,
    });
    console.log("Obnova zařazena. Zpracuje ji cov-monitor-update.service.");
    return;
  }
  if (fs.existsSync(journal)) {
    restore(JSON.parse(fs.readFileSync(journal)));
    fs.rmSync(queue + "/rollback-request.json", { force: true });
    fs.rmSync(queue + "/request.json", { force: true });
    return;
  }
  if (fs.existsSync(queue + "/rollback-request.json")) {
    let rollbackTransaction;
    try {
      if (fs.existsSync(queue + "/request.json"))
        throw Error("Nelze současně aktualizovat a obnovovat");
      const request = JSON.parse(read(queue + "/rollback-request.json", 4096));
      const target = history().find((entry) => entry.id === request.id);
      if (
        request.schema !== 1 ||
        request.acknowledgeDataLoss !== true ||
        !target
      )
        throw Error("Neplatný požadavek na obnovu");
      // Paths are taken ONLY from the root-owned catalogue, never from a web request.
      if (
        !target.previous.startsWith(base + "/releases/") ||
        !target.backup.startsWith(base + "/backups/") ||
        fs.realpathSync(target.previous) !== target.previous ||
        fs.realpathSync(target.backup) !== target.backup
      )
        throw Error("Neplatné umístění zálohy");
      if (
        JSON.parse(fs.readFileSync(target.previous + "/package.json"))
          .version !== target.version ||
        !fs.existsSync(target.backup + "/cov.sqlite") ||
        !fs.existsSync(target.backup + "/auth.json")
      )
        throw Error("Záloha není úplná");
      identifyJob(request, target.version);
      status(
        "Zálohuji současný stav před obnovou serveru " + target.version + ".",
        "running",
        "backup",
      );
      run("systemctl", ["stop", "cov-monitor.service"]);
      try {
        rollbackTransaction = snapshot(fs.realpathSync(current));
        saveTransaction(rollbackTransaction);
      } catch (error) {
        run("systemctl", ["start", "cov-monitor.service"]);
        throw error;
      }
      status(
        "Obnovuji vybranou verzi serveru a odpovídající data…",
        "running",
        "restoring",
      );
      activateBackup(target);
      status("Ověřuji spuštění obnoveného serveru…", "running", "verifying");
      await checkHealth(target.version);
      fs.rmSync(journal, { force: true });
      rollbackTransaction = null;
      run("sync", []);
      status(
        "Obnova dokončena: server " +
          target.version +
          ", data k " +
          target.created,
        "succeeded",
        "complete",
      );
    } catch (error) {
      if (rollbackTransaction) restore(rollbackTransaction);
      status(
        "Obnova selhala: " +
          error.message +
          (rollbackTransaction ? ". Zachován stav před pokusem o obnovu." : ""),
        "failed",
        "failed",
      );
    } finally {
      fs.rmSync(queue + "/rollback-request.json", { force: true });
      publishHistory();
    }
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
    identifyJob(envelope, item.version);
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
    status(
      "Ověření balíčku dokončeno. Připravuji soubory nové verze…",
      "running",
      "unpacking",
    );
    const release = base + "/releases/" + item.version + "-" + Date.now();
    fs.mkdirSync(release, { recursive: true, mode: 0o755 });
    fs.chmodSync(release, 0o755);
    const releaseDirectories = new Set([release]);
    for (const [name, value] of Object.entries(bundle.files)) {
      const target = path.join(release, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let directory = path.dirname(target);
      while (
        directory.startsWith(release + "/") &&
        !releaseDirectories.has(directory)
      ) {
        fs.chmodSync(directory, 0o755);
        releaseDirectories.add(directory);
        directory = path.dirname(directory);
      }
      fs.writeFileSync(target, Buffer.from(value, "base64"), {
        mode: 0o644,
        flag: "wx",
      });
      fs.chmodSync(target, 0o644);
    }
    status("Zálohuji data a připravuji restart serveru…", "running", "backup");
    run("systemctl", ["stop", "cov-monitor.service"]);
    try {
      transaction = snapshot(previous);
      saveTransaction(transaction);
    } catch (e) {
      run("systemctl", ["start", "cov-monitor.service"]);
      throw e;
    }
    switchTo(release);
    run("sync", []);
    status("Spouštím novou verzi serveru…", "running", "restarting");
    run("systemctl", ["start", "cov-monitor.service"]);
    status("Ověřuji, že nová verze správně naběhla…", "running", "verifying");
    await checkHealth(item.version);
    fs.unlinkSync(journal);
    transaction = null;
    run("sync", []);
    status("Aktualizace dokončena: " + item.version, "succeeded", "complete");
  } catch (error) {
    if (transaction) {
      restore(transaction);
      status(
        "Aktualizace selhala; obnovena záloha: " + error.message,
        "failed",
        "restored",
      );
    } else status("Aktualizace selhala: " + error.message, "failed", "failed");
  } finally {
    fs.rmSync(queue + "/request.json", { force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
