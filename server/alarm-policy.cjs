function outsideBand(value, min, max, active = false, hysteresis = 0) {
  if (value == null) return false;
  const lower = min == null ? null : min + (active ? hysteresis : 0);
  const upper = max == null ? null : max - (active ? hysteresis : 0);
  return (lower != null && value < lower) || (upper != null && value > upper);
}
// Only threshold alarms are delayed. Device timeout and missing sensors have their own semantics.
function stabilize(conditions, active, pending, delaySeconds, now) {
  const seen = new Set(conditions.map((c) => c[0]));
  for (const id of Object.keys(pending)) if (!seen.has(id)) delete pending[id];
  return conditions.filter(([id]) => {
    if (!["temp", "level"].includes(id) && !id.startsWith("range")) return true;
    if (active.has(id)) {
      delete pending[id];
      return true;
    }
    pending[id] ??= now;
    return now - pending[id] >= delaySeconds * 1000;
  });
}
module.exports = { outsideBand, stabilize };
