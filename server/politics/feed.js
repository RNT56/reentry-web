import { POLITICAL_CHECK_INTERVAL, applyPoliticalCadence } from "./schedule.js";
import { createHash } from "node:crypto";
import { politicalPeople } from "./people.js";
import { portraitURL } from "./portraits.js";
export { portraitURL } from "./portraits.js";

export { POLITICAL_CHECK_INTERVAL } from "./schedule.js";

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
  typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, n) : "";
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
      owner:
        { SP: "Spouse", JT: "Joint", DC: "Dependent child", SELF: "Self" }[
          r.owner
        ] ||
        string(r.owner, 80) ||
        "Unspecified",
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
    people: politicalPeople(filers, rows),
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
async function json(fetcher, url, signal, limit = 12000000, etag = null) {
  const r = await fetcher(url, {
    signal,
    redirect: "error",
    headers: {
      Accept: "application/json",
      "User-Agent": "Reentry public-disclosure research",
      ...(etag ? { "If-None-Match": etag } : {}),
    },
  });
  if (r.status === 304) return { unchanged: true, etag };
  if (!r.ok) {
    await r.body?.cancel();
    const error = Error("Disclosure source unavailable");
    if ([429, 403, 503].includes(r.status)) {
      const retry = r.headers.get("retry-after");
      error.retryAfter =
        retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : 0;
      error.retryAt = retry && !/^\d+$/.test(retry) ? Date.parse(retry) : 0;
      if (r.headers.get("x-ratelimit-remaining") === "0")
        error.retryAt = Number(r.headers.get("x-ratelimit-reset")) * 1000;
    }
    throw error;
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
  return {
    value: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    etag: r.headers.get("etag"),
  };
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
    started = false,
    stopped = false;
  const savedSync = db
    .prepare("SELECT * FROM political_sync WHERE id='kadoa'")
    .get();
  const sync = savedSync || {
    checked_at: null,
    attempted_at: null,
    next_check_at: 0,
    etag: null,
    failures: 0,
    last_error: null,
  };
  function saveSync() {
    db.prepare(
      "INSERT INTO political_sync(id,checked_at,attempted_at,next_check_at,etag,failures,last_error) VALUES('kadoa',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,attempted_at=excluded.attempted_at,next_check_at=excluded.next_check_at,etag=excluded.etag,failures=excluded.failures,last_error=excluded.last_error",
    ).run(
      sync.checked_at,
      sync.attempted_at,
      sync.next_check_at,
      sync.etag,
      sync.failures,
      sync.last_error,
    );
  }
  const stored = db
    .prepare("SELECT * FROM political_feed WHERE id='kadoa'")
    .get();
  if (stored)
    try {
      const payload = JSON.parse(stored.payload);
      if (
        Array.isArray(payload.rows) &&
        payload.rows.length &&
        payload.coverage
      )
        cached = {
          ...payload,
          fetchedAt: stored.fetched_at,
          version: stored.version,
        };
    } catch {
      /* Replace a corrupt cache only after a validated fetch. */
    }
  if (!cached || !cached.people) sync.etag = null;
  if (cached) applyPoliticalCadence(sync);
  const due = () => now() >= sync.next_check_at;
  function schedule() {
    if (!started || stopped) return;
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = null;
        if (due()) void refresh().catch(() => {});
        else schedule();
      },
      Math.max(1000, sync.next_check_at - now()),
    );
    timer.unref?.();
  }
  function refresh() {
    if (inflight) return inflight;
    if (stopped) return Promise.resolve();
    controller = new AbortController();
    sync.attempted_at = now();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(25000),
    ]);
    inflight = (async () => {
      const response = await json(
        fetcher,
        "https://api.github.com/repos/kadoa-org/congress-trading-monitor/commits?path=public/data&per_page=1",
        signal,
        100000,
        cached?.people ? sync.etag : null,
      );
      if (!response.unchanged) {
        const commits = response.value,
          sha = commits?.[0]?.sha;
        if (!/^[a-f0-9]{40}$/.test(sha || ""))
          throw Error("Invalid disclosure revision");
        // A successful unchanged revision check is fresh even when no new filings were published.
        if (!cached?.people || cached.version.split(":")[0] !== sha) {
          const [trades, people] = await Promise.all(
            ["trades", "filers"].map(
              async (name) =>
                (
                  await json(
                    fetcher,
                    BASE + sha + "/public/data/" + name + ".json",
                    signal,
                  )
                ).value,
            ),
          );
          const payload = normalizePoliticalFeed(trades, people, {
            now: now(),
          });
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
        }
        sync.etag = response.etag;
      } else if (!cached) throw Error("No cached disclosure snapshot");
      if (stopped) return;
      Object.assign(sync, {
        checked_at: now(),
        next_check_at: now() + POLITICAL_CHECK_INTERVAL,
        failures: 0,
        last_error: null,
      });
      saveSync();
    })()
      .catch((e) => {
        if (stopped) return;
        sync.failures++;
        const backoff = Math.min(
          3600000,
          60000 * 2 ** Math.min(sync.failures - 1, 6),
        );
        const requested = Math.max(
          e.retryAfter || 0,
          Number.isFinite(e.retryAt) ? e.retryAt - now() : 0,
        );
        sync.next_check_at =
          now() + Math.max(backoff, Math.min(86400000, requested));
        sync.last_error = "Source temporarily unavailable";
        saveSync();
        if (!cached) throw e;
      })
      .finally(() => {
        inflight = null;
        controller = null;
        schedule();
      });
    return inflight;
  }
  async function get({ force = false } = {}) {
    // A single shared schedule governs workers, page loads and manual refreshes.
    // Failed requests retain their backoff even when many clients reconnect.
    const manualDue =
      force && !sync.failures && now() - (sync.attempted_at || 0) >= 60000;
    if (due() || manualDue) {
      const pending = refresh().catch(() => {});
      if (!cached || force) await pending;
    } else if (!cached && inflight) await inflight.catch(() => {});
    const oldCheck =
      !sync.checked_at ||
      now() - sync.checked_at > 2 * POLITICAL_CHECK_INTERVAL;
    const oldPublication =
      cached?.publishedAt &&
      now() - Date.parse(cached.publishedAt) > 72 * 3600000;
    return {
      ...(cached || { rows: [], people: [], coverage: null, fetchedAt: null }),
      checkedAt: sync.checked_at,
      attemptedAt: sync.attempted_at,
      nextCheckAt: sync.next_check_at,
      checkIntervalMs: POLITICAL_CHECK_INTERVAL,
      status: !cached
        ? "unavailable"
        : sync.last_error
          ? "cached"
          : oldCheck
            ? "stale"
            : oldPublication ||
                now() - Date.parse(cached.coverage.through) > 7 * 86400000
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
      if (!enabled || started || stopped) return;
      started = true;
      if (due()) void refresh().catch(() => {});
      else schedule();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      await inflight?.catch(() => {});
    },
  };
}
