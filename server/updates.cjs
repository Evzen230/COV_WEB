const fs = require("node:fs");
const path = require("node:path");
const { verify, createHash, randomUUID } = require("node:crypto");
const VERSION = require("../package.json").version;
const semver = (v) => /^\d+\.\d+\.\d+$/.test(v);
function newer(a, b) {
  if (!semver(a) || !semver(b)) return false;
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
async function download(url, limit = 32 * 1024 * 1024, fetchBytes = fetch) {
  if (new URL(url).protocol !== "https:")
    throw Error("Aktualizace vyžaduje HTTPS.");
  const response = await fetchBytes(url, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const githubManifest =
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/latest\/download\/manifest\.json$/.test(
        url,
      );
    const message =
      response.status === 404 && githubManifest
        ? "Na GitHubu zatím není dostupné vydání se souborem manifest.json (HTTP 404). Monitoring pokračuje v současné verzi."
        : `Stažení aktualizace selhalo (HTTP ${response.status}).`;
    throw Object.assign(Error(message), { httpStatus: response.status });
  }
  if (new URL(response.url).protocol !== "https:")
    throw Error(
      "Stažení aktualizace bylo přesměrováno na nezabezpečené spojení.",
    );
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) {
      await response.body.cancel().catch(() => {});
      throw Error("Balíček je příliš velký.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function decodeManifest(envelope, key) {
  const bytes = Buffer.from(envelope.payload, "base64");
  if (!verify(null, bytes, key, Buffer.from(envelope.signature, "base64")))
    throw Error("Neplatný podpis aktualizace.");
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1) throw Error("Nepodporovaný manifest.");
  for (const kind of ["server", "firmware"]) {
    const item = manifest[kind];
    if (
      !item ||
      !semver(item.version) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      new URL(item.url).protocol !== "https:"
    )
      throw Error("Neplatný manifest.");
  }
  if (
    !["esp32-ds18b20-v1", "esp32-nano-v1"].includes(manifest.firmware.target) ||
    manifest.firmware.protocol !== 1 ||
    manifest.server.protocol !== 1
  )
    throw Error("Nekompatibilní aktualizace.");
  return manifest;
}
function createUpdates({
  get,
  put,
  directory = process.env.UPDATE_DIR,
  manifestUrl = process.env.UPDATE_MANIFEST_URL,
  publicKey = process.env.UPDATE_PUBLIC_KEY &&
    fs.readFileSync(process.env.UPDATE_PUBLIC_KEY, "utf8"),
  fetchBytes = download,
  firmwareFilename = "firmware.bin",
} = {}) {
  let checking, staging;
  const enabled = Boolean(directory && manifestUrl && publicKey);
  function serverRollbacks() {
    if (!directory) return { supported: false, entries: [] };
    try {
      const catalogue = JSON.parse(
        fs.readFileSync(path.join(directory, "server-rollback.json"), "utf8"),
      );
      if (catalogue.schema !== 1 || !Array.isArray(catalogue.entries))
        throw Error("Neplatný katalog");
      return {
        supported: true,
        entries: catalogue.entries
          .filter(
            (entry) =>
              typeof entry.id === "string" &&
              /^[a-f0-9-]{36}$/.test(entry.id) &&
              semver(entry.version) &&
              Number.isFinite(Date.parse(entry.created)),
          )
          .slice()
          .reverse(),
      };
    } catch {
      return { supported: false, entries: [] };
    }
  }
  function queueBusy() {
    return (
      directory &&
      ["request.json", "rollback-request.json"].some((name) =>
        fs.existsSync(path.join(directory, name)),
      )
    );
  }
  const status = () => {
    const release = get("updateRelease", null),
      station = get("stationVersion", null);
    let job = null;
    if (directory)
      try {
        job = JSON.parse(
          fs.readFileSync(path.join(directory, "status.json"), "utf8"),
        );
      } catch {}
    return {
      enabled,
      current: VERSION,
      station,
      release,
      job,
      pending: queueBusy(),
      checked: get("updateChecked", null),
      error: get("updateError", null),
      serverRollbacks: serverRollbacks(),
      firmwareRollbacks: get("updateHistory", [])
        .filter(
          (entry) =>
            station &&
            entry.release.firmware.target === station.target &&
            newer(station.version, entry.release.firmware.version),
        )
        .map((entry) => ({
          version: entry.release.firmware.version,
          target: entry.release.firmware.target,
          checked: entry.checked,
        })),
      available: Boolean(
        release &&
        (newer(release.server.version, VERSION) ||
          (station && newer(release.firmware.version, station.version))),
      ),
    };
  };
  async function check() {
    if (!enabled)
      throw Object.assign(Error("Zdroj aktualizací není nakonfigurován."), {
        status: 503,
      });
    if (checking) return checking;
    checking = (async () => {
      try {
        const envelope = JSON.parse(await fetchBytes(manifestUrl, 256 * 1024));
        const release = decodeManifest(envelope, publicKey);
        const history = get("updateHistory", []).filter(
          (entry) =>
            entry.release.firmware.version !== release.firmware.version ||
            entry.release.firmware.target !== release.firmware.target,
        );
        put(
          "updateHistory",
          [
            { envelope, release, checked: new Date().toISOString() },
            ...history,
          ].slice(0, 50),
        );
        put("updateRelease", release);
        put("updateEnvelope", envelope);
        put("updateError", null);
      } catch (error) {
        put("updateError", error.message);
        error.status = 400;
        throw error;
      } finally {
        put("updateChecked", new Date().toISOString());
      }
      return status();
    })();
    try {
      return await checking;
    } finally {
      checking = null;
    }
  }
  async function stage(kind, { rollbackVersion, acknowledge = false } = {}) {
    if (!enabled || !["server", "firmware"].includes(kind))
      throw Object.assign(Error("Aktualizace není dostupná."), { status: 400 });
    if (staging)
      throw Object.assign(Error("Jiná aktualizace se právě připravuje."), {
        status: 409,
      });
    staging = true;
    try {
      // Revalidate the persisted signature before every installation.
      if (
        rollbackVersion &&
        (kind !== "firmware" ||
          !acknowledge ||
          get("stationVersion", {})?.rollback !== true)
      )
        throw Error(
          "Stanice zatím nepodporuje potvrzený návrat firmware. Nejdřív nahrajte firmware s podporou obnovy.",
        );
      const envelope = rollbackVersion
        ? get("updateHistory", []).find(
            (entry) =>
              entry.release.firmware.version === rollbackVersion &&
              entry.release.firmware.target ===
                get("stationVersion", {})?.target,
          )?.envelope
        : get("updateEnvelope", null);
      if (!envelope)
        throw Error(
          "Podepsané vydání této verze není uložené. Nejdřív načtěte jeho manifest.",
        );
      const release = decodeManifest(envelope, publicKey),
        item = release[kind];
      if (
        rollbackVersion
          ? !newer(get("stationVersion", {})?.version, item.version)
          : !newer(
              item.version,
              kind === "server"
                ? VERSION
                : get("stationVersion", {})?.version || "0.0.0",
            )
      )
        throw Error(
          rollbackVersion
            ? "Zvolený firmware není starší než verze stanice."
            : "Novější verze není dostupná.",
        );
      if (
        kind === "firmware" &&
        get("stationVersion", {})?.target !== item.target
      )
        throw Error("Stanice nemá kompatibilní OTA firmware.");
      fs.mkdirSync(directory, { recursive: true });
      if (queueBusy())
        throw Error("Aktualizace serveru již čeká na instalaci.");
      const bytes = await fetchBytes(item.url);
      if (queueBusy())
        throw Error(
          "Jiná operace byla mezitím zařazena. Vyčkejte na její dokončení.",
        );
      if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
        throw Error("Kontrolní součet nesouhlasí.");
      const filename = kind === "server" ? "server.bundle" : firmwareFilename;
      const operationId = randomUUID();
      fs.writeFileSync(path.join(directory, filename + ".tmp"), bytes, {
        mode: 0o600,
      });
      fs.renameSync(
        path.join(directory, filename + ".tmp"),
        path.join(directory, filename),
      );
      if (kind === "server") {
        fs.writeFileSync(
          path.join(directory, "request.tmp"),
          JSON.stringify({ ...envelope, operationId }),
          { mode: 0o600 },
        );
        fs.renameSync(
          path.join(directory, "request.tmp"),
          path.join(directory, "request.json"),
        );
      } else
        put("firmwareOffer", {
          ...item,
          id: operationId,
          rollback: Boolean(rollbackVersion),
        });
      put("updateError", null);
      return { queued: true, version: item.version, operationId };
    } catch (error) {
      put("updateError", error.message);
      error.status = 400;
      throw error;
    } finally {
      staging = false;
    }
  }
  async function rollbackServer({ id, acknowledgeDataLoss } = {}) {
    if (!directory || acknowledgeDataLoss !== true)
      throw Object.assign(
        Error("Potvrďte obnovu databáze a ztrátu novějších dat."),
        { status: 400 },
      );
    const catalogue = serverRollbacks();
    if (
      !catalogue.supported ||
      !catalogue.entries.some((entry) => entry.id === id)
    )
      throw Object.assign(
        Error(
          "Zvolená záloha není dostupná. Aktualizační služba musí podporovat ruční obnovu.",
        ),
        { status: 400 },
      );
    if (staging || queueBusy())
      throw Object.assign(Error("Jiná operace již čeká nebo se připravuje."), {
        status: 409,
      });
    const filename = path.join(directory, "rollback-request.json");
    const operationId = randomUUID();
    fs.writeFileSync(
      filename + ".tmp",
      JSON.stringify({ schema: 1, id, acknowledgeDataLoss: true, operationId }),
      { mode: 0o600 },
    );
    fs.renameSync(filename + ".tmp", filename);
    return {
      queued: true,
      operationId,
      version: catalogue.entries.find((entry) => entry.id === id).version,
    };
  }
  async function rememberRelease(version) {
    try {
      if (!enabled || !semver(version))
        throw Object.assign(Error("Zadejte stabilní verzi ve tvaru 0.3.1."), {
          status: 400,
        });
      const match = manifestUrl.match(
        /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\/latest\/download\/manifest\.json$/,
      );
      if (!match)
        throw Object.assign(
          Error("Načtení staršího vydání vyžaduje nakonfigurovaný GitHub."),
          { status: 400 },
        );
      const envelope = JSON.parse(
        await fetchBytes(
          `${match[1]}/releases/download/v${version}/manifest.json`,
          256 * 1024,
        ),
      );
      const release = decodeManifest(envelope, publicKey);
      const station = get("stationVersion", null);
      if (
        release.firmware.version !== version ||
        (station && release.firmware.target !== station.target)
      )
        throw Object.assign(
          Error("Vydání neodpovídá zadané verzi firmware nebo typu stanice."),
          { status: 400 },
        );
      const history = get("updateHistory", []).filter(
        (entry) =>
          entry.release.firmware.version !== version ||
          entry.release.firmware.target !== release.firmware.target,
      );
      put(
        "updateHistory",
        [
          { envelope, release, checked: new Date().toISOString() },
          ...history,
        ].slice(0, 50),
      );
      return status();
    } catch (error) {
      error.status ||= 400;
      throw error;
    }
  }
  const timer = enabled
    ? setInterval(() => check().catch(() => {}), 6 * 3600000)
    : null;
  timer?.unref();
  const initial = enabled
    ? setTimeout(() => check().catch(() => {}), 1000)
    : null;
  initial?.unref();
  return {
    status,
    check,
    stage,
    rollbackServer,
    rememberRelease,
    firmware: () => get("firmwareOffer", null),
    firmwarePath: () => path.join(directory, firmwareFilename),
    close() {
      clearInterval(timer);
      clearTimeout(initial);
    },
  };
}
module.exports = { createUpdates, decodeManifest, newer, download };
