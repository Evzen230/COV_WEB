const { test } = require("node:test");
const assert = require("node:assert/strict");
const { credentials, createSecurity } = require("../server/security.cjs");
test("Persistent sessions survive restart, expire after 30 days and revoke on logout", async () => {
  let time = 1000;
  const data = new Map();
  const options = {
    get: (k, d) => data.get(k) || d,
    put: (k, v) => data.set(k, structuredClone(v)),
  };
  const config = credentials("test password", "key");
  let security = createSecurity(config, () => time, options);
  let cookie;
  const req = {
    method: "POST",
    headers: {},
    socket: { remoteAddress: "local" },
  };
  const res = { setHeader: (k, v) => (cookie = v.split(";")[0]) };
  await security.handle(
    req,
    res,
    "/api/auth/login",
    async () => ({ password: "test password" }),
    () => {},
  );
  assert.ok(!JSON.stringify([...data]).includes(cookie.slice(12)));
  req.headers.cookie = cookie;
  security = createSecurity(config, () => time, options);
  assert.doesNotThrow(() => security.authorize(req, "/api/state"));
  time += 30 * 86400000;
  assert.throws(() => security.authorize(req, "/api/state"), { status: 401 });
  await security.handle(
    req,
    res,
    "/api/auth/login",
    async () => ({ password: "test password" }),
    () => {},
  );
  req.headers.cookie = cookie;
  await security.handle(
    req,
    res,
    "/api/auth/logout",
    async () => ({}),
    () => {},
  );
  security = createSecurity(config, () => time, options);
  assert.throws(() => security.authorize(req, "/api/state"), { status: 401 });
});
