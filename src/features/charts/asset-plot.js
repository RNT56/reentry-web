import { chartGeometry, chartNumber } from "./analysis-render.js";
import { renderChartInk, newChartInkId } from "../../shared/chart-ink.js";
import { esc } from "../../shared/format.js";
import { sampleChartPoints } from "../../domain/chart-sampling.js";

export function renderAssetPlot(
  data,
  state,
  {
    width,
    height,
    references = [],
    hidden = new Set(),
    xLabel,
    yLabel,
    sampleLimit,
    extra,
  } = {},
) {
  const points = data.points;
  if (!points || points.length < 2)
    return {
      geometry: null,
      html:
        '<div class="asset-chart-empty">' +
        (points?.length ? "1 observation" : "No observations") +
        "</div>",
    };
  const series = data.series || [
    { points, color: "#9bd5aa", highlight: "#dcf1d5", primary: true },
  ];
  const visible = references.filter(
    (r) =>
      !hidden.has(r.id) &&
      Number.isFinite(r.price) &&
      (state.scale !== "log" || r.price > 0),
  );
  const values = series
    .flatMap((s) => s.points.map((p) => p.price))
    .concat(visible.map((r) => r.price))
    .filter((v) => Number.isFinite(v) && (state.scale !== "log" || v > 0));
  if (!values.length)
    return {
      geometry: null,
      html: '<div class="asset-chart-empty">No values for this scale</div>',
    };
  const low = Math.min(...values),
    high = Math.max(...values);
  const bounds = [low, high === 0 && low === 0 ? 0.01 : high];
  const geometry = chartGeometry(
    data,
    {
      ...state,
      chartType: "line",
      indicators: [],
      drawings: bounds.map((price) => ({
        type: "horizontal",
        anchors: [{ time: points[0].time, price }],
      })),
    },
    {},
    width,
    height,
  );
  const g = geometry,
    id = newChartInkId("asset"),
    date =
      xLabel ||
      ((time) =>
        new Intl.DateTimeFormat("en-GB", {
          timeZone: data.timeZone || "UTC",
          ...(data.range === "1d"
            ? { hour: "2-digit", minute: "2-digit" }
            : { month: "short", day: "numeric" }),
        }).format(time * 1000));
  const inks = series.map((s, i) =>
    renderChartInk(
      sampleLimit
        ? sampleChartPoints(s.points.slice(g.from, g.to + 1), sampleLimit)
        : s.points,
      {
        id: id + "-" + i,
        x: (_index, p) => g.timeX(p.time),
        y: g.y,
        baseline: s.primary ? g.B : undefined,
        color: s.color || "#9bd5aa",
        highlight: s.highlight || s.color || "#dcf1d5",
        endpoint: false,
        className: "asset-series-line",
      },
    ),
  );
  const grid = Array.from({ length: 5 }, (_, i) => {
    const y = g.T + ((g.B - g.T) * i) / 4;
    return `<path d="M${g.L} ${y}H${g.R}" class="ta-grid"/><text x="${g.R + 8}" y="${y + 4}" class="ta-axis">${esc(yLabel ? yLabel(g.axis(i)) : chartNumber(g.axis(i)))}</text>`;
  }).join("");
  const ticks = [
    ...new Set([
      g.visibleFrom,
      Math.max(
        g.visibleFrom,
        Math.min(g.visibleTo, Math.round((g.start + g.end) / 2)),
      ),
      g.visibleTo,
    ]),
  ];
  const dates = ticks
    .map(
      (i, k) =>
        `<text x="${g.x(i)}" y="${g.H - 8}" text-anchor="${k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle"}" class="ta-axis">${esc(date(points[i].time))}</text>`,
    )
    .join("");
  const refs = visible
    .map(
      (r, i) =>
        `<g pointer-events="none"><path d="M${g.L} ${g.y(r.price)}H${g.R}" stroke="${esc(r.color || "#b9f68b")}" stroke-dasharray="5 5" opacity=".65"/><text x="${i % 2 ? g.R - 6 : g.L + 6}" y="${g.y(r.price) - 7}" text-anchor="${i % 2 ? "end" : "start"}" class="asset-reference-label" fill="${esc(r.color || "#b9f68b")}">${esc(r.label)} ${chartNumber(r.price)}</text></g>`,
    )
    .join("");
  return {
    geometry,
    html: `<svg class="ta-canvas asset-canvas" viewBox="0 0 ${g.W} ${g.H}" aria-hidden="true"><defs>${inks.map((i) => i.defs).join("")}<clipPath id="${id}-clip"><rect x="${g.L}" y="${g.T}" width="${g.R - g.L}" height="${g.B - g.T}"/></clipPath></defs>${grid}<g clip-path="url(#${id}-clip)">${inks.map((ink, i) => `<g opacity="${series[i].primary ? 1 : 0.65}"${series[i].dashed ? ' stroke-dasharray="5 4"' : ""}>${ink.bodyMarkup}</g>`).join("")}${refs}${extra?.(g) || ""}<g class="asset-crosshair" opacity="0" pointer-events="none"><path class="asset-cross-v" stroke="#9eb3a070" stroke-dasharray="3 4"/><path class="asset-cross-h" stroke="#9eb3a040" stroke-dasharray="3 4"/><circle class="asset-cross-dot" r="3" fill="#dcf1d5"/></g></g>${dates}<rect class="ta-axis-hit" data-ta-axis="price" x="${g.R}" y="${g.T}" width="${g.W - g.R}" height="${g.B - g.T}"><title>Drag to scale price · Double-click to reset</title></rect><rect class="ta-axis-hit" data-ta-axis="time" x="${g.L}" y="${g.B}" width="${g.R - g.L}" height="${g.H - g.B}"><title>Drag to scale ${xLabel ? "horizontal axis" : "time"} · Double-click to reset</title></rect></svg>`,
  };
}
