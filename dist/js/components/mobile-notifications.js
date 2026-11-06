import { api } from "../core/api.js";
import { generateNotificationTopic } from "../core/notification-topic.js";

export function mobileNotificationsPanel() {
  return `<section class="card" id="mobile-notifications-panel">
    <div class="panelhead"><h2>Oznámení do telefonu</h2></div>
    <p>Alarm i návrat do normálu vám přijde přes aplikaci ntfy, i když máte web zavřený. Server i telefon potřebují internet.</p>
    <ol><li>Nainstalujte si aplikaci ntfy pro Android nebo iPhone a povolte oznámení.</li>
    <li>Vygenerujte níže náhodné téma, uložte nastavení a stejné téma přidejte v aplikaci na serveru https://ntfy.sh.</li>
    <li>Odešlete test a ověřte přijetí také se zamčeným telefonem.</li></ol>
    <p>Téma je společné pro tuto ČOV; může ho odebírat více telefonů. Na veřejném ntfy.sh může zprávy číst i odesílat každý, kdo zná téma. Zacházejte s ním jako s heslem. Text alarmů se odesílá službě ntfy.</p>
    <form id="mobile-notifications-form" class="formgrid">
      <label class="full"><span><input type="checkbox" name="enabled"> Zapnout mobilní oznámení</span></label>
      <label class="full">Téma ntfy<input name="topic" maxlength="128" minlength="16" pattern="[a-zA-Z0-9_-]{16,128}" autocomplete="off" spellcheck="false"></label>
      <div class="full"><button type="button" data-generate-topic>Vygenerovat téma</button> <button type="submit">Uložit oznámení</button> <button type="button" data-test-notifications>Odeslat test</button></div>
      <p class="full" role="status" data-notification-status>Načítání…</p>
    </form></section>`;
}

export function mountMobileNotifications() {
  const form = document.querySelector("#mobile-notifications-form");
  if (!form) return;
  const status = form.querySelector("[data-notification-status]");
  const describe = (value) => {
    status.textContent = `${value.enabled ? "Oznámení zapnuta." : "Oznámení vypnuta."} Čekající zprávy: ${value.pending}. ${value.lastSent ? "Poslední předání službě: " + new Date(value.lastSent).toLocaleString("cs-CZ") + "." : "Zatím nic neodesláno."} ${value.error || ""}`;
  };
  const buttons = () => [...form.querySelectorAll("button")];
  let ready = false;
  buttons().forEach((button) => (button.disabled = true));
  api("/api/notifications")
    .then((value) => {
      if (!form.isConnected) return;
      form.elements.enabled.checked = value.enabled;
      form.elements.topic.value = value.topic;
      ready = true;
      buttons().forEach((button) => (button.disabled = false));
      describe(value);
    })
    .catch((error) => (status.textContent = error.message));
  form.querySelector("[data-generate-topic]").onclick = () => {
    try {
      form.elements.topic.value = generateNotificationTopic();
      status.textContent = "Nové téma uložte a přidejte v aplikaci ntfy.";
    } catch {
      status.textContent =
        "Téma se nepodařilo vygenerovat. Zadejte vlastní náhodné téma nebo obnovte stránku.";
    }
  };
  async function run(test) {
    if (!ready) return;
    buttons().forEach((button) => (button.disabled = true));
    try {
      const value = test
        ? await api("/api/notifications/test", "POST", {})
        : await api("/api/notifications", "PUT", {
            enabled: form.elements.enabled.checked,
            topic: form.elements.topic.value.trim(),
          });
      describe(value);
      if (test)
        status.textContent +=
          " Ověřte zprávu v telefonu; předání službě nepotvrzuje doručení do telefonu.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons().forEach((button) => (button.disabled = false));
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    void run(false);
  };
  form.querySelector("[data-test-notifications]").onclick = () =>
    void run(true);
}
