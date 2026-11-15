import congress from "./catalog/congress.json" with { type: "json" };
import executiveRoles from "./catalog/executive-roles.json" with { type: "json" };
export const SALARY_SOURCE =
  "https://uscode.house.gov/us/usc/119-136/t5/s5332/";
export function careerProfile(person, rows, now = Date.now()) {
  const meta = congress[person.bioguide],
    today = new Date(now).toISOString().slice(0, 10),
    year = today.slice(0, 4);
  const terms = meta?.terms || [],
    last = terms.at(-1),
    active = terms.some((t) => t.start <= today && t.end >= today);
  const salaryDate = active ? today : last?.end;
  const role = (meta?.leadership || []).findLast(
    (r) => r.start <= salaryDate && (!r.end || r.end >= salaryDate),
  );
  const speaker = /speaker/i.test(role?.title || ""),
    leader = /majority leader|minority leader|president pro tempore/i.test(
      role?.title || "",
    );
  let salary = last
    ? {
        annual: speaker ? 223500 : leader ? 193400 : 174000,
        currency: "USD",
        role: speaker
          ? "Speaker"
          : leader
            ? role.title
            : last.type === "sen"
              ? "Senator"
              : "Representative",
        year: active ? Number(year) : Number(last.end.slice(0, 4)),
        active,
        source: SALARY_SOURCE,
      }
    : null;
  const executive = executiveRoles[person.id];
  if (executive) {
    const rates = {
      "Level I": 253100,
      "Level II": 228000,
      "Level III": 209600,
      "Level IV": 197200,
      "Level V": 184900,
    };
    const president = person.id === "oge_donald_trump";
    salary = {
      annual: president ? 400000 : rates[executive.level],
      currency: "USD",
      role: executive.office,
      year: 2026,
      basis: "role_benchmark",
      active: null,
      source: president
        ? "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title3-section102&num=0&edition=prelim"
        : SALARY_SOURCE,
    };
  }
  const aggregate = (side, subset) => {
    const r = subset.filter((r) => r.side === side);
    return {
      count: r.length,
      low: r.reduce((n, r) => n + (r.low || 0), 0),
      high: r.every((r) => r.high !== null)
        ? r.reduce((n, r) => n + r.high, 0)
        : null,
      known: r.filter((r) => r.low !== null).length,
    };
  };
  const dates = rows.map((r) => r.traded).sort(),
    annualRows = rows.filter((r) => r.traded.startsWith(year));
  return {
    salary,
    service: terms.length
      ? {
          from: terms[0].start,
          through: active ? null : last.end,
          source: "https://bioguide.congress.gov/search/bio/" + person.bioguide,
        }
      : null,
    history: {
      from: dates[0] || null,
      through: dates.at(-1) || null,
      buys: aggregate("buy", rows),
      sells: aggregate("sell", rows),
    },
    annual: {
      year: Number(year),
      buys: aggregate("buy", annualRows),
      sells: aggregate("sell", annualRows),
    },
    gains: {
      value: null,
      status: "not_disclosed",
      reason:
        "Transaction reports do not provide complete holdings, cost basis or lifetime realized gains. Reported sales are proceeds, not profit.",
    },
  };
}
export function congressIdentity(bioguide, filed) {
  const m = congress[bioguide];
  if (!m) return null;
  const t =
    m.terms.findLast((t) => t.start <= filed && t.end >= filed) ||
    m.terms.at(-1);
  return {
    state: t.state,
    party:
      { Democrat: "D", Republican: "R", Independent: "I" }[t.party] || null,
  };
}
