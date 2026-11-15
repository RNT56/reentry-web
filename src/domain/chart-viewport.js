const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const MAX_TIME = 4102444800;

/** Fractional bar positions preserve smooth motion across real market gaps. */
export function observationIndex(points, time) {
  let low = 0,
    high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const i = Math.max(0, low - 1),
    a = points[i],
    b = points[i + 1];
  return i + (time - a.time) / (b.time - a.time);
}

export function observationTime(
  points,
  index,
  limits = { min: 0, max: MAX_TIME },
) {
  const i = clamp(Math.floor(index), 0, points.length - 2);
  return clamp(
    points[i].time + (index - i) * (points[i + 1].time - points[i].time),
    limits.min,
    limits.max,
  );
}

export function savedChartViewport(points, { from, to }, limits) {
  if (Math.abs(from) < 1e-8 && Math.abs(to - points.length + 1) < 1e-8)
    return null;
  return {
    from: observationTime(points, from, limits),
    to: observationTime(points, to, limits),
  };
}

/** Keep at least half the observed window on-screen, including at full zoom. */
export function panChartWindow({ length, from, to }, delta) {
  if (!Number.isFinite(delta) || length < 2) return { from, to };
  const span = to - from,
    padding = span / 2;
  const start = clamp(from + delta, -padding, length - 1 - span + padding);
  return { from: start, to: start + span };
}

export function restoreChartWindow(points, viewport) {
  const full = { from: 0, to: points.length - 1 };
  if (!viewport) return full;
  const from = observationIndex(points, viewport.from),
    to = observationIndex(points, viewport.to);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    to < 0 ||
    from > full.to
  )
    return full;
  const span = clamp(to - from, 1, full.to);
  return panChartWindow({ length: points.length, from, to: from + span }, 0);
}
