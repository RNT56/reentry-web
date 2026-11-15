// Separate daily series: chart ranges downsample older prices and cannot be used
// to reconstruct execution-day prices. All values remain in disclosed USD.
export function returnHistoryPath(symbol, now = Date.now()) {
  if (
    !/^[A-Z0-9.-]{1,20}$/.test(symbol) &&
    !["^GSPC", "^990100-USD-STRD"].includes(symbol)
  )
    throw Error("Unsupported ticker");
  return `/v8/finance/chart/${encodeURIComponent(symbol)}?period1=1325376000&period2=${Math.floor(now / 1000)}&interval=1d&includePrePost=false`;
}
export function normalizeReturnHistory(payload, symbol, now = Date.now()) {
  const r = payload?.chart?.result?.[0],
    m = r?.meta;
  const index = ["^GSPC", "^990100-USD-STRD"].includes(symbol);
  // Yahoo omits currency on this exact MSCI USD price-index series. This is a
  // pinned identifier, not a generic default for unknown security currencies.
  const currency =
    symbol === "^990100-USD-STRD" && m?.currency == null ? "USD" : m?.currency;
  if (
    !m ||
    payload.chart.error ||
    currency !== "USD" ||
    !(index
      ? m.instrumentType === "INDEX"
      : ["EQUITY", "ETF", "MUTUALFUND"].includes(m.instrumentType)) ||
    m.symbol?.toUpperCase() !== symbol.toUpperCase()
  )
    throw Error("No matching USD security history");
  if (!r.timestamp?.length || r.timestamp.length > 6500)
    throw Error("Invalid daily history");
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: m.exchangeTimezoneName || "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const points = new Map(),
    closes = r.indicators?.quote?.[0]?.close || [];
  for (const [i, time] of r.timestamp.entries()) {
    const close = closes[i];
    if (
      !Number.isSafeInteger(time) ||
      time * 1000 > now ||
      !Number.isFinite(close) ||
      close <= 0
    )
      continue;
    const parts = Object.fromEntries(
      format.formatToParts(time * 1000).map((p) => [p.type, p.value]),
    );
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (date >= "2012-01-01") points.set(date, close);
  }
  if (!points.size) throw Error("Daily prices unavailable");
  return {
    symbol,
    currency: "USD",
    source: "Yahoo Finance",
    adjustment: "split-adjusted, excluding dividends",
    name: m.longName || m.shortName || symbol,
    instrumentType: m.instrumentType,
    points: [...points]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, close]) => ({ date, close })),
  };
}
