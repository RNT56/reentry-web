import { fail } from "../platform/util.js";
import { portfolioAssets } from "../intelligence/portfolio-sources.js";
import { ownedList } from "../watchlists/store.js";
import { featuredPeople, politicalPeople } from "./people.js";
import { careerProfile } from "./career.js";

export function feedStatus(data) {
  return Object.fromEntries(
    [
      "coverage",
      "sources",
      "historyStatus",
      "status",
      "fetchedAt",
      "publishedAt",
      "version",
      "checkedAt",
      "attemptedAt",
      "nextCheckAt",
      "checkIntervalMs",
      "refreshing",
    ].map((key) => [key, data[key] ?? null]),
  );
}

export function summarizeDisclosures(rows) {
  const members = new Map(),
    assets = new Map(),
    days = new Map();
  let buys = 0,
    sells = 0;
  for (const r of rows) {
    buys += Number(r.side === "buy");
    sells += Number(r.side === "sell");
    const p = members.get(r.memberId) || {
      id: r.memberId,
      name: r.member,
      portrait: r.portrait,
      party: r.party,
      state: r.state,
      chamber: r.chamber,
      office: r.office,
      count: 0,
      buys: 0,
      sells: 0,
    };
    p.count++;
    p.buys += Number(r.side === "buy");
    p.sells += Number(r.side === "sell");
    members.set(p.id, p);
    if (r.ticker) {
      const a = assets.get(r.ticker) || {
        symbol: r.ticker,
        name: r.asset,
        count: 0,
        buys: 0,
        sells: 0,
        members: new Set(),
      };
      a.count++;
      a.buys += Number(r.side === "buy");
      a.sells += Number(r.side === "sell");
      a.members.add(r.memberId);
      assets.set(r.ticker, a);
    }
    const key = r.filed.slice(0, 7),
      d = days.get(key) || { date: key, buys: 0, sells: 0, other: 0 };
    d[r.side === "buy" ? "buys" : r.side === "sell" ? "sells" : "other"]++;
    days.set(key, d);
  }
  const delays = rows.map((r) => r.lag).sort((a, b) => a - b);
  const middle = Math.floor(delays.length / 2);
  return {
    count: rows.length,
    buys,
    sells,
    people: members.size,
    assets: assets.size,
    medianLag: delays.length
      ? delays.length % 2
        ? delays[middle]
        : (delays[middle - 1] + delays[middle]) / 2
      : null,
    members: [...members.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    ),
    tickers: [...assets.values()]
      .map((a) => ({ ...a, members: a.members.size }))
      .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol)),
    flow: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
export function filterDisclosures(
  rows,
  query = {},
  symbols = null,
  now = Date.now(),
) {
  const days = Number(query.days ?? 90);
  if (![30, 90, 365, 0].includes(days)) throw fail("Invalid date window.");
  const q = String(query.q || "")
    .trim()
    .toLowerCase();
  if (q.length > 100) throw fail("Search is too long.");
  if (
    query.chamber &&
    !["house", "senate", "executive", "all"].includes(query.chamber)
  )
    throw fail("Invalid chamber.");
  if (query.side && !["buy", "sell", "exchange", "all"].includes(query.side))
    throw fail("Invalid transaction filter.");
  const since = days
    ? new Date(now - days * 86400000).toISOString().slice(0, 10)
    : "2012-01-01";
  return rows.filter(
    (r) =>
      r.filed >= since &&
      (!query.chamber ||
        query.chamber === "all" ||
        r.chamber === query.chamber) &&
      (!query.side || query.side === "all" || r.side === query.side) &&
      (!query.member || r.memberId === query.member) &&
      (!query.ticker || r.ticker === query.ticker) &&
      (!symbols || symbols.has(r.ticker)) &&
      (!q ||
        [r.member, r.asset, r.ticker || "", r.state].some((v) =>
          v.toLowerCase().includes(q),
        )),
  );
}
export function registerPoliticalRoutes(
  app,
  { db, politics, politicalReturns },
) {
  const auth = { preHandler: app.requireUser };
  app.get("/api/politics/status", auth, async () =>
    feedStatus(await politics.get()),
  );
  app.get("/api/politics/returns", auth, async (req) => {
    if (typeof req.query.member !== "string" || req.query.member.length > 100)
      throw fail("Choose a person.");
    const data = await politics.get(),
      id = data.aliases?.[req.query.member] || req.query.member,
      person = data.people?.find((p) => p.id === id);
    if (!person) throw fail("Person not found.", 404);
    return politicalReturns.get(person, data.rows);
  });
  app.post("/api/politics/refresh", auth, async () =>
    feedStatus(await politics.get({ force: true })),
  );
  app.get("/api/politics/people", auth, async () => {
    const data = await politics.get();
    return {
      people: data.people || politicalPeople([], data.rows),
      ...feedStatus(data),
    };
  });
  app.get("/api/politics", { preHandler: app.requireUser }, async (req) => {
    const user = req.auth.user_id,
      q = { ...req.query },
      scope = String(q.scope || "all");
    let symbols = null;
    if (scope === "portfolio")
      symbols = new Set(portfolioAssets(db, user).map((a) => a.symbol));
    else if (scope.startsWith("list:"))
      symbols = new Set(ownedList(db, user, scope.slice(5)).symbols);
    else if (scope !== "all") throw fail("Invalid disclosure scope.");
    const data = await politics.get();
    if (q.version && q.version !== data.version)
      throw fail("Disclosures updated. Refresh this view.", 409);
    if (q.member && data.aliases?.[q.member]) q.member = data.aliases[q.member];
    const rows = filterDisclosures(data.rows, q, symbols),
      summary = summarizeDisclosures(rows);
    const offset = Number(q.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 500000)
      throw fail("Invalid page.");
    const member = q.member
      ? (data.people || politicalPeople([], data.rows)).find(
          (p) => p.id === q.member,
        )
      : null;
    return {
      rows: rows.slice(offset, offset + 50),
      nextOffset: offset + 50 < rows.length ? offset + 50 : null,
      summary: {
        ...summary,
        members: matchingPeople(data.people || [], summary.members, q),
        tickers: summary.tickers.slice(0, 10),
      },
      member,
      career: member
        ? careerProfile(
            member,
            data.rows.filter((r) => r.memberId === member.id),
          )
        : null,
      power: q.ticker
        ? powerStruggle(
            filterDisclosures(
              data.rows,
              { ...q, member: "", side: "all", q: "" },
              symbols,
            ),
          )
        : null,
      ...feedStatus(data),
      rejected: data.rejected || 0,
    };
  });
}

export function matchingPeople(directory, active, query) {
  const result = [...active],
    ids = new Set(active.map((p) => p.id)),
    q = String(query.q || "").toLowerCase();
  if (
    (!query.scope || query.scope === "all") &&
    !query.ticker &&
    (!query.side || query.side === "all")
  )
    for (const p of directory)
      if (
        !ids.has(p.id) &&
        (!query.chamber ||
          query.chamber === "all" ||
          p.chamber === query.chamber) &&
        (!q || [p.name, p.state].some((v) => v?.toLowerCase().includes(q)))
      )
        result.push({ ...p, count: 0, buys: 0, sells: 0 });
  return featuredPeople(result, result.length);
}
export function powerStruggle(rows) {
  const s = summarizeDisclosures(rows);
  const buyers = s.members
    .filter((p) => p.buys)
    .sort((a, b) => b.buys - a.buys || a.name.localeCompare(b.name));
  const sellers = s.members
    .filter((p) => p.sells)
    .sort((a, b) => b.sells - a.sells || a.name.localeCompare(b.name));
  return {
    buyers,
    sellers,
    buyDisclosures: s.buys,
    sellDisclosures: s.sells,
    both: s.members.filter((p) => p.buys && p.sells).length,
    other: s.count - s.buys - s.sells,
    people: s.people,
  };
}
