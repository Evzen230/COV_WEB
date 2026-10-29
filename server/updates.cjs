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
async function download(url, limit = 32 * 1024 * 1024) {
  if (new URL(url).protocol !== "https:")
    throw Error("Aktualizace vyžaduje HTTPS.");
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok || new URL(response.url).protocol !== "https:")
    throw Error("Stažení aktualizace selhalo.");
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
    manifest.firmware.target !== "esp32-ds18b20-v1" ||
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
} = {}) {
  let checking, staging;
  const enabled = Boolean(directory && manifestUrl && publicKey);
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
      checked: get("updateChecked", null),
      error: get("updateError", null),
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
  async function stage(kind) {
    if (!enabled || !["server", "firmware"].includes(kind))
      throw Object.assign(Error("Aktualizace není dostupná."), { status: 400 });
    if (staging)
      throw Object.assign(Error("Jiná aktualizace se právě připravuje."), {
        status: 409,
      });
    staging = true;
    try {
      // Revalidate the persisted signature before every installation.
      const envelope = get("updateEnvelope", null);
      const release = decodeManifest(envelope, publicKey),
        item = release[kind];
      if (
        !newer(
          item.version,
          kind === "server"
            ? VERSION
            : get("stationVersion", {})?.version || "0.0.0",
        )
      )
        throw Error("Novější verze není dostupná.");
      if (
        kind === "firmware" &&
        get("stationVersion", {})?.target !== item.target
      )
        throw Error("Stanice nemá kompatibilní OTA firmware.");
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(path.join(directory, "request.json")))
        throw Error("Aktualizace serveru již čeká na instalaci.");
      const bytes = await fetchBytes(item.url);
      if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
        throw Error("Kontrolní součet nesouhlasí.");
      const filename = kind === "server" ? "server.bundle" : "firmware.bin";
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
          JSON.stringify(envelope),
          { mode: 0o600 },
        );
        fs.renameSync(
          path.join(directory, "request.tmp"),
          path.join(directory, "request.json"),
        );
      } else put("firmwareOffer", { ...item, id: randomUUID() });
      put("updateError", null);
      return { queued: true, version: item.version };
    } catch (error) {
      put("updateError", error.message);
      error.status = 400;
      throw error;
    } finally {
      staging = false;
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
    firmware: () => get("firmwareOffer", null),
    firmwarePath: () => path.join(directory, "firmware.bin"),
    close() {
      clearInterval(timer);
      clearTimeout(initial);
    },
  };
}
module.exports = { createUpdates, decodeManifest, newer, download };
