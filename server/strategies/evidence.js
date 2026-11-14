import { compareStrategies } from "../../src/domain/strategies.js";
export function createStrategyEvidence(market) {
  return async function collectStrategyEvidence(asset) {
    const history = await market.history(asset.symbol, "5y", "EUR");
    const result = compareStrategies(history.points);
    return {
      kind: "technical",
      title: `${asset.symbol} · strategy comparison & technical structure`,
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(asset.symbol)}/`,
      published_at: result.end * 1000,
      connector: "strategies",
      content: JSON.stringify({
        currency: history.currency,
        firstEvaluation: result.start,
        lastObservation: result.end,
        sampleCount: result.samples,
        baselineCapital: result.capital,
        orderFee: result.fee,
        comparisons: result.strategies.map((s) => ({
          method: s.name,
          totalReturn: s.return,
          drawdown: s.drawdown,
          uninvestedCash: s.cash,
          orders: s.trades.length,
          fees: s.fees,
        })),
        powerLaw: {
          method:
            "Available-window log-price/log-elapsed-time regression, descriptive in-window fit",
          exponent: result.power?.slope,
          r2: result.power?.r2,
          fittedLatestPrice: result.power?.fair,
        },
        elliottWave2: {
          method:
            "Two-sample confirmed low-high-low, 38.2–78.6% retracement; heuristic only",
          active: result.wave.active,
          invalidation: result.wave.invalidation,
          conditionalPriceRange: result.wave.projected,
        },
        basis:
          "Historical accumulation comparison. Equal starting cash, idle cash included at 0%, signals from previous observations. Sampled price closes, pre-tax, no dividend cash flows. Technical setups are conditional and not calibrated forecasts.",
      }),
    };
  };
}
