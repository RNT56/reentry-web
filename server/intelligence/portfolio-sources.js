import { collectSources } from "./sources.js";
import { transaction } from "../platform/util.js";
import {
  initializeResearchVisibility,
  researchHidden,
} from "./research-visibility.js";

const SIX_HOURS = 6 * 3600000;
const LEASE = 120000;
const validSymbol = /^[A-Za-z0-9.^=-]{1,32}$/;

export function portfolioAssets(db, user) {
  const row = db
    .prepare("SELECT data FROM portfolios WHERE user_id=?")
    .get(user);
  if (!row) return [];
  let holdings;
  try {
    holdings = JSON.parse(row.data).holdings;
  } catch {
    return [];
  }
  const assets = new Map();
  for (const holding of Array.isArray(holdings) ? holdings : []) {
    if (holding?.demo) continue;
    if (!validSymbol.test(holding?.symbol || "")) continue;
    const symbol = holding.symbol.toUpperCase();
    if (assets.has(symbol)) continue;
    assets.set(symbol, {
      symbol,
      name: String(holding.name || symbol).slice(0, 160),
      ...(holding.assetType ? { assetType: holding.assetType } : {}),
      ...(holding.isin ? { isin: holding.isin } : {}),
      inPortfolio: true,
    });
  }
  return [...assets.values()];
}

export function researchAsset(db, user, symbol) {
  if (researchHidden(db, user, symbol)) return null;
  return (
    db
      .prepare(
        "SELECT symbol,name FROM research_assets WHERE user_id=? AND symbol=?",
      )
      .get(user, symbol) ||
    portfolioAssets(db, user).find((asset) => asset.symbol === symbol)
  );
}

/** Independent additive table: startup never rewrites existing durable rows. */
export function createPortfolioSources({
  db,
  connectors,
  enabled = false,
  now = Date.now,
}) {
  initializeResearchVisibility(db);
  db.exec(`CREATE TABLE IF NOT EXISTS source_refresh_states(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,name TEXT NOT NULL,in_portfolio INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',updated_at INTEGER NOT NULL DEFAULT 0,
    next_run INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,
    last_attempt INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER NOT NULL DEFAULT 0,coverage TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY(user_id,symbol));
    CREATE INDEX IF NOT EXISTS source_refresh_queue ON source_refresh_states(in_portfolio,next_run,lease_until);`);
  let timer = null,
    running = null,
    stopped = false,
    cursor = "";
  const pending = new Map();
  const active = new Set();
  const ownerPending = new Map();
  const syncedRevisions = new Map();
  const waiters = [];
  let upstreamActive = 0;
  async function publicEvidence(asset) {
    if (upstreamActive >= 4)
      await new Promise((resolve) => waiters.push(resolve));
    else upstreamActive++;
    try {
      return await connectors.collect(asset);
    } finally {
      const next = waiters.shift();
      if (next) next();
      else upstreamActive--;
    }
  }
  // Only public connector evidence is shared in flight. Owner notes and stored
  // source rows are added by collectSources separately for each account.
  const shared = {
    collect(asset) {
      const key = JSON.stringify([asset.symbol, asset.name]);
      if (pending.has(key)) return pending.get(key);
      if (pending.size >= 12)
        return Promise.reject(Error("Source connectors are busy."));
      const promise = Promise.resolve()
        .then(() => publicEvidence(asset))
        .finally(() => pending.delete(key));
      pending.set(key, promise);
      return promise;
    },
  };
  function sync(user) {
    const revision = db
      .prepare("SELECT revision FROM portfolios WHERE user_id=?")
      .get(user)?.revision;
    const assets = portfolioAssets(db, user);
    if (revision !== undefined && syncedRevisions.get(user) === revision)
      return assets;
    transaction(db, () => {
      db.prepare(
        "UPDATE source_refresh_states SET in_portfolio=0 WHERE user_id=? AND in_portfolio=1",
      ).run(user);
      const put = db.prepare(
        "INSERT INTO source_refresh_states(user_id,symbol,name,in_portfolio) VALUES(?,?,?,1) ON CONFLICT(user_id,symbol) DO UPDATE SET name=excluded.name,in_portfolio=1",
      );
      for (const asset of assets) put.run(user, asset.symbol, asset.name);
    });
    if (revision !== undefined) {
      if (syncedRevisions.size >= 1000)
        syncedRevisions.delete(syncedRevisions.keys().next().value);
      syncedRevisions.set(user, revision);
    }
    return assets;
  }
  function state(user, symbol) {
    const row = db
      .prepare(
        "SELECT status,updated_at,next_run,coverage,lease_until FROM source_refresh_states WHERE user_id=? AND symbol=?",
      )
      .get(user, symbol);
    if (!row) return null;
    return {
      status:
        row.status === "collecting" && row.lease_until <= now()
          ? "pending"
          : row.status,
      updatedAt: row.updated_at || null,
      nextRefreshAt: row.next_run || null,
      coverage: JSON.parse(row.coverage),
    };
  }
  async function perform(user, asset) {
    const row = db
      .prepare(
        "SELECT * FROM source_refresh_states WHERE user_id=? AND symbol=?",
      )
      .get(user, asset.symbol);
    if (!row) return null;
    const lease = now() + LEASE;
    const claim = db
      .prepare(
        "UPDATE source_refresh_states SET status='collecting',lease_until=?,last_attempt=? WHERE user_id=? AND symbol=? AND lease_until<=?",
      )
      .run(lease, now(), user, asset.symbol, now());
    if (!claim.changes) return null;
    try {
      const result = await collectSources(db, shared, user, asset);
      const available = result.coverage.some((c) => c.status === "available");
      const unavailable = result.coverage.some(
        (c) => c.status === "unavailable",
      );
      const success = available || (!unavailable && result.coverage.length > 0);
      const failures = success ? 0 : row.failures + 1;
      const delay = success
        ? unavailable
          ? 1800000
          : SIX_HOURS
        : Math.min(SIX_HOURS, 300000 * 2 ** Math.min(failures - 1, 6));
      db.prepare(
        "UPDATE source_refresh_states SET status=?,updated_at=?,next_run=?,failures=?,lease_until=0,coverage=? WHERE user_id=? AND symbol=? AND lease_until=?",
      ).run(
        success ? (unavailable ? "partial" : "ready") : "retrying",
        success ? now() : row.updated_at,
        now() + delay,
        failures,
        JSON.stringify(result.coverage),
        user,
        asset.symbol,
        lease,
      );
      return { ...result, collection: state(user, asset.symbol) };
    } catch {
      const failures = row.failures + 1;
      db.prepare(
        "UPDATE source_refresh_states SET status='retrying',next_run=?,failures=?,lease_until=0 WHERE user_id=? AND symbol=? AND lease_until=?",
      ).run(
        now() + Math.min(SIX_HOURS, 300000 * 2 ** Math.min(failures - 1, 6)),
        failures,
        user,
        asset.symbol,
        lease,
      );
      return {
        sources: [],
        coverage: JSON.parse(row.coverage),
        collection: state(user, asset.symbol),
      };
    }
  }
  function track(promise) {
    active.add(promise);
    promise.finally(() => active.delete(promise)).catch(() => {});
    return promise;
  }
  function collect(user, asset) {
    if (stopped) return Promise.resolve(null);
    const key = JSON.stringify([user, asset.symbol]);
    if (ownerPending.has(key)) return ownerPending.get(key);
    db.prepare(
      "INSERT OR IGNORE INTO source_refresh_states(user_id,symbol,name) VALUES(?,?,?)",
    ).run(user, asset.symbol, asset.name);
    const promise = track(perform(user, asset)).finally(() =>
      ownerPending.delete(key),
    );
    ownerPending.set(key, promise);
    return promise;
  }
  async function tick() {
    if (stopped || running) return;
    running = (async () => {
      // Rotate through owners rather than holding every portfolio in memory.
      const owners = db
        .prepare(
          "SELECT user_id FROM portfolios WHERE user_id>? ORDER BY user_id LIMIT 25",
        )
        .all(cursor);
      for (const owner of owners) sync(owner.user_id);
      cursor = owners.length === 25 ? owners.at(-1).user_id : "";
      const due = db
        .prepare(
          "SELECT s.user_id,s.symbol,s.name FROM source_refresh_states s JOIN (SELECT user_id,MAX(last_attempt) AS serviced FROM source_refresh_states WHERE in_portfolio=1 GROUP BY user_id) owners ON owners.user_id=s.user_id WHERE s.in_portfolio=1 AND s.next_run<=? AND s.lease_until<=? ORDER BY owners.serviced,s.next_run,s.user_id,s.symbol LIMIT 2",
        )
        .all(now(), now());
      await Promise.all(
        due.map((row) => {
          // Recheck membership immediately before any network request.
          if (
            !portfolioAssets(db, row.user_id).some(
              (a) => a.symbol === row.symbol,
            )
          ) {
            db.prepare(
              "UPDATE source_refresh_states SET in_portfolio=0 WHERE user_id=? AND symbol=?",
            ).run(row.user_id, row.symbol);
            return null;
          }
          return collect(row.user_id, { symbol: row.symbol, name: row.name });
        }),
      );
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  }
  return {
    enabled,
    sync,
    state,
    collect,
    tick,
    start() {
      if (!enabled || timer || stopped) return;
      timer = setInterval(() => tick().catch(() => {}), 15000);
      timer.unref();
      void tick().catch(() => {});
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running?.catch(() => {});
      await Promise.allSettled([...active]);
    },
  };
}
