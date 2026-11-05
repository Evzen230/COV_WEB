const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  createSecurity,
  loadCredentials,
  saveCredentials,
} = require("./server/security.cjs");
const { createUpdates } = require("./server/updates.cjs");
const { outsideBand, stabilize } = require("./server/alarm-policy.cjs");
const { DatabaseSync } = require("node:sqlite");
const KEYS = ["temperature", "level", "ph", "ec", "turbidity", "orp"];
const SENSOR_NAMES = {
  temperature: "Teplotní čidlo",
  level: "Senzor hladiny",
  ph: "pH sonda",
  ec: "Sonda vodivosti",
  turbidity: "Senzor zákalu",
  orp: "ORP sonda",
};
const LIMITS = {
  temperature: [-55, 125],
  level: [0, 100],
  ph: [0, 14],
  ec: [0, 200000],
  turbidity: [0, 100000],
  orp: [-2000, 2000],
};
const defaults = {
  name: "Domovní ČOV",
  tempMin: 8,
  tempMax: 30,
  levelMax: 85,
  stale: 15,
  mode: "live",
  tankVolume: 2400,
  hiddenSensors: [],
  levelCalibration: {},
  alarmDelaySeconds: 60,
  tempHysteresis: 0.5,
  levelHysteresis: 2,
  rangeHysteresis: {
    temperature: 0.5,
    level: 2,
    ph: 0.1,
    ec: 10,
    turbidity: 1,
    orp: 10,
  },
  sensorRules: Object.fromEntries(
    KEYS.map((key) => [
      key,
      { enabled: key === "temperature", min: null, max: null },
    ]),
  ),
};
function createApp({
  dbPath = process.env.DB_PATH || path.join(__dirname, "data", "cov.sqlite"),
  now = Date.now,
  security,
} = {}) {
  const accessConfig = security ? null : loadCredentials();
  if (dbPath !== ":memory:")
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY,source TEXT NOT NULL,sample_id TEXT NOT NULL,time INTEGER NOT NULL,received INTEGER NOT NULL,value TEXT NOT NULL,UNIQUE(source,sample_id));
 CREATE INDEX IF NOT EXISTS samples_time ON samples(source,time);
 CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,time INTEGER NOT NULL,title TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS alarms(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,active INTEGER NOT NULL,acknowledged INTEGER NOT NULL,started INTEGER NOT NULL,ended INTEGER);`);
  const get = (k, d) =>
    JSON.parse(
      db.prepare("SELECT value FROM kv WHERE key=?").get(k)?.value ||
        JSON.stringify(d),
    );
  const put = (k, v) =>
    db
      .prepare("INSERT OR REPLACE INTO kv VALUES(?,?)")
      .run(k, JSON.stringify(v));
  security ||= createSecurity(accessConfig, now, {
    save: saveCredentials,
    get,
    put,
  });
  let settings = { ...defaults, ...get("settings", {}), mode: "live" };
  settings.sensorSources = {
    ...Object.fromEntries(
      [...KEYS, "blower"].map((key) => [key, "cov-monitor-01"]),
    ),
    ...settings.sensorSources,
  };
  delete settings.interval;
  put("settings", settings);
  const fleet = require("./server/stations.cjs").createStations({
    db,
    dbPath,
    get,
    put,
    now,
    settings: () => settings,
  });
  const pairing = require("./server/pairing.cjs").createPairing({
    get,
    put,
    now,
    fleet,
  });
  const updateClients = new Map();
  function updatesFor(id = "cov-monitor-01") {
    if (!fleet.has(id)) fail("Neznámé device_id");
    if (!updateClients.has(id)) {
      const key = (k) =>
        id === "cov-monitor-01" ? k : "device:" + id + ":" + k;
      updateClients.set(
        id,
        createUpdates({
          get: (k, d) => get(key(k), d),
          put: (k, v) => put(key(k), v),
          firmwareFilename:
            id === "cov-monitor-01"
              ? "firmware.bin"
              : "firmware-" + id + ".bin",
        }),
      );
    }
    return updateClients.get(id);
  }
  const pending = get("pendingAlarms", {});
  const event = (title) =>
    db
      .prepare("INSERT INTO events VALUES(?,?,?)")
      .run(randomUUID(), now(), title);
  const row = (r) =>
    r
      ? {
          time: r.time,
          received: r.received,
          source: r.source,
          device_id: fleet.device(r.source),
          ...JSON.parse(r.value),
        }
      : null;
  function evaluate() {
    const active = new Set(
      db
        .prepare("SELECT id FROM alarms WHERE active=1")
        .all()
        .map((row) => row.id),
    );
    const snapshot = fleet.readings();
    const last = snapshot.last,
      v = snapshot.values,
      offline = !snapshot.online;
    let conditions = [];
    for (const station of fleet.catalog()) {
      if (station.online) continue;
      conditions.push([
        station.id === "cov-monitor-01" ? "offline" : "offline-" + station.id,
        fleet.catalog().length === 1
          ? "Stanice neodpovídá"
          : station.name + ": stanice neodpovídá",
        station.last_seen
          ? "Chybí aktuální měření déle než " + settings.stale + " minut."
          : "Čeká se na první zprávu stanice.",
      ]);
    }
    if (!offline) {
      for (const key of KEYS) {
        const rule = settings.sensorRules[key];
        if (
          !rule?.enabled ||
          !fleet.online(fleet.latest(fleet.sensorSource(key)))
        )
          continue;
        if (v[key] == null)
          conditions.push([
            key === "temperature" ? "sensor" : `sensor${key}`,
            `${SENSOR_NAMES[key]}: chybí měření`,
            "Stanice odpovídá, ale sledovaný senzor neposlal platnou hodnotu. Zkontrolujte čidlo, kabel a firmware.",
          ]);
        else if (
          outsideBand(
            v[key],
            rule.min,
            rule.max,
            active.has("range" + key),
            settings.rangeHysteresis[key] ?? 0,
          )
        )
          conditions.push([
            `range${key}`,
            `${SENSOR_NAMES[key]}: hodnota mimo nastavené pásmo`,
            `Naměřeno ${v[key]}. Nastavené pásmo ${rule.min ?? "bez dolní meze"} až ${rule.max ?? "bez horní meze"}. Jde o uživatelské provozní meze.`,
          ]);
      }
      if (
        v.temperature != null &&
        outsideBand(
          v.temperature,
          settings.tempMin,
          settings.tempMax,
          active.has("temp"),
          settings.tempHysteresis,
        )
      )
        conditions.push([
          "temp",
          "Teplota mimo nastavené pásmo",
          `Naměřeno ${v.temperature} °C; pásmo ${settings.tempMin} až ${settings.tempMax} °C.`,
        ]);
      if (
        outsideBand(
          v.level,
          null,
          settings.levelMax,
          active.has("level"),
          settings.levelHysteresis,
        )
      )
        conditions.push([
          "level",
          "Vysoká hladina v nádrži",
          `Hladina ${v.level} % překročila práh ${settings.levelMax} %.`,
        ]);
    }
    const previousPending = JSON.stringify(pending);
    conditions = stabilize(
      conditions,
      active,
      pending,
      settings.alarmDelaySeconds,
      now(),
    );
    if (JSON.stringify(pending) !== previousPending)
      put("pendingAlarms", pending);
    for (let a of db.prepare("SELECT * FROM alarms WHERE active=1").all())
      if (!conditions.some((c) => c[0] === a.id)) {
        db.prepare("UPDATE alarms SET active=0,ended=? WHERE id=?").run(
          now(),
          a.id,
        );
        event("Obnoveno: " + a.title);
      }
    for (let [id, title, body] of conditions) {
      let old = db.prepare("SELECT * FROM alarms WHERE id=?").get(id);
      if (!old?.active) {
        db.prepare(
          "INSERT OR REPLACE INTO alarms VALUES(?,?,?,?,?,?,NULL)",
        ).run(id, title, body, 1, 0, now());
        event("Alarm: " + title);
      } else
        db.prepare("UPDATE alarms SET title=?,body=? WHERE id=?").run(
          title,
          body,
          id,
        );
    }
    return {
      online: !offline,
      last_seen: last?.received ?? null,
      latest: last ? { ...row(last), ...v } : null,
    };
  }
  const insert = (source, time, values, id = randomUUID(), received = now()) =>
    db
      .prepare(
        "INSERT OR IGNORE INTO samples(source,sample_id,time,received,value) VALUES(?,?,?,?,?)",
      )
      .run(source, id, time, received, JSON.stringify(values));
  const timer = setInterval(() => {
    try {
      evaluate();
    } catch (e) {
      console.error(e.message);
    }
  }, 1000);
  timer.unref();
  const records = (kind) =>
    db
      .prepare("SELECT value FROM records WHERE kind=? ORDER BY rowid DESC")
      .all(kind)
      .map((r) => JSON.parse(r.value));
  function state() {
    const sensorStatus = fleet.sensorStatus();
    return {
      settings,
      stations: fleet.catalog(),
      sensorStatus,
      station: evaluate(),
      history: db
        .prepare(
          "SELECT * FROM (SELECT * FROM samples WHERE (source='live' OR source LIKE 'station:%') AND time>=? ORDER BY time DESC,id DESC LIMIT 20000) ORDER BY time,id",
        )
        .all(now() - 7 * 86400000)
        .map(row),
      labs: records("labs"),
      service: records("service"),
      events: db
        .prepare("SELECT * FROM events ORDER BY time DESC,rowid DESC LIMIT 100")
        .all(),
      alarms: db.prepare("SELECT * FROM alarms WHERE active=1").all(),
    };
  }
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  for (const station of fleet.catalog()) updatesFor(station.id);
  function text(v, key, max = 200, required = true) {
    if (typeof v !== "string" || v.length > max || (required && !v.trim()))
      fail("Neplatné pole " + key);
    return v.trim();
  }
  async function body(req) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      fail("Použijte Content-Type: application/json", 415);
    let chunks = [],
      size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 65536) fail("Příliš velká zpráva", 413);
      chunks.push(c);
    }
    try {
      let b = JSON.parse(Buffer.concat(chunks).toString());
      if (!b || typeof b !== "object" || Array.isArray(b))
        fail("Očekáván JSON objekt");
      return b;
    } catch {
      fail("Neplatný JSON objekt");
    }
  }
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(data));
    };
    try {
      let p = new URL(req.url, "http://localhost").pathname,
        m = req.method;
      if (p.startsWith("/api/")) {
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}` &&
          req.headers.origin !== `https://${req.headers.host}`
        )
          fail("Cizí původ požadavku není povolen", 403);
        if (m === "GET" && p === "/api/health")
          return json(200, {
            ok: true,
            version: require("./package.json").version,
            mode: settings.mode,
          });
        if (await security.handle(req, res, p, body, json)) return;
        if (p === "/api/v1/pair" && m === "POST")
          return json(
            200,
            pairing.claim(await body(req), req.socket.remoteAddress),
          );
        security.authorize(req, p, pairing.authenticate);
        const pairMatch = p.match(
          /^\/api\/stations\/([a-z0-9-]+)\/(pairing|revoke)$/,
        );
        if (pairMatch && m === "POST") {
          if (pairMatch[2] === "pairing")
            return json(201, pairing.issue(pairMatch[1]));
          pairing.revoke(pairMatch[1]);
          return json(200, { revoked: true });
        }
        if (p === "/api/stations" && m === "GET")
          return json(200, fleet.catalog());
        if (p === "/api/stations" && m === "POST")
          return json(201, fleet.save(await body(req), fail));
        const stationMatch = p.match(/^\/api\/stations\/([a-z0-9-]+)$/);
        if (stationMatch && m === "DELETE") {
          const id = stationMatch[1];
          fleet.remove(id, fail);
          pairing.revoke(id);
          for (const key of Object.keys(settings.sensorSources))
            if (settings.sensorSources[key] === id)
              settings.sensorSources[key] = "cov-monitor-01";
          if (settings.levelCalibration) delete settings.levelCalibration[id];
          put("settings", settings);
          updateClients.delete(id);
          return json(200, { removed: true });
        }
        if (stationMatch && m === "PUT")
          return json(200, fleet.save(await body(req), fail, stationMatch[1]));
        const deviceId =
          new URL(req.url, "http://localhost").searchParams.get("device_id") ||
          "cov-monitor-01";
        if (
          req.deviceId &&
          p.startsWith("/api/v1/device/") &&
          deviceId !== req.deviceId
        )
          fail("Klíč patří jiné stanici", 403);
        if (m === "POST" && p === "/api/v1/device/credentials") {
          if (!req.deviceId) fail("Vyžaduje vlastní klíč stanice", 403);
          return json(
            200,
            pairing.rotate(
              req.headers["x-api-key"] ||
                req.headers.authorization?.replace(/^Bearer /i, ""),
              req.deviceId,
            ),
          );
        }
        const updates =
          p.startsWith("/api/updates") || p.startsWith("/api/v1/device/")
            ? updatesFor(deviceId)
            : null;
        if (m === "GET" && p === "/api/v1/device/status") {
          const last = fleet.latest(deviceId);
          const station = {
            online: fleet.online(last),
            last_seen: last?.received ?? null,
          };
          return json(200, {
            mode: "live",
            online: station.online,
            last_seen: station.last_seen,
          });
        }
        if (m === "GET" && p === "/api/updates")
          return json(200, updates.status());
        if (m === "POST" && p === "/api/updates/check")
          return json(200, await updates.check());
        if (m === "POST" && p === "/api/updates/install")
          return json(202, await updates.stage((await body(req)).kind));
        if (m === "GET" && p === "/api/v1/device/update") {
          const offer = updates.firmware();
          return json(200, {
            firmware: offer
              ? {
                  version: offer.version,
                  sha256: offer.sha256,
                  target: offer.target,
                  id: offer.id,
                }
              : null,
          });
        }
        if (m === "GET" && p === "/api/v1/device/firmware") {
          if (!updates.firmware()) fail("Firmware není připraven", 404);
          const bytes = fs.readFileSync(updates.firmwarePath());
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": bytes.length,
            "Cache-Control": "no-store",
          });
          return res.end(bytes);
        }
        const docMatch = p.match(/^\/api\/docs\/([a-z]+)$/);
        if (m === "GET" && docMatch) {
          const documents = {
            readme: "README.md",
            api: "docs/API.md",
            structure: "docs/STRUCTURE.md",
            alarms: "docs/ALARMS.md",
            security: "docs/SECURITY.md",
            updates: "docs/UPDATES.md",
            pairing: "docs/PAIRING.md",
            firmware: "docs/FIRMWARE.md",
          };
          const filename = documents[docMatch[1]];
          if (!filename) fail("Dokument nenalezen", 404);
          let content;
          try {
            content = fs.readFileSync(path.join(__dirname, filename), "utf8");
          } catch {
            fail("Dokument není dostupný", 404);
          }
          if (
            new URL(req.url, "http://localhost").searchParams.get(
              "download",
            ) === "1"
          ) {
            res.writeHead(200, {
              "Content-Type": "text/markdown; charset=utf-8",
              "Content-Disposition": `attachment; filename="${path.basename(filename)}"`,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            res.end(content);
            return;
          }
          return json(200, { id: docMatch[1], path: filename, content });
        }
        if (p === "/api/preferences" && m === "GET")
          return json(200, get("preferences", { dark: null }));
        if (p === "/api/preferences" && m === "POST") {
          const input = await body(req);
          if (typeof input.dark !== "boolean")
            return json(400, { error: "Neplatný režim vzhledu." });
          put("preferences", { dark: input.dark });
          return json(200, { dark: input.dark });
        }
        if (m === "GET" && p === "/api/state") return json(200, state());
        if (m === "GET" && p === "/api/backup")
          return json(200, {
            version: 2,
            exported: new Date(now()).toISOString(),
            ...state(),
            all_samples: db
              .prepare("SELECT * FROM samples ORDER BY time,id")
              .all(),
          });
        if (m === "POST" && p === "/api/v1/telemetry") {
          let b = await body(req);
          if (req.deviceId && b.device_id !== req.deviceId)
            fail("Klíč patří jiné stanici", 403);
          if (!fleet.has(b.device_id)) fail("Neznámé device_id");
          const source = fleet.source(b.device_id);
          if (b.firmware_version !== undefined) {
            if (
              typeof b.firmware_version !== "string" ||
              !/^\d+\.\d+\.\d+$/.test(b.firmware_version) ||
              !["esp32-ds18b20-v1", "esp32-nano-v1"].includes(b.hardware)
            )
              fail("Neplatná verze stanice");
            put(
              b.device_id === "cov-monitor-01"
                ? "stationVersion"
                : "device:" + b.device_id + ":stationVersion",
              {
                version: b.firmware_version,
                target: b.hardware,
                seen: new Date(now()).toISOString(),
              },
            );
          }
          text(b.sample_id, "sample_id", 100);
          if (
            !b.measurements ||
            typeof b.measurements !== "object" ||
            Array.isArray(b.measurements)
          )
            fail("Chybí measurements");
          let time =
            b.timestamp === undefined ? now() : Date.parse(b.timestamp);
          if (
            !Number.isFinite(time) ||
            time > now() + 60000 ||
            time < now() - 30 * 86400000
          )
            fail("Čas musí být nejvýše 30 dní starý a nejvýše 60 s v budoucnu");
          let v = {};
          for (let k of KEYS) {
            let x = b.measurements[k] ?? null;
            if (
              x !== null &&
              (typeof x !== "number" ||
                !Number.isFinite(x) ||
                x < LIMITS[k][0] ||
                x > LIMITS[k][1])
            )
              fail("Neplatná veličina " + k);
            v[k] = x;
          }
          if (Object.hasOwn(b.measurements, "distance_cm")) {
            const distance = b.measurements.distance_cm;
            if (
              distance !== null &&
              (typeof distance !== "number" ||
                !Number.isFinite(distance) ||
                distance < 21 ||
                distance > 600)
            )
              fail("Neplatná vzdálenost distance_cm");
            if (Object.hasOwn(b.measurements, "level"))
              fail("Posílejte buď level, nebo distance_cm");
            v.distance_cm = distance;
            const calibration = settings.levelCalibration[b.device_id];
            v.level =
              distance !== null && calibration
                ? Math.max(
                    0,
                    Math.min(
                      100,
                      (100 * (calibration.emptyCm - distance)) /
                        (calibration.emptyCm - calibration.fullCm),
                    ),
                  )
                : null;
          }
          if (
            !Object.hasOwn(b.measurements, "distance_cm") &&
            !KEYS.some((k) => Object.hasOwn(b.measurements, k))
          )
            fail("Zpráva neobsahuje známou veličinu");
          v.blower = b.blower ?? null;
          if (v.blower !== null && typeof v.blower !== "boolean")
            fail("blower musí být boolean nebo null");
          v.rssi = b.rssi ?? null;
          if (
            v.rssi !== null &&
            (typeof v.rssi !== "number" ||
              !Number.isFinite(v.rssi) ||
              v.rssi > 0 ||
              v.rssi < -150)
          )
            fail("Neplatné rssi");
          let old = db
            .prepare("SELECT * FROM samples WHERE source=? AND sample_id=?")
            .get(source, b.sample_id);
          if (old) {
            // A retry retains its original calibration, even after a settings change.
            if (Object.hasOwn(v, "distance_cm"))
              v.level = JSON.parse(old.value).level;
            if (
              old.value !== JSON.stringify(v) ||
              (b.timestamp !== undefined && old.time !== time)
            )
              fail("sample_id už existuje s jinými daty", 409);
            return json(200, { accepted: true, duplicate: true, id: old.id });
          }
          let result = insert(source, time, v, b.sample_id);
          evaluate();
          return json(201, {
            accepted: true,
            duplicate: false,
            id: Number(result.lastInsertRowid),
            received_at: new Date(now()).toISOString(),
          });
        }
        if (m === "PUT" && p === "/api/settings") {
          let b = await body(req),
            next = { ...settings };
          next.name = text(b.name, "name", 60);
          if (b.sensorSources !== undefined) {
            if (
              !b.sensorSources ||
              typeof b.sensorSources !== "object" ||
              Array.isArray(b.sensorSources)
            )
              fail("Neplatné zdroje senzorů");
            next.sensorSources = { ...settings.sensorSources };
            for (const key of [...KEYS, "blower"]) {
              const id = b.sensorSources[key] ?? settings.sensorSources[key];
              if (!fleet.has(id)) fail("Neznámá zdrojová stanice: " + key);
              next.sensorSources[key] = id;
            }
          }
          if (b.levelCalibration !== undefined) {
            if (
              !b.levelCalibration ||
              typeof b.levelCalibration !== "object" ||
              Array.isArray(b.levelCalibration)
            )
              fail("Neplatná kalibrace hladiny");
            next.levelCalibration = {};
            for (const [id, calibration] of Object.entries(
              b.levelCalibration,
            )) {
              if (
                !fleet.has(id) ||
                !calibration ||
                typeof calibration !== "object"
              )
                fail("Neplatná stanice kalibrace");
              const { emptyCm, fullCm } = calibration;
              if (
                ![emptyCm, fullCm].every(
                  (x) =>
                    typeof x === "number" &&
                    Number.isFinite(x) &&
                    x >= 21 &&
                    x <= 600,
                ) ||
                emptyCm <= fullCm
              )
                fail(
                  "Vzdálenost pro prázdnou nádrž musí být větší než pro plnou; rozsah 21–600 cm",
                );
              next.levelCalibration[id] = { emptyCm, fullCm };
            }
          }
          if (b.hiddenSensors !== undefined) {
            if (
              !Array.isArray(b.hiddenSensors) ||
              b.hiddenSensors.some((key) => !KEYS.includes(key))
            )
              fail("Neplatný seznam skrytých senzorů");
            next.hiddenSensors = [...new Set(b.hiddenSensors)];
          }
          if (b.sensorRules !== undefined) {
            if (
              !b.sensorRules ||
              typeof b.sensorRules !== "object" ||
              Array.isArray(b.sensorRules)
            )
              fail("Neplatné nastavení senzorů");
            const rules = {};
            for (const key of KEYS) {
              const rule = b.sensorRules[key];
              if (!rule || typeof rule.enabled !== "boolean")
                fail("Chybí nastavení senzoru " + key);
              for (const bound of ["min", "max"])
                if (
                  rule[bound] !== null &&
                  (typeof rule[bound] !== "number" ||
                    !Number.isFinite(rule[bound]) ||
                    rule[bound] < LIMITS[key][0] ||
                    rule[bound] > LIMITS[key][1])
                )
                  fail("Neplatná mez senzoru " + key);
              if (rule.min != null && rule.max != null && rule.min >= rule.max)
                fail("Minimum musí být menší než maximum: " + key);
              rules[key] = {
                enabled: rule.enabled,
                min: rule.min,
                max: rule.max,
              };
            }
            next.sensorRules = rules;
          }
          for (let [k, min, max] of [
            ["tempMin", -55, 125],
            ["tempMax", -55, 125],
            ["levelMax", 1, 100],
            ["stale", 1, 120],
            ["tankVolume", 1, 1000000],
            ["alarmDelaySeconds", 0, 3600],
            ["tempHysteresis", 0, 20],
            ["levelHysteresis", 0, 50],
          ]) {
            let v = b[k] ?? settings[k];
            if (
              typeof v !== "number" ||
              !Number.isFinite(v) ||
              v < min ||
              v > max
            )
              fail("Neplatné nastavení " + k);
            next[k] = v;
          }
          if (next.tempMin >= next.tempMax)
            fail("Minimální teplota musí být nižší než maximální");
          if (next.tempHysteresis * 2 >= next.tempMax - next.tempMin)
            fail(
              "Teplotní návratové pásmo musí být menší než polovina rozsahu.",
            );
          if (next.levelHysteresis > next.levelMax)
            fail("Návratové pásmo hladiny nesmí překročit práh.");
          {
            b.rangeHysteresis ??= settings.rangeHysteresis;
            if (
              !b.rangeHysteresis ||
              typeof b.rangeHysteresis !== "object" ||
              Array.isArray(b.rangeHysteresis)
            )
              fail("Neplatná návratová pásma");
            const values = {};
            for (const key of KEYS) {
              const v = b.rangeHysteresis[key] ?? settings.rangeHysteresis[key];
              const rule = next.sensorRules[key];
              if (
                typeof v !== "number" ||
                !Number.isFinite(v) ||
                v < 0 ||
                v > LIMITS[key][1] - LIMITS[key][0] ||
                (rule.min != null &&
                  rule.max != null &&
                  v * 2 >= rule.max - rule.min)
              )
                fail("Neplatné návratové pásmo " + key);
              values[key] = v;
            }
            next.rangeHysteresis = values;
          }
          if (b.mode !== undefined && b.mode !== "live")
            fail("Použijte HTTP API; vestavěný simulátor byl odstraněn.");
          next.mode = "live";
          for (const id of Object.keys(pending)) delete pending[id];
          put("pendingAlarms", pending);
          settings = next;
          put("settings", settings);
          return json(200, state());
        }
        let a = p.match(/^\/api\/alarms\/([a-zA-Z0-9-]+)\/ack$/);
        if (m === "POST" && a) {
          let r = db
            .prepare("SELECT * FROM alarms WHERE id=? AND active=1")
            .get(a[1]);
          if (!r) fail("Alarm už není aktivní", 404);
          if (!r.acknowledged) {
            db.prepare("UPDATE alarms SET acknowledged=1 WHERE id=?").run(r.id);
            event("Potvrzení alarmu: " + r.title);
          }
          return json(200, state());
        }
        let r = p.match(/^\/api\/(labs|service)(?:\/([a-zA-Z0-9-]+))?$/);
        if (r) {
          let kind = r[1],
            id = r[2];
          if (m === "POST" && !id) {
            let b = await body(req),
              v = { id: randomUUID(), date: text(b.date, "date", 10) };
            if (
              !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
              !Number.isFinite(Date.parse(v.date)) ||
              new Date(v.date).toISOString().slice(0, 10) !== v.date
            )
              fail("Neplatné datum");
            for (let k of kind === "labs"
              ? ["location", "parameter", "unit", "lab"]
              : ["type", "device"])
              v[k] = text(b[k], k);
            v.note = text(b.note ?? "", "note", 5000, kind === "service");
            if (kind === "labs") {
              if (
                typeof b.value !== "number" ||
                !Number.isFinite(b.value) ||
                b.value < 0
              )
                fail("Neplatná hodnota rozboru");
              v.value = b.value;
            }
            db.prepare("INSERT INTO records VALUES(?,?,?)").run(
              v.id,
              kind,
              JSON.stringify(v),
            );
            return json(201, v);
          }
          if (m === "DELETE" && id) {
            let result = db
              .prepare("DELETE FROM records WHERE id=? AND kind=?")
              .run(id, kind);
            if (!result.changes) fail("Záznam nenalezen", 404);
            return json(200, { deleted: true });
          }
        }
        fail("API cesta nebo metoda neexistuje", 404);
      }
      if (!["GET", "HEAD"].includes(m)) fail("Metoda není povolená", 405);
      const root = path.join(__dirname, "dist"),
        file = path.resolve(
          root,
          "." + decodeURIComponent(p === "/" ? "/index.html" : p),
        );
      if (!file.startsWith(root + path.sep)) fail("Přístup odepřen", 403);
      fs.readFile(file, (err, data) => {
        if (err) return json(404, { error: "Nenalezeno" });
        res.writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
            }[path.extname(file)] || "application/octet-stream",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(m === "HEAD" ? undefined : data);
      });
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent)
        json(e.status || 500, {
          error: e.status ? e.message : "Chyba serveru",
        });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return {
    server,
    security,
    db,
    evaluate,
    close() {
      for (const client of updateClients.values()) client.close();
      clearInterval(timer);
      server.close();
      db.close();
    },
  };
}
if (require.main === module) {
  let app;
  try {
    app = createApp();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const port = Number(process.env.PORT || 4173),
    host = process.env.HOST || "127.0.0.1";
  app.server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `\nPort ${port} na adrese ${host} je už obsazený. ČOV Monitor nelze spustit podruhé na stejné adrese.`,
      );
      console.error(
        "Pokud už aplikace běží, otevřete její web. Pro restart ukončete původní server v jeho terminálu pomocí Ctrl+C a potom spusťte npm start znovu.",
      );
      console.error(
        "Jiný port lze nastavit proměnnou PORT (například v cmd: set PORT=4174).",
      );
    } else {
      console.error(`Server se nepodařilo spustit: ${error.message}`);
    }
    app.close();
    process.exitCode = 1;
  });
  app.server.listen(port, host, () =>
    console.log(`ČOV Monitor: http://${host}:${port} · SQLite · chráněné API`),
  );
  for (let sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      app.close();
      process.exit();
    });
}
module.exports = { createApp };
