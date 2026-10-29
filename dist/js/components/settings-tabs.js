export function mountSettingsTabs() {
  const form = document.querySelector("#settingsform");
  if (!form) return;
  const layout = form.closest(".settings-layout"),
    card = form.parentElement,
    connection = layout.nextElementSibling,
    access = connection?.nextElementSibling;
  const names = [
    ["general", "Provoz"],
    ["alarms", "Alarmy a senzory"],
    ["connection", "Připojení"],
    ["access", "Přístup a API"],
    ["updates", "Aktualizace"],
  ];
  const nav = document.createElement("div");
  nav.className = "settings-tabs";
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "Sekce nastavení");
  layout.before(nav);
  for (const [id] of names.slice(0, 2)) {
    const panel = document.createElement("div");
    panel.className = "settings-fields full";
    panel.dataset.settingsPanel = id;
    panel.id = "settings-panel-" + id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "settings-tab-" + id);
    form.prepend(panel);
  }
  for (const field of Array.from(form.children)) {
    if (field.tagName === "LABEL")
      form
        .querySelector(
          `[data-settings-panel="${["name", "tankVolume", "stale"].includes(field.querySelector("input")?.name) ? "general" : "alarms"}"]`,
        )
        .append(field);
    if (field.tagName === "FIELDSET")
      form.querySelector('[data-settings-panel="alarms"]').append(field);
  }
  for (const [id, element] of [
    ["connection", connection],
    ["access", access],
    ["updates", document.querySelector("#updates-panel")],
  ])
    if (element) {
      element.dataset.settingsPanel = id;
      element.id = "settings-panel-" + id;
      element.setAttribute("role", "tabpanel");
      element.setAttribute("aria-labelledby", "settings-tab-" + id);
    }
  const choose = (id) => {
    for (const panel of document.querySelectorAll("[data-settings-panel]"))
      panel.hidden = panel.dataset.settingsPanel !== id;
    layout.hidden = !["general", "alarms"].includes(id);
    card.querySelector("h2").textContent =
      id === "alarms" ? "Alarmy a senzory" : "Provozní parametry";
    for (const button of nav.children) {
      const active = button.dataset.settingsTab === id;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      button.classList.toggle("active", active);
    }
    history.replaceState(null, "", "#settings/" + id);
  };
  for (const [id, title] of names) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = title;
    button.dataset.settingsTab = id;
    button.id = "settings-tab-" + id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "settings-panel-" + id);
    button.onclick = () => choose(id);
    nav.append(button);
  }
  nav.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(nav.children),
      index = buttons.indexOf(document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next].click();
    buttons[next].focus();
  });
  const id = location.hash.split("/")[1];
  choose(names.some((item) => item[0] === id) ? id : "general");
}
