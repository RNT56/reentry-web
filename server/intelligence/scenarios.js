import { id, fail } from "../platform/util.js";
import { evaluateBranch } from "../../src/domain/scenarios.js";
import { currencyUnit } from "../../src/domain/currency.js";
import { observeChartPrices } from "./chart-observations.js";
export function createSet(
  db,
  user,
  symbol,
  title,
  branches,
  provenance = null,
  now = Date.now(),
) {
  const set = id();
  db.prepare(
    "INSERT INTO scenario_sets(id,user_id,symbol,title,branches,provenance,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    set,
    user,
    symbol,
    title,
    JSON.stringify(branches),
    provenance ? JSON.stringify(provenance) : null,
    now,
    now,
  );
  return set;
}
export function setView(db, row, asOf = Date.now()) {
  // Retraction history is append-only in the audit ledger. Replays use knowledge at asOf.
  const retractions = new Map();
  for (const r of db
    .prepare(
      "SELECT details,created_at FROM ai_audit WHERE user_id=? AND action='event-retracted' AND json_extract(details,'$.setId')=? ORDER BY created_at DESC",
    )
    .all(row.user_id, row.id))
    retractions.set(JSON.parse(r.details).eventId, r.created_at);
  const observation = (o) => ({
    id: o.id,
    asset: row.symbol,
    kind: o.kind,
    key: o.event_key,
    value: o.value,
    currency: o.currency,
    verified: !!o.verified || (retractions.get(o.id) || 0) > asOf,
    source: o.source_title,
    url: o.source_url,
    occurredAt: o.occurred_at,
    recordedAt: o.recorded_at,
  });
  const events = db
    .prepare(
      "SELECT * FROM scenario_observations WHERE set_id=? AND kind='event' AND recorded_at<=? ORDER BY occurred_at,id",
    )
    .all(row.id, asOf)
    .map(observation);
  const recent = db
    .prepare(
      "SELECT * FROM scenario_observations WHERE set_id=? AND kind='price' AND recorded_at<=? ORDER BY occurred_at DESC LIMIT 30",
    )
    .all(row.id, asOf)
    .map(observation);
  const matches = [];
  // Fetch the first qualifying quote for each branch rather than truncating away old hits.
  const branches = JSON.parse(row.branches).map((b) => {
    const deadline = row.created_at + b.horizonDays * 86400000;
    const condition = events.find(
      (o) =>
        o.key === b.eventKey &&
        o.verified &&
        o.occurredAt >= row.created_at &&
        o.occurredAt <= Math.min(asOf, deadline),
    );
    if (condition) {
      const hit = db
        .prepare(
          "SELECT * FROM scenario_observations WHERE set_id=? AND kind='price' AND verified=1 AND currency=? AND value>=? AND value<=? AND occurred_at>=? AND occurred_at<=? AND recorded_at<=? ORDER BY occurred_at LIMIT 1",
        )
        .get(
          row.id,
          b.currency,
          b.low,
          b.high,
          condition.occurredAt,
          Math.min(asOf, deadline),
          asOf,
        );
      if (hit) matches.push(observation(hit));
    }
    return {
      ...b,
      status: evaluateBranch(
        {
          asset: row.symbol,
          publishedAt: row.created_at,
          deadline,
          requires: [b.eventKey],
          invalidatedBy: [b.eventKey + "-invalidated"],
          target: [b.low, b.high],
          currency: b.currency,
        },
        [...events, ...matches],
        asOf,
      ),
    };
  });
  const observations = [...events, ...matches, ...recent]
    .filter((o, i, a) => a.findIndex((x) => x.id === o.id) === i)
    .sort((a, b) => b.recordedAt - a.recordedAt);
  const prices = db
    .prepare(
      "SELECT COUNT(*) AS n FROM scenario_observations WHERE set_id=? AND kind='price' AND recorded_at<=?",
    )
    .get(row.id, asOf).n;
  return {
    id: row.id,
    symbol: row.symbol,
    title: row.title,
    branches,
    provenance: row.provenance ? JSON.parse(row.provenance) : null,
    createdAt: row.created_at,
    lastCheck: row.last_check,
    observations,
    counts: { prices, events: events.filter((o) => o.verified).length },
  };
}
export async function observePrice(db, market, row, now = Date.now()) {
  const provenance = row.provenance ? JSON.parse(row.provenance) : null;
  if (provenance?.kind === "ai-chart")
    return observeChartPrices(db, market, row, now);
  const q = await market.quote(row.symbol),
    [currency, unit] = currencyUnit(q.originalCurrency || q.currency),
    value = (q.originalPrice || q.price) * unit,
    occurred = q.time * 1000;
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isFinite(occurred) ||
    occurred > now + 60000 ||
    occurred < row.created_at ||
    !/^[A-Z]{3}$/.test(currency)
  )
    return;
  db.prepare(
    "INSERT OR IGNORE INTO scenario_observations VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id(),
    row.id,
    "price",
    "quote",
    value,
    currency,
    1,
    q.source || "Yahoo Finance",
    `https://finance.yahoo.com/quote/${encodeURIComponent(row.symbol)}/`,
    occurred,
    now,
  );
  db.prepare("UPDATE scenario_sets SET last_check=? WHERE id=?").run(
    now,
    row.id,
  );
}
export function ownedSet(db, user, set) {
  const row = db
    .prepare("SELECT * FROM scenario_sets WHERE id=? AND user_id=?")
    .get(set, user);
  if (!row) throw fail("Scenario not found.", 404);
  return row;
}
