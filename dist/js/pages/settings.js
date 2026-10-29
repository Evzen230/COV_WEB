import { updatesPanel } from "../components/updates.js";
import { settings, sensors } from "../core/state.js";
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
              Název stanice
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
                  return `<div class="sensor-rule"><label class="sensor-toggle"><input type="checkbox" name="watch_${sensor.id}" ${rule.enabled ? "checked" : ""}>Hlásit výpadek: ${sensor.name}</label><p>${explanations[sensor.id]}</p>${!["temperature", "level"].includes(sensor.id) ? `<div class="sensor-rule-bounds"><label>Minimum (${sensor.unit})<input type="number" step="any" name="min_${sensor.id}" value="${rule.min ?? ""}" placeholder="Nenastaveno"></label><label>Návratové pásmo (${sensor.unit})<input type="number" step="any" min="0" name="hysteresis_${sensor.id}" value="${settings.rangeHysteresis?.[sensor.id] ?? 0}"></label><label>Maximum (${sensor.unit})<input type="number" step="any" name="max_${sensor.id}" value="${rule.max ?? ""}" placeholder="Nenastaveno"></label></div>` : ""}</div>`;
                })
                .join("")}
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
    updatesPanel()
  );
}
