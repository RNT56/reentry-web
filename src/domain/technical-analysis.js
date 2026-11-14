const finite = (value) => typeof value === "number" && Number.isFinite(value);
const gap = (value) => value === null || value === undefined;
function periodValue(period) {
  if (!Number.isInteger(period) || period < 1 || period > 10000)
    throw Error("Invalid indicator period.");
}
function valuesInput(values) {
  if (!Array.isArray(values) || values.some((v) => !gap(v) && !finite(v)))
    throw Error("Indicator values must be finite numbers or gaps.");
}

/** Aligned trailing average; a gap starts a fresh contiguous warmup. */
export function sma(values, period) {
  periodValue(period);
  valuesInput(values);
  const result = Array(values.length).fill(null),
    ring = Array(period);
  let count = 0,
    position = 0,
    sum = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (gap(value)) {
      count = position = sum = 0;
      continue;
    }
    if (count === period) sum -= ring[position];
    else count++;
    ring[position] = value;
    position = (position + 1) % period;
    sum += value;
    if (count === period) result[i] = sum / period;
  }
  return result;
}

/** EMA seeded with the first complete period's arithmetic average. */
export function ema(values, period) {
  periodValue(period);
  valuesInput(values);
  const result = Array(values.length).fill(null),
    alpha = 2 / (period + 1);
  let count = 0,
    sum = 0,
    average = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (gap(value)) {
      count = sum = 0;
      average = null;
      continue;
    }
    if (average === null) {
      count++;
      sum += value;
      if (count === period) average = sum / period;
    } else average += alpha * (value - average);
    if (average !== null) result[i] = average;
  }
  return result;
}

/** Bollinger's default: SMA 20 ± 2 population standard deviations. */
export function bollingerBands(values, period = 20, deviations = 2) {
  periodValue(period);
  valuesInput(values);
  if (!finite(deviations) || deviations <= 0 || deviations > 10)
    throw Error("Invalid band deviations.");
  const middle = Array(values.length).fill(null),
    upper = Array(values.length).fill(null),
    lower = Array(values.length).fill(null),
    ring = Array(period);
  let count = 0,
    position = 0,
    mean = 0,
    m2 = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (gap(value)) {
      count = position = mean = m2 = 0;
      continue;
    }
    if (count === period) {
      if (count === 1) {
        count = mean = m2 = 0;
      } else {
        const removed = ring[position],
          previous = mean;
        mean -= (removed - mean) / (count - 1);
        m2 -= (removed - previous) * (removed - mean);
        count--;
      }
    }
    ring[position] = value;
    position = (position + 1) % period;
    count++;
    const delta = value - mean;
    mean += delta / count;
    m2 += delta * (value - mean);
    if (count === period) {
      const width = deviations * Math.sqrt(Math.max(0, m2 / period));
      middle[i] = mean;
      upper[i] = mean + width;
      lower[i] = mean - width;
    }
  }
  return { middle, upper, lower };
}

/** Wilder smoothing; first result needs period + 1 consecutive closes. */
export function rsi(values, period = 14) {
  periodValue(period);
  valuesInput(values);
  const result = Array(values.length).fill(null);
  let previous = null,
    count = 0,
    gain = 0,
    loss = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (gap(value)) {
      previous = null;
      count = gain = loss = 0;
      continue;
    }
    if (previous !== null) {
      const delta = value - previous,
        up = Math.max(0, delta),
        down = Math.max(0, -delta);
      if (count < period) {
        gain += up;
        loss += down;
        count++;
        if (count === period) {
          gain /= period;
          loss /= period;
        }
      } else {
        gain = (gain * (period - 1) + up) / period;
        loss = (loss * (period - 1) + down) / period;
      }
      if (count === period)
        result[i] =
          !gain && !loss
            ? 50
            : !loss
              ? 100
              : !gain
                ? 0
                : 100 - 100 / (1 + gain / loss);
    }
    previous = value;
  }
  return result;
}

export function macd(
  values,
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
) {
  [fastPeriod, slowPeriod, signalPeriod].forEach(periodValue);
  if (fastPeriod >= slowPeriod)
    throw Error("MACD fast period must precede slow period.");
  const fast = ema(values, fastPeriod),
    slow = ema(values, slowPeriod),
    line = values.map((_v, i) =>
      fast[i] === null || slow[i] === null ? null : fast[i] - slow[i],
    ),
    signal = ema(line, signalPeriod),
    histogram = line.map((v, i) =>
      v === null || signal[i] === null ? null : v - signal[i],
    );
  return { line, signal, histogram };
}

/** Validates, never sorts or drops bars: every result index matches the chart. */
export function technicalIndicators(points) {
  if (!Array.isArray(points) || points.length > 100000)
    throw Error("Invalid chart history.");
  let previousTime = -Infinity;
  const prices = [],
    volume = [];
  for (const point of points) {
    if (!point || !finite(point.time) || point.time <= previousTime)
      throw Error("Chart times must be finite and strictly increasing.");
    previousTime = point.time;
    const price = point.price ?? point.close;
    if (!gap(price) && (!finite(price) || price <= 0))
      throw Error("Chart prices must be positive finite numbers.");
    if (!gap(point.volume) && (!finite(point.volume) || point.volume < 0))
      throw Error("Chart volume must be a nonnegative finite number.");
    prices.push(gap(price) ? null : price);
    volume.push(gap(point.volume) ? null : point.volume);
  }
  return {
    sma20: sma(prices, 20),
    sma50: sma(prices, 50),
    sma200: sma(prices, 200),
    ema20: ema(prices, 20),
    bollinger: bollingerBands(prices),
    rsi: rsi(prices),
    macd: macd(prices),
    volume,
  };
}

function validateAnchor(anchor) {
  if (
    !anchor ||
    !finite(anchor.time) ||
    !finite(anchor.price) ||
    anchor.price <= 0
  )
    throw Error("Invalid chart anchor.");
}
export const fibonacciRatios = Object.freeze([
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1,
]);
/** A→B move: 0% is B, 100% retracement returns to A, in either direction. */
export function fibonacciLevels(a, b) {
  validateAnchor(a);
  validateAnchor(b);
  return fibonacciRatios.map((ratio) => ({
    ratio,
    price: b.price + (a.price - b.price) * ratio,
  }));
}
export function measureRange(a, b, points) {
  validateAnchor(a);
  validateAnchor(b);
  const absolute = b.price - a.price,
    seconds = Math.abs(b.time - a.time);
  let bars = null;
  if (Array.isArray(points) && points.length) {
    if (
      points.some(
        (p, i) => !finite(p?.time) || (i && p.time <= points[i - 1].time),
      )
    )
      throw Error("Measurement history must be ordered.");
    const index = (time) => {
      let low = 0,
        high = points.length - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (points[mid].time < time) low = mid + 1;
        else high = mid;
      }
      return low > 0 &&
        Math.abs(points[low - 1].time - time) <
          Math.abs(points[low].time - time)
        ? low - 1
        : low;
    };
    bars = Math.abs(index(b.time) - index(a.time));
  }
  return {
    absolute,
    percent: (absolute / a.price) * 100,
    seconds,
    days: seconds / 86400,
    bars,
  };
}
