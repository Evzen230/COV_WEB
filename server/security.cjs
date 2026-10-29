const {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const digest = (value) => createHash("sha256").update(value).digest();
const equal = (a, b) => a.length === b.length && timingSafeEqual(a, b);

function credentials(password, apiKey) {
  const salt = randomBytes(16).toString("hex");
  return {
    version: 1,
    salt,
    passwordHash: scryptSync(password, salt, 64).toString("hex"),
    telemetryHash: digest(apiKey).toString("hex"),
  };
}
function loadCredentials(
  filename = process.env.AUTH_FILE ||
    path.join(__dirname, "..", "data", "auth.json"),
) {
  if (!fs.existsSync(filename))
    throw Error(
      "Chybí zabezpečení. Nejdřív spusťte npm run setup a uložte si vygenerované přístupové údaje.",
    );
  const config = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (
    config.version !== 1 ||
    !/^[a-f0-9]{128}$/.test(config.passwordHash) ||
    !/^[a-f0-9]{64}$/.test(config.telemetryHash) ||
    !/^[a-f0-9]{32}$/.test(config.salt)
  )
    throw Error(
      "Neplatný soubor zabezpečení. Pro obnovu použijte npm run setup -- --reset.",
    );
  return config;
}
function saveCredentials(
  config,
  filename = process.env.AUTH_FILE ||
    path.join(__dirname, "..", "data", "auth.json"),
) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + "." + randomBytes(8).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function createSecurity(
  config,
  now = Date.now,
  {
    save = () => {
      throw Error("Ukládání přístupu není nastaveno.");
    },
  } = {},
) {
  const sessions = new Map(),
    attempts = new Map(),
    traffic = new Map();
  function limit(map, key, max, windowMs) {
    let record = map.get(key);
    if (!record || record.until <= now()) {
      record = { count: 0, until: now() + windowMs };
      map.set(key, record);
    }
    record.count++;
    if (map.size > 2000)
      for (const [id, item] of map) if (item.until <= now()) map.delete(id);
    if (record.count > max)
      throw Object.assign(Error("Příliš mnoho požadavků. Zkuste to později."), {
        status: 429,
      });
  }
  function session(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("cov_session="))
      ?.slice(12);
    const item = sessions.get(token);
    if (!item || item.expires <= now()) {
      sessions.delete(token);
      return null;
    }
    return { token, ...item };
  }
  async function handle(req, res, p, body, json) {
    if (
      req.method === "POST" &&
      ["/api/auth/password", "/api/auth/api-key"].includes(p)
    ) {
      const current = session(req);
      if (!current)
        throw Object.assign(Error("Přihlaste se do aplikace."), {
          status: 401,
        });
      limit(attempts, req.socket.remoteAddress, 5, 15 * 60000);
      const input = await body(req);
      if (
        typeof input.currentPassword !== "string" ||
        input.currentPassword.length > 256 ||
        !equal(
          scryptSync(input.currentPassword, config.salt, 64),
          Buffer.from(config.passwordHash, "hex"),
        )
      )
        throw Object.assign(Error("Současné heslo není správné."), {
          status: 403,
        });
      let next = { ...config },
        key;
      if (p === "/api/auth/password") {
        if (
          typeof input.newPassword !== "string" ||
          input.newPassword.length < 8 ||
          input.newPassword.length > 128
        )
          throw Object.assign(
            Error("Zvolte heslo nebo frázi o délce 8 až 128 znaků."),
            { status: 400 },
          );
        const generated = credentials(input.newPassword, "unused");
        next.salt = generated.salt;
        next.passwordHash = generated.passwordHash;
      } else {
        key = randomBytes(32).toString("base64url");
        next.telemetryHash = digest(key).toString("hex");
      }
      save(next);
      config = next;
      attempts.delete(req.socket.remoteAddress);
      if (p === "/api/auth/password") {
        const token = randomBytes(32).toString("base64url");
        sessions.clear();
        sessions.set(token, { expires: now() + 12 * 3600000 });
        res.setHeader(
          "Set-Cookie",
          `cov_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.socket.encrypted ? "; Secure" : ""}`,
        );
      }
      json(200, key ? { apiKey: key } : { changed: true });
      return true;
    }
    if (p === "/api/auth/session" && req.method === "GET") {
      json(200, { authenticated: !!session(req) });
      return true;
    }
    if (p === "/api/auth/login" && req.method === "POST") {
      limit(attempts, req.socket.remoteAddress, 5, 15 * 60000);
      const input = await body(req),
        password = input.password;
      if (
        typeof password !== "string" ||
        password.length > 256 ||
        !equal(
          scryptSync(password, config.salt, 64),
          Buffer.from(config.passwordHash, "hex"),
        )
      )
        throw Object.assign(Error("Nesprávné heslo."), { status: 401 });
      attempts.delete(req.socket.remoteAddress);
      const token = randomBytes(32).toString("base64url");
      for (const [key, value] of sessions)
        if (value.expires <= now()) sessions.delete(key);
      if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
      sessions.set(token, { expires: now() + 12 * 3600000 });
      res.setHeader(
        "Set-Cookie",
        `cov_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.socket.encrypted ? "; Secure" : ""}`,
      );
      json(200, { authenticated: true });
      return true;
    }
    if (p === "/api/auth/logout" && req.method === "POST") {
      const current = session(req);
      if (current) sessions.delete(current.token);
      res.setHeader(
        "Set-Cookie",
        "cov_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
      json(200, { authenticated: false });
      return true;
    }
    return false;
  }
  function authorize(req, p) {
    if (
      p === "/api/v1/telemetry" ||
      p === "/api/v1/device/status" ||
      p === "/api/v1/device/update" ||
      p === "/api/v1/device/firmware"
    ) {
      const key =
        req.headers["x-api-key"] ||
        req.headers.authorization?.replace(/^Bearer /i, "") ||
        "";
      if (
        typeof key !== "string" ||
        key.length > 256 ||
        !equal(digest(key), Buffer.from(config.telemetryHash, "hex"))
      )
        throw Object.assign(Error("Neplatný klíč stanice."), { status: 401 });
      limit(traffic, req.socket.remoteAddress, 300, 60000);
    } else if (!session(req))
      throw Object.assign(Error("Přihlaste se do aplikace."), { status: 401 });
  }
  return { handle, authorize };
}
module.exports = {
  credentials,
  loadCredentials,
  createSecurity,
  saveCredentials,
};
