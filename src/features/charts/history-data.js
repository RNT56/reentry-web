const cache = new Map(),
  pending = new Map();
export async function fetchPriceHistory(symbol, range, currency, before) {
  const key = symbol + ":" + range + ":" + currency + ":" + (before ?? ""),
    previous = cache.get(key);
  if (previous && Date.now() - previous.at < (before ? 86400000 : 60000))
    return previous.data;
  if (pending.has(key)) return pending.get(key);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 45000);
  const promise = (async () => {
    try {
      const response = await fetch(
        `/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&currency=${currency}${before ? "&before=" + before : ""}`,
        { credentials: "same-origin", signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Price history unavailable.");
      if (cache.size >= 48) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), data });
      return data;
    } finally {
      clearTimeout(timer);
      pending.delete(key);
    }
  })();
  pending.set(key, promise);
  return promise;
}

export const MAX_HISTORY_POINTS = 30000;
export function mergeHistory(current, older) {
  if (
    ["symbol", "range", "interval", "currency"].some(
      (key) => current[key] !== older[key],
    )
  )
    throw Error(
      "Earlier prices unavailable in this currency. Try another currency.",
    );
  const points = new Map(older.points.map((p) => [p.time, p]));
  for (const p of current.points) points.set(p.time, p);
  const sorted = [...points.values()].sort((a, b) => a.time - b.time);
  const limited = sorted.length > MAX_HISTORY_POINTS;
  return {
    ...current,
    extended: true,
    points: sorted.slice(-MAX_HISTORY_POINTS),
    paging: limited
      ? { before: null, boundary: "History limit" }
      : older.paging,
  };
}
export function fullHistoryViewport(data) {
  return data?.extended && data.points?.length > 1
    ? { from: data.points[0].time, to: data.points.at(-1).time }
    : null;
}
export function historyOutside(data, viewport) {
  return !!(
    viewport &&
    data?.points?.length &&
    viewport.from < data.points[0].time &&
    data.paging?.before
  );
}
export async function loadChartHistory(
  symbol,
  state,
  current = () => true,
  read = fetchPriceHistory,
) {
  let data = await read(symbol, state.range, state.currency);
  for (
    let page = 0;
    page < 24 && current() && historyOutside(data, state.viewport);
    page++
  ) {
    const cursor = data.paging.before;
    const older = await read(symbol, state.range, state.currency, cursor);
    if (!current()) return data;
    data = mergeHistory(data, older);
    if (data.paging?.before >= cursor)
      throw Error("History cursor did not advance.");
  }
  return data;
}
