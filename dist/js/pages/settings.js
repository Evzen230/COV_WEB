import { updatesPanel } from "../components/updates.js";
import { settings, sensors, serverState } from "../core/state.js";
import { esc, healthy } from "../core/utils.js";
import { header } from "../components/dashboard.js";
import { accessSettings } from "../components/access-settings.js";
const explanations = {
  temperature:
    "Teplota vody ovlivňuje biologické procesy. Provozní meze nastavíte výše.",
  level:
    "Zaplnění nádrže v procentech. Vysokou hladinu hlídá práh nastavený výše.",
  ph: "Kyselost nebo zásaditost vody. Hodnota 7 je neutrální, nižší je kyselá a vyšší zásaditá.",
  ec: "Elektrická vodivost přibližuje množství rozpuštěných iontů; jednotka µS/cm. Sama neurčuje čistotu vody.",
  turbidity:
    "Zákal vyjadřuje optické zakalení vody částicemi; jednotka NTU. Výsledek závisí na sondě a kalibraci.",
  orp: "Oxidačně-redukční potenciál v mV popisuje chemické podmínky vody. Hodnotí se podle místa měření a provozu.",
};

export function settingsPage() {
  return (
    header(
      "Nastavení",
      "Parametry monitoringu, hlídání senzorů a připojení stanice.",
    ) +
    /* HTML */ `
      <div class="settings-layout">
        <div class="card">
          <div class="panelhead"><h2>Provozní parametry</h2></div>
          <form id="settingsform" class="formgrid">
            <label>
              Objem nádrže (litry)
              <input
                name="tankVolume"
                type="number"
                min="1"
                max="1000000"
                required
                value="${settings.tankVolume}"
              />
            </label>
            <label>
              Název ČOV
              <input
                name="name"
                required
                maxlength="60"
                value="${esc(settings.name)}"
              />
            </label>
            <label>
              Minimální teplota (°C)
              <input
                name="tempMin"
                type="number"
                min="-10"
                max="60"
                step=".1"
                required
                value="${settings.tempMin}"
              />
            </label>
            <label>
              Maximální teplota (°C)
              <input
                name="tempMax"
                type="number"
                min="-10"
                max="60"
                step=".1"
                required
                value="${settings.tempMax}"
              />
            </label>
            <label>
              Alarm hladiny (%)
              <input
                name="levelMax"
                type="number"
                min="1"
                max="100"
                required
                value="${settings.levelMax}"
              />
            </label>
            <label>
              Nedostupnost zařízení (minuty)
              <input
                name="stale"
                type="number"
                min="1"
                max="120"
                required
                value="${settings.stale}"
              />
            </label>
            <fieldset class="sensor-monitoring full">
              <legend>Stabilita alarmů</legend>
              <p class="subtitle">
                Překročení meze musí trvat po celou prodlevu. Návratové pásmo
                brání přepínání alarmu kolem hranice. Výpadek čidla se hlásí
                ihned; výpadek stanice používá dobu nedostupnosti výše.
              </p>
              <div class="sensor-rule-bounds">
                <label>
                  Prodleva překročení (sekundy)
                  <input
                    name="alarmDelaySeconds"
                    type="number"
                    min="0"
                    max="3600"
                    required
                    value="${settings.alarmDelaySeconds ?? 60}"
                  />
                </label>
                <label>
                  Návratové pásmo teploty (°C)
                  <input
                    name="tempHysteresis"
                    type="number"
                    min="0"
                    max="20"
                    step="any"
                    required
                    value="${settings.tempHysteresis ?? 0.5}"
                  />
                </label>
                <label>
                  Návratové pásmo hladiny (%)
                  <input
                    name="levelHysteresis"
                    type="number"
                    min="0"
                    max="50"
                    step="any"
                    required
                    value="${settings.levelHysteresis ?? 2}"
                  />
                </label>
              </div>
            </fieldset>
            <fieldset class="sensor-monitoring full">
              <legend>Hlídání jednotlivých senzorů</legend>
              <p>
                <a class="linkbtn" href="#guides/alarms">
                  Jak nastavit a otestovat alarmy →
                </a>
              </p>
              <p class="subtitle">
                Zaškrtněte zapojené sondy. Jejich chybějící nebo null hodnota
                vyvolá alarm. Nezapojené sondy ponechte vypnuté. Volitelné meze
                pro další veličiny určují vaše provozní pásmo, nikoli
                legislativní limity; pokud je neznáte, nechte je prázdné.
              </p>
              ${sensors
                .map((sensor) => {
                  const rule = settings.sensorRules?.[sensor.id] ?? {
                    enabled: sensor.id === "temperature",
                    min: null,
                    max: null,
                  };
                  return `<div class="sensor-rule"><label class="sensor-toggle"><input type="checkbox" name="show_${sensor.id}" ${settings.hiddenSensors?.includes(sensor.id) ? "" : "checked"}>Zobrazovat: ${sensor.name}</label><p>Skrytí neovlivní příjem dat ani nastavené alarmy.</p><label class="sensor-toggle"><input type="checkbox" name="watch_${sensor.id}" ${rule.enabled ? "checked" : ""}>Hlásit výpadek: ${sensor.name}</label><p>${explanations[sensor.id]}</p>${!["temperature", "level"].includes(sensor.id) ? `<div class="sensor-rule-bounds"><label>Minimum (${sensor.unit})<input type="number" step="any" name="min_${sensor.id}" value="${rule.min ?? ""}" placeholder="Nenastaveno"></label><label>Návratové pásmo (${sensor.unit})<input type="number" step="any" min="0" name="hysteresis_${sensor.id}" value="${settings.rangeHysteresis?.[sensor.id] ?? 0}"></label><label>Maximum (${sensor.unit})<input type="number" step="any" name="max_${sensor.id}" value="${rule.max ?? ""}" placeholder="Nenastaveno"></label></div>` : ""}</div>`;
                })
                .join("")}
            </fieldset>
            <fieldset class="sensor-monitoring full">
              <legend>Kalibrace ultrazvukové hladiny</legend>
              <p class="subtitle">
                Vzdálenosti od čela čidla k hladině v centimetrech. Bez obou
                hodnot je hladina neznámá. Změna platí pro nově přijaté vzorky;
                historie zůstává zachovaná. Vymazáním obou polí kalibraci
                vypnete. Dodržte odstup alespoň 21 cm, prakticky raději 25 cm.
              </p>
              ${(serverState?.stations || [{ id: "cov-monitor-01", name: "Hlavní ESP32" }]).map((station) => `<div class="sensor-rule"><h3>${esc(station.name)}</h3><p>Poslední přijatá vzdálenost: ${station.latest?.distance_cm ?? "—"} cm${station.online ? "" : " · stanice nedostupná"}</p><div class="sensor-rule-bounds"><label>Prázdná nádrž (cm)<input type="number" min="21" max="600" step="0.1" name="emptyCm_${esc(station.id)}" value="${settings.levelCalibration?.[station.id]?.emptyCm ?? ""}"></label><label>Plná nádrž (cm)<input type="number" min="21" max="600" step="0.1" name="fullCm_${esc(station.id)}" value="${settings.levelCalibration?.[station.id]?.fullCm ?? ""}"></label></div></div>`).join("")}
            </fieldset>
            <button class="btn primary">Uložit nastavení</button>
          </form>
        </div>
      </div>
      <div class="card">
        <div class="panelhead">
          <h2>Připojení stanice přes HTTP API</h2>
          <span class="pill warning">
            ${healthy() ? "Stanice online" : "Čeká na data"}
          </span>
        </div>
        <div style="padding:22px">
          <p class="subtitle" style="line-height:1.8">
            Stanice odesílá POST ${esc(location.origin)}/api/v1/telemetry s
            Content-Type: application/json. Přidejte jedinečné sample_id. Stačí
            poslat zapojené veličiny; odpojené čidlo má null. Podrobný postup je
            na stránce Návody a dokumentace.
          </p>
          <pre class="code">
${esc(JSON.stringify({ device_id: "cov-monitor-01", sample_id: "boot-001-1", timestamp: new Date().toISOString(), measurements: { temperature: 18.7, level: 64, ph: 7.2, ec: 842, turbidity: 12.4, orp: 185 } }, null, 2))}</pre>
          <button class="btn" data-action="backup">↓ Záloha dat JSON</button>
        </div>
      </div>
    ` +
    accessSettings() +
    updatesPanel() +
    `<div class="card" id="stations-panel"><h2>Pokročilé nastavení</h2><p class="subtitle">Technická konfigurace instalace a rozšíření měření.</p><details class="technical-details"><summary>Připojené stanice a zdroje měření</summary><p class="subtitle">Jedna ČOV může mít více ESP32, například pro vnitřní a venkovní měření. Každé ESP posílá vlastní senzory pod svým ID. Níže určíte, která stanice poskytuje jednotlivé hodnoty pro společný přehled. Rozbory a servisní deník jsou společné.</p><h3>Zdroje hlavního přehledu</h3><div class="formgrid">${[...sensors, { id: "blower", name: "Stav dmychadla" }].map((sensor) => `<label>${sensor.name}<select form="settingsform" name="source_${sensor.id}">${(serverState?.stations || [{ id: "cov-monitor-01", name: "Hlavní ESP32" }]).map((station) => `<option value="${esc(station.id)}" ${(settings.sensorSources?.[sensor.id] || "cov-monitor-01") === station.id ? "selected" : ""}>${esc(station.name)} (${esc(station.id)})</option>`).join("")}</select></label>`).join("")}<button form="settingsform" class="btn primary">Uložit zdroje měření</button></div><div class="station-registry">${(serverState?.stations || []).map((station) => `<form class="formgrid" data-station-rename><input type="hidden" name="stationId" value="${esc(station.id)}"><label>Název ESP stanice<input name="name" value="${esc(station.name)}" required maxlength="60"></label><p><code>${esc(station.id)}</code> · ${station.online ? "Online" : "Čeká na data / nedostupná"}</p><button class="btn">Uložit název</button><button type="button" class="btn" data-pair-station="${esc(station.id)}">Spárovat přes mobil</button><button type="button" class="btn" data-revoke-station="${esc(station.id)}">Zrušit přístup stanice</button>${station.id !== "cov-monitor-01" ? `<button type="button" class="btn danger" data-remove-station="${esc(station.id)}">Odebrat stanici</button>` : ""}</form>`).join("")}</div><h3>Připojit další ESP32</h3><form id="stationform" class="formgrid"><label>Název stanice<input name="name" required maxlength="60" placeholder="Venkovní měření"></label><label>ID stanice<input name="stationId" required maxlength="60" pattern="[a-z0-9][a-z0-9-]{0,59}" placeholder="cov-monitor-02"><small>Malá písmena, číslice a pomlčky. ID musí být jedinečné.</small></label><button class="btn primary">Přidat stanici</button></form></details></div>`
  );
}
