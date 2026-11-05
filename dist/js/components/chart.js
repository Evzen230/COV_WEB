import {
  history,
  chartStation,
  serverState,
  metric,
  range,
  sensors,
  settings,
  visibleSensors,
  setView,
} from "../core/state.js";
import { esc, filtered, fmt, alarmLimits } from "../core/utils.js";

// Stable scales make small changes comparable across periods and refreshes.
export const scales = {
  temperature: { min: 0, max: 40, step: 10 },
  level: { min: 0, max: 100, step: 25 },
  ph: { min: 0, max: 14, step: 3.5 },
  ec: { min: 0, max: 2000, step: 500 },
  turbidity: { min: 0, max: 100, step: 25 },
  orp: { min: -500, max: 500, step: 250 },
};
export function chartScale(id, rows) {
  const base = scales[id];
  let min = base.min,
    max = base.max;
  // Never hide values beyond the normal display range.
  for (const row of [
    ...rows,
    ...alarmLimits(id).map((limit) => ({ [id]: limit.value })),
  ]) {
    const value = row[id];
    if (value == null) continue;
    if (value < min) min = Math.floor(value / base.step) * base.step;
    if (value > max) max = Math.ceil(value / base.step) * base.step;
  }
  return { min, max, expanded: min !== base.min || max !== base.max };
}
export function nearestSample(rows, time) {
  if (!rows.length) return -1;
  let left = 0,
    right = rows.length - 1;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (rows[middle].time < time) left = middle + 1;
    else right = middle;
  }
  return left > 0 && time - rows[left - 1].time <= rows[left].time - time
    ? left - 1
    : left;
}
const x = (time, rows) =>
  58 +
  ((time - rows[0].time) / Math.max(1, rows.at(-1).time - rows[0].time)) * 550;
const y = (value, scale) =>
  15 + ((scale.max - value) / (scale.max - scale.min)) * 155;

export function chartSegments(
  rows,
  id,
  maxGap = (settings.stale ?? 15) * 60000,
) {
  const segments = [];
  let segment = null;
  for (const row of rows) {
    if (!Number.isFinite(row[id])) {
      segment = null;
      continue;
    }
    if (!segment || row.time - segment.at(-1).time > maxGap) {
      segment = [];
      segments.push(segment);
    }
    segment.push(row);
  }
  return segments;
}

export function sampleAtTime(
  rows,
  time,
  maxGap = (settings.stale ?? 15) * 60000,
) {
  const index = nearestSample(rows, time);
  if (index < 0) return -1;
  const left = rows[index].time <= time ? index : index - 1;
  const right = left + 1;
  if (
    left >= 0 &&
    right < rows.length &&
    time > rows[left].time &&
    time < rows[right].time &&
    rows[right].time - rows[left].time > maxGap
  )
    return -1;
  return index;
}

export function chart() {
  const visible = visibleSensors();
  if (!visible.length)
    return '<div class="card"><h2>Historie měření</h2><p>Všechny senzory jsou skryté. Zobrazení můžete změnit v Nastavení.</p></div>';
  if (!visible.some((sensor) => sensor.id === metric))
    setView({ metric: visible[0].id });
  const sensor = sensors.find((sensor) => sensor.id === metric);
  const rows = filtered(),
    valid = rows.filter((row) => row[metric] != null);
  const scale = chartScale(metric, rows);
  const segments = chartSegments(rows, metric);
  const paths = segments.map((segment) =>
    segment
      .map(
        (row, index) =>
          `${index ? "L" : "M"}${x(row.time, rows).toFixed(2)},${y(row[metric], scale).toFixed(2)}`,
      )
      .join(" "),
  );
  const path = paths.join(" ");
  const labels = Array.from({ length: 5 }, (_, index) => {
    const tick = scale.max - (index * (scale.max - scale.min)) / 4;
    return `<line x1="58" y1="${15 + index * 38.75}" x2="608" y2="${15 + index * 38.75}"/><text x="48" y="${18 + index * 38.75}" text-anchor="end">${fmt(tick)}</text>`;
  }).join("");
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const time = rows.length
      ? rows[0].time + (index / 4) * (rows.at(-1).time - rows[0].time)
      : null;
    return `<text x="${58 + (index / 4) * 550}" y="197" text-anchor="middle">${time == null ? "—" : new Date(time).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</text>`;
  }).join("");
  return /* HTML */ `
    <div class="card">
      <div class="panelhead chart-header">
        <div class="chart-heading">
          <h2>${sensor.name} v čase</h2>
          <p>Průběh měření · ${sensor.unit}</p>
        </div>
        <label class="chart-metric-picker">
          Zobrazit v grafu
          <select id="metric">
            ${visible.map((item) => `<option value="${item.id}" ${metric === item.id ? "selected" : ""}>${item.name} (${item.unit})</option>`).join("")}
          </select>
        </label>
        ${
          (serverState?.stations?.length || 0) > 1
            ? `<details class="chart-sources" ${chartStation ? "open" : ""}><summary>Další měření</summary><label>Zdroj měření          <select id="chart-station" aria-label="Zdroj měření v grafu">
            <option value="">Zdroj hlavního přehledu</option>
            ${(serverState?.stations || []).map((station) => `<option value="${esc(station.id)}" ${chartStation === station.id ? "selected" : ""}>${esc(station.name)}</option>`).join("")}
          </select>
</label></details>`
            : ""
        }
        <div class="segments">
          ${["1 h", "24 h", "7 dní"].map((period) => `<button data-range="${period}" class="${range === period ? "active" : ""}">${period}</button>`).join("")}
        </div>
      </div>
      <div class="chartwrap">
        <div class="legend">
          <span>
            <i></i>
            ${sensor.name}
          </span>
          <span class="alarm-legend">
            ${
              alarmLimits(metric)
                .map(
                  (limit) =>
                    `${limit.label}: ${fmt(limit.value)} ${sensor.unit}`,
                )
                .join(" · ") || "Alarmové meze nejsou nastavené"
            }
          </span>
        </div>
        <div class="chart-scale">
          Rozsah osy:
          <b>${fmt(scale.min)} až ${fmt(scale.max)} ${sensor.unit}</b>
          ${scale.expanded ? " · rozšířen pro hodnoty mimo základní rozsah" : " · pevné měřítko"}
        </div>
        <div class="chart-plot" data-chart-metric="${metric}">
          <svg
            class="chart"
            viewBox="0 0 640 208"
            tabindex="0"
            role="group"
            aria-label="Graf ${sensor.name}. Rozsah ${fmt(scale.min)} až ${fmt(scale.max)} ${sensor.unit}. Najetím nebo šipkami prohlédnete hodnotu a čas měření."
          >
            <defs>
              <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop stop-color="#369780" stop-opacity=".18" />
                <stop offset="1" stop-color="#369780" stop-opacity="0" />
              </linearGradient>
            </defs>
            ${labels}
            ${alarmLimits(metric)
              .map(
                (limit) =>
                  `<g class="chart-limit"><line x1="58" x2="608" y1="${y(limit.value, scale)}" y2="${y(limit.value, scale)}"/><title>${limit.label}: ${fmt(limit.value)} ${sensor.unit}</title></g>`,
              )
              .join("")}
            ${segments.map((segment, index) => (segment.length > 1 ? `<path d="${paths[index]} L${x(segment.at(-1).time, rows)},170 L${x(segment[0].time, rows)},170Z" fill="url(#chart-fill)"/>` : "")).join("")}
            <path
              d="${path}"
              stroke="var(--green)"
              fill="none"
              stroke-width="2.3"
              stroke-linecap="round"
            />
            ${segments
              .filter((segment) => segment.length === 1)
              .map(
                ([row]) =>
                  `<circle cx="${x(row.time, rows)}" cy="${y(row[metric], scale)}" r="4" fill="var(--green)"/>`,
              )
              .join("")}
            ${ticks}
            ${!rows.length ? '<text x="330" y="95" text-anchor="middle">Pro toto období zatím nejsou data</text>' : ""}
            <g class="chart-cursor" visibility="hidden" aria-hidden="true">
              <line y1="15" y2="170" />
              <circle r="4" />
            </g>
          </svg>
          <div class="chart-tooltip" role="status" hidden></div>
        </div>
        <p class="chart-hint">
          Mezery označují chybějící měření nebo výpadek delší než
          ${settings.stale ?? 15} minut. Přerušované červené čáry označují
          alarmové meze. Alarm se vyhodnotí podle nastavené prodlevy a
          návratového pásma. Najeďte na graf pro hodnotu a čas. Na telefonu
          klepněte; klávesnicí použijte šipky.
        </p>
      </div>
      <div class="chartfoot">
        <span>
          Naměřené MIN
          <b>
            ${fmt(valid.length ? Math.min(...valid.map((row) => row[metric])) : null)}
          </b>
          &nbsp; MAX
          <b>
            ${fmt(valid.length ? Math.max(...valid.map((row) => row[metric])) : null)}
          </b>
          ${sensor.unit}
        </span>
        <span>
          ${valid.length} vzorků · dostupná historie
          ${Math.round((Date.now() - (history[0]?.time ?? Date.now())) / 3600000)}
          h
        </span>
      </div>
    </div>
  `;
}

let selection = null;
let chartEvents = null;
function showSample(plot, index) {
  const rows = filtered(),
    row = rows[index];
  if (!row) return;
  const sensor = sensors.find((sensor) => sensor.id === metric),
    scale = chartScale(metric, rows);
  const svg = plot.querySelector("svg"),
    cursor = plot.querySelector(".chart-cursor");
  const positionX = x(row.time, rows),
    positionY = row[metric] == null ? 90 : y(row[metric], scale);
  cursor.setAttribute("visibility", "visible");
  cursor.querySelector("line").setAttribute("x1", positionX);
  cursor.querySelector("line").setAttribute("x2", positionX);
  const dot = cursor.querySelector("circle");
  dot.setAttribute("cx", positionX);
  dot.setAttribute("cy", positionY);
  dot.setAttribute("visibility", row[metric] == null ? "hidden" : "visible");
  const tooltip = plot.querySelector(".chart-tooltip");
  const time = new Date(row.time).toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  tooltip.innerHTML = `<small>${esc(time)}</small><b>${row[metric] == null ? "Bez měření" : esc(Number(row[metric]).toLocaleString("cs-CZ", { maximumFractionDigits: 10 })) + " " + sensor.unit}</b><span>${sensor.name}</span>`;
  tooltip.hidden = false;
  const point = new DOMPoint(positionX, positionY).matrixTransform(
    svg.getScreenCTM(),
  );
  const bounds = plot.getBoundingClientRect();
  const left = Math.max(
    0,
    Math.min(bounds.width - tooltip.offsetWidth, point.x - bounds.left + 12),
  );
  tooltip.style.left = left + "px";
  tooltip.style.top =
    Math.max(
      0,
      Math.min(
        bounds.height - tooltip.offsetHeight,
        point.y - bounds.top - tooltip.offsetHeight - 10,
      ),
    ) + "px";
  selection = { metric, time: row.time };
}
function hideSample(plot) {
  plot.querySelector(".chart-cursor").setAttribute("visibility", "hidden");
  plot.querySelector(".chart-tooltip").hidden = true;
  selection = null;
}
export function mountChart() {
  chartEvents?.abort();
  chartEvents = new AbortController();
  const options = { signal: chartEvents.signal };
  const plot = document.querySelector(".chart-plot");
  if (!plot) {
    selection = null;
    return;
  }
  const svg = plot.querySelector("svg");
  const pointAt = (event) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    const rows = filtered();
    if (
      !rows.length ||
      point.x < 58 ||
      point.x > 608 ||
      point.y < 15 ||
      point.y > 170
    ) {
      hideSample(plot);
      return;
    }
    const time =
      rows[0].time + ((point.x - 58) / 550) * (rows.at(-1).time - rows[0].time);
    const index = sampleAtTime(rows, time);
    if (index < 0) hideSample(plot);
    else showSample(plot, index);
  };
  svg.addEventListener("pointermove", pointAt, options);
  svg.addEventListener("pointerdown", pointAt, options);
  svg.addEventListener(
    "pointerleave",
    (event) => {
      // Touch pointers leave immediately after a tap; keep the selected value visible.
      if (event.pointerType !== "touch") hideSample(plot);
    },
    options,
  );
  svg.addEventListener("blur", () => hideSample(plot), options);
  svg.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        hideSample(plot);
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const rows = filtered();
      if (!rows.length) return;
      let index =
        selection?.metric === metric ? nearestSample(rows, selection.time) : -1;
      index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : index < 0
              ? 0
              : Math.max(
                  0,
                  Math.min(
                    rows.length - 1,
                    index + (event.key === "ArrowRight" ? 1 : -1),
                  ),
                );
      showSample(plot, index);
    },
    options,
  );
  if (selection?.metric === metric)
    showSample(plot, nearestSample(filtered(), selection.time));
  else selection = null;
}
