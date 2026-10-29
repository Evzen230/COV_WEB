import { api } from "../core/api.js";
import { esc, toast } from "../core/utils.js";
let dismissed = "";
let lastCheck = 0;
export function updatesPanel() {
  return '<div class="card" id="updates-panel"><div class="panelhead"><h2>Aktualizace</h2></div><div style="padding:22px" id="updates-content">Načítání verzí…</div></div>';
}
export async function refreshUpdates(force = false) {
  if (!force && Date.now() - lastCheck < 60000) return;
  lastCheck = Date.now();
  try {
    const s = await api("/api/updates");
    const signature = JSON.stringify([
      s.release?.server.version,
      s.release?.firmware.version,
    ]);
    document.querySelector("#update-notice")?.remove();
    if (s.available && dismissed !== signature) {
      const notice = document.createElement("div");
      notice.id = "update-notice";
      notice.className = "notice";
      notice.innerHTML =
        'Je dostupná aktualizace. <a href="#settings/updates">Zobrazit aktualizace</a> <button type="button" class="btn" aria-label="Skrýt oznámení aktualizace">Zavřít</button>';
      notice.querySelector("button").onclick = () => {
        dismissed = signature;
        notice.remove();
      };
      document.querySelector("#main").before(notice);
    }
    const content = document.querySelector("#updates-content");
    if (!content) return;
    content.innerHTML = `<p>Server: <b>${esc(s.current)}</b> · Stanice: <b>${esc(s.station?.version || "Verze není hlášena")}</b></p>
      <p>${s.enabled ? "Kontrola probíhá každých 6 hodin. Instalace vyžaduje krátký restart." : "Zdroj aktualizací není nakonfigurován. Postup najdete v dokumentaci aktualizací."}</p>
      <p>Poslední kontrola: ${esc(s.checked ? new Date(s.checked).toLocaleString("cs-CZ") : "Dosud neproběhla")}</p>
      ${s.error ? `<p role="status">${esc(s.error)}</p>` : ""}
      ${s.job ? `<p role="status">Instalace serveru: ${esc(s.job.message)}</p>` : ""}
      ${s.release ? `<p>Dostupný server: ${esc(s.release.server.version)} · Firmware: ${esc(s.release.firmware.version)}</p><p style="white-space:pre-wrap">${esc(s.release.notes || "")}</p>` : ""}
      <button class="btn" data-update="check" ${s.enabled ? "" : "disabled"}>Zkontrolovat aktualizace</button>
      <button class="btn" data-update="server" ${s.enabled && s.release && newer(s.release.server.version, s.current) ? "" : "disabled"}>Aktualizovat server (krátký výpadek)</button>
      <button class="btn" data-update="firmware" ${s.enabled && s.station && s.release && newer(s.release.firmware.version, s.station.version) ? "" : "disabled"}>Aktualizovat ESP32 (restart stanice)</button>`;
    for (const button of content.querySelectorAll("[data-update]"))
      button.onclick = async () => {
        for (const b of content.querySelectorAll("button")) b.disabled = true;
        try {
          const kind = button.dataset.update;
          await api(
            kind === "check" ? "/api/updates/check" : "/api/updates/install",
            "POST",
            kind === "check" ? undefined : { kind },
          );
          toast(
            kind === "check"
              ? "Kontrola dokončena."
              : "Aktualizace připravena. Sledujte verzi a stav instalace.",
          );
        } catch (e) {
          toast(e.message, "error");
        }
        await refreshUpdates(true);
      };
  } catch {
    /* Update checks never interrupt monitoring. */
  }
}
function newer(a, b) {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
