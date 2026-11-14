import { createHash } from "node:crypto";
import { id } from "../platform/util.js";
export function putSource(db, user, symbol, s) {
  const hash = createHash("sha256")
    .update(JSON.stringify([s.kind, s.url, s.title, s.content, s.published_at]))
    .digest("hex");
  db.prepare(
    "INSERT OR IGNORE INTO research_sources VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id(),
    user,
    symbol,
    s.kind,
    s.title,
    s.url || null,
    s.content,
    hash,
    s.published_at || null,
    Date.now(),
    s.connector,
  );
  return db
    .prepare(
      "SELECT * FROM research_sources WHERE user_id=? AND symbol=? AND hash=?",
    )
    .get(user, symbol, hash);
}
export async function collectSources(db, connectors, user, asset) {
  const result = await connectors.collect(asset);
  const fresh = result.sources.map((s) => putSource(db, user, asset.symbol, s));
  const notes = db
    .prepare(
      "SELECT * FROM research_sources WHERE user_id=? AND symbol=? AND connector='manual' ORDER BY fetched_at DESC LIMIT 3",
    )
    .all(user, asset.symbol);
  // Keep raw source history bounded; job snapshots retain the evidence used by each run.
  db.prepare(
    "DELETE FROM research_sources WHERE user_id=? AND symbol=? AND connector!='manual' AND id NOT IN (SELECT id FROM research_sources WHERE user_id=? AND symbol=? ORDER BY fetched_at DESC LIMIT 100)",
  ).run(user, asset.symbol, user, asset.symbol);
  return {
    sources: [
      ...notes,
      ...fresh.sort(
        (a, b) =>
          (({
            fundamentals: 0,
            filing: 1,
            quote: 2,
            technical: 3,
            macro: 4,
            headline: 5,
            coverage: 6,
          })[a.kind] ?? 5) -
          ({
            fundamentals: 0,
            filing: 1,
            quote: 2,
            technical: 3,
            macro: 4,
            headline: 5,
            coverage: 6,
          }[b.kind] ?? 5),
      ),
    ]
      .slice(0, 18)
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        url: s.url,
        content: s.content.slice(
          0,
          s.connector === "manual"
            ? 3000
            : s.kind === "fundamentals"
              ? 5000
              : 1800,
        ),
        truncated:
          s.content.length >
          (s.connector === "manual"
            ? 3000
            : s.kind === "fundamentals"
              ? 5000
              : 1800),
        publishedAt: s.published_at,
        fetchedAt: s.fetched_at,
        connector: s.connector,
      })),
    coverage: result.coverage,
  };
}
