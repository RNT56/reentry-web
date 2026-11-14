import { icon } from "../../shared/ui.js";
import { loadingSurface, revealChart } from "../../shared/motion.js";
import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { mountChartFullscreen } from "../../shared/chart-fullscreen.js";
import {
  chartInkPaths,
  renderChartInk,
  newChartInkId,
} from "../../shared/chart-ink.js";
const number = (n) =>
  Number(n).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
export function macroChartInk(
  points,
  {
    spark = false,
    id = newChartInkId("macro"),
    width = 800,
    height = 250,
  } = {},
) {
  const values = points.map((p) => p.value).filter(Number.isFinite);
  const low = values.length ? Math.min(...values) : 0,
    high = values.length ? Math.max(...values) : 0,
    range = high - low || 1;
  const options = {
    id,
    x: (i) => (i / (points.length - 1 || 1)) * width,
    y: (value) => height - 16 - ((value - low) / range) * (height - 32),
    value: (point) => point.value,
    className: "macro-path",
    baseline: height - 16,
    endpoint: true,
  };
  if (spark) {
    const { linePath } = chartInkPaths(points, options);
    return {
      low,
      high,
      defs: "",
      markup: `<path d="${linePath}" class="macro-spark"/>`,
    };
  }
  return { low, high, ...renderChartInk(points, options) };
}
export function macroView() {
  return '<section id="macro-workspace" class="macro-workspace"></section>';
}
export function mountMacro(root) {
  let alive = true,
    data,
    selected = "CPIAUCSL",
    filter = "All",
    shownSeries = null,
    fullscreen = null;
  const inkId = newChartInkId("macro-focus");
  const resize = new ResizeObserver(() => resizePlot());
  function resizePlot() {
    if (!alive || !root.isConnected) return;
    const svg = root.querySelector(".macro-chart svg");
    const active = data?.indicators.find((item) => item.id === selected);
    if (!svg || !active) return;
    const width = fullscreen?.isActive() ? Math.max(200, svg.clientWidth) : 800,
      height = fullscreen?.isActive() ? Math.max(100, svg.clientHeight) : 250,
      ink = macroChartInk(active.points, { id: inkId, width, height });
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `<defs>${ink.defs}</defs><path d="M0 ${height - 16}H${width} M0 ${height / 2}H${width} M0 16H${width}" class="macro-grid"/>${ink.markup}`;
  }
  root.innerHTML = loadingSurface("macro");
  root.setAttribute("aria-busy", "true");
  function render() {
    const previousStage = root
      .querySelector(".macro-stage-content")
      ?.closest(".macro-stage");
    const active = data.indicators.find((i) => i.id === selected),
      points = active.points,
      ink = macroChartInk(points, { id: inkId }),
      { low, high } = ink;
    if (!previousStage) {
      root.innerHTML = `<header class="macro-heading"><div><h1>Markets</h1></div><span class="macro-provenance">FRED ${icon("arrow")}<br>${new Date(data.fetchedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span></header><nav class="macro-filters" aria-label="Macro categories">${["All", ...new Set(data.indicators.map((i) => i.group))].map((group) => `<button data-filter="${esc(group)}" aria-pressed="${filter === group}">${esc(group)}</button>`).join("")}</nav><div class="macro-board"><div class="macro-stage"><div class="macro-stage-tools"><label class="macro-series-picker"><span class="sr-only">Market indicator</span><select aria-label="Market indicator">${data.indicators.map((item) => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join("")}</select></label></div><div class="macro-stage-content"></div></div><div class="macro-tape"></div></div>`;
      const stage = root.querySelector(".macro-stage");
      fullscreen = mountChartFullscreen(stage, {
        native: true,
        label: () =>
          data.indicators.find((item) => item.id === selected)?.label ||
          "Markets",
        buttonHost: stage.querySelector(".macro-stage-tools"),
        onChange: () => requestAnimationFrame(resizePlot),
      });
      stage.querySelector("select").onchange = (event) => {
        selected = event.target.value;
        render();
      };
    }
    root.querySelector(".macro-tape").innerHTML = `${data.indicators
      .filter((i) => filter === "All" || i.group === filter)
      .map(
        (i) =>
          `<button class="macro-row" data-series="${i.id}" aria-pressed="${selected === i.id}"><span class="macro-identity"><small>${esc(i.region)}</small><b>${esc(i.label)}</b></span><svg viewBox="0 0 800 250" aria-hidden="true">${macroChartInk(i.points, { spark: true }).markup}</svg><span class="macro-reading"><strong>${i.latest ? number(i.latest.value) : "—"}</strong><small>${esc(i.unit)}</small></span><span class="macro-observed">${i.latest?.date || "Unavailable"}${i.status === "stale" ? " · stale" : ""}</span></button>`,
      )
      .join("")}`;
    if (selected !== shownSeries) {
      root.querySelector(".macro-stage-content").innerHTML =
        `<div class="macro-focus"><span class="eyebrow">${esc(active.region)} / ${esc(active.group)}</span><h2>${esc(active.label)}</h2><div class="macro-large"><span data-number>${active.latest ? number(active.latest.value) : "—"}</span><small>${esc(active.unit)}</small></div><div class="macro-date"><a href="${active.source}" target="_blank" rel="noopener noreferrer">${active.id} ${icon("arrow")}</a><span>${active.latest?.date || "Unavailable"}${active.status === "stale" ? " · stale" : ""}</span></div></div><div class="macro-chart">${points.length ? `<div class="macro-y-axis" aria-hidden="true"><span>${number(high)}</span><span>${number((low + high) / 2)}</span><span>${number(low)}</span></div>` : ""}${points.length ? `<svg viewBox="0 0 800 250" role="img" aria-label="${esc(active.label)} history"><defs>${ink.defs}</defs><path d="M0 234H800 M0 125H800 M0 16H800" class="macro-grid"/>${ink.markup}</svg><div class="macro-axis"><span>${points[0].date}</span><span>${points.at(-1).date}</span></div>` : '<div class="macro-unavailable">No observations</div>'}</div>`;
      resize.disconnect();
      const chart = root.querySelector(".macro-chart");
      if (chart) resize.observe(chart);
      resizePlot();
      revealChart(root.querySelector(".macro-chart .macro-path"));
    }
    fullscreen?.refresh();
    root.querySelector(".macro-series-picker select").value = selected;
    shownSeries = selected;
    root.setAttribute("aria-busy", "false");
    root.querySelectorAll("[data-filter]").forEach(
      (button) =>
        (button.onclick = () => {
          const scroll = root.querySelector(".macro-filters").scrollLeft;
          filter = button.dataset.filter;
          render();
          const rail = root.querySelector(".macro-filters");
          rail.scrollLeft = scroll;
          rail
            .querySelectorAll("button")
            .forEach((item) =>
              item.setAttribute(
                "aria-pressed",
                String(item.dataset.filter === filter),
              ),
            );
          [...rail.querySelectorAll("button")]
            .find((item) => item.dataset.filter === filter)
            ?.focus({ preventScroll: true });
        }),
    );
    root.querySelectorAll("[data-series]").forEach(
      (button) =>
        (button.onclick = () => {
          selected = button.dataset.series;
          render();
          root
            .querySelector(`[data-series="${selected}"]`)
            ?.focus({ preventScroll: true });
          if (
            !fullscreen?.isActive() &&
            window.matchMedia("(max-width: 1099px)").matches
          )
            root.querySelector(".macro-stage").scrollIntoView({
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? "instant"
                : "smooth",
              block: "start",
            });
        }),
    );
  }
  function load() {
    root.setAttribute("aria-busy", "true");
    return request("/api/macro")
      .then((result) => {
        if (!alive || !root.isConnected) return;
        data = result;
        render();
      })
      .catch(() => {
        if (alive && root.isConnected) {
          fullscreen?.destroy();
          fullscreen = null;
          resize.disconnect();
          shownSeries = null;
          root.setAttribute("aria-busy", "false");
          root.innerHTML = `<button class="secondary" data-retry>Retry market data ${icon("refresh")}</button>`;
          root.querySelector("button").onclick = () => {
            root.innerHTML = loadingSurface("macro");
            load();
          };
        }
      });
  }
  load();
  return {
    destroy() {
      alive = false;
      fullscreen?.destroy();
      resize.disconnect();
    },
  };
}
