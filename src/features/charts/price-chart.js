import { referenceLevels } from "../../domain/chart-levels.js";
import { mountAssetChart } from "./asset-chart.js";
import { loadChartHistory } from "./history-data.js";
export { fetchPriceHistory } from "./history-data.js";
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
    candles: true,
    reserveReferences: Number.isFinite(initialLevels.buyIn) || !!holding.lots,
    load: (state, current) =>
      holding.demo
        ? Promise.resolve({
            symbol: holding.symbol,
            points: [],
            source: "Demo",
            currency: state.currency,
          })
        : loadChartHistory(holding.symbol, state, current),
    history: !holding.demo,
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
    canLeave: chart.canLeave,
  };
}
