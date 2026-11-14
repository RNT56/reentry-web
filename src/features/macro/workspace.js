import { loadingSurface, revealChart } from "../../shared/motion.js";
import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
const number = (n) =>
  Number(n).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
function line(points, width = 800, height = 250) {
  if (!points.length) return "";
  const low = Math.min(...points.map((p) => p.value)),
    high = Math.max(...points.map((p) => p.value)),
    range = high - low || 1;
  return points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${((i / (points.length - 1 || 1)) * width).toFixed(2)},${(height - 16 - ((p.value - low) / range) * (height - 32)).toFixed(2)}`,
    )
    .join(" ");
}
export function macroView() {
  return '<section id="macro-workspace" class="macro-workspace"></section>';
}
export function mountMacro(root) {
  let alive = true,
    data,
    selected = "CPIAUCSL",
    filter = "All",
    shownSeries = null;
  root.innerHTML = loadingSurface("macro");
  root.setAttribute("aria-busy", "true");
  function render() {
    const previousStage =
      selected === shownSeries ? root.querySelector(".macro-stage") : null;
    const active = data.indicators.find((i) => i.id === selected),
      points = active.points,
      low = points.length ? Math.min(...points.map((p) => p.value)) : 0,
      high = points.length ? Math.max(...points.map((p) => p.value)) : 0;
    root.innerHTML = `<header class="macro-heading"><div><h1>Markets</h1></div><span class="macro-provenance">FRED ↗<br>${new Date(data.fetchedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span></header><nav class="macro-filters" aria-label="Macro categories">${["All", ...new Set(data.indicators.map((i) => i.group))].map((group) => `<button data-filter="${esc(group)}" aria-pressed="${filter === group}">${esc(group)}</button>`).join("")}</nav><div class="macro-board"><div class="macro-stage"><div class="macro-focus"><span class="eyebrow">${esc(active.region)} / ${esc(active.group)}</span><h2>${esc(active.label)}</h2><div class="macro-large"><span data-number>${active.latest ? number(active.latest.value) : "—"}</span><small>${esc(active.unit)}</small></div><div class="macro-date"><a href="${active.source}" target="_blank" rel="noopener noreferrer">${active.id} ↗</a><span>${active.latest?.date || "Unavailable"}${active.status === "stale" ? " · stale" : ""}</span></div></div><div class="macro-chart">${points.length ? `<div class="macro-y-axis" aria-hidden="true"><span>${number(high)}</span><span>${number((low + high) / 2)}</span><span>${number(low)}</span></div>` : ""}${points.length ? `<svg viewBox="0 0 800 250" role="img" aria-label="${esc(active.label)} history"><path d="M0 234H800 M0 125H800 M0 16H800" class="macro-grid"/><path d="${line(points)}" class="macro-path"/></svg><div class="macro-axis"><span>${points[0].date}</span><span>${points.at(-1).date}</span></div>` : '<div class="macro-unavailable">No observations</div>'}</div></div><div class="macro-tape">${data.indicators
      .filter((i) => filter === "All" || i.group === filter)
      .map(
        (i) =>
          `<button class="macro-row" data-series="${i.id}" aria-pressed="${selected === i.id}"><span class="macro-identity"><small>${esc(i.region)}</small><b>${esc(i.label)}</b></span><svg viewBox="0 0 800 250" aria-hidden="true"><path d="${line(i.points)}" class="macro-path"/></svg><span class="macro-reading"><strong>${i.latest ? number(i.latest.value) : "—"}</strong><small>${esc(i.unit)}</small></span><span class="macro-observed">${i.latest?.date || "Unavailable"}${i.status === "stale" ? " · stale" : ""}</span></button>`,
      )
      .join("")}</div></div>`;
    if (previousStage)
      root.querySelector(".macro-stage").replaceWith(previousStage);
    else revealChart(root.querySelector(".macro-chart .macro-path"));
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
          if (window.matchMedia("(max-width: 1099px)").matches)
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
  request("/api/macro")
    .then((result) => {
      if (!alive || !root.isConnected) return;
      data = result;
      render();
    })
    .catch(() => {
      if (alive && root.isConnected) {
        root.setAttribute("aria-busy", "false");
        root.innerHTML =
          '<button class="secondary" data-retry>Retry market data ↻</button>';
        root.querySelector("button").onclick = () => {
          const next = mountMacro(root);
          alive = false;
          return next;
        };
      }
    });
  return {
    destroy() {
      alive = false;
    },
  };
}
