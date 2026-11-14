// FX observations are matched backwards only; stale or missing rates never become prices.
export function convertHistory(history, fx, target) {
  // Yahoo timestamps identify the opening of each close-price bar. A close is
  // available only after its interval ends, never at the opening timestamp.
  const lag =
    {
      "1d": 300,
      "1wk": 900,
      "1mo": 86400,
      "3mo": 86400,
      "1y": 86400,
      "5y": 7 * 86400,
    }[fx.range] || 0;
  const rates = fx.points
    .map((p) => ({ ...p, time: p.time + lag }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.time - b.time);
  let index = -1;
  const points = history.points.map((point) => {
    while (index + 1 < rates.length && rates[index + 1].time <= point.time)
      index++;
    const rate = rates[index];
    if (!rate || point.time - rate.time > 10 * 86400) return null;
    const converted = { ...point, price: point.price * rate.price };
    // One completed, earlier FX observation is used for the complete bar so
    // converted candle geometry stays coherent. Trading volume is a count.
    for (const field of ["open", "high", "low", "close"])
      if (Number.isFinite(point[field]) && point[field] > 0)
        converted[field] = point[field] * rate.price;
    if (
      ["price", "open", "high", "low", "close"].some(
        (field) =>
          field in converted &&
          (!Number.isFinite(converted[field]) || converted[field] <= 0),
      )
    )
      return null;
    return converted;
  });
  // Keep the complete native series if FX coverage is incomplete; no silent gap removal.
  if (points.some((p) => !p))
    return {
      ...history,
      requestedCurrency: target,
      conversionUnavailable: true,
    };
  return {
    ...history,
    currency: target,
    nativeCurrency: history.currency,
    converted: true,
    points,
    fxSource: fx.source,
  };
}
