import {
  history,
  range,
  serverState,
  connected,
  settings,
  chartStation,
  metric,
  visibleSensors,
} from "./state.js";

export const $ = (selector) => document.querySelector(selector);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
export const fmt = (value) =>
  value == null
    ? "—"
    : Number(value).toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
export const stamp = (time) =>
  time == null
    ? "—"
    : new Date(time).toLocaleString("cs-CZ", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
export const current = () => history.at(-1) || { time: null };
export const healthy = () => connected && !!serverState?.station.online;
export const value = (id) =>
  healthy() ? (serverState?.station.latest?.[id] ?? null) : null;
export const sourceName = (id) => {
  const stationId = settings.sensorSources?.[id] || "cov-monitor-01";
  return (
    serverState?.stations?.find((station) => station.id === stationId)?.name ||
    stationId
  );
};
export const activeAlarms = () => serverState?.alarms ?? [];
export function sensorAlarms(id) {
  const ids = [`range${id}`, id === "temperature" ? "sensor" : `sensor${id}`];
  if (id === "temperature") ids.push("temp");
  if (id === "level") ids.push("level");
  return activeAlarms().filter((alarm) => ids.includes(alarm.id));
}
export function alarmLimits(id) {
  if (
    chartStation &&
    chartStation !== (settings.sensorSources?.[id] || "cov-monitor-01")
  )
    return [];
  const rule = settings.sensorRules?.[id];
  const limits = [];
  const add = (value, label) => {
    if (Number.isFinite(value)) limits.push({ value, label });
  };
  if (id === "temperature") {
    add(settings.tempMin, "Dolní mez");
    add(settings.tempMax, "Horní mez");
  } else if (id === "level") add(settings.levelMax, "Horní mez");
  if (rule?.enabled) {
    if (!limits.some((limit) => limit.value === rule.min))
      add(rule.min, "Dolní mez");
    if (!limits.some((limit) => limit.value === rule.max))
      add(rule.max, "Horní mez");
  }
  return limits;
}
export function stationStatus() {
  if (!connected) return { kind: "offline", text: "Spojení není dostupné" };
  if (!healthy()) return { kind: "offline", text: "Stanice neodesílá data" };
  const alarms = activeAlarms();
  if (alarms.length)
    return {
      kind: "alarm",
      text: `Aktivní alarmy: ${alarms.length}`,
      detail: alarms.map((a) => a.title).join(" · "),
    };
  if (visibleSensors().some((sensor) => value(sensor.id) == null))
    return { kind: "warning", text: "Některá měření chybí" };
  return { kind: "ok", text: "Provoz v pořádku" };
}
export function levelTrend() {
  if (value("level") == null) return "Trend není dostupný";
  const now = Date.now();
  const rows = history.filter(
    (row) =>
      row.time >= now - 15 * 60000 &&
      row.time <= now &&
      (!row.device_id ||
        row.device_id === (settings.sensorSources?.level || "cov-monitor-01")),
  );
  const last = rows.at(-1);
  if (!last || last.level == null || now - last.time > settings.stale * 60000)
    return "Trend není dostupný";
  let start = rows.length - 1;
  while (
    start > 0 &&
    rows[start - 1].level != null &&
    rows[start].time - rows[start - 1].time <= settings.stale * 60000
  )
    start--;
  const first = rows[start];
  if (last.time - first.time < 60000) return "Zatím málo dat pro trend";
  const delta = last.level - first.level;
  return `${Math.abs(delta) < 0.5 ? "→ Stabilní" : delta > 0 ? "↑ Stoupá" : "↓ Klesá"} · za ${Math.round((last.time - first.time) / 60000)} min`;
}
export function sensorAge(id) {
  const time = sensorTime(id);
  if (time == null) return "Zatím bez platného měření";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  const age =
    seconds < 60
      ? `${seconds} s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)} min`
        : seconds < 86400
          ? `${Math.floor(seconds / 3600)} h`
          : `${Math.floor(seconds / 86400)} dní`;
  return `Poslední platné: před ${age}`;
}
export function sensorTime(id) {
  return (
    serverState?.sensorStatus?.[id]?.last_valid_at ??
    (value(id) != null ? current().time : null)
  );
}
export const status = (sensor) =>
  !healthy() || serverState?.sensorStatus?.[sensor.id]?.status === "stale"
    ? '<span class="pill warning">Zastaralé / nedostupné</span>'
    : sensorAlarms(sensor.id).length
      ? `<span class="pill danger">${value(sensor.id) == null ? "Aktivní alarm · bez měření" : "Aktivní alarm"}</span>`
      : value(sensor.id) == null
        ? '<span class="pill warning">Bez měření</span>'
        : '<span class="pill">V pořádku</span>';

export function filtered() {
  const station =
    chartStation || settings.sensorSources?.[metric] || "cov-monitor-01";
  const hours = { "1 h": 1, "24 h": 24, "7 dní": 168 }[range];
  return history.filter(
    (sample) =>
      sample.time >= Date.now() - hours * 3600000 &&
      (!sample.device_id || sample.device_id === station),
  );
}

export function toast(message, kind = "success") {
  $("#toast").dataset.kind = kind;
  $("#toast").setAttribute("role", kind === "error" ? "alert" : "status");
  $("#toast").textContent = message;
  $("#toast").style.display = "block";
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    $("#toast").style.display = "none";
  }, 3500);
}

export function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csv(rows) {
  return (
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map(
            (value) =>
              '"' +
              String(value ?? "")
                .replace(/^[=+@-]/, "' $&")
                .replace(/"/g, '""') +
              '"',
          )
          .join(";"),
      )
      .join("\r\n")
  );
}
