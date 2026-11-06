import { api } from "../core/api.js";
import { esc } from "../core/utils.js";

export function connectionPanels() {
  return `<div class="card" id="network-panel"><div class="panelhead"><h2>Wi-Fi Raspberry Pi</h2></div><div class="panelbody"><p data-network-status role="status">Načítání připojení…</p><form data-network-form class="formgrid" hidden><div class="full actions"><button type="button" class="btn" data-network-scan>Vyhledat sítě</button></div><label>Dostupné sítě<select data-network-list><option value="">Zadejte síť ručně</option></select></label><label>Název Wi-Fi (SSID)<input name="ssid" required maxlength="32" autocomplete="off"></label><label>Heslo Wi-Fi<input name="password" type="password" required minlength="8" maxlength="64" autocomplete="new-password"></label><label class="sensor-toggle"><input type="checkbox" name="hidden">Skrytá síť</label><p class="full subtitle">Po změně připojení se prohlížeč může odpojit. Připojte mobil ke stejné domácí síti jako malinu. Při neúspěchu se obnoví původní připojení nebo nastavovací Wi-Fi ze štítku; otevřete http://192.168.4.1:8080.</p><button class="btn primary">Připojit k Wi-Fi</button></form><p data-network-message role="status"></p></div></div>
  <div class="card" id="displays-panel"><div class="panelhead"><h2>Domácí displeje</h2></div><div class="panelbody"><p class="subtitle">Samostatné displeje zobrazují přehled a alarmy. Jejich klíče umožňují pouze čtení.</p><div data-display-list role="status">Načítání displejů…</div><form data-display-form class="formgrid"><label>Název displeje<input name="name" required maxlength="60" placeholder="Displej v kuchyni"></label><button class="btn primary">Vytvořit klíč displeje</button></form><div data-display-secret hidden><p>Klíč se zobrazí pouze jednou. Zadejte jej do nastavovací stránky displeje.</p><textarea readonly rows="3" aria-label="Klíč displeje"></textarea><button type="button" class="btn" data-display-hide>Skrýt klíč</button></div><p data-display-message role="status"></p></div></div>`;
}

export async function mountConnections() {
  const network = document.querySelector("#network-panel"),
    displays = document.querySelector("#displays-panel");
  if (!network || network.dataset.mounted) return;
  network.dataset.mounted = "true";
  const form = network.querySelector("form"),
    message = network.querySelector("[data-network-message]");
  const notify = (element, text, failed = false) => {
    element.textContent = text;
    element.dataset.kind = failed ? "error" : "info";
  };
  let revision = 0;
  async function status() {
    try {
      const v = await api("/api/network/status");
      if (!network.isConnected) return;
      network.querySelector("[data-network-status]").textContent = !v.available
        ? v.message
        : v.busy
          ? "Probíhá změna připojení…"
          : `${v.wifi ? `Wi-Fi: ${v.ssid}` : v.setup ? "Nastavovací Wi-Fi" : "Wi-Fi nepřipojena"}${v.ethernet ? " · Ethernet připojen" : ""}${v.result === "failed" ? " · Poslední změna selhala, připojení bylo obnoveno." : ""}`;
      form.hidden = !v.available;
      form.querySelector('button:not([type="button"])').disabled = !!v.busy;
    } catch (e) {
      notify(network.querySelector("[data-network-status]"), e.message, true);
    }
  }
  const scan = network.querySelector("[data-network-scan]");
  scan.onclick = async () => {
    scan.disabled = true;
    notify(message, "Vyhledávám sítě…");
    try {
      const v = await api("/api/network/scan"),
        list = network.querySelector("select");
      list.replaceChildren(new Option("Zadejte síť ručně", ""));
      for (const n of v.networks)
        list.add(new Option(`${n.ssid} (${n.signal} %)`, n.ssid));
      notify(
        message,
        v.networks.length
          ? "Vyberte síť nebo zadejte její název ručně."
          : "Žádná síť nebyla nalezena. Název lze zadat ručně.",
      );
    } catch (e) {
      notify(message, e.message, true);
    } finally {
      scan.disabled = false;
    }
  };
  network.querySelector("select").onchange = (e) => {
    form.elements.ssid.value = e.target.value;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const button = form.querySelector('button:not([type="button"])');
    button.disabled = true;
    notify(message, "Odesílám změnu připojení. Prohlížeč se může odpojit…");
    try {
      await api("/api/network/connect", "POST", {
        ssid: form.elements.ssid.value,
        password: form.elements.password.value,
        hidden: form.elements.hidden.checked,
      });
      form.elements.password.value = "";
      notify(
        message,
        "Změna přijata. Připojte mobil k cílové síti. Při neúspěchu se do 90 sekund obnoví původní připojení nebo nastavovací Wi-Fi.",
      );
    } catch (e) {
      notify(message, e.message, true);
    } finally {
      button.disabled = false;
    }
  };
  const displayMessage = displays.querySelector("[data-display-message]");
  const loadDisplays = async () => {
    const current = ++revision;
    try {
      const items = await api("/api/displays");
      if (!displays.isConnected || current !== revision) return;
      displays.querySelector("[data-display-list]").innerHTML = items.length
        ? items
            .map(
              (d) =>
                `<div class="connection-row"><span>${esc(d.name)}</span><button type="button" class="btn danger" data-revoke-display="${esc(d.id)}">Zrušit přístup</button></div>`,
            )
            .join("")
        : '<div class="empty">Zatím není připojen žádný displej.</div>';
    } catch (e) {
      notify(displayMessage, e.message, true);
    }
  };
  displays.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const button = e.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const result = await api("/api/displays", "POST", {
        name: e.currentTarget.elements.name.value,
      });
      const secret = displays.querySelector("[data-display-secret]");
      secret.hidden = false;
      secret.querySelector("textarea").value = result.key;
      notify(displayMessage, "Klíč vytvořen. Uložte jej do displeje.");
      await loadDisplays();
    } catch (e) {
      notify(displayMessage, e.message, true);
    } finally {
      button.disabled = false;
    }
  };
  displays.querySelector("[data-display-hide]").onclick = () => {
    const secret = displays.querySelector("[data-display-secret]");
    secret.querySelector("textarea").value = "";
    secret.hidden = true;
  };
  displays.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-revoke-display]");
    if (!button) return;
    button.disabled = true;
    try {
      await api(`/api/displays/${button.dataset.revokeDisplay}`, "DELETE");
      notify(displayMessage, "Přístup displeje zrušen.");
      await loadDisplays();
    } catch (err) {
      notify(displayMessage, err.message, true);
      button.disabled = false;
    }
  });
  await Promise.allSettled([status(), loadDisplays()]);
  const poll = async () => {
    if (!network.isConnected) return;
    await status();
    if (network.isConnected) setTimeout(poll, 5000);
  };
  if (network.isConnected) setTimeout(poll, 5000);
}
