import { api } from "./core/api.js";
import { settings, sensors, labs, setView } from "./core/state.js";
import { csv, download, filtered, toast } from "./core/utils.js";

export function bindEvents({ render, mutate }) {
  document.addEventListener("click", async (e) => {
    let b = e.target.closest("button");
    if (!b) return;
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
            ["Čas ISO", ...sensors.map((s) => `${s.name} (${s.unit})`)],
            ...filtered().map((r) => [
              new Date(r.time).toISOString(),
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
    if (e.target.id === "metric") {
      setView({ metric: e.target.value });
      render();
    }
  });
  document.addEventListener("submit", (e) => {
    if (!["labform", "serviceform", "settingsform"].includes(e.target.id))
      return;
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target));
    if (e.target.id === "settingsform") {
      const form = new FormData(e.target);
      data.rangeHysteresis = Object.fromEntries(
        sensors.map((sensor) => [
          sensor.id,
          form.has("hysteresis_" + sensor.id)
            ? Number(form.get("hysteresis_" + sensor.id))
            : (settings.rangeHysteresis?.[sensor.id] ?? 0),
        ]),
      );
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
