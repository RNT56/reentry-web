// Drawing-only reduction. Keep real observations, extrema and gap boundaries;
// the full-resolution dataset still drives crosshairs, keyboard inspection and
// zoom. Never interpolate or draw across a missing observation.
export function sampleChartPoints(points, limit = 800) {
  if (points.length <= limit) return points;
  const result = [],
    step = Math.max(
      1,
      Math.ceil(points.length / Math.max(1, Math.floor(limit / 4))),
    );
  for (let from = 0; from < points.length; from += step) {
    const to = Math.min(points.length - 1, from + step - 1),
      keep = new Set([from, to]);
    let min = -1,
      max = -1;
    for (let i = from; i <= to; i++) {
      if (!Number.isFinite(points[i].price)) {
        if (i === from || Number.isFinite(points[i - 1]?.price)) keep.add(i);
        if (Number.isFinite(points[i + 1]?.price)) keep.add(i);
      } else {
        if (min < 0 || points[i].price < points[min].price) min = i;
        if (max < 0 || points[i].price > points[max].price) max = i;
        if (i > 0 && !Number.isFinite(points[i - 1].price)) keep.add(i);
        if (i + 1 < points.length && !Number.isFinite(points[i + 1].price))
          keep.add(i);
      }
    }
    if (min >= 0) keep.add(min);
    if (max >= 0) keep.add(max);
    for (const i of [...keep].sort((a, b) => a - b)) result.push(points[i]);
  }
  return result;
}
