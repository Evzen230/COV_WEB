import { history, range, serverState, connected } from "./state.js";

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
export const activeAlarms = () => serverState?.alarms ?? [];
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
  !healthy()
    ? '<span class="pill warning">Zastaralé / nedostupné</span>'
    : value(sensor.id) == null
      ? '<span class="pill warning">Bez měření</span>'
      : '<span class="pill">V pořádku</span>';

export function filtered() {
  const hours = { "1 h": 1, "24 h": 24, "7 dní": 168 }[range];
  return history.filter(
    (sample) => sample.time >= Date.now() - hours * 3600000,
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
