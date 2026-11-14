import {
  fibonacciLevels,
  measureRange,
} from "../../domain/technical-analysis.js";
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
const validCandle = (p) =>
  [p.open, p.high, p.low, p.close].every((v) => finite(v) && v > 0) &&
  p.low <= Math.min(p.open, p.close) &&
  p.high >= Math.max(p.open, p.close);
export function chartGeometry(data, state, indicators, width) {
  const all = data.points;
  if (!Array.isArray(all) || all.length < 2)
    throw Error("At least two chart observations required.");
  let from = 0,
    to = all.length - 1;
  if (state.viewport) {
    const a = all.findIndex((p) => p.time >= state.viewport.from);
    let b = all.findLastIndex((p) => p.time <= state.viewport.to);
    if (a >= 0 && b - a >= 2) {
      from = a;
      to = b;
    }
  }
  const points = all.slice(from, to + 1),
    W = Math.max(280, width),
    H =
      (W < 600 ? 390 : 470) -
      state.indicators.filter((id) => ["rsi", "macd", "volume"].includes(id))
        .length *
        82,
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
  const low = log || minimum < 0 ? min - padding : Math.max(0, min - padding),
    high = max + padding;
  const x = (i) => L + ((i - from) / (to - from)) * (R - L),
    y = (v) => T + ((high - transform(v)) / (high - low)) * (B - T);
  function indexAt(time) {
    let lo = 0,
      hi = all.length - 1;
    while (lo < hi) {
      const m = Math.floor((lo + hi) / 2);
      if (all[m].time < time) lo = m + 1;
      else hi = m;
    }
    if (!lo) return (time - all[0].time) / (all[1].time - all[0].time);
    const a = all[lo - 1],
      b = all[lo];
    return lo - 1 + (time - a.time) / (b.time - a.time || 1);
  }
  const timeX = (time) => x(indexAt(time));
  const anchor = (px, py) => {
    const i = Math.max(
      from,
      Math.min(to, Math.round(from + ((px - L) / (R - L)) * (to - from))),
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
      from,
      Math.min(to, Math.round(from + ((px - L) / (R - L)) * (to - from))),
    );
  return {
    W,
    H,
    log,
    L,
    R,
    T,
    B,
    from,
    to,
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
  return drawings
    .map((d) => {
      const [a, b] = d.anchors,
        ax = g.timeX(a.time),
        ay = g.y(a.price),
        bx = b ? g.timeX(b.time) : ax,
        by = b ? g.y(b.price) : ay,
        color = d.color || "#a4dec0",
        id = esc(d.id),
        hit = `data-drawing="${id}"`,
        stroke = `stroke="${color}" stroke-width="1.6" fill="none" vector-effect="non-scaling-stroke"`,
        selectedClass = d.id === selected ? " is-selected" : "";
      let content = "";
      if (d.type === "trend")
        content = `<path d="M${ax} ${ay}L${bx} ${by}" ${stroke}/><path d="M${ax} ${ay}L${bx} ${by}" class="ta-hit" ${hit}/>`;
      if (d.type === "horizontal")
        content = `<path d="M${g.L} ${ay}H${g.R}" ${stroke} stroke-dasharray="6 5"/><path d="M${g.L} ${ay}H${g.R}" class="ta-hit" ${hit}/><text x="${g.R - 5}" y="${ay - 7}" text-anchor="end" fill="${color}">${chartNumber(a.price)}</text>`;
      if (d.type === "fib")
        content =
          fibonacciLevels(a, b)
            .map(
              (l) =>
                `<path d="M${Math.min(ax, bx)} ${g.y(l.price)}H${g.R}" ${stroke} opacity="${l.ratio === 0.618 ? 0.95 : 0.5}" stroke-dasharray="${l.ratio === 0 || l.ratio === 1 ? "0" : "4 4"}"/><text x="${g.R - 5}" y="${g.y(l.price) - 5}" text-anchor="end" fill="${color}">${(l.ratio * 100).toFixed(1)}% · ${chartNumber(l.price)}</text>`,
            )
            .join("") +
          `<path d="M${ax} ${ay}L${bx} ${by}" class="ta-hit" ${hit}/>`;
      if (d.type === "measure") {
        const m = measureRange(a, b, g.all);
        content = `<rect x="${Math.min(ax, bx)}" y="${Math.min(ay, by)}" width="${Math.max(2, Math.abs(bx - ax))}" height="${Math.max(2, Math.abs(by - ay))}" fill="${color}" fill-opacity=".07" stroke="${color}" stroke-dasharray="4 4" ${hit}/><text x="${Math.max(g.L + 4, Math.min((ax + bx) / 2, g.R - 70))}" y="${Math.max(g.T + 16, Math.min(ay, by) - 10)}" fill="${color}">${m.percent >= 0 ? "+" : ""}${m.percent.toFixed(2)}% · ${m.bars} bars</text>`;
      }
      if (d.type === "note")
        content = `<circle cx="${ax}" cy="${ay}" r="4" fill="${color}"/><text x="${Math.max(g.L + 6, Math.min(ax + 10, g.R - 135))}" y="${Math.max(g.T + 16, ay - 8)}" fill="${color}" ${hit}>${esc(d.text || "Note")}</text><circle cx="${ax}" cy="${ay}" r="15" fill="transparent" ${hit}/>`;
      if (d.type !== "note" && d.text)
        content += `<text class="ta-drawing-label" x="${Math.max(g.L + 6, Math.min(ax + 8, g.R - 135))}" y="${Math.max(g.T + 15, Math.min(g.B - 6, ay + 19))}" fill="${color}" ${hit}><title>${esc(d.text)}</title>${esc(d.text)}</text>`;
      if (d.id === selected && !preview)
        content += d.anchors
          .map(
            (p, i) =>
              `<circle cx="${g.timeX(p.time)}" cy="${g.y(p.price)}" r="6" class="ta-anchor" data-drawing="${id}" data-anchor="${i}"/>`,
          )
          .join("");
      return `<g class="ta-drawing${selectedClass}" data-drawing="${id}">${content}</g>`;
    })
    .join("");
}
function renderPane(id, series, g) {
  const h = 82,
    w = g.W,
    l = g.L,
    r = g.R,
    top = 20,
    bottom = 68,
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
    return `<svg viewBox="0 0 ${w} ${h}" class="ta-pane" aria-label="${indicatorLabels[id]} · ${status}"><text x="${l}" y="12" class="ta-pane-label">${indicatorLabels[id]}</text><text x="${(l + r) / 2}" y="47" text-anchor="middle" class="ta-pane-label">${status}</text></svg>`;
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
    const bw = Math.max(1, ((r - l) / (g.to - g.from + 1)) * 0.65);
    for (let i = g.from; i <= g.to; i++)
      if (finite(series.histogram[i]))
        content += `<rect x="${g.x(i) - bw / 2}" y="${Math.min(y(0), y(series.histogram[i]))}" width="${bw}" height="${Math.max(0.7, Math.abs(y(0) - y(series.histogram[i])))}" fill="${series.histogram[i] >= 0 ? "#72b795" : "#c68e80"}" opacity=".5"/>`;
    content += line(series.line, "#9fbde3") + line(series.signal, "#d5b97a");
  } else {
    const bw = Math.max(1, ((r - l) / (g.to - g.from + 1)) * 0.7);
    for (let i = g.from; i <= g.to; i++)
      if (finite(series[i]))
        content += `<rect x="${g.x(i) - bw / 2}" y="${y(series[i])}" width="${bw}" height="${Math.max(0.5, bottom - y(series[i]))}" fill="${g.all[i].price >= (g.all[i - 1]?.price || g.all[i].price) ? "#72b795" : "#c68e80"}" opacity=".5"/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="ta-pane" aria-label="${indicatorLabels[id]}"><text x="${l}" y="12" class="ta-pane-label">${indicatorLabels[id]}</text><text x="${r + 7}" y="${top + 7}" class="ta-axis">${id === "volume" ? compact(hi) : hi.toFixed(id === "rsi" ? 0 : 2)}</text><text x="${r + 7}" y="${bottom}" class="ta-axis">${id === "volume" ? "0" : lo.toFixed(id === "rsi" ? 0 : 2)}</text>${content}</svg>`;
}
export function renderAnalysisPlot(data, state, indicators, g, selected) {
  const latest = g.points.at(-1),
    up = latest.price >= g.points[0].price,
    color = up ? "#b9edb1" : "#e3a295";
  const grid = Array.from({ length: 5 }, (_, i) => {
    const v = g.axis(i),
      y = g.T + ((g.B - g.T) * i) / 4;
    return `<path d="M${g.L} ${y}H${g.R}" class="ta-grid"/><text x="${g.R + 8}" y="${y + 4}" class="ta-axis">${chartNumber(v)}</text>`;
  }).join("");
  let candles = "",
    hasCandles = false;
  const candleWidth = Math.max(
    1,
    Math.min(12, ((g.R - g.L) / (g.to - g.from + 1)) * 0.65),
  );
  if (state.chartType === "candle")
    for (let i = g.from; i <= g.to; i++) {
      const p = data.points[i];
      if (!validCandle(p)) continue;
      hasCandles = true;
      const c = p.close >= p.open ? "#8bd5ab" : "#df9d90";
      candles += `<path d="M${g.x(i)} ${g.y(p.high)}V${g.y(p.low)}" stroke="${c}"/><rect x="${g.x(i) - candleWidth / 2}" y="${Math.min(g.y(p.open), g.y(p.close))}" width="${candleWidth}" height="${Math.max(1, Math.abs(g.y(p.close) - g.y(p.open)))}" fill="${c}"/>`;
    }
  const closePath = path(
      data.points.map((p) => p.price),
      g,
    ),
    priceLine = `<path class="ta-price-line" d="${closePath}" stroke="${color}" fill="none" stroke-width="1.8" stroke-linejoin="round"/>`;
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
  const date = (t) =>
    new Intl.DateTimeFormat("en-GB", {
      month: "short",
      day: "numeric",
      timeZone: data.timeZone || "UTC",
    }).format(t * 1000);
  const dates = [g.from, Math.floor((g.from + g.to) / 2), g.to]
    .map(
      (i, k) =>
        `<text x="${g.x(i)}" y="${g.H - 7}" text-anchor="${k === 0 ? "start" : k === 2 ? "end" : "middle"}" class="ta-axis">${date(data.points[i].time)}</text>`,
    )
    .join("");
  const gradientId = "ta-fill-" + data.symbol.replace(/[^a-z0-9]/gi, "");
  const svg = `<svg class="ta-canvas" viewBox="0 0 ${g.W} ${g.H}" aria-hidden="true"><defs><clipPath id="${gradientId}-clip"><rect x="${g.L}" y="${g.T}" width="${g.R - g.L}" height="${g.B - g.T}"/></clipPath></defs>${grid}<g clip-path="url(#${gradientId}-clip)">${hasCandles ? candles : priceLine}${overlays}<g class="ta-drawings">${renderDrawings(state.drawings, g, selected)}</g><g class="ta-preview"></g><g class="ta-crosshair" opacity="0"><path class="ta-cross-v" stroke="#9eb3a080" stroke-dasharray="3 4"/><path class="ta-cross-h" stroke="#9eb3a040" stroke-dasharray="3 4"/><circle class="ta-cross-dot" r="3.5" fill="${color}"/></g></g>${dates}</svg>`;
  const panes = state.indicators
    .filter((id) => ["rsi", "macd", "volume"].includes(id))
    .map((id) => renderPane(id, indicators[id], g))
    .join("");
  return { html: svg + panes, candleAvailable: hasCandles };
}
