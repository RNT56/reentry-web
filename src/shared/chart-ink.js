import { esc } from "./format.js";
let sequence = 0;
export function newChartInkId(prefix = "chart") {
  return `${
    String(prefix)
      .replace(/[^a-z0-9_-]/gi, "")
      .slice(0, 40) || "chart"
  }-ink-${++sequence}`;
}
const tone = (value, fallback) =>
  typeof value === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)
    ? value
    : fallback;

/** Project every observation exactly. Invalid observations separate the path. */
export function chartInkPaths(
  points,
  { x, y, value = (point) => point?.price, baseline },
) {
  const segments = [];
  let current = [];
  const flush = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (let i = 0; i < points.length; i++) {
    const v = value(points[i], i);
    if (!Number.isFinite(v)) {
      flush();
      continue;
    }
    const px = x(i, points[i]),
      py = y(v, i);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      flush();
      continue;
    }
    current.push({ x: px, y: py, index: i });
  }
  flush();
  const linePath = segments
    .map((segment) =>
      segment
        .map((point, i) => `${i ? "L" : "M"}${point.x} ${point.y}`)
        .join(""),
    )
    .join("");
  const areaPath = Number.isFinite(baseline)
    ? segments
        .filter((segment) => segment.length > 1)
        .map(
          (segment) =>
            segment
              .map((point, i) => `${i ? "L" : "M"}${point.x} ${point.y}`)
              .join("") +
            `L${segment.at(-1).x} ${baseline}L${segment[0].x} ${baseline}Z`,
        )
        .join("")
    : "";
  return {
    linePath,
    areaPath,
    segments,
    endpoint: segments.at(-1)?.at(-1) || null,
  };
}

/** Restrained vector ink. No smoothing, resampling, glow, or pointer hit surface. */
export function renderChartInk(points, options) {
  const { linePath, areaPath, segments, endpoint } = chartInkPaths(
      points,
      options,
    ),
    id = String(options.id || newChartInkId()).replace(/[^a-z0-9_-]/gi, ""),
    color = tone(options.color, "#9bd5aa"),
    highlight = tone(options.highlight, "#dcf1d5"),
    className = esc(options.className || "chart-ink-line"),
    left = segments[0]?.[0]?.x ?? 0,
    right = endpoint?.x ?? left,
    ys = segments.flatMap((segment) => segment.map((point) => point.y)),
    top = ys.length ? Math.min(...ys) : 0,
    bottom = Number.isFinite(options.baseline)
      ? options.baseline
      : Math.max(top + 1, ...ys);
  if (!linePath)
    return {
      id,
      defs: "",
      markup: "",
      bodyMarkup: "",
      endpointMarkup: "",
      linePath,
      areaPath,
    };
  const defs = `<linearGradient id="${id}-stroke" gradientUnits="userSpaceOnUse" x1="${left}" y1="0" x2="${right === left ? right + 1 : right}" y2="0"><stop stop-color="${color}" stop-opacity=".78"/><stop offset=".6" stop-color="${color}"/><stop offset="1" stop-color="${highlight}"/></linearGradient><linearGradient id="${id}-wash" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${bottom === top ? bottom + 1 : bottom}"><stop stop-color="${color}" stop-opacity=".13"/><stop offset=".65" stop-color="${color}" stop-opacity=".035"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
  const marker =
    options.endpoint === false || !endpoint
      ? ""
      : `<circle class="chart-ink-end-ring" cx="${endpoint.x}" cy="${endpoint.y}" r="4.5" fill="${color}" fill-opacity=".08" stroke="${color}" stroke-opacity=".2" stroke-width=".7" vector-effect="non-scaling-stroke"/><circle class="chart-ink-end" cx="${endpoint.x}" cy="${endpoint.y}" r="2" fill="${highlight}"/>`;
  const bodyMarkup = `<g class="chart-ink" pointer-events="none">${areaPath ? `<path class="chart-ink-wash" d="${areaPath}" fill="url(#${id}-wash)"/>` : ""}<path class="chart-ink-understroke" d="${linePath}" stroke="${color}" stroke-opacity=".075" stroke-width="4.2" fill="none" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/><path class="${className} chart-ink-line" d="${linePath}" stroke="url(#${id}-stroke)" stroke-width="1.65" fill="none" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></g>`;
  const markup =
    bodyMarkup +
    (marker
      ? `<g class="chart-ink-endpoint" pointer-events="none">${marker}</g>`
      : "");
  return {
    id,
    defs,
    markup,
    bodyMarkup,
    endpointMarkup: marker,
    linePath,
    areaPath,
  };
}
