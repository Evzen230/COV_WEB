const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const hash = (key) => createHash("sha256").update(key).digest();
const { createPairing } = require("./pairing.cjs");

function createDisplays({ get, put, now = Date.now }) {
  const catalog = () => get("displays", []);
  const pairing = createPairing({
    now,
    fleet: { has: (id) => catalog().some((item) => item.id === id) },
    get: () =>
      Object.fromEntries(
        catalog()
          .filter((item) => item.hash)
          .map((item) => [item.id, { hash: item.hash }]),
      ),
    put: (key, credentials) =>
      put(
        "displays",
        catalog().map((item) => {
          const { hash: previous, ...rest } = item;
          return credentials[item.id]
            ? { ...rest, hash: credentials[item.id].hash }
            : rest;
        }),
      ),
  });
  function create(name, key) {
    if (typeof name !== "string" || !name.trim() || name.length > 60)
      throw Object.assign(Error("Zadejte název displeje (nejvýše 60 znaků)."), {
        status: 400,
      });
    if (catalog().length >= 20)
      throw Object.assign(Error("Nejvýše 20 displejů."), { status: 409 });
    const item = {
      id: randomBytes(12).toString("hex"),
      name: name.trim(),
      created_at: now(),
      ...(key ? { hash: hash(key).toString("hex") } : {}),
    };
    put("displays", [...catalog(), item]);
    return item;
  }
  return {
    list: () =>
      catalog().map(({ hash: secret, ...item }) => ({
        ...item,
        paired: !!secret,
      })),
    pairNew(name) {
      const item = create(name);
      return { ...pairing.issue(item.id), name: item.name };
    },
    pair(id) {
      return pairing.issue(id);
    },
    claim: pairing.claim,
    issue(name) {
      const key = randomBytes(32).toString("hex");
      const item = create(name, key);
      return { id: item.id, name: item.name, key };
    },
    revoke(id) {
      pairing.revoke(id);
      put(
        "displays",
        catalog().filter((item) => item.id !== id),
      );
    },
    authenticate(req) {
      const key =
        req.headers["x-api-key"] ||
        req.headers.authorization?.replace(/^Bearer /i, "");
      if (
        typeof key !== "string" ||
        key.length !== 64 ||
        !catalog().some(
          (item) =>
            item.hash &&
            timingSafeEqual(hash(key), Buffer.from(item.hash, "hex")),
        )
      )
        throw Object.assign(Error("Neplatný klíč displeje."), { status: 401 });
    },
  };
}

function displaySnapshot({
  name,
  station,
  sensors,
  alarms,
  values,
  now,
  staleMinutes,
}) {
  return {
    version: 1,
    name,
    server_time: now,
    online: station.online,
    stale_after_ms: staleMinutes * 60000,
    temperature: { value: values.temperature ?? null, ...sensors.temperature },
    level: { value: values.level ?? null, ...sensors.level },
    alarms: alarms.map(({ id, title, body, acknowledged }) => ({
      id,
      title,
      body,
      acknowledged: !!acknowledged,
    })),
  };
}
module.exports = { createDisplays, displaySnapshot };
