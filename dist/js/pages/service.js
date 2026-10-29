import { service, sensors } from "../core/state.js";
import { esc } from "../core/utils.js";
import { header } from "../components/dashboard.js";

export function servicePage() {
  return (
    header(
      "Servisní deník",
      "Údržba, kalibrace a změny zařízení na jednom místě.",
    ) +
    /* HTML */ `
      <div class="card">
        <div class="panelhead"><h2>Přidat servisní událost</h2></div>
        <form id="serviceform" class="formgrid">
          <label>
            Datum
            <input
              name="date"
              type="date"
              required
              value="${new Date().toLocaleDateString("sv-SE")}"
            />
          </label>
          <label>
            Typ
            <select name="type">
              <option>Pravidelná kontrola</option>
              <option>Čištění</option>
              <option>Kalibrace</option>
              <option>Výměna senzoru</option>
              <option>Firmware</option>
              <option>Jiné</option>
            </select>
          </label>
          <label class="full">
            Zařízení
            <select name="device">
              <option>Celá stanice</option>
              <option>ESP32</option>
              ${sensors
                .map(
                  (s) => /* HTML */ `
                    <option>${s.name}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <label class="full">
            Popis práce
            <textarea
              name="note"
              required
              placeholder="Co bylo provedeno, výsledek kontroly…"
            ></textarea>
          </label>
          <button class="btn primary">+ Uložit záznam</button>
        </form>
      </div>
      <div class="card" style="margin-top:22px">
        <div class="panelhead">
          <h2>Provedené práce (${service.length})</h2>
        </div>
        ${
          service.length
            ? service
                .map(
                  (s) => /* HTML */ `
                    <div class="event">
                      <span class="eventicon">⌕</span>
                      <div style="flex:1">
                        <b>${esc(s.type)} · ${esc(s.device)}</b>
                        <p>${esc(s.note)}</p>
                        <time>${esc(s.date)}</time>
                      </div>
                      <button class="linkbtn" data-delete-service="${s.id}">
                        Smazat
                      </button>
                    </div>
                  `,
                )
                .join("")
            : '<div class="empty">První servisní záznam se zobrazí zde.</div>'
        }
      </div>
    `
  );
}
