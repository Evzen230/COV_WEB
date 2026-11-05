import { refreshUpdates } from "./components/updates.js";
import { mountSettingsTabs } from "./components/settings-tabs.js";
import {
  mountPasswordControls,
  bindValidation,
} from "./components/form-feedback.js";
import { api } from "./core/api.js";
import { showLogin } from "./core/login.js";
import {
  settings,
  serverState,
  connected,
  applyState,
  setConnected,
} from "./core/state.js";
import { $, esc, activeAlarms, toast, stationStatus } from "./core/utils.js";
import { bindEvents } from "./events.js";
import { mountChart } from "./components/chart.js";
import { patchView } from "./core/patch-view.js";
import { mountAccessSettings } from "./components/access-settings.js";
import { updateAlarmNotifications } from "./components/alarm-notifications.js";
import { overview } from "./pages/overview.js";
import { historyPage } from "./pages/history.js";
import { sensorsPage } from "./pages/sensors.js";
import { alarmsPage } from "./pages/alarms.js";
import { labsPage } from "./pages/labs.js";
import { servicePage } from "./pages/service.js";
import { settingsPage } from "./pages/settings.js";
import { guidesPage } from "./pages/guides.js";


const navigation = [
  ["overview", "◫", "Přehled", overview],
  ["history", "⌁", "Historie dat", historyPage],
  ["sensors", "⊞", "Senzory a zařízení", sensorsPage],
  ["alarms", "♧", "Alarmy", alarmsPage],
  ["labs", "⚗", "Laboratorní rozbory", labsPage],
  ["service", "⌕", "Servisní deník", servicePage],
  ["settings", "⚙", "Nastavení", settingsPage],
  ["guides", "▤", "Návody a dokumentace", guidesPage],
];
let busy = false;
let authenticated = false;
let preferencesLoaded = false;
let rendering = 0;
let navigationKey = "";
let renderedPage = "";
let refreshing = false;
function route() {
  const [page, document] = location.hash.slice(1).split("/");
  return {
    page: navigation.some((item) => item[0] === page) ? page : "overview",
    document,
  };
}

function updateNavigation() {
  const state = stationStatus();
  $(".station").innerHTML =
    `<span class="dot"></span>${esc(settings.name)}<small>${esc(state.text)}</small>${state.detail ? `<small>${esc(state.detail)}</small>` : ""}`;
  $(".station").dataset.kind = state.kind;
  $(".testbadge").textContent = state.text;
  $(".testbadge").dataset.kind = state.kind;
  const { page } = route();
  const nextNavigationKey = `${page}:${activeAlarms().length}`;
  if (nextNavigationKey !== navigationKey) {
    const nav = $("#nav");
    const { scrollTop, scrollLeft } = nav;
    nav.innerHTML = navigation
      .map(
        ([id, icon, title]) => `
    <a href="#${id}" class="${page === id ? "active" : ""}" ${page === id ? 'aria-current="page"' : ""}>
      <span aria-hidden="true">${icon}</span><span class="nav-text" title="${title}">${title}</span>${id === "alarms" && activeAlarms().length ? `<span class="count">${activeAlarms().length}</span>` : ""}
    </a>`,
      )
      .join("");
    nav.scrollTop = scrollTop;
    nav.scrollLeft = scrollLeft;
    navigationKey = nextNavigationKey;
  }
}

async function render() {
  if (!authenticated) return;
  const revision = ++rendering;
  const { page, document: documentId } = route();
  const selected = navigation.find((item) => item[0] === page);
  updateNavigation();
  $("#crumb").textContent = selected[2];
  document.title = selected[2] + " · ČOV Monitor";
  $(".sidebottom b").textContent = "Domácí monitoring";
  $(".sidebottom p").textContent = "Přehled o vaší čistírně.";
  $("footer .muted").textContent = "/ Provoz stanice";
  if (page === "guides")
    $("#main").innerHTML = '<div class="empty">Načítání dokumentace…</div>';
  const content = await selected[3](documentId);
  if (revision !== rendering) return;
  if (page === "overview" && renderedPage === "overview")
    patchView($("#main"), content);
  else $("#main").innerHTML = content;
  renderedPage = page;
  document.documentElement.classList.remove("booting");
  refreshUpdates(page === "settings");
  mountChart();
  mountAccessSettings();
  if (page === "settings") mountSettingsTabs();
  mountPasswordControls();
  if (!connected)
    $("#main").insertAdjacentHTML(
      "afterbegin",
      '<div class="notice" role="alert">Server není dostupný. Zobrazené údaje mohou být zastaralé; změny nelze uložit.</div>',
    );
}

async function refresh(redraw = true) {
  if (refreshing) return;
  refreshing = true;
  try {
    applyState(await api("/api/state"));
    authenticated = true;
    if (!preferencesLoaded) {
      const preference = await api("/api/preferences");
      if (typeof preference.dark === "boolean") {
        try {
          localStorage.setItem("cov-dark", preference.dark);
        } catch {}
        document.body.classList.toggle("dark", preference.dark);
        document.documentElement.classList.toggle("dark", preference.dark);
        document.documentElement.style.colorScheme = preference.dark
          ? "dark"
          : "light";
        bindTheme();
      } else
        await api("/api/preferences", "POST", {
          dark: document.body.classList.contains("dark"),
        });
      preferencesLoaded = true;
    }
    document.body.classList.remove("locked");
    $("#logout").hidden = false;
    refreshUpdates();
    updateNavigation();
    updateAlarmNotifications(activeAlarms(), "live", async (id) => {
      await api(`/api/alarms/${encodeURIComponent(id)}/ack`, "POST");
      await refresh(false);
    });
    if (redraw) await render();
  } catch (error) {
    setConnected(false);
    updateNavigation();
    if (error.status === 401) {
      authenticated = false;
      renderedPage = "";
      showLogin(() => refresh());
      return;
    }
    if (redraw) await render();
    if (!authenticated) {
      $("#main").innerHTML =
        '<div class="empty" role="alert">Monitoring se nepodařilo načíst. <button class="btn" id="retry-load">Zkusit znovu</button></div>';
      $("#retry-load").onclick = () => refresh().catch(() => {});
      document.documentElement.classList.remove("booting");
    }
    throw error;
  } finally {
    refreshing = false;
  }
}

async function mutate(operation, message) {
  if (busy) return;
  busy = true;
  try {
    await operation();
    await refresh();
    if (message) toast(message);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    busy = false;
  }
}

function bindTheme() {
  let dark = document.documentElement.classList.contains("dark");
  try {
    const saved = localStorage.getItem("cov-dark");
    if (saved != null) dark = JSON.parse(saved) === true;
  } catch {}
  document.body.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("dark", dark);
  const update = () => {
    $("#theme").textContent = document.body.classList.contains("dark")
      ? "☀   Světlý režim"
      : "◐   Tmavý režim";
  };
  update();
  $("#theme").onclick = async () => {
    document.body.classList.toggle("dark");
    const dark = document.body.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem(
        "cov-dark",
        document.body.classList.contains("dark"),
      );
    } catch {}
    update();
    if (authenticated) {
      try {
        await api("/api/preferences", "POST", {
          dark: document.body.classList.contains("dark"),
        });
      } catch (error) {
        toast(error.message, "error");
      }
    }
  };
}

bindTheme();
bindValidation();
$("#logout").onclick = async () => {
  try {
    await api("/api/auth/logout", "POST");
    authenticated = false;
    renderedPage = "";
    preferencesLoaded = false;
    document.querySelector("#update-notice")?.remove();
    setConnected(false);
    showLogin(() => refresh());
  } catch (error) {
    toast(error.message, "error");
  }
};
bindEvents({ render, mutate });
window.addEventListener("hashchange", () => {
  render();
});
window.covMonitor = {
  ingest: (message) =>
    mutate(
      () => api("/api/v1/telemetry", "POST", message),
      "Vzorek přijat serverem.",
    ),
};
const clock = () => {
  $("#clock").textContent = new Date().toLocaleString("cs-CZ", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
};
clock();
setInterval(clock, 1000);
$("#main").innerHTML =
  '<div class="empty">Načítání dat z domácího serveru…</div>';
refresh().catch(() => {});
setInterval(() => {
  if (!busy && authenticated)
    refresh(
      ["overview", "history", "sensors", "alarms"].includes(route().page),
    ).catch(() => {});
}, 5000);
