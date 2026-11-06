import { serverState } from "../core/state.js";
import { api } from "../core/api.js";
import { esc, toast } from "../core/utils.js";
let dismissed = "";
let lastCheck = 0;
let updateStation = "cov-monitor-01";
export function updatesPanel() {
  return `<div class="card" id="updates-panel"><div class="panelhead"><h2>Aktualizace</h2><label>ESP stanice<select id="update-station">${(serverState?.stations || [{ id: "cov-monitor-01", name: "Hlavní ESP32" }]).map((station) => `<option value="${esc(station.id)}" ${station.id === updateStation ? "selected" : ""}>${esc(station.name)}</option>`).join("")}</select></label></div><div style="padding:22px" id="updates-content">Načítání verzí…</div></div>`;
}
export async function refreshUpdates(force = false) {
  const picker = document.querySelector("#update-station");
  if (picker)
    picker.onchange = () => {
      updateStation = picker.value;
      refreshUpdates(true);
    };
  if (!force && Date.now() - lastCheck < 60000) return;
  lastCheck = Date.now();
  try {
    const requestedStation = updateStation;
    const s = await api(
      "/api/updates?device_id=" + encodeURIComponent(updateStation),
    );
    if (requestedStation !== updateStation) return;
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
      <button class="btn" data-update="firmware" ${s.enabled && s.station && s.release && newer(s.release.firmware.version, s.station.version) ? "" : "disabled"}>Aktualizovat ESP32 (restart stanice)</button>
      ${rollbackControls(s)}`;
    for (const checkbox of content.querySelectorAll("[data-rollback-ack]"))
      checkbox.onchange = () => {
        content.querySelector(
          `[data-update="restore-${checkbox.dataset.rollbackAck}"]`,
        ).disabled = !checkbox.checked;
      };
    for (const button of content.querySelectorAll("[data-update]"))
      button.onclick = async () => {
        for (const b of content.querySelectorAll("button")) b.disabled = true;
        try {
          const kind = button.dataset.update;
          if (kind.startsWith("restore-")) {
            const component = kind.slice(8);
            if (
              !content.querySelector(`[data-rollback-ack="${component}"]`)
                ?.checked
            )
              throw Error("Potvrďte důsledky obnovy.");
            const selection = content.querySelector(
              `#rollback-${component}`,
            ).value;
            await api(
              "/api/updates/rollback?device_id=" +
                encodeURIComponent(updateStation),
              "POST",
              component === "server"
                ? { kind: component, id: selection, acknowledgeDataLoss: true }
                : { kind: component, version: selection, acknowledge: true },
            );
            toast(
              "Obnova připravena. Po restartu obnovte stránku a případně se přihlaste původními údaji.",
            );
          } else if (kind === "history") {
            const version = content
              .querySelector("#rollback-release-version")
              .value.trim();
            await api(
              "/api/updates/history?device_id=" +
                encodeURIComponent(updateStation),
              "POST",
              { version },
            );
            toast("Podepsané vydání bylo ověřeno a přidáno do výběru.");
          } else {
            await api(
              (kind === "check"
                ? "/api/updates/check"
                : "/api/updates/install") +
                "?device_id=" +
                encodeURIComponent(updateStation),
              "POST",
              kind === "check" ? undefined : { kind },
            );
            toast(
              kind === "check"
                ? "Kontrola dokončena."
                : "Aktualizace připravena. Sledujte verzi a stav instalace.",
            );
          }
        } catch (e) {
          toast(e.message, "error");
        }
        await refreshUpdates(true);
      };
  } catch {
    /* Update checks never interrupt monitoring. */
  }
}
export function rollbackControls(s) {
  const server = s.serverRollbacks || { supported: false, entries: [] };
  const firmware = s.firmwareRollbacks || [];
  return `<fieldset class="update-recovery sensor-monitoring"><legend>Vrátit server na uloženou verzi</legend>
    <p>Obnoví se program, databáze i přístupové údaje k datu zvolené zálohy. Novější měření, nastavení a párování se ztratí. Před obnovou se uloží i současný stav. Server se krátce restartuje.</p>
    ${!server.supported ? "<p>Aktualizační služba na malině zatím nepodporuje ruční obnovu. Postup jejího doplnění je v návodu k aktualizacím.</p>" : !server.entries.length ? "<p>Zatím není uložená žádná předchozí verze. Zálohy pro návrat vznikají před instalací dalších verzí.</p>" : `<label>Verze a datum zálohy<select id="rollback-server">${server.entries.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.version)} · ${esc(new Date(entry.created).toLocaleString("cs-CZ"))}</option>`).join("")}</select></label><label class="sensor-toggle"><input type="checkbox" data-rollback-ack="server"> Souhlasím s obnovením dat a přístupů k uvedenému datu a se ztrátou novějších záznamů.</label><button type="button" class="btn" data-update="restore-server" disabled>Obnovit vybranou zálohu serveru</button>`}
    <p><a href="#guides/updates">Postup obnovy, také při nefunkčním webu →</a></p></fieldset>
    <fieldset class="update-recovery sensor-monitoring"><legend>Vrátit ESP32 na starší firmware</legend>
    <p>Nabízejí se dříve ověřená vydání pro vybraný typ stanice. Firmware se stáhne z původního vydání a znovu ověří podpisem a SHA-256. Párování v NVS se nemaže.</p>
    ${s.station?.rollback !== true ? "<p>Stanice zatím nehlásí podporu ručního návratu. Nejdřív ji aktualizujte na firmware 0.3.2 nebo novější s touto podporou.</p>" : !firmware.length ? "<p>Žádná starší kompatibilní verze zatím není načtená.</p>" : `<label>Starší verze firmware<select id="rollback-firmware">${firmware.map((entry) => `<option value="${esc(entry.version)}">${esc(entry.version)}</option>`).join("")}</select></label><label class="sensor-toggle"><input type="checkbox" data-rollback-ack="firmware"> Souhlasím s restartem stanice. Starší firmware nemusí podporovat všechny současné funkce ani další návraty.</label><button type="button" class="btn" data-update="restore-firmware" disabled>Obnovit vybraný firmware ESP32</button>`}
    ${s.enabled ? '<label>Načíst podepsané vydání firmware z GitHubu (např. 0.3.1)<input id="rollback-release-version" placeholder="0.3.1" maxlength="40"></label><button type="button" class="btn" data-update="history">Načíst starší vydání</button>' : ""}
    </fieldset>`;
}
function newer(a, b) {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
