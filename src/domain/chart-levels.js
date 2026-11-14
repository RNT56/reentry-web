import { currencyUnit } from "./currency.js";
// Portfolio inputs are EUR. History remains in the listing currency.
// A current FX conversion positions reference levels; it never rewrites history.
export function referenceLevels({
  currency,
  symbol,
  buyIn,
  target,
  quote,
  now = Date.now(),
}) {
  let rate = 1;
  if (currency !== "EUR") {
    const sameListing = quote?.symbol === symbol;
    const sameCurrency = currencyUnit(quote?.originalCurrency)[0] === currency;
    const age = now / 1000 - quote?.fxTime;
    if (
      !sameListing ||
      !sameCurrency ||
      quote?.error ||
      !Number.isFinite(quote?.fxRate) ||
      quote.fxRate <= 0 ||
      !Number.isFinite(age) ||
      age < -300 ||
      age > 7 * 86400
    )
      return {
        levels: [],
        note: "EUR levels unavailable · refresh the FX quote",
        converted: false,
      };
    rate = quote.fxRate;
  }
  const levels = [
    {
      id: "buy-in",
      label: "Buy-in",
      detail: "Average acquisition cost, including purchase fees",
      eur: buyIn,
      color: "#a8c7fa",
    },
    {
      id: "target",
      label: "Buyback target",
      detail: "After-tax ceiling for your current sale and additional shares",
      eur: target,
      color: "#b9f68b",
    },
  ]
    .filter((l) => Number.isFinite(l.eur) && l.eur >= 0)
    .map((l) => ({ ...l, price: l.eur / rate }));
  return {
    levels,
    converted: currency !== "EUR",
    fxTime: quote?.fxTime,
    note:
      currency === "EUR"
        ? "Buy-in includes purchase fees"
        : "EUR levels at quoted FX · historical prices unchanged",
  };
}

export function chartScale(points, levels = []) {
  const values = [
    ...points.map((p) => p.price),
    ...levels.map((l) => l.price),
  ].filter(Number.isFinite);
  const min = Math.min(...values),
    max = Math.max(...values);
  const padding = Math.max((max - min) * 0.12, max * 0.001, 1e-8);
  const low = Math.max(0, min - padding),
    high = max + padding;
  return {
    low,
    high,
    y: (value) => 12 + ((high - value) / (high - low)) * 172,
  };
}
