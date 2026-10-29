import { events, ack } from "../core/state.js";
import { esc, stamp, activeAlarms } from "../core/utils.js";
import { header } from "../components/dashboard.js";

export function alarmsPage() {
  let a = activeAlarms();
  return (
    header(
      "Alarmy a události",
      "Technické stavy, potvrzení alarmů a historie provozu.",
    ) +
    /* HTML */ `
      <div class="card">
        <div class="panelhead">
          <h2>Aktivní alarmy (${a.length})</h2>
          <span class="pill ${a.length ? "warning" : ""}">
            ${a.length ? "Vyžaduje pozornost" : "Provoz v pořádku"}
          </span>
        </div>
        ${
          a.length
            ? a
                .map(
                  (x) => /* HTML */ `
                    <div class="event">
                      <span class="eventicon">!</span>
                      <div style="flex:1">
                        <b>${x.title}</b>
                        <p>${x.body}</p>
                      </div>
                      <button
                        class="btn"
                        data-ack="${x.id}"
                        ${ack[x.id] ? "disabled" : ""}
                      >
                        ${ack[x.id] ? "Potvrzeno" : "Potvrdit přijetí"}
                      </button>
                    </div>
                  `,
                )
                .join("")
            : '<div class="empty">✓ Žádné aktivní technické alarmy.</div>'
        }
      </div>
      <div class="card" style="margin-top:22px">
        <div class="panelhead"><h2>Historie událostí</h2></div>
        ${
          events.length
            ? events
                .slice(0, 50)
                .map(
                  (e) => /* HTML */ `
                    <div class="event">
                      <span class="eventicon">↗</span>
                      <div>
                        <b>${esc(e.title)}</b>
                        <p>${stamp(e.time)}</p>
                      </div>
                    </div>
                  `,
                )
                .join("")
            : '<div class="empty">Události se zobrazí při vzniku, potvrzení nebo ukončení alarmu.</div>'
        }
      </div>
    `
  );
}
