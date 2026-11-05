import { api } from "./core/api.js";
import { settings, sensors, labs, setView } from "./core/state.js";
import { csv, download, filtered, toast } from "./core/utils.js";

export function bindEvents({ render, mutate }) {
  document.addEventListener("click", async (e) => {
    let b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.removeStation) {
      if (
        !confirm(
          "Odebrat tuto stanici a zrušit její přístup? Její senzory se přepnou na hlavní stanici. Historie měření zůstane zachovaná.",
        )
      )
        return;
      b.disabled = true;
      try {
        await mutate(async () => {
          await api(
            `/api/stations/${encodeURIComponent(b.dataset.removeStation)}`,
            "DELETE",
          );
          setView({ chartStation: "" });
        }, "Stanice odebrána.");
      } finally {
        b.disabled = false;
      }
      return;
    }
    if (b.dataset.pairStation || b.dataset.revokeStation) {
      b.disabled = true;
      try {
        const id = b.dataset.pairStation || b.dataset.revokeStation;
        if (b.dataset.revokeStation) {
          if (
            confirm(
              "Zrušit vlastní klíč této stanice? Pro opětovné připojení bude nutné párování.",
            )
          ) {
            await api(`/api/stations/${encodeURIComponent(id)}/revoke`, "POST");
            toast("Přístup stanice zrušen.");
          }
        } else
          showPairing(
            await api(
              `/api/stations/${encodeURIComponent(id)}/pairing`,
              "POST",
            ),
          );
      } catch (error) {
        toast(error.message, "error");
      } finally {
        b.disabled = false;
      }
      return;
    }
    if (b.dataset.range) {
      setView({ range: b.dataset.range });
      render();
      return;
    }
    if (b.dataset.ack)
      return mutate(
        () => api(`/api/alarms/${b.dataset.ack}/ack`, "POST"),
        "Přijetí alarmu potvrzeno.",
      );
    for (let kind of ["lab", "service"]) {
      let id = b.getAttribute("data-delete-" + kind);
      if (id) {
        if (confirm("Smazat tento záznam?"))
          return mutate(
            () =>
              api(
                `/api/${kind === "lab" ? "labs" : "service"}/${id}`,
                "DELETE",
              ),
            "Záznam smazán.",
          );
        return;
      }
    }
    switch (b.dataset.action) {
      case "refresh":
        return mutate(() => Promise.resolve(), "Data načtena ze serveru.");
      case "backup":
        try {
          download(
            "cov-zaloha.json",
            JSON.stringify(await api("/api/backup"), null, 2),
            "application/json",
          );
          toast("Záloha serverových dat stažena.");
        } catch (e) {
          toast(e.message, "error");
        }
        break;
      case "export":
        download(
          "cov-mereni.csv",
          csv([
            [
              "Čas ISO",
              "ID stanice",
              ...sensors.map((s) => `${s.name} (${s.unit})`),
            ],
            ...filtered().map((r) => [
              new Date(r.time).toISOString(),
              r.device_id || "cov-monitor-01",
              ...sensors.map((s) => r[s.id]),
            ]),
          ]),
          "text/csv;charset=utf-8",
        );
        break;
      case "exportlabs":
        download(
          "cov-rozbory.csv",
          csv([
            [
              "Datum",
              "Místo",
              "Ukazatel",
              "Hodnota",
              "Jednotka",
              "Protokol",
              "Poznámka",
            ],
            ...labs.map((l) => [
              l.date,
              l.location,
              l.parameter,
              l.value,
              l.unit,
              l.lab,
              l.note,
            ]),
          ]),
          "text/csv;charset=utf-8",
        );
        break;
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "chart-station") {
      setView({ chartStation: e.target.value });
      render();
    }
    if (e.target.id === "metric") {
      setView({ metric: e.target.value });
      render();
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.matches("[data-station-rename]")) {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      return mutate(
        () =>
          api(`/api/stations/${encodeURIComponent(data.stationId)}`, "PUT", {
            name: data.name,
          }),
        "Název ESP stanice uložen.",
      );
    }
    if (
      !["labform", "serviceform", "settingsform", "stationform"].includes(
        e.target.id,
      )
    )
      return;
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target));
    if (e.target.id === "stationform") {
      return mutate(async () => {
        const station = await api("/api/stations", "POST", {
          id: data.stationId,
          name: data.name,
        });
        showPairing(
          await api(
            `/api/stations/${encodeURIComponent(station.id)}/pairing`,
            "POST",
          ),
        );
      }, "ESP stanice přidána. Zdroje měření nastavíte v pokročilém nastavení.");
    }
    if (e.target.id === "settingsform") {
      const form = new FormData(e.target);
      data.levelCalibration = {};
      for (const [key, value] of form.entries()) {
        if (!key.startsWith("emptyCm_")) continue;
        const id = key.slice(8);
        const full = form.get("fullCm_" + id);
        if (value.trim() || full?.trim())
          data.levelCalibration[id] = {
            emptyCm: value.trim() ? Number(value) : null,
            fullCm: full?.trim() ? Number(full) : null,
          };
      }
      data.sensorSources = Object.fromEntries(
        [...sensors.map((sensor) => sensor.id), "blower"].map((key) => [
          key,
          form.get("source_" + key) ||
            settings.sensorSources?.[key] ||
            "cov-monitor-01",
        ]),
      );
      data.rangeHysteresis = Object.fromEntries(
        sensors.map((sensor) => [
          sensor.id,
          form.has("hysteresis_" + sensor.id)
            ? Number(form.get("hysteresis_" + sensor.id))
            : (settings.rangeHysteresis?.[sensor.id] ?? 0),
        ]),
      );
      data.hiddenSensors = sensors
        .filter((sensor) => !form.has("show_" + sensor.id))
        .map((sensor) => sensor.id);
      data.sensorRules = Object.fromEntries(
        sensors.map((sensor) => [
          sensor.id,
          {
            enabled: form.has("watch_" + sensor.id),
            min: form.get("min_" + sensor.id)?.trim()
              ? Number(form.get("min_" + sensor.id))
              : null,
            max: form.get("max_" + sensor.id)?.trim()
              ? Number(form.get("max_" + sensor.id))
              : null,
          },
        ]),
      );
      for (let k of [
        "tempMin",
        "tempMax",
        "levelMax",
        "stale",
        "tankVolume",
        "alarmDelaySeconds",
        "tempHysteresis",
        "levelHysteresis",
      ])
        data[k] = Number(data[k]);
      return mutate(
        () => api("/api/settings", "PUT", data),
        "Nastavení uloženo na serveru.",
      );
    }
    if (e.target.id === "labform") data.value = Number(data.value);
    mutate(
      () =>
        api(
          e.target.id === "labform" ? "/api/labs" : "/api/service",
          "POST",
          data,
        ),
      "Záznam uložen na serveru.",
    );
  });
}

function showPairing(result) {
  document.getElementById("pairing-dialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "pairing-dialog";
  dialog.style.cssText =
    "max-width:480px;width:90%;padding:24px;border-radius:16px";
  dialog.innerHTML =
    '<h2>Připojení ESP32 přes mobil</h2><p>Připojte mobil k Wi-Fi COV-Setup uvedené na štítku stanice. Po připojení otevřete nabídnuté nastavení sítě. Pokud se neukáže, otevřete http://192.168.4.1. Nastavte domácí Wi-Fi, adresu serveru a tento krátký kód.</p><label>Jednorázový párovací kód<input readonly aria-label="Párovací kód" style="width:100%;font-family:monospace"></label><button type="button" class="btn" data-copy-pairing>Zkopírovat kód</button><p role="status"></p><p>Nové spárování nahradí předchozí vlastní klíč této stanice. Stávající měření zůstanou zachovaná.</p><button class="btn">Zavřít</button>';
  dialog.querySelector("input").value =
    result.code.length === 8
      ? result.code.slice(0, 4) + "-" + result.code.slice(4)
      : result.code;
  dialog.querySelector("[data-copy-pairing]").onclick = async () => {
    const input = dialog.querySelector("input");
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext)
        await navigator.clipboard.writeText(input.value);
      else {
        input.focus();
        input.select();
        if (!document.execCommand("copy")) throw Error("copy");
      }
      dialog.querySelector("[data-copy-pairing]").textContent = "Zkopírováno";
    } catch {
      input.focus();
      input.select();
      dialog.querySelector("[data-copy-pairing]").textContent =
        "Kód je označený – zkopírujte jej";
    }
  };
  dialog.querySelector("input").onclick = (e) => e.target.select();
  dialog.querySelector('[role="status"]').textContent =
    "Platí do " +
    new Date(result.expires).toLocaleTimeString("cs-CZ") +
    ". Adresa tohoto serveru: " +
    location.origin;
  dialog.querySelector("button:last-child").onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
