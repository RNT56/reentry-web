import { createHash } from "node:crypto";
import { fail, symbol, transaction } from "../platform/util.js";

const MAX_ASSETS = 2050;
const canonical = (symbols) => [...symbols].sort();
const fingerprint = (symbols) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(symbols)))
    .digest("hex");
const same = (left, right) =>
  left.length === right.length &&
  left.every((symbol, index) => symbol === right[index]);

/** Adds preference storage without rewriting any existing durable rows. */
export function initializeResearchOrder(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS research_asset_order(
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    symbols TEXT NOT NULL,visible_hash TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>=0),updated_at INTEGER NOT NULL);`);
}

function current(db, user, visible) {
  const row = db
    .prepare(
      "SELECT symbols,visible_hash,revision FROM research_asset_order WHERE user_id=?",
    )
    .get(user);
  const visibleSet = new Set(visible);
  const stored = row ? JSON.parse(row.symbols) : [];
  const ranked = stored.filter((symbol) => visibleSet.has(symbol));
  const rankedSet = new Set(ranked);
  const symbols = [
    ...ranked,
    ...canonical(visible.filter((symbol) => !rankedSet.has(symbol))),
  ];
  const hash = fingerprint(visible);
  return {
    row,
    symbols,
    hash,
    revision: row?.revision || 0,
    membershipChanged: !!row && row.visible_hash !== hash,
  };
}

/** Reads reconcile membership so stale tabs receive a new integer revision. */
export function readResearchOrder(db, user, visible) {
  return transaction(db, () => {
    const order = current(db, user, visible);
    const revision = order.revision + Number(order.membershipChanged);
    if (!order.row || order.membershipChanged) {
      db.prepare(
        "INSERT INTO research_asset_order(user_id,symbols,visible_hash,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET symbols=excluded.symbols,visible_hash=excluded.visible_hash,revision=excluded.revision,updated_at=excluded.updated_at",
      ).run(
        user,
        JSON.stringify(order.symbols),
        order.hash,
        revision,
        Date.now(),
      );
    }
    return { symbols: order.symbols, revision };
  });
}

export function writeResearchOrder(db, user, body, visibleSymbols) {
  if (!Array.isArray(body.symbols) || body.symbols.length > MAX_ASSETS)
    throw fail("Choose a valid research asset order.");
  const symbols = body.symbols.map(symbol);
  if (new Set(symbols).size !== symbols.length)
    throw fail("Research assets cannot appear twice.");
  if (!Number.isSafeInteger(body.revision) || body.revision < 0)
    throw fail("Invalid research order revision.");
  return transaction(db, () => {
    const visible = visibleSymbols();
    const order = current(db, user, visible);
    if (
      body.revision !== order.revision ||
      order.membershipChanged ||
      !same(canonical(symbols), canonical(visible))
    )
      throw fail(
        "Your research list changed. Reload it before reordering.",
        409,
      );
    const changed = !same(order.symbols, symbols);
    const revision = order.revision + Number(changed);
    if (!order.row || changed) {
      const updated = db
        .prepare(
          "INSERT INTO research_asset_order(user_id,symbols,visible_hash,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET symbols=excluded.symbols,visible_hash=excluded.visible_hash,revision=excluded.revision,updated_at=excluded.updated_at WHERE research_asset_order.revision=?",
        )
        .run(
          user,
          JSON.stringify(symbols),
          order.hash,
          revision,
          Date.now(),
          body.revision,
        );
      if (!updated.changes)
        throw fail(
          "Your research order changed in another tab. Reload it before reordering.",
          409,
        );
    }
    return { symbols, revision };
  });
}
