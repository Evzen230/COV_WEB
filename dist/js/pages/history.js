import { sensors } from "../core/state.js";
import { fmt, stamp, filtered } from "../core/utils.js";
import { header, exportButton, chart } from "../components/dashboard.js";

export function historyPage() {
  return (
    header(
      "Historie dat",
      "Průběh naměřených hodnot a export časových řad.",
      exportButton(),
    ) +
    /* HTML */ `
      ${chart()}
      <div class="card" style="margin-top:22px">
        <div class="panelhead">
          <h2>Posledních 30 měření</h2>
          <span class="muted">Prázdná hodnota = nedostupná data</span>
        </div>
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th>ČAS</th>
                ${sensors
                  .map(
                    (s) => /* HTML */ `
                      <th>${s.name} (${s.unit})</th>
                    `,
                  )
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${filtered()
                .slice(-30)
                .reverse()
                .map(
                  (r) => /* HTML */ `
                    <tr>
                      <td>${stamp(r.time)}</td>
                      ${sensors
                        .map(
                          (s) => /* HTML */ `
                            <td class="mono">${fmt(r[s.id])}</td>
                          `,
                        )
                        .join("")}
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `
  );
}
