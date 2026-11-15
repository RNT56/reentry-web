import { historyRanges } from "./market-history.js";
import { MIN_LOG_PRICE, MAX_AXIS_PRICE } from "./chart-axis.js";

export const MAX_CHART_WORKSPACES = 3;
export const MAX_CHART_DRAWINGS = 40;
export const chartIndicatorIds = Object.freeze([
  "sma20",
  "sma50",
  "sma200",
  "ema20",
  "bollinger",
  "rsi",
  "macd",
  "volume",
]);
export const chartDrawingTypes = Object.freeze([
  "trend",
  "horizontal",
  "fib",
  "note",
  "measure",
]);

const invalid = (message) => Object.assign(Error(message), { statusCode: 400 });
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid("Invalid " + label + ".");
  return value;
}
function text(value, limit, label, empty = false) {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    value.includes("\0") ||
    (!empty && !value.trim())
  )
    throw invalid("Check " + label + ".");
  return value.trim();
}
function timestamp(value) {
  if (!Number.isFinite(value) || value < 0 || value > 4102444800)
    throw invalid("Invalid chart date.");
  return value;
}
function price(value) {
  if (!Number.isFinite(value) || value <= 0 || value > 1e12)
    throw invalid("Invalid chart price.");
  return value;
}

export function defaultChartWorkspaceState(name = "Analysis 1") {
  return {
    name,
    range: "1y",
    currency: "EUR",
    scale: "linear",
    chartType: "line",
    indicators: ["sma20", "sma50"],
    drawings: [],
    viewport: null,
    priceRange: null,
  };
}

/** Return only the supported, bounded chart state; never persist arbitrary UI data. */
export function validateChartWorkspaceState(input) {
  object(input, "chart workspace");
  if (!Object.hasOwn(historyRanges, input.range))
    throw invalid("Choose a chart range.");
  if (!["EUR", "USD"].includes(input.currency))
    throw invalid("Choose EUR or USD.");
  if (!["linear", "log"].includes(input.scale))
    throw invalid("Choose a chart scale.");
  if (!["line", "candle"].includes(input.chartType))
    throw invalid("Choose a chart type.");
  if (
    !Array.isArray(input.indicators) ||
    input.indicators.length > chartIndicatorIds.length ||
    new Set(input.indicators).size !== input.indicators.length ||
    input.indicators.some((id) => !chartIndicatorIds.includes(id))
  )
    throw invalid("Choose supported chart indicators.");
  if (
    !Array.isArray(input.drawings) ||
    input.drawings.length > MAX_CHART_DRAWINGS
  )
    throw invalid(
      "Use up to " + MAX_CHART_DRAWINGS + " drawings per analysis.",
    );
  const ids = new Set();
  const drawings = input.drawings.map((inputDrawing) => {
    const drawing = object(inputDrawing, "drawing");
    if (
      typeof drawing.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(drawing.id) ||
      ids.has(drawing.id)
    )
      throw invalid("Invalid drawing identifier.");
    ids.add(drawing.id);
    if (!chartDrawingTypes.includes(drawing.type))
      throw invalid("Choose a drawing tool.");
    const count = ["horizontal", "note"].includes(drawing.type) ? 1 : 2;
    if (!Array.isArray(drawing.anchors) || drawing.anchors.length !== count)
      throw invalid("Check the drawing anchors.");
    const result = {
      id: drawing.id,
      type: drawing.type,
      anchors: drawing.anchors.map((anchor) => {
        object(anchor, "drawing anchor");
        return { time: timestamp(anchor.time), price: price(anchor.price) };
      }),
    };
    if (drawing.text !== undefined)
      result.text = text(drawing.text, 120, "drawing text", true);
    if (drawing.color !== undefined) {
      if (
        typeof drawing.color !== "string" ||
        !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(drawing.color)
      )
        throw invalid("Choose a drawing color.");
      result.color = drawing.color;
    }
    return result;
  });
  let viewport = null;
  if (input.viewport !== undefined && input.viewport !== null) {
    const value = object(input.viewport, "chart viewport");
    const from = timestamp(value.from),
      to = timestamp(value.to);
    if (from >= to) throw invalid("Check the chart viewport.");
    viewport = { from, to };
  }
  let priceRange = null;
  if (input.priceRange !== undefined && input.priceRange !== null) {
    const value = object(input.priceRange, "price range");
    const { min, max } = value;
    if (
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min >= max ||
      min < -MAX_AXIS_PRICE ||
      max > MAX_AXIS_PRICE ||
      (input.scale === "log" && min < MIN_LOG_PRICE)
    )
      throw invalid("Check the chart price range.");
    priceRange = { min, max };
  }
  return {
    name: text(input.name, 40, "analysis name"),
    range: input.range,
    currency: input.currency,
    scale: input.scale,
    chartType: input.chartType,
    indicators: [...input.indicators],
    drawings,
    viewport,
    priceRange,
  };
}
