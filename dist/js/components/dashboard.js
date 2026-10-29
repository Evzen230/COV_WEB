import {
  settings,
  history,
  events,
  range,
  metric,
  ack,
  sensors,
  serverState,
} from "../core/state.js";
import {
  esc,
  fmt,
  stamp,
  current,
  healthy,
  value,
  activeAlarms,
  status,
  filtered,
  sensorAge,
  sensorTime,
} from "../core/utils.js";

export function header(title, sub, actions = "") {
  return /* HTML */ /* HTML */ `
    <div class="pagehead">
      <div>
        <h1>${title}</h1>
        <p class="subtitle">${sub}</p>
      </div>
      <div class="actions">${actions}</div>
    </div>
  `;
}
export function exportButton() {
  return '<button class="btn" data-action="export">↓ &nbsp; Export CSV</button>';
}

function levelDisplay() {
  const reading = value("level");
  return {
    fill: Number.isFinite(reading) ? Math.max(0, Math.min(100, reading)) : 0,
    alarm:
      activeAlarms().some((alarm) => alarm.id === "level") ||
      (reading != null && reading >= settings.levelMax),
    missing: reading == null,
  };
}

function tankGraphic(compact = false) {
  const { fill, alarm, missing } = levelDisplay();
  return `<div class="tankgraphic${compact ? " tankgraphic-compact" : ""}${alarm ? " tank-alarm" : ""}${missing ? " tank-missing" : ""}" style="--fill:${fill}%;--threshold:${Math.max(0, Math.min(100, settings.levelMax))}%" role="img" aria-label="${missing ? "Hladina není dostupná" : `Naplnění nádrže ${fmt(value("level"))} %${alarm ? ", alarm hladiny" : ""}`}">
    <div class="water"></div><span class="tank-threshold" aria-hidden="true"></span>
    ${missing ? '<span class="tank-unknown" aria-hidden="true">?</span>' : ""}
  </div>`;
}

export function metrics() {
  return /* HTML */ /* HTML */ `
    <div class="metrics">
      ${sensors
        .slice(0, 4)
        .map(
          (s) => /* HTML */ `
            <div class="card metric">
              <div class="metrichead">
                ${s.name}
                <span class="metricicon">${s.icon}</span>
              </div>
              <div class="metric-reading">
                <div class="value">
                  ${fmt(value(s.id))}
                  <small>${s.unit}</small>
                </div>
                ${s.id === "level" ? tankGraphic(true) : ""}
              </div>
              <p class="sensor-age">${sensorAge(s.id)}</p>
              <div class="metricfoot">
                ${status(s)}
                <span>
                  ${s.id === "level" ? "Objem ≈ " + fmt(value("level") == null ? null : (value("level") * settings.tankVolume) / 100) + " l" : "Měření ze stanice"}
                </span>
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

export { chart } from "./chart.js";

export function sensorTable() {
  return /* HTML */ /* HTML */ `
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>SENZOR / ROZHRANÍ</th>
            <th>AKTUÁLNÍ HODNOTA</th>
            <th>STAV</th>
            <th>POSLEDNÍ PLATNÉ MĚŘENÍ</th>
          </tr>
        </thead>
        <tbody>
          ${sensors
            .map(
              (s) => /* HTML */ `
                <tr>
                  <td class="sensorname">
                    ${s.name}
                    <small>${s.device}</small>
                  </td>
                  <td class="mono">${fmt(value(s.id))} ${s.unit}</td>
                  <td>${status(s)}</td>
                  <td class="muted">
                    ${stamp(sensorTime(s.id))}
                    <small class="sensor-age">${sensorAge(s.id)}</small>
                  </td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function process() {
  return /* HTML */ /* HTML */ `
    <div class="card">
      <div class="panelhead">
        <h2>Stav technologie</h2>
        <span class="pill">${"Stanice"}</span>
      </div>
      <div class="process">
        <div class="tank">
          ${tankGraphic()}
          <div>
            <small>AKTIVAČNÍ NÁDRŽ</small>
            <strong>
              ${fmt(value("level"))}
              <span class="muted" style="font-size:14px">%</span>
            </strong>
            <small>Odhad z objemu ${fmt(settings.tankVolume)} l</small>
          </div>
        </div>
        <div class="progress${levelDisplay().alarm ? " tank-alarm" : ""}">
          <span style="width:${levelDisplay().fill}%"></span>
        </div>
        <div class="metricfoot">
          <span>0 %</span>
          <span>
            ${levelDisplay().missing ? "Bez měření" : levelDisplay().alarm ? "Alarm hladiny" : "Provozní hladina"}
          </span>
          <span>100 %</span>
        </div>
        <div class="processrow">
          <div class="flex">
            <span class="equipment">ϟ</span>
            <div>
              Dmychadlo
              <small>Pouze sledování provozu</small>
            </div>
          </div>
          <span class="pill ${healthy() ? "" : "warning"}">
            ${!healthy() || serverState?.station.latest?.blower == null ? "Neznámý stav" : serverState.station.latest.blower ? "V provozu" : "Vypnuto"}
          </span>
        </div>
        <div class="processrow">
          <div class="flex">
            <span class="equipment">⌁</span>
            <div>
              Komunikační jednotka
              <small>cov-monitor-01 · ESP32</small>
            </div>
          </div>
          <span class="${healthy() ? "ok" : "warn"}">
            ● ${healthy() ? "Online" : "Offline"}
          </span>
        </div>
      </div>
    </div>
  `;
}

export function eventList() {
  let alarms = activeAlarms();
  return /* HTML */ /* HTML */ `
    ${alarms
      .map(
        (a) => /* HTML */ `
          <div class="event">
            <span class="eventicon">!</span>
            <div>
              <b>${a.title}</b>
              <p>${a.body}</p>
              <span class="pill warning">
                ${ack[a.id] ? "Potvrzeno" : "Aktivní alarm"}
              </span>
            </div>
          </div>
        `,
      )
      .join("")}
    <div class="event">
      <span class="eventicon" style="background:var(--soft);color:var(--green)">
        ✓
      </span>
      <div>
        <b>${"Příjem dat ze stanice"}</b>
        <p>${"Server přijímá data přes HTTP API a vyhodnocuje dostupnost."}</p>
        <time>Monitoring stanice</time>
      </div>
    </div>
    ${events
      .slice(0, 2)
      .map(
        (e) => /* HTML */ `
          <div class="event">
            <span class="eventicon">↗</span>
            <div>
              <b>${esc(e.title)}</b>
              <p>${stamp(e.time)}</p>
            </div>
          </div>
        `,
      )
      .join("")}
  `;
}
