import { chartTimeLabel } from "./chart-time.js";
import { sampleChartPoints } from "../../domain/chart-sampling.js";
import { validCandle, renderCandles } from "./candles.js";
import { renderChartInk, newChartInkId } from "../../shared/chart-ink.js";
import {
  fibonacciLevels,
  measureRange,
} from "../../domain/technical-analysis.js";
import {
  observationIndex,
  restoreChartWindow,
} from "../../domain/chart-viewport.js";
import { esc } from "../../shared/format.js";
export const indicatorLabels = {
  sma20: "SMA 20",
  sma50: "SMA 50",
  sma200: "SMA 200",
  ema20: "EMA 20",
  bollinger: "Bollinger 20",
  rsi: "RSI 14",
  macd: "MACD 12·26·9",
  volume: "Volume",
};
export const toolLabels = {
  inspect: "Inspect",
  trend: "Trend line",
  horizontal: "Price level",
  fib: "Fibonacci",
  measure: "Measure",
  note: "Note",
};
export const palette = {
  sma20: "#d5b97a",
  sma50: "#8ab9d9",
  sma200: "#c5a1e3",
  ema20: "#82c9ad",
  bollinger: "#8596c4",
};
const normalNumber = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const smallNumber = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 6,
  minimumFractionDigits: 2,
});
export const chartNumber = (value) =>
  (Math.abs(value) < 0.1 ? smallNumber : normalNumber).format(value);
const compact = (value) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
const finite = (v) => Number.isFinite(v);
export function chartGeometry(data, state, indicators, width, totalHeight) {
  const all = data.points;
  if (!Array.isArray(all) || all.length < 2)
    throw Error("At least two chart observations required.");
  const window = restoreChartWindow(all, state.viewport);
  const start = window.from,
    end = window.to;
  // Include adjacent observations so line segments meet the plot clip cleanly.
  const from = Math.max(0, Math.floor(start)),
    to = Math.min(all.length - 1, Math.ceil(end));
  const visibleFrom = Math.max(0, Math.ceil(start - 1e-8)),
    visibleTo = Math.min(all.length - 1, Math.floor(end + 1e-8));
  const points = all.slice(from, to + 1),
    W = Math.max(280, width),
    paneCount = state.indicators.filter((id) =>
      ["rsi", "macd", "volume"].includes(id),
    ).length,
    fitted = Number.isFinite(totalHeight) && totalHeight > 0,
    allocation = fitted
      ? Math.max(64 + 24 * paneCount, Math.round(totalHeight))
      : W < 600
        ? 390
        : 470,
    paneHeight =
      fitted && paneCount
        ? Math.max(
            24,
            Math.min(82, Math.floor((allocation * 0.36) / paneCount)),
          )
        : 82,
    H = allocation - paneCount * paneHeight,
    L = 10,
    R = W - (W < 600 ? 64 : 76),
    T = 16,
    B = H - 32;
  const values = points.flatMap((p) =>
    state.chartType === "candle" && validCandle(p)
      ? [p.low, p.high]
      : [p.price],
  );
  for (const id of state.indicators) {
    const series =
      id === "bollinger"
        ? [indicators.bollinger.upper, indicators.bollinger.lower]
        : palette[id]
          ? [indicators[id]]
          : [];
    for (const a of series)
      values.push(...a.slice(from, to + 1).filter((v) => finite(v)));
  }
  for (const d of state.drawings)
    if (
      d.type === "horizontal" ||
      d.anchors.some(
        (a) => a.time >= points[0].time && a.time <= points.at(-1).time,
      )
    )
      values.push(...d.anchors.map((a) => a.price));
  const log = state.scale === "log",
    transform = (v) => (log ? Math.log(v) : v),
    untransform = (v) => (log ? Math.exp(v) : v);
  const supportedValues = values.filter((v) => finite(v) && (!log || v > 0));
  const minimum = Math.min(...supportedValues),
    maximum = Math.max(...supportedValues);
  const min = transform(minimum),
    max = transform(maximum),
    padding = Math.max((max - min) * 0.09, log ? 0.005 : maximum * 0.001);
  const low = state.priceRange
      ? transform(state.priceRange.min)
      : log || minimum < 0
        ? min - padding
        : Math.max(0, min - padding),
    high = state.priceRange ? transform(state.priceRange.max) : max + padding;
  const x = (i) => L + ((i - start) / (end - start)) * (R - L),
    y = (v) => T + ((high - transform(v)) / (high - low)) * (B - T);
  const timeX = (time) => x(observationIndex(all, time));
  const anchor = (px, py) => {
    const i = Math.max(
      visibleFrom,
      Math.min(
        visibleTo,
        Math.round(start + ((px - L) / (R - L)) * (end - start)),
      ),
    );
    return {
      time: all[i].time,
      price: Math.max(
        1e-10,
        untransform(
          high - ((Math.max(T, Math.min(B, py)) - T) / (B - T)) * (high - low),
        ),
      ),
    };
  };
  const at = (px) =>
    Math.max(
      visibleFrom,
      Math.min(
        visibleTo,
        Math.round(start + ((px - L) / (R - L)) * (end - start)),
      ),
    );
  return {
    W,
    H,
    paneHeight,
    totalHeight: allocation,
    log,
    L,
    R,
    T,
    B,
    from,
    to,
    start,
    end,
    visibleFrom,
    visibleTo,
    points,
    all,
    x,
    y,
    timeX,
    at,
    anchor,
    low: untransform(low),
    high: untransform(high),
    axis: (i) => untransform(high - ((high - low) * i) / 4),
  };
}
function path(series, g) {
  let path = "",
    open = false;
  for (let i = g.from; i <= g.to; i++) {
    const v = series[i];
    if (!finite(v) || (g.log && v <= 0)) {
      open = false;
      continue;
    }
    path += (open ? "L" : "M") + g.x(i).toFixed(2) + " " + g.y(v).toFixed(2);
    open = true;
  }
  return path;
}
export function renderDrawings(drawings, g, selected, preview = false) {
  // Keep the selected tool's handles above overlapping tools without mutating saved order.
  const ordered =
    selected && !preview
      ? [
          ...drawings.filter((d) => d.id !== selected),
          ...drawings.filter((d) => d.id === selected),
        ]
      : drawings;
  return ordered
    .map((d) => {
      const [a, b] = d.anchors,
        ax = g.timeX(a.time),
        ay = g.y(a.price),
        bx = b ? g.timeX(b.time) : ax,
        by = b ? g.y(b.price) : ay,
        color = d.color || "#a4dec0",
        id = esc(d.id),
        hit = `data-drawing="${id}"`,
        hitPath = (path) =>
          `<path d="${path}" class="ta-hit" ${hit} vector-effect="non-scaling-stroke"/>`,
        stroke = `stroke="${color}" stroke-width="${d.id === selected && !preview ? "2.2" : "1.6"}" fill="none" vector-effect="non-scaling-stroke"`,
        selectedClass = d.id === selected ? " is-selected" : "";
      let content = "";
      if (d.type === "trend")
        content = `<path d="M${ax} ${ay}L${bx} ${by}" ${stroke}/>${hitPath(`M${ax} ${ay}L${bx} ${by}`)}`;
      if (d.type === "horizontal")
        content = `<path d="M${g.L} ${ay}H${g.R}" ${stroke} stroke-dasharray="6 5"/>${hitPath(`M${g.L} ${ay}H${g.R}`)}<text x="${g.R - 5}" y="${ay - 7}" text-anchor="end" fill="${color}" ${hit}>${chartNumber(a.price)}</text>`;
      if (d.type === "fib")
        content =
          fibonacciLevels(a, b)
            .map(
              (l) =>
                `<path d="M${Math.min(ax, bx)} ${g.y(l.price)}H${g.R}" ${stroke} opacity="${l.ratio === 0.618 ? 0.95 : 0.5}" stroke-dasharray="${l.ratio === 0 || l.ratio === 1 ? "0" : "4 4"}"/>${hitPath(`M${Math.min(ax, bx)} ${g.y(l.price)}H${g.R}`)}<text x="${g.R - 5}" y="${g.y(l.price) - 5}" text-anchor="end" fill="${color}" ${hit}>${(l.ratio * 100).toFixed(1)}% · ${chartNumber(l.price)}</text>`,
            )
            .join("") + `${hitPath(`M${ax} ${ay}L${bx} ${by}`)}`;
      if (d.type === "measure") {
        const m = measureRange(a, b, g.all);
        content = `<rect x="${Math.min(ax, bx)}" y="${Math.min(ay, by)}" width="${Math.max(2, Math.abs(bx - ax))}" height="${Math.max(2, Math.abs(by - ay))}" fill="${color}" fill-opacity=".07" stroke="${color}" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" ${hit}/><text x="${Math.max(g.L + 4, Math.min((ax + bx) / 2, g.R - 70))}" y="${Math.max(g.T + 16, Math.min(ay, by) - 10)}" fill="${color}" ${hit}>${m.percent >= 0 ? "+" : ""}${m.percent.toFixed(2)}% · ${m.bars} bars</text>`;
      }
      if (d.type === "note")
        content = `<circle cx="${ax}" cy="${ay}" r="4" fill="${color}"/><text x="${Math.max(g.L + 6, Math.min(ax + 10, g.R - 135))}" y="${Math.max(g.T + 16, ay - 8)}" fill="${color}" ${hit}>${esc(d.text || "Note")}</text><circle cx="${ax}" cy="${ay}" r="15" fill="transparent" pointer-events="all" ${hit}/>`;
      if (d.type !== "note" && d.text)
        content += `<text class="ta-drawing-label" x="${Math.max(g.L + 6, Math.min(ax + 8, g.R - 135))}" y="${Math.max(g.T + 15, Math.min(g.B - 6, ay + 19))}" fill="${color}" ${hit}><title>${esc(d.text)}</title>${esc(d.text)}</text>`;
      if (d.id === selected && !preview)
        content += d.anchors
          .map(
            (p, i) =>
              `<circle cx="${g.timeX(p.time)}" cy="${g.y(p.price)}" r="12" fill="transparent" pointer-events="all" class="ta-anchor-hit" data-drawing="${id}" data-anchor="${i}"/><circle cx="${g.timeX(p.time)}" cy="${g.y(p.price)}" r="5" class="ta-anchor" pointer-events="none"/>`,
          )
          .join("");
      return `<g class="ta-drawing${selectedClass}" data-drawing="${id}">${content}</g>`;
    })
    .join("");
}
function renderPane(id, series, g) {
  const h = g.paneHeight ?? 82,
    compactPane = h < 62,
    w = g.W,
    l = g.L,
    r = g.R,
    top = compactPane ? Math.min(13, Math.floor(h * 0.32)) : 20,
    bottom = h - (compactPane ? 5 : 14),
    values = (
      id === "macd"
        ? [...series.line, ...series.signal, ...series.histogram]
        : series
    ).slice();
  const relevant =
    id === "macd"
      ? [
          ...series.line.slice(g.from, g.to + 1),
          ...series.signal.slice(g.from, g.to + 1),
          ...series.histogram.slice(g.from, g.to + 1),
        ]
      : values.slice(g.from, g.to + 1);
  if (!relevant.some(finite)) {
    const status =
      id === "volume"
        ? "No volume"
        : id === "rsi"
          ? "Needs 15 bars"
          : "Needs 34 bars";
    return `<svg viewBox="0 0 ${w} ${h}" class="ta-pane ${compactPane ? "is-compact" : ""}" aria-label="${indicatorLabels[id]} · ${status}"><text x="${l}" y="${compactPane ? 9 : 12}" class="ta-pane-label">${indicatorLabels[id]}</text><text x="${(l + r) / 2}" y="${Math.max(15, (top + bottom) / 2)}" text-anchor="middle" class="ta-pane-label">${status}</text></svg>`;
  }
  let lo = id === "rsi" ? 0 : Math.min(0, ...relevant.filter(finite)),
    hi = id === "rsi" ? 100 : Math.max(0, ...relevant.filter(finite));
  if (hi === lo) hi = lo + 1;
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const line = (array, color) => {
    let d = "",
      on = false;
    for (let i = g.from; i <= g.to; i++) {
      if (!finite(array[i])) {
        on = false;
        continue;
      }
      d += (on ? "L" : "M") + g.x(i) + " " + y(array[i]);
      on = true;
    }
    return `<path d="${d}" stroke="${color}" fill="none" stroke-width="1.4"/>`;
  };
  let content = "";
  if (id === "rsi")
    content =
      [30, 70]
        .map(
          (v) =>
            `<path d="M${l} ${y(v)}H${r}" stroke="#70847440" stroke-dasharray="3 5"/>`,
        )
        .join("") + line(series, "#bba6df");
  else if (id === "macd") {
    const bw = Math.max(1, ((r - l) / (g.end - g.start + 1)) * 0.65);
    for (let i = g.from; i <= g.to; i++)
      if (finite(series.histogram[i]))
        content += `<rect x="${g.x(i) - bw / 2}" y="${Math.min(y(0), y(series.histogram[i]))}" width="${bw}" height="${Math.max(0.7, Math.abs(y(0) - y(series.histogram[i])))}" fill="${series.histogram[i] >= 0 ? "#72b795" : "#c68e80"}" opacity=".5"/>`;
    content += line(series.line, "#9fbde3") + line(series.signal, "#d5b97a");
  } else {
    const bw = Math.max(1, ((r - l) / (g.end - g.start + 1)) * 0.7);
    for (let i = g.from; i <= g.to; i++)
      if (finite(series[i]))
        content += `<rect x="${g.x(i) - bw / 2}" y="${y(series[i])}" width="${bw}" height="${Math.max(0.5, bottom - y(series[i]))}" fill="${g.all[i].price >= (g.all[i - 1]?.price || g.all[i].price) ? "#72b795" : "#c68e80"}" opacity=".5"/>`;
  }
  const clipId = newChartInkId("pane");
  return `<svg viewBox="0 0 ${w} ${h}" class="ta-pane ${compactPane ? "is-compact" : ""}" aria-label="${indicatorLabels[id]}"><defs><clipPath id="${clipId}"><rect x="${l}" y="0" width="${r - l}" height="${h}"/></clipPath></defs><text x="${l}" y="${compactPane ? 9 : 12}" class="ta-pane-label">${indicatorLabels[id]}</text>${compactPane ? "" : `<text x="${r + 7}" y="${top + 7}" class="ta-axis">${id === "volume" ? compact(hi) : hi.toFixed(id === "rsi" ? 0 : 2)}</text><text x="${r + 7}" y="${bottom}" class="ta-axis">${id === "volume" ? "0" : lo.toFixed(id === "rsi" ? 0 : 2)}</text>`}<g clip-path="url(#${clipId})">${content}</g></svg>`;
}
export function renderAnalysisPlot(
  data,
  state,
  indicators,
  g,
  selected,
  aiLayer = "",
) {
  const latest = g.points.at(-1),
    up = latest.price >= g.points[0].price,
    color = up ? "#b9edb1" : "#e3a295";
  const grid = Array.from({ length: 5 }, (_, i) => {
    const v = g.axis(i),
      y = g.T + ((g.B - g.T) * i) / 4;
    return `<path d="M${g.L} ${y}H${g.R}" class="ta-grid"/><text x="${g.R + 8}" y="${y + 4}" class="ta-axis">${chartNumber(v)}</text>`;
  }).join("");
  const candleLayer =
    state.chartType === "candle" ? renderCandles(data.points, g) : null;
  const hasCandles = !!candleLayer?.count,
    candles = candleLayer?.html || "";
  const inkId = newChartInkId("research"),
    ink = hasCandles
      ? { defs: "", bodyMarkup: "", endpointMarkup: "" }
      : renderChartInk(
          sampleChartPoints(data.points.slice(g.from, g.to + 1), 1200),
          {
            id: inkId,
            x: (_i, p) => g.timeX(p.time),
            y: g.y,
            baseline: g.B,
            color: up ? "#9bd5aa" : "#dca295",
            highlight: up ? "#dcf1d5" : "#f1c8bb",
            className: "ta-price-line",
          },
        );
  let overlays = "";
  for (const id of state.indicators) {
    if (id === "bollinger") {
      overlays += ["upper", "middle", "lower"]
        .map(
          (key) =>
            `<path d="${path(indicators.bollinger[key], g)}" stroke="${palette.bollinger}" opacity="${key === "middle" ? 0.7 : 0.4}" stroke-dasharray="${key === "middle" ? "4 4" : "0"}" stroke-width="1.1" fill="none"/>`,
        )
        .join("");
    } else if (palette[id])
      overlays += `<path d="${path(indicators[id], g)}" stroke="${palette[id]}" fill="none" stroke-width="1.4"/>`;
  }
  const date = chartTimeLabel(data, g);
  const dates = [
    ...new Set([g.visibleFrom, Math.round((g.start + g.end) / 2), g.visibleTo]),
  ]
    .map(
      (i, k, ticks) =>
        `<text x="${g.x(i)}" y="${g.H - 7}" text-anchor="${k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle"}" class="ta-axis">${date(data.points[i].time)}</text>`,
    )
    .join("");
  const axes = `<rect class="ta-axis-hit" data-ta-axis="price" x="${g.R}" y="${g.T}" width="${g.W - g.R}" height="${g.B - g.T}"><title>Drag to scale price · Double-click to reset</title></rect><rect class="ta-axis-hit" data-ta-axis="time" x="${g.L}" y="${g.B}" width="${g.R - g.L}" height="${g.H - g.B}"><title>Drag to scale time · Double-click to reset</title></rect>`;
  const gradientId = inkId;
  const svg = `<svg class="ta-canvas" viewBox="0 0 ${g.W} ${g.H}" aria-hidden="true"><defs>${hasCandles ? "" : ink.defs}<clipPath id="${gradientId}-clip"><rect x="${g.L}" y="${g.T}" width="${g.R - g.L}" height="${g.B - g.T}"/></clipPath></defs>${grid}<g clip-path="url(#${gradientId}-clip)">${hasCandles ? candles : ink.bodyMarkup}${overlays}<g class="ta-ai-layer">${aiLayer}</g><g class="ta-drawings">${renderDrawings(state.drawings, g, selected)}</g><g class="ta-preview"></g><g class="ta-crosshair" opacity="0" pointer-events="none"><path class="ta-cross-v" stroke="#9eb3a080" stroke-dasharray="3 4"/><path class="ta-cross-h" stroke="#9eb3a040" stroke-dasharray="3 4"/><circle class="ta-cross-dot" r="3.5" fill="${color}"/></g></g>${hasCandles || g.x(g.to) > g.R || g.x(g.to) < g.L || g.y(latest.price) < g.T || g.y(latest.price) > g.B ? "" : `<g class="ta-line-endpoint" pointer-events="none">${ink.endpointMarkup}</g>`}${dates}${axes}</svg>`;
  const panes = state.indicators
    .filter((id) => ["rsi", "macd", "volume"].includes(id))
    .map((id) => renderPane(id, indicators[id], g))
    .join("");
  return { html: svg + panes, candleAvailable: hasCandles };
}
