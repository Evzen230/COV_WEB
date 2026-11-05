import { stationCards } from "../components/stations.js";
import { settings, serverState } from "../core/state.js";
import { stamp, healthy } from "../core/utils.js";
import { header, sensorTable } from "../components/dashboard.js";

export function sensorsPage() {
  return (
    header("Senzory a zařízení", "Aktuální měření a dostupnost senzorů.") +
    `
    <div class="notice">Nezapojené nebo nedostupné senzory mají stav Bez měření. Zobrazení senzorů můžete změnit v <a href="#settings">Nastavení</a>; příjem dat pokračuje.</div>
    <div class="card">${sensorTable()}</div>
    <details class="technical-details"><summary>Technické informace o připojení</summary>${stationCards()}</details>
    <div class="detailcards" style="margin-top:22px">
      <div class="card"><h2>Společný sběr dat ČOV</h2>
        <p>Poslední zpráva: ${stamp(serverState?.station.last_seen)}</p>
        <span class="pill ${healthy() ? "" : "warning"}">${healthy() ? "Příjem dat funguje" : "Příjem dat není dostupný"}</span></div>
      <div class="card"><h2>Dostupnost měření</h2>
        <p>Pokud měření nepřichází déle než ${settings.stale} minut, zobrazí se jako nedostupná.</p>
        <p>Aktivní upozornění najdete v přehledu alarmů.</p></div>
      <div class="card"><h2>Kvalita měření</h2>
        <p>Při výpadku senzoru zůstane v grafu mezera. Chybějící hodnoty se nenahrazují nulou.</p>
        <p>Provozní sondy nenahrazují laboratorní rozbor.</p></div>
    </div>`
  );
}
