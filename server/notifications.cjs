// Persisted outbox: one message per alarm transition, independent of browsers.
function createNotifications({
  get,
  put,
  now = Date.now,
  fetcher = fetch,
  token = process.env.NTFY_TOKEN,
}) {
  let config = get("notifications", { enabled: false, topic: "" });
  let queue = get("notificationQueue", []);
  let status = get("notificationStatus", { lastSent: null, error: null });
  let busy = false,
    closed = false;
  const save = () => put("notificationQueue", queue);
  function view() {
    return { ...config, ...status, pending: queue.length };
  }
  function configure(value) {
    if (
      typeof value.enabled !== "boolean" ||
      typeof value.topic !== "string" ||
      (value.topic !== "" && !/^[a-zA-Z0-9_-]{16,128}$/.test(value.topic)) ||
      (value.enabled && !value.topic)
    )
      throw Object.assign(
        new Error(
          "Téma musí mít 16–128 znaků: písmena, číslice, pomlčka nebo podtržítko.",
        ),
        { status: 400 },
      );
    config = { enabled: value.enabled, topic: value.topic };
    put("notifications", config);
    queue = [];
    save();
    status = { lastSent: null, error: null };
    put("notificationStatus", status);
    return view();
  }
  function enqueue(title, message, recovery = false) {
    if (!config.enabled) return false;
    if (queue.length >= 500) return false;
    queue.push({
      topic: config.topic,
      title,
      message,
      priority: recovery ? 3 : 4,
      attempts: 0,
      due: now(),
    });
    save();
    return true;
  }
  async function tick() {
    if (
      busy ||
      closed ||
      !config.enabled ||
      !queue.length ||
      queue[0].due > now()
    )
      return;
    busy = true;
    const item = queue[0];
    try {
      const response = await fetcher("https://ntfy.sh/", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          topic: item.topic,
          title: item.title,
          message: item.message,
          priority: item.priority,
        }),
      });
      await response.body?.cancel();
      if (!response.ok)
        throw new Error(`Služba ntfy odpověděla HTTP ${response.status}.`);
      if (closed || queue[0] !== item) return;
      queue.shift();
      status = { lastSent: now(), error: null };
    } catch (error) {
      if (closed || queue[0] !== item) return;
      item.attempts++;
      item.due =
        now() + Math.min(3600000, 15000 * 2 ** Math.min(item.attempts - 1, 8));
      status.error = error.message.startsWith("Služba ntfy")
        ? error.message
        : "Odeslání se nezdařilo. Zpráva čeká na opakování.";
    } finally {
      busy = false;
      if (!closed) {
        save();
        put("notificationStatus", status);
      }
    }
  }
  return {
    view,
    configure,
    enqueue,
    tick,
    close() {
      closed = true;
    },
  };
}
module.exports = { createNotifications };
