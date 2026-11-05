// Multiple ESP devices contribute measurements to one treatment plant.
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const PRIMARY = "cov-monitor-01";
const KEYS = ["temperature", "level", "ph", "ec", "turbidity", "orp"];
const source = (id) => (id === PRIMARY ? "live" : `station:${id}`);
const device = (value) => (value === "live" ? PRIMARY : value.slice(8));
function createStations({ db, dbPath, get, put, now, settings }) {
  let stations = get("stationCatalog", [{ id: PRIMARY, name: "Hlavní ESP32" }]);
  // Preserve readings created by the earlier separate-database implementation.
  for (const id of get("stations", [])) {
    if (stations.some((station) => station.id === id)) continue;
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id))
      throw Error("Neplatné uložené ID stanice");
    const filename = `${dbPath}.${id}.sqlite`;
    let name = id;
    if (dbPath !== ":memory:" && fs.existsSync(filename)) {
      const previous = new DatabaseSync(filename, { readOnly: true });
      try {
        name =
          JSON.parse(
            previous.prepare("SELECT value FROM kv WHERE key='settings'").get()
              ?.value || "{}",
          ).name || id;
        db.exec("BEGIN");
        try {
          const insert = db.prepare(
            "INSERT OR IGNORE INTO samples(source,sample_id,time,received,value) VALUES(?,?,?,?,?)",
          );
          for (const row of previous
            .prepare("SELECT * FROM samples WHERE source='live'")
            .all())
            insert.run(
              source(id),
              row.sample_id,
              row.time,
              row.received,
              row.value,
            );
          for (const row of previous.prepare("SELECT * FROM records").all())
            db.prepare("INSERT OR IGNORE INTO records VALUES(?,?,?)").run(
              row.id,
              row.kind,
              row.value,
            );
          stations.push({ id, name });
          put("stationCatalog", stations);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } finally {
        previous.close();
      }
    } else stations.push({ id, name });
  }
  put("stationCatalog", stations);
  put("stations", []);
  const latest = (id = PRIMARY) =>
    db
      .prepare(
        "SELECT * FROM samples WHERE source=? ORDER BY time DESC,id DESC LIMIT 1",
      )
      .get(source(id));
  const online = (row) =>
    !!row &&
    now() - row.time <= settings().stale * 60000 &&
    now() - row.received <= settings().stale * 60000;
  const sensorSource = (key) => settings().sensorSources?.[key] || PRIMARY;
  function catalog() {
    return stations.map((station) => {
      const row = latest(station.id);
      return {
        ...station,
        online: online(row),
        last_seen: row?.received ?? null,
        measured_at: row?.time ?? null,
        latest: row ? JSON.parse(row.value) : null,
      };
    });
  }
  function readings() {
    const values = {};
    for (const key of [...KEYS, "blower"]) {
      const row = latest(sensorSource(key));
      values[key] = online(row) ? (JSON.parse(row.value)[key] ?? null) : null;
    }
    const last = stations
      .map((station) => latest(station.id))
      .filter(Boolean)
      .sort((a, b) => b.time - a.time || b.id - a.id)[0];
    return {
      last,
      values,
      online: catalog().some((station) => station.online),
    };
  }
  function sensorStatus() {
    return Object.fromEntries(
      KEYS.map((key) => {
        const id = sensorSource(key),
          row = latest(id),
          value = row ? JSON.parse(row.value)[key] : null;
        const valid = db
          .prepare(
            `SELECT time FROM samples WHERE source=? AND json_extract(value,'$.${key}') IS NOT NULL ORDER BY time DESC,id DESC LIMIT 1`,
          )
          .get(source(id));
        return [
          key,
          {
            station_id: id,
            status: !online(row)
              ? "stale"
              : value == null
                ? "missing"
                : "fresh",
            measured_at: value == null ? null : row.time,
            last_valid_at: valid?.time ?? null,
          },
        ];
      }),
    );
  }
  function save(input, fail, id) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const renaming = id !== undefined;
    id ??= input.id;
    if (
      typeof id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,59}$/.test(id) ||
      !name ||
      name.length > 60
    )
      fail("Vyplňte název a platné jedinečné ID stanice (nejvýše 60 znaků).");
    const existing = stations.find((station) => station.id === id);
    if (!renaming && existing) fail("Toto ID stanice už existuje.", 409);
    if (renaming && !existing) fail("Stanice neexistuje.", 404);
    const next = existing
      ? stations.map((station) => (station.id === id ? { id, name } : station))
      : [...stations, { id, name }];
    put("stationCatalog", next);
    stations = next;
    return { id, name };
  }
  function remove(id, fail) {
    if (!stations.some((station) => station.id === id))
      fail("Stanice neexistuje.", 404);
    if (id === PRIMARY) fail("Hlavní stanici nelze odebrat.", 409);
    const next = stations.filter((station) => station.id !== id);
    put(
      "stations",
      get("stations", []).filter((legacyId) => legacyId !== id),
    );
    put("stationCatalog", next);
    stations = next;
  }
  return {
    catalog,
    latest,
    online,
    readings,
    sensorStatus,
    sensorSource,
    save,
    remove,
    source,
    device,
    has: (id) => stations.some((station) => station.id === id),
  };
}
module.exports = { createStations, PRIMARY };
