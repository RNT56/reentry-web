const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const MIN_LOG_PRICE = 1e-10;
export const MAX_AXIS_PRICE = 1e12;

/** Scale the visible price interval, in linear or logarithmic coordinates. */
export function scalePriceRange({ low, high, log = false }, factor) {
  if (
    !Number.isFinite(factor) ||
    factor <= 0 ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    low >= high ||
    (log && low <= 0)
  )
    return null;
  const transform = log ? Math.log : (n) => n;
  const inverse = log ? Math.exp : (n) => n;
  const floor = log ? Math.log(MIN_LOG_PRICE) : -MAX_AXIS_PRICE;
  const ceiling = log ? Math.log(MAX_AXIS_PRICE) : MAX_AXIS_PRICE;
  const a = transform(low),
    b = transform(high),
    center = a + (b - a) / 2;
  const minimumSpan = log ? 1e-6 : Math.max(1e-10, Math.abs(center) * 1e-8);
  const span = clamp((b - a) * factor, minimumSpan, ceiling - floor);
  const midpoint = clamp(center, floor + span / 2, ceiling - span / 2);
  return {
    min: clamp(
      inverse(midpoint - span / 2),
      log ? MIN_LOG_PRICE : floor,
      MAX_AXIS_PRICE,
    ),
    max: clamp(
      inverse(midpoint + span / 2),
      log ? MIN_LOG_PRICE : floor,
      MAX_AXIS_PRICE,
    ),
  };
}

export function chartAxisAt({ x, y }, view) {
  if (x > view.R && x <= view.W && y >= view.T && y <= view.B) return "price";
  if (y > view.B && y <= view.H && x >= view.L && x <= view.R) return "time";
  return null;
}

/** Positive movement follows a downward pointer drag without changing scale. */
export function panPriceRange(
  { low, high, log = false, priceRange },
  fraction,
) {
  low = priceRange?.min ?? low;
  high = priceRange?.max ?? high;
  if (
    !Number.isFinite(fraction) ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    low >= high ||
    (log && low <= 0)
  )
    return null;
  const transform = log ? Math.log : (n) => n;
  const inverse = log ? Math.exp : (n) => n;
  const floor = log ? Math.log(MIN_LOG_PRICE) : -MAX_AXIS_PRICE;
  const ceiling = log ? Math.log(MAX_AXIS_PRICE) : MAX_AXIS_PRICE;
  const a = transform(low),
    span = Math.min(transform(high) - a, ceiling - floor);
  const start = clamp(a + span * fraction, floor, ceiling - span);
  const min = clamp(
    inverse(start),
    log ? MIN_LOG_PRICE : floor,
    MAX_AXIS_PRICE,
  );
  const max = clamp(
    inverse(start + span),
    log ? MIN_LOG_PRICE : floor,
    MAX_AXIS_PRICE,
  );
  return min < max ? { min, max } : null;
}

/** CSS pixels give the same drag sensitivity at every chart size and density. */
export const axisDragFactor = (pixels) => Math.exp(clamp(pixels / 180, -8, 8));
