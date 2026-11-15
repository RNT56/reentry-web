import { createReturnLedger } from "./return-ledger.js";
const DAY = 86400000,
  stamp = (d) => Date.parse(d + "T00:00:00Z"),
  day = (t) => new Date(t).toISOString().slice(0, 10),
  round = (n) => Math.round(n * 100) / 100;
export const performanceBenchmarks = [
  {
    id: "sp500",
    symbol: "^GSPC",
    label: "S&P 500",
    currency: "USD",
    basis: "price",
    source: "https://www.spglobal.com/spdji/en/indices/equity/sp-500/",
  },
  {
    id: "world",
    symbol: "^990100-USD-STRD",
    label: "MSCI World",
    currency: "USD",
    basis: "price",
    source:
      "https://www.msci.com/documents/10199/255599/msci-world-index-usd-price.pdf",
  },
];
function cursor(points = []) {
  let i = -1;
  return (date, oldest = day(stamp(date) - 7 * DAY)) => {
    while (i + 1 < points.length && points[i + 1].date <= date) i++;
    const p = points[i];
    return p && p.date >= oldest ? p.close : null;
  };
}
function benchmarkBook(history) {
  const lots = new Map(),
    price = cursor(history?.points);
  let units = 0,
    basis = 0,
    realized = 0,
    valid = history?.currency === "USD";
  return {
    apply(flows, date) {
      if (!valid || !flows.length) return;
      const close = price(date);
      if (!Number.isFinite(close)) {
        valid = false;
        return;
      }
      for (const f of flows) {
        if (f.side === "buy") {
          const quantity = f.cost / close;
          lots.set(f.id, { ratio: quantity / f.units, price: close });
          units += quantity;
          basis += f.cost;
        } else {
          const lot = lots.get(f.id);
          if (!lot) {
            valid = false;
            return;
          }
          const sold = f.units * lot.ratio;
          units -= sold;
          basis -= f.cost;
          realized += sold * (close - lot.price);
        }
      }
      if (Math.abs(units) < 1e-8) {
        units = 0;
        basis = 0;
      }
    },
    value(date) {
      if (!valid) return null;
      if (!units) return round(realized);
      const close = price(date);
      return Number.isFinite(close)
        ? round(realized + units * close - basis)
        : null;
    },
  };
}
export function buildPoliticalPerformance(
  rows,
  histories,
  salary,
  { from, through },
) {
  if (!from || from > through) return null;
  const dates = [];
  for (let t = stamp(from); t <= stamp(through); t += DAY) dates.push(day(t));
  if (dates.length > 6500)
    throw Error("Performance period exceeds daily history limit");
  // Execution dates, not disclosure/publication dates; this is retrospective,
  // not an investable backtest of information available at the time.
  const events = [...rows].sort(
    (a, b) =>
      a.priceDate.localeCompare(b.priceDate) ||
      a.traded.localeCompare(b.traded) ||
      (a.side === b.side
        ? a.id.localeCompare(b.id)
        : a.side === "sell"
          ? -1
          : 1),
  );
  const variants = {};
  for (const [key, fraction] of [
    ["low", 0],
    ["mid", 0.5],
    ["high", 1],
  ]) {
    const ledger = createReturnLedger(fraction),
      prices = new Map(
        [...histories].map(([symbol, h]) => [symbol, cursor(h.points)]),
      ),
      books = Object.fromEntries(
        performanceBenchmarks.map((b) => [
          b.id,
          benchmarkBook(histories.get(b.symbol)),
        ]),
      ),
      series = { gain: [], sp500: [], world: [] };
    let next = 0;
    for (const date of dates) {
      const oldest = day(stamp(date) - 7 * DAY);
      while (next < events.length && events[next].priceDate <= date) {
        const r = events[next++],
          flows = ledger.apply(r);
        for (const b of Object.values(books)) b.apply(flows, r.priceDate);
      }
      series.gain.push(
        ledger.value((symbol) => prices.get(symbol)?.(date, oldest)).gain,
      );
      for (const b of performanceBenchmarks)
        series[b.id].push(books[b.id].value(date));
    }
    variants[key] = series;
  }
  return {
    version: 1,
    from,
    through,
    dates,
    variants,
    salary: dates.map((d) =>
      Number.isFinite(salary?.annual) && salary.annual > 0
        ? round((salary.annual * (stamp(d) - stamp(from))) / DAY / 365.2425)
        : null,
    ),
    benchmarks: performanceBenchmarks.map((b) => ({
      ...b,
      available: Number.isFinite(variants.mid[b.id].at(-1)),
      through:
        histories
          .get(b.symbol)
          ?.points.filter((p) => p.date <= through)
          .at(-1)?.date || null,
    })),
    basis: "matched-capital-price-gains",
    currency: "USD",
  };
}
