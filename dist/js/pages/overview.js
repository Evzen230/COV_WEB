import { settings, connected } from "../core/state.js";
import { stationStatus, esc } from "../core/utils.js";

import {
  header,
  exportButton,
  metrics,
  chart,
  sensorTable,
  process,
  eventList,
} from "../components/dashboard.js";

export function overview() {
  return (
    header(
      "Provozní přehled",
      "Vše důležité o vaší čistírně na jednom místě.",
      exportButton() +
        /* HTML */ `
          <button class="btn primary" data-action="refresh">
            ↻ &nbsp; Obnovit data
          </button>
        `,
    ) +
    /* HTML */ `
      <div class="notice" data-kind="${stationStatus().kind}">
        <b>◈ &nbsp; ${esc(stationStatus().text)}</b>
        ${esc(stationStatus().detail || "Aktuální přehled měření a provozu čistírny.")}
      </div>
    ` +
    metrics() +
    /* HTML */ `
      <div class="grid">${chart()}${process()}</div>
      <div class="grid">
        <div class="card">
          <div class="panelhead">
            <h2>Přehled senzorů</h2>
            <a class="linkbtn" href="#sensors">Všechny senzory ↗</a>
          </div>
          ${sensorTable()}
        </div>
        <div class="card">
          <div class="panelhead">
            <h2>Události a upozornění</h2>
            <a class="linkbtn" href="#alarms">Zobrazit vše ↗</a>
          </div>
          ${eventList()}
        </div>
      </div>
    `
  );
}
