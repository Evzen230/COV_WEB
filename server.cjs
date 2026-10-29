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
  security ||= createSecurity(loadCredentials(), now, {
    save: saveCredentials,
  });
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
  const updates = createUpdates({ get, put });
  let settings = { ...defaults, ...get("settings", {}), mode: "live" };
  delete settings.interval;
  put("settings", settings);
  const pending = get("pendingAlarms", {});
  const event = (title) =>
    db
      .prepare("INSERT INTO events VALUES(?,?,?)")
      .run(randomUUID(), now(), title);
  const latest = () =>
    db
      .prepare(
        "SELECT * FROM samples WHERE source=? ORDER BY time DESC,id DESC LIMIT 1",
      )
      .get(settings.mode);
  const row = (r) =>
    r
      ? {
          time: r.time,
          received: r.received,
          source: r.source,
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
    let last = latest(),
      v = last ? JSON.parse(last.value) : {},
      offline =
        !last ||
        now() - last.received > settings.stale * 60000 ||
        now() - last.time > settings.stale * 60000,
      conditions = [];
    if (offline)
      conditions.push([
        "offline",
        "Stanice neodpovídá",
        last
          ? `Chybí aktuální měření déle než ${settings.stale} minut.`
          : "Čeká se na první zprávu stanice.",
      ]);
    if (!offline) {
      for (const key of KEYS) {
        const rule = settings.sensorRules[key];
        if (!rule?.enabled) continue;
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
      } else db.prepare("UPDATE alarms SET body=? WHERE id=?").run(body, id);
    }
    return {
      online: !offline,
      last_seen: last?.received ?? null,
      latest: row(last),
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
    const sensorStatus = Object.fromEntries(
      KEYS.map((key) => {
        const latestRow = latest(),
          values = latestRow ? JSON.parse(latestRow.value) : {};
        const lastValid = db
          .prepare(
            `SELECT time FROM samples WHERE source='live' AND json_extract(value,'$.${key}') IS NOT NULL ORDER BY time DESC,id DESC LIMIT 1`,
          )
          .get();
        const stale =
          !latestRow ||
          now() - latestRow.time > settings.stale * 60000 ||
          now() - latestRow.received > settings.stale * 60000;
        return [
          key,
          {
            status: stale ? "stale" : values[key] == null ? "missing" : "fresh",
            measured_at: values[key] == null ? null : latestRow.time,
            last_valid_at: lastValid?.time ?? null,
          },
        ];
      }),
    );
    return {
      settings,
      sensorStatus,
      station: evaluate(),
      history: db
        .prepare(
          "SELECT * FROM (SELECT * FROM samples WHERE source=? AND time>=? ORDER BY time DESC,id DESC LIMIT 20000) ORDER BY time,id",
        )
        .all(settings.mode, now() - 7 * 86400000)
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
        security.authorize(req, p);
        if (m === "GET" && p === "/api/v1/device/status") {
          const station = evaluate();
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
          if (b.device_id !== "cov-monitor-01") fail("Neznámé device_id");
          if (b.firmware_version !== undefined) {
            if (
              typeof b.firmware_version !== "string" ||
              !/^\d+\.\d+\.\d+$/.test(b.firmware_version) ||
              b.hardware !== "esp32-ds18b20-v1"
            )
              fail("Neplatná verze stanice");
            put("stationVersion", {
              version: b.firmware_version,
              target: b.hardware,
              seen: new Date(now()).toISOString(),
            });
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
          if (!KEYS.some((k) => Object.hasOwn(b.measurements, k)))
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
            .prepare(
              "SELECT * FROM samples WHERE source='live' AND sample_id=?",
            )
            .get(b.sample_id);
          if (old) {
            if (
              old.value !== JSON.stringify(v) ||
              (b.timestamp !== undefined && old.time !== time)
            )
              fail("sample_id už existuje s jinými daty", 409);
            return json(200, { accepted: true, duplicate: true, id: old.id });
          }
          let result = insert("live", time, v, b.sample_id);
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
        let a = p.match(/^\/api\/alarms\/([a-z]+)\/ack$/);
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
    db,
    evaluate,
    close() {
      updates.close();
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
