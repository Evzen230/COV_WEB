import { api } from "../core/api.js";
import { esc } from "../core/utils.js";

export function createUpdateTracker({
  now = Date.now,
  read,
  changed = () => {},
  initial = null,
} = {}) {
  let operation = initial;
  let generation = 0;
  const active = () =>
    Boolean(
      operation &&
      !["success", "error", "unknown", "auth"].includes(operation.phase),
    );
  const set = (phase, message) => {
    if (operation?.phase === phase && operation?.message === message)
      return operation;
    operation = { ...operation, phase, message };
    changed(operation);
    return operation;
  };
  return {
    current: () => operation,
    active,
    start(details) {
      generation++;
      operation = {
        ...details,
        started: now(),
        phase: "preparing",
        message: details.message || "Připravuji požadavek…",
      };
      changed(operation);
    },
    queued(result = {}) {
      if (!active()) return operation;
      operation = {
        ...operation,
        id: result.operationId || null,
        expectedVersion: result.version || operation.expectedVersion,
      };
      return set(
        "queued",
        operation.component === "server"
          ? "Balíček je připravený. Čekám na instalační službu…"
          : "Firmware je připravený. Čekám, až si jej ESP32 stáhne a restartuje se…",
      );
    },
    finish(message) {
      return set("success", message);
    },
    fail(message) {
      return set("error", message);
    },
    reconnect() {
      if (!active()) return operation;
      return set(
        "reconnecting",
        "Server se restartuje nebo je dočasně nedostupný. Automaticky obnovuji spojení…",
      );
    },
    resume() {
      if (operation?.phase === "auth")
        return set(
          "reconnecting",
          "Přihlášení obnoveno. Ověřuji výsledek aktualizace…",
        );
    },
    clear() {
      generation++;
      operation = null;
      changed(null);
    },
    async poll() {
      if (!active() || !operation.monitor) return operation;
      const token = generation;
      if (
        now() - operation.started >
        (operation.component === "server" ? 300000 : 600000)
      )
        return set(
          "unknown",
          "Výsledek se zatím nepodařilo potvrdit. Zkontrolujte připojení a stav instalace; neúspěch nebyl potvrzen.",
        );
      try {
        const status = await read(operation.deviceId);
        if (!active() || generation !== token) return operation;
        if (operation.component === "firmware") {
          if (
            status.station?.version === operation.expectedVersion &&
            status.station.seen !== operation.initialSeen
          )
            return set(
              "success",
              `Stanice se připojila s firmwarem ${operation.expectedVersion}.`,
            );
          if (operation.phase !== "preparing")
            return set(
              "waiting-device",
              "Čekám na ESP32. Po stažení firmware a restartu ověřím hlášenou verzi…",
            );
          return operation;
        }
        const job = status.job;
        const relevant =
          job &&
          (operation.id
            ? job.operationId === operation.id ||
              (!job.operationId && job.time !== operation.initialJobTime)
            : job.time !== operation.initialJobTime);
        if (relevant) {
          if (
            job.state === "failed" ||
            /(?:selhala|Obnovena předchozí verze)/.test(job.message || "")
          )
            return set("error", job.message);
          const completed =
            job.state === "succeeded" ||
            /(?:Aktualizace dokončena|Obnova dokončena)/.test(
              job.message || "",
            );
          if (completed && status.current === operation.expectedVersion)
            return set(
              "success",
              `Server nyní běží ve verzi ${status.current}.`,
            );
          if (completed && !status.pending)
            return set(
              "error",
              `Instalace skončila, ale server hlásí verzi ${status.current} místo ${operation.expectedVersion}. ${job.message || ""}`,
            );
          if (job.state === "running" || !completed)
            return set(
              job.phase || "installing",
              job.message || "Probíhá instalace a kontrola serveru…",
            );
        }
        if (
          status.current === operation.expectedVersion &&
          status.current !== operation.initialVersion &&
          !status.pending
        )
          return set("success", `Server nyní běží ve verzi ${status.current}.`);
        if (operation.phase !== "preparing")
          return set(
            "queued",
            "Čekám na instalaci serveru. Stav kontroluji každé dvě sekundy…",
          );
      } catch (error) {
        if (!active() || generation !== token) return operation;
        if (error.status === 401)
          return set(
            "auth",
            "Server je dostupný, ale vyžaduje nové přihlášení. Po přihlášení ověřím výsledek.",
          );
        if (error.status && ![502, 503, 504].includes(error.status))
          return set(
            "error",
            error.message || "Stav aktualizace se nepodařilo načíst.",
          );
        return set(
          "reconnecting",
          "Server se restartuje nebo je dočasně nedostupný. Automaticky obnovuji spojení…",
        );
      }
      return operation;
    },
  };
}

const storageKey = "cov-update-progress";
let saved = null;
if (typeof window !== "undefined")
  try {
    saved = JSON.parse(sessionStorage.getItem(storageKey));
  } catch {}
if (
  saved &&
  (!Number.isFinite(saved.started) ||
    !["server", "firmware"].includes(saved.component) ||
    !saved.monitor ||
    Date.now() - saved.started > 600000)
)
  saved = null;
let timer;
let polling = false;
let previousPhase;
export const updateTracker = createUpdateTracker({
  initial: saved,
  read: (deviceId) =>
    api(
      "/api/updates?device_id=" + encodeURIComponent(deviceId),
      "GET",
      undefined,
      { signal: AbortSignal.timeout(5000) },
    ),
  changed(operation) {
    if (typeof window === "undefined") return;
    try {
      if (operation)
        sessionStorage.setItem(storageKey, JSON.stringify(operation));
      else sessionStorage.removeItem(storageKey);
    } catch {}
    mountUpdateProgress();
    if (
      (!operation ||
        ["success", "error", "unknown"].includes(operation.phase)) &&
      previousPhase !== operation?.phase &&
      (operation?.monitor || !operation)
    )
      window.dispatchEvent(new Event("cov-update-finished"));
    if (
      operation?.phase === "success" &&
      previousPhase !== "success" &&
      operation.component === "server" &&
      operation.monitor
    ) {
      window.setTimeout(() => window.location.reload(), 1500);
    }
    previousPhase = operation?.phase;
    if (updateTracker.active() && operation?.monitor) schedulePoll();
  },
});
function schedulePoll() {
  if (timer || polling) return;
  timer = setTimeout(async () => {
    timer = null;
    polling = true;
    try {
      await updateTracker.poll();
    } finally {
      polling = false;
      if (updateTracker.active() && updateTracker.current()?.monitor)
        schedulePoll();
    }
  }, 2000);
}
export function mountUpdateProgress() {
  if (typeof document === "undefined") return;
  const main = document.querySelector("#main");
  if (!main) return;
  let banner = document.querySelector("#update-progress");
  const operation = updateTracker.current();
  const picker = document.querySelector("#update-station");
  if (picker) picker.disabled = updateTracker.active();
  if (!operation) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "update-progress";
    main.before(banner);
  }
  banner.className =
    "update-progress " +
    (updateTracker.active() ? "is-running" : operation.phase);
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.setAttribute("aria-busy", String(updateTracker.active()));
  const heading =
    operation.component === "server"
      ? operation.restoring
        ? "Obnova serveru"
        : "Aktualizace serveru"
      : operation.component === "firmware"
        ? operation.restoring
          ? "Obnova ESP32"
          : "Aktualizace ESP32"
        : "Kontrola aktualizací";
  const signature = JSON.stringify([
    heading,
    operation.phase,
    operation.message,
  ]);
  if (banner.dataset.progress !== signature) {
    banner.dataset.progress = signature;
    banner.innerHTML = `${updateTracker.active() ? '<span class="update-spinner" aria-hidden="true"></span>' : ""}<div><strong>${heading}</strong><p>${esc(operation.message)}</p></div>${!updateTracker.active() ? '<button type="button" class="btn" aria-label="Zavřít stav aktualizace">Zavřít</button>' : ""}`;
  }
  if (!updateTracker.active())
    banner.querySelector("button").onclick = () => updateTracker.clear();
  for (const control of document.querySelectorAll(
    "#updates-content button, #updates-content input, #updates-content select",
  )) {
    if (updateTracker.active()) control.disabled = true;
  }
  if (updateTracker.active() && operation.monitor) schedulePoll();
}
