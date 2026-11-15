import { createHash } from "node:crypto";

export const POLITICAL_SOURCE =
  "https://github.com/kadoa-org/congress-trading-monitor";
const BASE =
  "https://raw.githubusercontent.com/kadoa-org/congress-trading-monitor/";
const OFFICIAL = new Set([
  "disclosures-clerk.house.gov",
  "efdsearch.senate.gov",
  "extapps2.oge.gov",
  "www.oge.gov",
]);
const string = (v, n = 200) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
function date(v, now) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) &&
    new Date(t).toISOString().slice(0, 10) === v &&
    t <= now + 86400000 &&
    v >= "2012-01-01"
    ? v
    : null;
}
function officialURL(v) {
  try {
    const u = new URL(v);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      OFFICIAL.has(u.hostname) &&
      v.length < 2000
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function portraitURL(value) {
  const match = String(value || "").match(
    /^https:\/\/unitedstates\.github\.io\/images\/congress\/(?:225x275|450x550)\/([A-Z]\d{6})\.jpg$/,
  );
  return match
    ? `https://unitedstates.github.io/images/congress/225x275/${match[1]}.jpg`
    : null;
}
export function normalizePoliticalFeed(
  trades,
  filers,
  { now = Date.now() } = {},
) {
  if (
    !Array.isArray(trades) ||
    !trades.length ||
    trades.length > 20000 ||
    !Array.isArray(filers) ||
    filers.length > 5000
  )
    throw Error("Invalid disclosure feed");
  const people = new Map(
    filers.filter((f) => f && typeof f.id === "string").map((f) => [f.id, f]),
  );
  const seen = new Set(),
    rows = [];
  let rejected = 0;
  for (const r of trades) {
    if (!r || typeof r !== "object") {
      rejected++;
      continue;
    }
    const filed = date(r.filing_date, now),
      traded = date(r.transaction_date, now),
      url = officialURL(r.doc_url),
      person = people.get(r.filer_id),
      member = string(r.filer_name || person?.full_name);
    const rowId = string(r.id, 220),
      personId = string(r.filer_id, 160);
    if (
      !rowId ||
      !personId ||
      !member ||
      !url ||
      !filed ||
      !traded ||
      traded > filed ||
      !["house_clerk", "senate_efd", "oge_executive"].includes(r.source_id)
    ) {
      rejected++;
      continue;
    }
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    const low =
      Number.isFinite(r.amount_range_low) && r.amount_range_low >= 0
        ? r.amount_range_low
        : null;
    const high =
      Number.isFinite(r.amount_range_high) && r.amount_range_high >= 0
        ? r.amount_range_high
        : null;
    if (low !== null && high !== null && high < low) {
      rejected++;
      continue;
    }
    const ticker =
      typeof r.ticker === "string" &&
      /^[A-Z0-9.^=-]{1,20}$/.test(r.ticker) &&
      !["N/A", "NA", "NONE", "UNKNOWN"].includes(r.ticker)
        ? r.ticker
        : null;
    const type = string(r.transaction_type, 60),
      side = /^purchase$/i.test(type)
        ? "buy"
        : /^sale/i.test(type)
          ? "sell"
          : /^exchange$/i.test(type)
            ? "exchange"
            : "other";
    rows.push({
      id: rowId,
      memberId: personId,
      member,
      portrait: portraitURL(person?.photo_url),
      party: ["R", "D", "I"].includes(r.party) ? r.party : null,
      state: string(r.state, 3),
      chamber:
        r.source_id === "house_clerk"
          ? "house"
          : r.source_id === "senate_efd"
            ? "senate"
            : "executive",
      office: string(r.office || person?.office),
      ticker,
      asset: string(r.asset_name, 300),
      assetType: string(r.asset_type, 80) || null,
      side,
      type,
      owner: string(r.owner, 80) || "Unspecified",
      low,
      high,
      amount: string(r.amount_range_label, 80) || null,
      filed,
      traded,
      lag: Math.round((Date.parse(filed) - Date.parse(traded)) / 86400000),
      url,
      comment: string(r.comment, 1200) || null,
    });
  }
  if (!rows.length || rejected > trades.length * 0.2)
    throw Error("Disclosure feed failed validation");
  rows.sort(
    (a, b) =>
      b.filed.localeCompare(a.filed) ||
      b.traded.localeCompare(a.traded) ||
      a.id.localeCompare(b.id),
  );
  return {
    rows,
    rejected,
    coverage: {
      from: rows.at(-1).filed,
      through: rows[0].filed,
      rows: rows.length,
      window: "Published feed window",
      source: POLITICAL_SOURCE,
    },
  };
}
async function json(fetcher, url, signal, limit = 12000000) {
  const r = await fetcher(url, {
    signal,
    redirect: "error",
    headers: {
      Accept: "application/json",
      "User-Agent": "Reentry public-disclosure research",
    },
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw Error("Disclosure source unavailable");
  }
  const reader = r.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error("Disclosure response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function createPoliticalFeed({
  db,
  fetcher = fetch,
  now = Date.now,
  enabled = false,
} = {}) {
  let cached = null,
    inflight = null,
    timer = null,
    controller = null,
    lastAttempt = 0,
    lastError = null,
    stopped = false;
  const stored = db
    .prepare("SELECT * FROM political_feed WHERE id='kadoa'")
    .get();
  if (stored)
    try {
      cached = {
        ...JSON.parse(stored.payload),
        fetchedAt: stored.fetched_at,
        version: stored.version,
      };
    } catch {
      /* Invalid cache is replaced only after a validated fetch. */
    }
  const due = () => !cached || now() - cached.fetchedAt > 6 * 3600000;
  function refresh() {
    if (inflight) return inflight;
    if (stopped) return Promise.resolve();
    controller = new AbortController();
    lastAttempt = now();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(25000),
    ]);
    inflight = (async () => {
      // Pin both files to one revision, so a publish cannot mix identities and trades.
      const commits = await json(
        fetcher,
        "https://api.github.com/repos/kadoa-org/congress-trading-monitor/commits?path=public/data&per_page=1",
        signal,
        100000,
      );
      const sha = commits?.[0]?.sha;
      if (!/^[a-f0-9]{40}$/.test(sha || ""))
        throw Error("Invalid disclosure revision");
      const [trades, people] = await Promise.all(
        ["trades", "filers"].map((name) =>
          json(fetcher, BASE + sha + "/public/data/" + name + ".json", signal),
        ),
      );
      const payload = normalizePoliticalFeed(trades, people, { now: now() });
      payload.publishedAt = commits[0].commit?.committer?.date || null;
      const encoded = JSON.stringify(payload),
        version =
          sha +
          ":" +
          createHash("sha256").update(encoded).digest("hex").slice(0, 16);
      if (stopped) return;
      db.prepare(
        "INSERT INTO political_feed(id,payload,fetched_at,version) VALUES('kadoa',?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,version=excluded.version",
      ).run(encoded, now(), version);
      cached = { ...payload, version, fetchedAt: now() };
      lastError = null;
    })()
      .catch((e) => {
        lastError = "Source temporarily unavailable";
        if (!cached) throw e;
      })
      .finally(() => {
        inflight = null;
        controller = null;
      });
    return inflight;
  }
  async function get() {
    if (!cached && now() - lastAttempt > 60000) await refresh().catch(() => {});
    else if (due() && now() - lastAttempt > 60000)
      void refresh().catch(() => {});
    return {
      ...(cached || { rows: [], coverage: null, fetchedAt: null }),
      status: !cached
        ? "unavailable"
        : lastError
          ? "cached"
          : now() - Date.parse(cached.coverage.through) > 7 * 86400000
            ? "delayed"
            : "available",
      refreshing: !!inflight,
    };
  }
  return {
    get,
    refresh,
    async evidence(asset) {
      const data = await get();
      if (!data.coverage) throw Error("Disclosure feed unavailable");
      return data.rows
        .filter((r) => r.ticker === asset.symbol)
        .slice(0, 8)
        .map((r) => ({
          kind: "filing",
          title: `${r.member} · ${r.type} · ${r.ticker}`,
          url: r.url,
          published_at: Date.parse(r.filed),
          content: JSON.stringify({
            source: "Kadoa / official political disclosure",
            member: r.member,
            chamber: r.chamber,
            owner: r.owner,
            asset: r.asset,
            ticker: r.ticker,
            transactionType: r.type,
            transactionDate: r.traded,
            filingDate: r.filed,
            reportingDelayDays: r.lag,
            reportedAmountUSD: { low: r.low, high: r.high, label: r.amount },
            comment: r.comment,
            coverage: data.coverage,
            status: data.status,
            note: "Reported value band, not an exact transaction value or execution price. Filing date is not a verified first-publication time. Feed covers a rolling subset; absence does not establish no trades. A disclosure is not evidence of insider knowledge or a forecast.",
          }),
        }));
    },
    start() {
      if (!enabled || timer || stopped) return;
      timer = setInterval(() => {
        if (due()) void refresh().catch(() => {});
      }, 6 * 3600000);
      timer.unref?.();
      void refresh().catch(() => {});
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      controller?.abort();
      await inflight?.catch(() => {});
    },
  };
}
