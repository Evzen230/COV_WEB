import { api } from "../core/api.js";
import { esc } from "../core/utils.js";

export function connectionPanels() {
  return `<div class="card" id="network-panel"><div class="panelhead"><h2>Wi-Fi Raspberry Pi</h2></div><div class="panelbody"><p data-network-status role="status">Načítání připojení…</p><form data-network-form class="formgrid" hidden><div class="full actions"><button type="button" class="btn" data-network-scan>Vyhledat sítě</button></div><label>Dostupné sítě<select data-network-list><option value="">Zadejte síť ručně</option></select></label><label>Název Wi-Fi (SSID)<input name="ssid" required maxlength="32" autocomplete="off"></label><label>Heslo Wi-Fi<input name="password" type="password" required minlength="8" maxlength="64" autocomplete="new-password"></label><label class="sensor-toggle"><input type="checkbox" name="hidden">Skrytá síť</label><p class="full subtitle">Po změně připojení se prohlížeč může odpojit. Připojte mobil ke stejné domácí síti jako malinu. Při neúspěchu se obnoví původní připojení nebo nastavovací Wi-Fi ze štítku; otevřete http://192.168.4.1:8080.</p><button class="btn primary">Připojit k Wi-Fi</button></form><p data-network-message role="status"></p></div></div>
  <div class="card" id="displays-panel"><div class="panelhead"><h2>Domácí displeje</h2></div><div class="panelbody"><p class="subtitle">Samostatné displeje zobrazují přehled a alarmy. Připojíte je krátkým jednorázovým kódem. Přístup umožňuje pouze čtení.</p><div data-display-list role="status">Načítání displejů…</div><form data-display-form class="formgrid"><label>Název displeje<input name="name" required maxlength="60" placeholder="Displej v kuchyni"></label><button class="btn primary">Spárovat nový displej</button></form><div data-display-pairing hidden></div><p data-display-message role="status"></p></div></div>`;
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
  let revision = 0,
    displayedCatalog = "";
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
  const showPairing = (result) => {
    const panel = displays.querySelector("[data-display-pairing]");
    panel.hidden = false;
    panel.dataset.displayId = result.device_id;
    panel.innerHTML = displayPairingCard(result);
  };
  const loadDisplays = async () => {
    const current = ++revision;
    try {
      const items = await api("/api/displays");
      if (!displays.isConnected || current !== revision) return;
      const signature = JSON.stringify(items);
      if (signature === displayedCatalog) return;
      displayedCatalog = signature;
      displays.querySelector("[data-display-list]").innerHTML = items.length
        ? items
            .map(
              (d) =>
                `<div class="connection-row"><span>${esc(d.name)}<small>${d.paired ? "Spárovaný displej" : "Čeká na spárování"}</small></span><button type="button" class="btn" data-pair-display="${esc(d.id)}">Nový párovací kód</button><button type="button" class="btn danger" data-revoke-display="${esc(d.id)}">Zrušit přístup</button></div>`,
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
      const result = await api("/api/displays/pairing", "POST", {
        name: e.currentTarget.elements.name.value,
      });
      showPairing(result);
      notify(
        displayMessage,
        "Zadejte kód do nastavovací stránky displeje. Platí 10 minut.",
      );
      await loadDisplays();
    } catch (e) {
      notify(displayMessage, e.message, true);
    } finally {
      button.disabled = false;
    }
  };
  displays.addEventListener("click", async (e) => {
    const hide = e.target.closest("[data-display-hide]");
    if (hide) {
      const panel = displays.querySelector("[data-display-pairing]");
      panel.innerHTML = "";
      panel.hidden = true;
      return;
    }
    const copy = e.target.closest("[data-display-copy]");
    if (copy) {
      const input = displays.querySelector("[data-display-code]");
      try {
        await navigator.clipboard.writeText(input.value);
        notify(displayMessage, "Kód zkopírován.");
      } catch {
        input.select();
        notify(displayMessage, "Kód je označený; zkopírujte jej.");
      }
      return;
    }
    const button = e.target.closest(
      "[data-revoke-display], [data-pair-display]",
    );
    if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.pairDisplay) {
        showPairing(
          await api(
            `/api/displays/${button.dataset.pairDisplay}/pairing`,
            "POST",
          ),
        );
        notify(
          displayMessage,
          "Nový kód platí 10 minut. Předchozí kód už neplatí.",
        );
        return;
      }
      await api(`/api/displays/${button.dataset.revokeDisplay}`, "DELETE");
      const panel = displays.querySelector("[data-display-pairing]");
      if (panel.dataset.displayId === button.dataset.revokeDisplay) {
        panel.hidden = true;
        panel.innerHTML = "";
      }
      notify(displayMessage, "Přístup displeje zrušen.");
      await loadDisplays();
    } catch (err) {
      notify(displayMessage, err.message, true);
    } finally {
      button.disabled = false;
    }
  });
  await Promise.allSettled([status(), loadDisplays()]);
  const poll = async () => {
    if (!network.isConnected) return;
    await Promise.allSettled([status(), loadDisplays()]);
    if (network.isConnected) setTimeout(poll, 5000);
  };
  if (network.isConnected) setTimeout(poll, 5000);
}

export function displayPairingCard(result) {
  const code = result.code.replace(/^(.{4})(.{4})$/, "$1-$2");
  return `<p>Vložte tento kód do nastavení displeje. Platí 10 minut, do ${esc(new Date(result.expires).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }))}.</p><label>Párovací kód displeje<input data-display-code readonly value="${esc(code)}" autocomplete="off"></label><div class="actions"><button type="button" class="btn" data-display-copy>Kopírovat kód</button><button type="button" class="btn" data-display-hide>Skrýt kód</button></div><p class="subtitle">Po úspěšném párování si displej uloží přístup automaticky. Nové párování nahradí jeho předchozí přístup.</p>`;
}
