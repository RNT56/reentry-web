import { validateHistoryInput } from "../../src/domain/market-history.js";
const DAY = 86400;
const invalid = () =>
  Object.assign(Error("Invalid history cursor."), { statusCode: 400 });
export function historyWindow(
  symbol,
  range,
  before,
  now = Math.floor(Date.now() / 1000),
) {
  validateHistoryInput(symbol, range);
  if (before === undefined) return null;
  if (
    (typeof before !== "string" && typeof before !== "number") ||
    !/^\d{1,10}$/.test(String(before))
  )
    throw invalid();
  const to = Number(before);
  if (!Number.isSafeInteger(to) || to <= 0 || to > now + DAY) throw invalid();
  const intraday = range === "1d" || range === "1wk";
  const floor = intraday ? Math.max(0, now - 59 * DAY) : 0;
  if (to <= floor)
    throw Object.assign(Error("Intraday history retention reached."), {
      statusCode: 400,
    });
  const days = {
    "1d": 5,
    "1wk": 21,
    "1mo": 1826,
    "3mo": 1826,
    "1y": 1826,
    "5y": 7305,
  }[range];
  return {
    from: Math.max(floor, to - days * DAY),
    to: Math.min(now, to),
    floor,
  };
}
export function withHistoryPaging(
  data,
  window,
  now = Math.floor(Date.now() / 1000),
) {
  if (window)
    data = { ...data, points: data.points.filter((p) => p.time < window.to) };
  const floor =
    window?.floor ??
    (["1d", "1wk"].includes(data.range) ? Math.max(0, now - 59 * DAY) : 0);
  const earliest = Math.max(floor, data.firstTradeTime || 0);
  const before = window?.from ?? data.points[0]?.time ?? earliest;
  return {
    ...data,
    paging: {
      before: before > earliest ? before : null,
      boundary:
        floor >= (data.firstTradeTime || 0) && floor > 0
          ? "Intraday limit"
          : "Start of history",
    },
  };
}
