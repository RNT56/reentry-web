import { referenceLevels } from "../../domain/chart-levels.js";
import { mountAssetChart } from "./asset-chart.js";
const cache = new Map(),
  pending = new Map();
export async function fetchPriceHistory(symbol, range, currency) {
  const key = symbol + ":" + range + ":" + currency,
    previous = cache.get(key);
  if (previous && Date.now() - previous.at < 60000) return previous.data;
  if (pending.has(key)) return pending.get(key);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 18000);
  const promise = (async () => {
    try {
      const response = await fetch(
        `/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&currency=${currency}`,
        { credentials: "same-origin", signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Price history unavailable.");
      if (cache.size >= 30) cache.delete(cache.keys().next().value);
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
export function mountPriceChart(
  root,
  holding,
  initialLevels = {},
  { ownerId } = {},
) {
  let levels = initialLevels;
  const chart = mountAssetChart(root, {
    ownerId,
    symbol: holding.symbol,
    surface: "price",
    label: holding.symbol + " · Price history",
    ranges: true,
    currencyControl: true,
    reserveReferences: Number.isFinite(initialLevels.buyIn) || !!holding.lots,
    load: (state) =>
      holding.demo
        ? Promise.resolve({
            symbol: holding.symbol,
            points: [],
            source: "Demo",
            currency: state.currency,
          })
        : fetchPriceHistory(holding.symbol, state.range, state.currency),
    references: (data) =>
      referenceLevels({
        ...levels,
        currency: data.currency,
        symbol: data.symbol,
        displayFx: data.referenceFx,
      }).levels,
  });
  return {
    setLevels(next) {
      levels = next;
      chart.redraw();
    },
    destroy: chart.destroy,
  };
}
