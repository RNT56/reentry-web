import {
  historyRanges,
  validateHistoryInput,
} from "../../src/domain/market-history.js";
import { currencyUnit } from "../../src/domain/currency.js";
export function historyPath(symbol, range = "1mo") {
  validateHistoryInput(symbol, range);
  if (range === "1wk") {
    const end = Math.floor(Date.now() / 1000);
    return `/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${end - 7 * 86400}&period2=${end}&interval=15m&includePrePost=false`;
  }
  return `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${historyRanges[range].interval}&includePrePost=false`;
}

export function normalizeHistory(payload, symbol, range) {
  const result = payload?.chart?.result?.[0];
  if (!result || payload.chart.error)
    throw Error("Price history is unavailable for this asset.");
  const meta = result.meta || {};
  const [currency, unit] = currencyUnit(meta.currency);
  if (!/^[A-Z]{3}$/.test(currency || ""))
    throw Error("The history currency is unavailable.");
  const closes = result.indicators?.quote?.[0]?.close || [];
  const unique = new Map();
  for (const [i, time] of (result.timestamp || []).entries()) {
    const value = closes[i];
    if (
      Number.isSafeInteger(time) &&
      time > 0 &&
      time < 8640000000000 &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0
    )
      unique.set(time, { time, price: value * unit });
  }
  const points = [...unique.values()].sort((a, b) => a.time - b.time);
  // Bounded requests use at most a few hundred bars, including intraday crypto.
  if (points.length > 2500) throw Error("The history response is too large.");
  let timeZone = meta.exchangeTimezoneName || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
  } catch {
    timeZone = "UTC";
  }
  return {
    symbol,
    range,
    currency,
    timeZone,
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    source: "Yahoo Finance",
    interval: historyRanges[range].interval,
    points,
  };
}
