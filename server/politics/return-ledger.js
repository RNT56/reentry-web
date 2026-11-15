const round = (n) => Math.round(n * 100) / 100;

// One FIFO implementation serves the headline estimate and every dated chart
// observation. Matched lot flows also drive the equal-capital index portfolios.
export function createReturnLedger(fraction) {
  const books = new Map(),
    assets = new Map();
  let purchases = 0,
    realized = 0,
    unmatched = 0,
    matchedSales = 0,
    partialSales = 0;
  function apply(r) {
    const key = `${r.ticker}|${r.owner || "Unspecified"}`,
      lots = books.get(key) || [],
      a = assets.get(r.ticker) || {
        symbol: r.ticker,
        purchases: 0,
        realized: 0,
        units: 0,
        basis: 0,
        buys: 0,
        sells: 0,
      },
      amount = r.low + (r.high - r.low) * fraction,
      flows = [];
    if (r.side === "buy") {
      const units = amount / r.price;
      lots.push({ id: r.id, units, price: r.price });
      purchases += amount;
      a.purchases += amount;
      a.buys++;
      a.units += units;
      a.basis += amount;
      flows.push({ side: "buy", id: r.id, units, cost: amount });
    } else {
      let units = amount / r.price,
        matched = 0;
      if (/\b(full|all)\b/i.test(r.type || "") && lots.length)
        units = lots.reduce((n, l) => n + l.units, 0);
      while (units > 1e-8 && lots.length) {
        const lot = lots[0],
          used = Math.min(units, lot.units),
          cost = used * lot.price,
          gain = used * r.price - cost;
        realized += gain;
        a.realized += gain;
        matched += used;
        units -= used;
        lot.units -= used;
        a.units -= used;
        a.basis -= cost;
        flows.push({ side: "sell", id: lot.id, units: used, cost });
        if (lot.units < 1e-8) lots.shift();
      }
      if (Math.abs(a.units) < 1e-8) {
        a.units = 0;
        a.basis = 0;
      }
      if (matched) {
        matchedSales++;
        a.sells++;
      }
      if (units > 1e-8) {
        unmatched += units * r.price;
        partialSales++;
      }
    }
    books.set(key, lots);
    assets.set(r.ticker, a);
    return flows;
  }
  function value(price) {
    let open = 0,
      remaining = 0;
    for (const a of assets.values())
      if (a.units > 1e-8) {
        const mark = price(a.symbol);
        if (!Number.isFinite(mark))
          return { gain: null, open: null, remaining: null };
        remaining += a.units * mark;
        open += a.units * mark - a.basis;
      }
    return {
      gain: round(realized + open),
      open: round(open),
      remaining: round(remaining),
    };
  }
  function summary(price) {
    const v = value(price);
    return {
      ...v,
      purchases: round(purchases),
      realized: round(realized),
      gainOnBuys: purchases ? (v.gain / purchases) * 100 : null,
      unmatchedSales: round(unmatched),
      matchedSales,
      partialSales,
      assets: [...assets.values()]
        .filter((a) => a.buys)
        .map((a) => {
          const open = a.units > 1e-8 ? a.units * price(a.symbol) - a.basis : 0;
          return {
            symbol: a.symbol,
            purchases: round(a.purchases),
            realized: round(a.realized),
            open: round(open),
            buys: a.buys,
            sells: a.sells,
            gain: round(a.realized + open),
          };
        })
        .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain)),
    };
  }
  return { apply, value, summary };
}
