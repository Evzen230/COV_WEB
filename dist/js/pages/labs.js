import { labs } from "../core/state.js";
import { esc, value } from "../core/utils.js";
import { header } from "../components/dashboard.js";

export function labsPage() {
  return (
    header(
      "Laboratorní rozbory",
      "Ruční evidence výsledků pro porovnání s provozními trendy.",
    ) +
    /* HTML */ `
      <div class="card">
        <div class="panelhead">
          <h2>Nový laboratorní záznam</h2>
          <span class="pill">Ruční zadání</span>
        </div>
        <form id="labform" class="formgrid">
          <label>
            Datum odběru
            <input
              name="date"
              type="date"
              required
              value="${new Date().toLocaleDateString("sv-SE")}"
            />
          </label>
          <label>
            Místo odběru
            <select name="location">
              <option>Výpusť ČOV</option>
              <option>Aktivační nádrž</option>
              <option>Mokřad</option>
              <option>Přítok</option>
            </select>
          </label>
          <label>
            Ukazatel
            <select name="parameter">
              <option>BSK5</option>
              <option>CHSK</option>
              <option>Nerozpuštěné látky</option>
              <option>N-NH4</option>
              <option>Celkový fosfor</option>
              <option>pH</option>
            </select>
          </label>
          <label>
            Výsledek
            <input
              type="number"
              step="any"
              name="value"
              min="0"
              required
              placeholder="Např. 12,5"
            />
          </label>
          <label>
            Jednotka
            <select name="unit">
              <option>mg/l</option>
              <option>pH</option>
            </select>
          </label>
          <label>
            Laboratoř / číslo protokolu
            <input name="lab" required placeholder="Identifikace rozboru" />
          </label>
          <label class="full">
            Poznámka
            <textarea name="note" placeholder="Okolnosti odběru…"></textarea>
          </label>
          <button class="btn primary" type="submit">+ Uložit rozbor</button>
        </form>
      </div>
      <div class="card" style="margin-top:22px">
        <div class="panelhead">
          <h2>Evidence rozborů (${labs.length})</h2>
          <button class="linkbtn" data-action="exportlabs">Export CSV ↓</button>
        </div>
        ${
          labs.length
            ? /* HTML */ `
                <div class="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>DATUM / MÍSTO</th>
                        <th>UKAZATEL</th>
                        <th>VÝSLEDEK</th>
                        <th>PROTOKOL / POZNÁMKA</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${labs
                        .map(
                          (l) => /* HTML */ `
                            <tr>
                              <td>
                                ${esc(l.date)}
                                <br />
                                ${esc(l.location)}
                              </td>
                              <td>${esc(l.parameter)}</td>
                              <td class="mono">
                                ${esc(l.value)} ${esc(l.unit)}
                              </td>
                              <td>
                                ${esc(l.lab)}
                                <br />
                                ${esc(l.note)}
                              </td>
                              <td>
                                <button
                                  class="linkbtn"
                                  data-delete-lab="${l.id}"
                                >
                                  Smazat
                                </button>
                              </td>
                            </tr>
                          `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              `
            : '<div class="empty">Zatím žádné rozbory. Přidejte první výsledek z laboratoře.</div>'
        }
      </div>
    `
  );
}
