import { createReturnLedger } from "./return-ledger.js";
import { buildPoliticalPerformance } from "./performance.js";
const DAY = 86400000;
const date = (n) => new Date(n).toISOString().slice(0, 10);
const time = (d) => Date.parse(d + "T00:00:00Z");
const round = (n) => Math.round(n * 100) / 100;
export const RETURN_MODEL_VERSION = 2;
export const returnReasons = {
  instrument: "Options, bonds & unsupported instruments",
  action: "Exchanges, transfers & other actions",
  ticker: "No supported ticker",
  amount: "Unbounded or missing amounts",
  price: "Missing or stale USD prices",
  identity: "Unverified issuer / reused ticker",
  incomplete: "Incomplete owner / asset history",
  period: "Outside the modeled period",
};
export function returnCutoff(career, now = Date.now()) {
  // Never treat today's unfinished session as a closing price.
  const completedDay = date(now - DAY);
  return career.service?.through && career.service.through < completedDay
    ? career.service.through
    : completedDay;
}
function exclusion(r, through) {
  if (r.traded > through || r.traded < "2012-01-01") return "period";
  if (!["buy", "sell"].includes(r.side)) return "action";
  if (!r.ticker || !/^[A-Z0-9.-]{1,20}$/.test(r.ticker)) return "ticker";
  const kind = String(r.assetType || "").toLowerCase();
  if (
    kind &&
    ![
      "st",
      "stock",
      "et",
      "etf",
      "equity",
      "mutualfund",
      "ot",
      "other",
    ].includes(kind)
  )
    return "instrument";
  if (
    /\b(option|options|call|calls|put|puts|strike|exercise[ds]?|expir\w*|bond|bonds|debenture|treasury|warrant|warrants|futures|non-public|private placement)\b/i.test(
      [r.asset, r.comment].join(" "),
    )
  )
    return "instrument";
  if (
    /\b(gift|donat\w*|transfer\w*|merger|spin.?off|conversion|exchange)\b/i.test(
      [r.type, r.comment].join(" "),
    )
  )
    return "action";
  if (
    !Number.isFinite(r.low) ||
    !Number.isFinite(r.high) ||
    r.low <= 0 ||
    r.high < r.low ||
    r.high > 1e9
  )
    return "amount";
  return null;
}
const bucket = (r) => `${r.ticker}|${r.owner || "Unspecified"}`;
function issuerMatches(row, history) {
  // A ticker is not a permanent security identifier. For example today's SUNE
  // is SUNation, not the SunEdison shares reported in older disclosures.
  const words = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/\.com\b/g, "")
      .replace(/&/g, "")
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 1 &&
          ![
            "the",
            "inc",
            "incorporated",
            "corp",
            "corporation",
            "company",
            "co",
            "plc",
            "ltd",
            "limited",
            "holdings",
            "holding",
            "group",
            "common",
            "stock",
            "stocks",
            "shares",
            "share",
            "class",
            "new",
            "lp",
            "llc",
            "com",
            "cl",
            "ord",
            "ordinary",
          ].includes(w),
      );
  const actual = words(history?.name),
    reported = words(row.asset);
  if (!actual.length || !reported.length) return false;
  const joined = reported.join("");
  return actual
    .slice(0, Math.min(2, actual.length))
    .every((w) => joined.includes(w));
}
export function prepareReturns(rows, through) {
  const candidates = [],
    excluded = [],
    blocked = new Set();
  for (const r of rows) {
    const reason = exclusion(r, through);
    if (reason) {
      excluded.push({ id: r.id, ticker: r.ticker, reason });
      // An unquantified stock trade or transfer breaks this owner's lot chain.
      if (
        ["amount", "action"].includes(reason) &&
        r.ticker &&
        r.traded <= through
      )
        blocked.add(bucket(r));
    } else candidates.push(r);
  }
  const eligible = candidates.filter((r) => {
    if (!blocked.has(bucket(r))) return true;
    excluded.push({ id: r.id, ticker: r.ticker, reason: "incomplete" });
    return false;
  });
  return {
    eligible,
    excluded,
    symbols: [...new Set(eligible.map((r) => r.ticker))].sort(),
  };
}
function lookup(points, day, forward = false) {
  let lo = 0,
    hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date < day) lo = mid + 1;
    else hi = mid;
  }
  const point = forward
    ? points[lo]
    : points[lo]?.date === day
      ? points[lo]
      : points[lo - 1];
  return point &&
    Math.abs(time(point.date) - time(day)) <= (forward ? 4 : 7) * DAY
    ? point
    : null;
}
function reconstruct(rows, marks, fraction) {
  const ledger = createReturnLedger(fraction);
  for (const row of rows) ledger.apply(row);
  return ledger.summary((symbol) => marks.get(symbol)?.close);
}
export function estimateReturns(rows, histories, career, now = Date.now()) {
  const through = returnCutoff(career, now),
    prepared = prepareReturns(rows, through),
    excluded = [...prepared.excluded],
    marks = new Map(),
    blocked = new Set(),
    priced = [];
  for (const r of prepared.eligible) {
    const h = histories.get(r.ticker),
      points = h?.currency === "USD" ? h.points : [],
      execution = lookup(points || [], r.traded, true),
      mark = lookup(points || [], through);
    if (h && !issuerMatches(r, h)) {
      blocked.add(bucket(r));
      excluded.push({ id: r.id, ticker: r.ticker, reason: "identity" });
    } else if (!execution || !mark || execution.date > mark.date) {
      blocked.add(bucket(r));
      excluded.push({ id: r.id, ticker: r.ticker, reason: "price" });
    } else {
      priced.push({ ...r, price: execution.close, priceDate: execution.date });
      marks.set(r.ticker, mark);
    }
  }
  const eligible = priced
    .filter((r) => {
      if (!blocked.has(bucket(r))) return true;
      excluded.push({ id: r.id, ticker: r.ticker, reason: "incomplete" });
      return false;
    })
    .sort(
      (a, b) =>
        a.traded.localeCompare(b.traded) ||
        (a.side === b.side
          ? a.id.localeCompare(b.id)
          : a.side === "sell"
            ? -1
            : 1),
    );
  const from = eligible.find((r) => r.side === "buy")?.traded || null;
  const priceDates = [
    ...new Set(eligible.map((r) => marks.get(r.ticker).date)),
  ].sort();
  const asOf = priceDates.at(-1) || through;
  const days = from ? Math.max(0, (time(asOf) - time(from)) / DAY) : 0;
  const salary =
    Number.isFinite(career.salary?.annual) && career.salary.annual > 0 && from
      ? {
          ...career.salary,
          total: round((career.salary.annual * days) / 365.2425),
          days,
          basis: "constant_rate_benchmark",
        }
      : null;
  const variants = Object.fromEntries(
    [
      ["low", 0],
      ["mid", 0.5],
      ["high", 1],
    ].map(([name, f]) => [name, reconstruct(eligible, marks, f)]),
  );
  const reasons = Object.entries(returnReasons)
    .map(([key, label]) => ({
      key,
      label,
      count: excluded.filter((r) => r.reason === key).length,
    }))
    .filter((r) => r.count);
  return {
    modelVersion: RETURN_MODEL_VERSION,
    label: "Estimate",
    currency: "USD",
    from,
    through: asOf,
    requestedThrough: through,
    computedAt: now,
    performance: buildPoliticalPerformance(eligible, histories, career.salary, {
      from,
      through: asOf,
    }),
    salary,
    variants,
    available: Boolean(from),
    coverage: {
      total: rows.length,
      modeled: eligible.length,
      purchases: eligible.filter((r) => r.side === "buy").length,
      assets: variants.mid.assets.length,
      excluded: excluded.length,
      reasons,
      owners: [...new Set(eligible.map((r) => r.owner || "Unspecified"))],
      shiftedDates: eligible.filter((r) => r.priceDate !== r.traded).length,
      priceFrom: priceDates[0] || null,
      priceThrough: priceDates.at(-1) || null,
    },
    sources: [
      {
        label: "Daily prices · Yahoo Finance",
        url: "https://finance.yahoo.com/",
      },
      {
        label: "Disclosure rules · House Ethics",
        url: "https://ethics.house.gov/financial-disclosure/",
      },
    ],
  };
}
