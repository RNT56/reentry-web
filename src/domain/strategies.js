const day = 86400;
export function powerLaw(points) {
  if (points.length < 24) return null;
  const origin = points[0].time;
  const rows = points.map((p) => [
    Math.log(1 + (p.time - origin) / day),
    Math.log(p.price),
  ]);
  const mx = rows.reduce((s, p) => s + p[0], 0) / rows.length,
    my = rows.reduce((s, p) => s + p[1], 0) / rows.length;
  const xx = rows.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  if (!xx) return null;
  const slope = rows.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / xx,
    intercept = my - slope * mx;
  const residual = rows.reduce(
      (s, p) => s + (p[1] - intercept - slope * p[0]) ** 2,
      0,
    ),
    total = rows.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  return {
    slope,
    intercept,
    origin,
    r2: total > 0 ? Math.max(0, 1 - residual / total) : 1,
    deviation: Math.sqrt(residual / rows.length),
    fair: Math.exp(intercept + slope * rows.at(-1)[0]),
  };
}
export function confirmedPivots(points, radius = 2) {
  const pivots = [];
  for (let i = radius; i < points.length - radius; i++) {
    const window = points.slice(i - radius, i + radius + 1),
      p = points[i];
    const kind = window.every((v, j) => j === radius || v.price < p.price)
      ? "high"
      : window.every((v, j) => j === radius || v.price > p.price)
        ? "low"
        : null;
    if (!kind) continue;
    const pivot = { ...p, kind, confirmedAt: points[i + radius].time };
    const last = pivots.at(-1);
    if (last?.kind === kind) {
      if (kind === "high" ? p.price > last.price : p.price < last.price)
        pivots[pivots.length - 1] = pivot;
    } else pivots.push(pivot);
  }
  return pivots;
}
export function waveSetup(points) {
  const pivots = confirmedPivots(points),
    last = pivots.slice(-3);
  if (
    last.length !== 3 ||
    last[0].kind !== "low" ||
    last[1].kind !== "high" ||
    last[2].kind !== "low"
  )
    return { active: false, pivots: pivots.slice(-8) };
  const [a, b, c] = last,
    impulse = b.price - a.price,
    retracement = (b.price - c.price) / impulse;
  const active =
    impulse > 0 &&
    c.price > a.price &&
    points.at(-1).price > a.price &&
    retracement >= 0.382 &&
    retracement <= 0.786;
  return {
    active,
    pivots: pivots.slice(-8),
    retracement,
    invalidation: a.price,
    projected: active ? [c.price + impulse, c.price + 1.618 * impulse] : null,
  };
}
export function compareStrategies(
  raw,
  { capital = 10000, fee = 1, bps = 0, training = 52 } = {},
) {
  if (
    !Number.isFinite(capital) ||
    capital < 100 ||
    capital > 10000000 ||
    !Number.isFinite(fee) ||
    fee < 0 ||
    fee > 1000 ||
    !Number.isFinite(bps) ||
    bps < 0 ||
    bps > 500 ||
    !Number.isInteger(training) ||
    training < 24 ||
    training > 104
  )
    throw Error("Invalid strategy parameters.");
  if (!Array.isArray(raw)) throw Error("Price history unavailable.");
  const points = raw
    .filter(
      (p) => Number.isFinite(p.time) && Number.isFinite(p.price) && p.price > 0,
    )
    .sort((a, b) => a.time - b.time)
    .filter((p, i, a) => !i || p.time !== a[i - 1].time);
  if (points.length < training + 12)
    throw Error("At least 64 price samples required.");
  const months = [];
  for (let i = training; i < points.length; i++) {
    const m = new Date(points[i].time * 1000).toISOString().slice(0, 7);
    if (months.at(-1)?.month !== m) months.push({ month: m, index: i });
  }
  const scheduled = new Set(months.map((m) => m.index)),
    tranche = capital / months.length;
  const states = ["Lump sum", "DCA", "Power law", "Elliott · wave 2"].map(
    (name) => ({
      name,
      cash: capital,
      shares: 0,
      fees: 0,
      trades: [],
      curve: [],
      peak: capital,
      drawdown: 0,
    }),
  );
  for (let i = training; i < points.length; i++) {
    const p = points[i],
      past = points.slice(0, i),
      fit = powerLaw(past),
      wave = waveSetup(past);
    states.forEach((s, j) => {
      const signal =
        j === 0
          ? i === training
          : scheduled.has(i) &&
            (j === 1 ||
              (j === 2 && fit && past.at(-1).price < fit.fair) ||
              (j === 3 && wave.active));
      if (signal) {
        const spend = Math.min(s.cash, j === 0 ? capital : tranche),
          gross = (spend - fee) / (1 + bps / 10000);
        if (gross > 0) {
          const shares = gross / p.price,
            cost = spend - gross;
          s.cash -= spend;
          s.shares += shares;
          s.fees += cost;
          s.trades.push({ time: p.time, price: p.price, shares, cost, spend });
        }
      }
      const value = s.cash + s.shares * p.price;
      s.peak = Math.max(s.peak, value);
      s.drawdown = Math.max(s.drawdown, 1 - value / s.peak);
      s.curve.push({ time: p.time, value });
    });
  }
  const power = powerLaw(points);
  const stride = Math.max(1, Math.ceil(points.length / 259));
  const structure = points
    .filter((_p, i) => i % stride === 0 || i === points.length - 1)
    .map((p) => ({
      ...p,
      fit: power
        ? Math.exp(
            power.intercept +
              power.slope * Math.log(1 + (p.time - power.origin) / day),
          )
        : null,
    }));
  return {
    capital,
    fee,
    bps,
    trainingSamples: training,
    start: points[training].time,
    end: points.at(-1).time,
    samples: points.length - training,
    strategies: states.map((s) => ({
      ...s,
      value: s.curve.at(-1).value,
      return: s.curve.at(-1).value / capital - 1,
      averageCost: s.shares ? (capital - s.cash) / s.shares : null,
    })),
    power,
    structure,
    wave: waveSetup(points),
    prices: points,
  };
}
