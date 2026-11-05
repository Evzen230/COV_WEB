import { serverState, sensors, settings } from "../core/state.js";
import { esc, fmt, stamp } from "../core/utils.js";

export function stationCards() {
  if (!serverState?.stations?.length) return "";
  return `<section class="esp-stations" aria-label="ESP stanice jedné ČOV"><div class="panelhead"><h2>ESP stanice této ČOV</h2><a class="linkbtn" href="#settings/advanced">Spravovat stanice →</a></div><div class="detailcards">${serverState.stations
    .map((station) => {
      const readings = sensors.filter(
        (sensor) =>
          !settings.hiddenSensors?.includes(sensor.id) &&
          (station.latest?.[sensor.id] != null ||
            (settings.sensorSources?.[sensor.id] || "cov-monitor-01") ===
              station.id),
      );
      return `<article class="card esp-station"><div class="panelhead"><h3>${esc(station.name)}</h3><span class="pill ${station.online ? "" : "warning"}">${station.online ? "Online" : "Nedostupná"}</span></div><div class="esp-station-body"><p><code>${esc(station.id)}</code> · Poslední zpráva: ${stamp(station.last_seen)}</p>${readings.length ? `<dl>${readings.map((sensor) => `<div><dt>${sensor.name}</dt><dd>${fmt(station.online ? station.latest?.[sensor.id] : null)} ${sensor.unit}</dd></div>`).join("")}</dl>` : "<p>Čeká na měření senzorů.</p>"}</div></article>`;
    })
    .join("")}</div></section>`;
}
