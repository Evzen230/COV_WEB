const {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
  createCipheriv,
} = require("node:crypto");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const error = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
function seal(secret, data) {
  return sealDerived(hash(secret), data);
}
function createPairing({ get, put, now, fleet }) {
  const tickets = new Map(),
    attempts = new Map();
  let globalAttempt = { count: 0, until: 0 };
  const keys = () => get("deviceCredentials", {});
  function issue(id) {
    if (!fleet.has(id)) error("Neznámá stanice", 404);
    for (const [key, ticket] of tickets)
      if (ticket.id === id || ticket.expires <= now()) tickets.delete(key);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code;
    do {
      code = Array.from(randomBytes(8), (byte) => alphabet[byte & 31]).join("");
    } while (tickets.has(hash(hash(code))));
    const expires = now() + 10 * 60000;
    tickets.set(hash(hash(code)), { id, expires, derived: hash(code) });
    return { code, expires, device_id: id };
  }
  function claim(input, address) {
    // Bound online guesses across addresses as well as per client.
    if (globalAttempt.until <= now())
      globalAttempt = { count: 0, until: now() + 60000 };
    if (++globalAttempt.count > 60)
      error("Příliš mnoho pokusů o párování.", 429);
    let attempt = attempts.get(address);
    if (!attempt || attempt.until <= now()) {
      attempt = { count: 0, until: now() + 60000 };
      attempts.set(address, attempt);
    }
    if (++attempt.count > 10) error("Příliš mnoho pokusů o párování.", 429);
    if (attempts.size > 2000)
      for (const [id, item] of attempts)
        if (item.until <= now()) attempts.delete(id);
    if (!input || typeof input !== "object" || Array.isArray(input))
      error("Neplatné párování");
    const { codeHash, nonce, proof } = input;
    if (
      typeof codeHash !== "string" ||
      typeof nonce !== "string" ||
      typeof proof !== "string" ||
      !/^[a-f0-9]{64}$/.test(codeHash) ||
      !/^[a-f0-9]{32}$/.test(nonce) ||
      !/^[a-f0-9]{64}$/.test(proof)
    )
      error("Neplatné párování");
    const ticket = tickets.get(codeHash);
    if (!ticket || ticket.expires <= now())
      error("Kód není platný nebo vypršel.", 401);
    const expected = createHmac("sha256", Buffer.from(ticket.derived, "hex"))
      .update(nonce)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(proof, "hex")))
      error("Neplatné párování", 401);
    if (ticket.nonce) {
      if (ticket.nonce !== nonce) error("Kód již byl použit.", 409);
      return ticket.reply;
    }
    const apiKey = randomBytes(32).toString("hex"),
      next = keys();
    next[ticket.id] = { hash: hash(apiKey) };
    put("deviceCredentials", next);
    // The public ticket identifier is a hash of the derived encryption key.
    ticket.nonce = nonce;
    ticket.reply = sealDerived(ticket.derived, {
      apiKey,
      device_id: ticket.id,
    });
    return ticket.reply;
  }
  function authenticate(key) {
    const digest = hash(key),
      all = keys();
    for (const [id, entry] of Object.entries(all)) {
      if (entry.pendingHash === digest) {
        all[id] = { hash: digest };
        put("deviceCredentials", all);
        return id;
      }
      if (entry.hash === digest) return id;
    }
    return null;
  }
  function rotate(key, id) {
    const all = keys(),
      entry = all[id];
    if (!entry || entry.hash !== hash(key)) error("Neplatný klíč stanice", 401);
    if (!entry.pending) {
      const apiKey = randomBytes(32).toString("hex");
      entry.pendingHash = hash(apiKey);
      entry.pending = seal(key, { apiKey, device_id: id });
      put("deviceCredentials", all);
    }
    return entry.pending;
  }
  function revoke(id) {
    const all = keys();
    delete all[id];
    put("deviceCredentials", all);
    for (const [k, t] of tickets) if (t.id === id) tickets.delete(k);
  }
  return { issue, claim, authenticate, rotate, revoke };
}
function sealDerived(key, data) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data)),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}
module.exports = { createPairing };
