export const historyRanges = {
  "1d": { label: "1D", interval: "5m" },
  "1wk": { label: "1W", interval: "15m" },
  "1mo": { label: "1M", interval: "1d" },
  "3mo": { label: "3M", interval: "1d" },
  "1y": { label: "1Y", interval: "1d" },
  "5y": { label: "5Y", interval: "1wk" },
};

export function historyPath(symbol, range = "1mo") {
  if (
    !/^[A-Za-z0-9.^=\-]{1,32}$/.test(symbol) ||
    !Object.hasOwn(historyRanges, range)
  )
    throw Object.assign(Error("Invalid asset or chart range."), {
      statusCode: 400,
    });
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
  const units = {
    GBp: ["GBP", 0.01],
    GBX: ["GBP", 0.01],
    ILA: ["ILS", 0.01],
    ZAc: ["ZAR", 0.01],
  };
  const [currency, unit] = units[meta.currency] || [meta.currency, 1];
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
