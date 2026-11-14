const finite = (value) => typeof value === "number" && Number.isFinite(value);
const maxPrice = 1e12;
const week = 7 * 86400;
function validateHistory(points) {
  if (!Array.isArray(points) || !points.length || points.length > 100000)
    throw Error("Historical currency coverage unavailable.");
  let previous = -Infinity;
  for (const p of points) {
    if (
      !p ||
      !finite(p.time) ||
      p.time <= previous ||
      !finite(p.price) ||
      p.price <= 0
    )
      throw Error("Historical currency coverage unavailable.");
    previous = p.time;
  }
}

/** Convert drawing prices with exact matching asset bars in both currencies. */
export function convertDrawingCurrency(drawings, sourcePoints, targetPoints) {
  if (!Array.isArray(drawings)) throw Error("Invalid chart drawings.");
  if (!drawings.length) return [];
  validateHistory(sourcePoints);
  validateHistory(targetPoints);
  const target = new Map(targetPoints.map((p) => [p.time, p.price]));
  const common = sourcePoints.filter((p) => target.has(p.time));
  if (!common.length)
    throw Error("Matching historical currency bars unavailable.");
  const first = common[0].time,
    last = common.at(-1).time;
  function rateAt(time) {
    if (!finite(time) || time < first || time > last + week)
      throw Error("Drawing falls outside historical currency coverage.");
    let low = 0,
      high = common.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (common[middle].time <= time) low = middle;
      else high = middle - 1;
    }
    const source = common[low];
    return target.get(source.time) / source.price;
  }
  return drawings.map((d) => {
    if (!d || !Array.isArray(d.anchors) || !d.anchors.length)
      throw Error("Invalid chart drawing anchors.");
    return {
      ...d,
      anchors: d.anchors.map((anchor) => {
        if (!anchor || !finite(anchor.price) || anchor.price <= 0)
          throw Error("Invalid chart drawing price.");
        const price = anchor.price * rateAt(anchor.time);
        if (!finite(price) || price <= 0 || price > maxPrice)
          throw Error("Converted drawing price is outside supported bounds.");
        return { ...anchor, price };
      }),
    };
  });
}
