import { esc, stamp } from "../core/utils.js";

// Each occurrence has its own key, so a returning fault is announced again.
export class AlarmInbox {
  dismissed = new Set();
  key(alarm, source) {
    return `${source}:${alarm.id}:${alarm.started}`;
  }
  dismiss(alarm, source) {
    this.dismissed.add(this.key(alarm, source));
  }
  visible(alarms, source) {
    return alarms.filter(
      (alarm) =>
        !alarm.acknowledged && !this.dismissed.has(this.key(alarm, source)),
    );
  }
}

const inbox = new AlarmInbox();
let signature = "";
let acknowledge;
let current = [];
let source = "live";
let bound = false;
let pending = false;

export function updateAlarmNotifications(alarms, mode, onAcknowledge) {
  const container = document.querySelector("#alarm-notifications");
  if (!container) return;
  acknowledge = onAcknowledge;
  current = alarms;
  source = mode;
  if (!bound) {
    bound = true;
    container.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const alarm = current.find((item) => item.id === button.dataset.alarm);
      if (!alarm) return;
      if (button.dataset.notification === "dismiss") {
        inbox.dismiss(alarm, source);
        updateAlarmNotifications(current, source, acknowledge);
      }
      if (button.dataset.notification === "ack" && !pending) {
        pending = true;
        button.disabled = true;
        try {
          await acknowledge(alarm.id);
        } catch (error) {
          container.querySelector(".alarm-notification-error").textContent =
            `Potvrzení se nepodařilo: ${error.message}`;
        } finally {
          pending = false;
          if (button.isConnected) button.disabled = false;
        }
      }
    });
  }
  const visible = inbox.visible(alarms, mode);
  const nextSignature = JSON.stringify([mode, visible]);
  container.hidden = !visible.length;
  if (signature === nextSignature) return;
  signature = nextSignature;
  container.hidden = !visible.length;
  container.innerHTML =
    visible
      .map(
        (alarm) => /* HTML */ `
          <article class="alarm-notification" role="alert">
            <div class="alarm-notification-heading">
              <span class="alarm-notification-icon" aria-hidden="true">!</span>
              <div>
                <small>${"ALARM STANICE"}</small>
                <h2>${esc(alarm.title)}</h2>
              </div>
              <button
                class="alarm-notification-close"
                data-notification="dismiss"
                data-alarm="${esc(alarm.id)}"
                aria-label="Zavřít upozornění: ${esc(alarm.title)}"
                title="Skrýt upozornění; alarm zůstane nepotvrzený"
              >
                ×
              </button>
            </div>
            <p>${esc(alarm.body)}</p>
            <time>Vznik: ${stamp(alarm.started)}</time>
            <div class="alarm-notification-actions">
              <a href="#alarms">Zobrazit alarmy ↗</a>
              <button
                class="btn"
                data-notification="ack"
                data-alarm="${esc(alarm.id)}"
              >
                Potvrdit přijetí
              </button>
            </div>
          </article>
        `,
      )
      .join("") + '<p class="alarm-notification-error" role="status"></p>';
}
