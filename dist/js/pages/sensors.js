import { settings, serverState } from "../core/state.js";
import { fmt, healthy } from "../core/utils.js";
import { header, sensorTable } from "../components/dashboard.js";

export function sensorsPage() {
  return (
    header(
      "Senzory a zařízení",
      "Připravená struktura pro jednotlivé etapy projektu.",
    ) +
    /* HTML */ `
      <div class="notice">
        ◈ &nbsp;
        ${"Zobrazeny přijaté hodnoty. Nezapojené veličiny mají stav Bez měření."}
      </div>
      <div class="card">${sensorTable()}</div>
      <div class="detailcards" style="margin-top:22px">
        <div class="card">
          <h2>cov-monitor-01</h2>
          <p>
            ESP32 DevKit · HW-01 · ${"HTTP API v1"}
            <br />
            Wi-Fi: ${fmt(serverState?.station.latest?.rssi)} dBm
            <br />
            Zdroj dat: ${"HTTP → SQLite"}
          </p>
          <span class="pill ${healthy() ? "" : "warning"}">
            ${healthy() ? "Online" : "Offline"}
          </span>
        </div>
        <div class="card">
          <h2>Datový řetězec</h2>
          <p>Senzory → ESP32 → vlastní API → databáze → ČOV Monitor</p>
          <p>Home Assistant je volitelný odběratel dat.</p>
        </div>
        <div class="card">
          <h2>Kvalita měření</h2>
          <p>
            Odpojené čidlo se označí jako nedostupné. Graf zachová mezeru a
            export prázdnou buňku.
          </p>
          <p>Provozní sondy nenahrazují laboratorní rozbor.</p>
        </div>
      </div>
    `
  );
}
