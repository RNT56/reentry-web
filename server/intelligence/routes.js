import {
  fail,
  id,
  text,
  symbol,
  safeURL,
  integer,
  audit,
  transaction,
} from "../platform/util.js";
import { putSource } from "./sources.js";
import { researchAsset } from "./portfolio-sources.js";
import { createSet, ownedSet, setView, observePrice } from "./scenarios.js";
import { validateBranches } from "../ai/contract.js";
export function registerIntelligenceRoutes(
  app,
  { db, engine, market, portfolioSources },
) {
  const auth = { preHandler: app.requireUser },
    limited = {
      ...auth,
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    };
  app.get("/api/research/assets", auth, async (req) => {
    const user = req.auth.user_id;
    const held = portfolioSources.sync(user);
    const assets = new Map(
      held.map((asset) => [
        asset.symbol,
        { ...asset, automatic: 0, interval_hours: 24, next_run: 0 },
      ]),
    );
    for (const { metadata, ...asset } of db
      .prepare(
        "SELECT symbol,name,automatic,interval_hours,next_run,metadata FROM research_assets WHERE user_id=? ORDER BY symbol",
      )
      .all(user)) {
      assets.set(asset.symbol, {
        ...assets.get(asset.symbol),
        ...asset,
        ...JSON.parse(metadata),
      });
    }
    return {
      assets: [...assets.values()]
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
        .map((asset) => ({
          ...asset,
          sourceStatus: portfolioSources.state(user, asset.symbol),
        })),
    };
  });
  app.put("/api/research/assets/:symbol", auth, async (req) => {
    const s = symbol(req.params.symbol),
      user = req.auth.user_id,
      b = req.body || {};
    if (typeof b.automatic !== "boolean")
      throw fail("Choose whether to automate this asset.");
    const existing = db
      .prepare("SELECT * FROM research_assets WHERE user_id=? AND symbol=?")
      .get(user, s);
    if (
      !existing &&
      db
        .prepare("SELECT COUNT(*) AS n FROM research_assets WHERE user_id=?")
        .get(user).n >= 50
    )
      throw fail("Research lists support fifty assets.");
    const hours = integer(b.intervalHours, 6, 168),
      name = text(b.name, 160);
    const metadata = JSON.parse(existing?.metadata || "{}");
    if (b.assetType !== undefined) {
      if (
        ![
          "EQUITY",
          "ETF",
          "MUTUALFUND",
          "CRYPTOCURRENCY",
          "INDEX",
          "OTHER",
        ].includes(b.assetType)
      )
        throw fail("Invalid asset type.");
      metadata.assetType = b.assetType;
    }
    if (b.isin) {
      if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(b.isin)) throw fail("Invalid ISIN.");
      metadata.isin = b.isin;
    }

    db.prepare(
      "INSERT INTO research_assets(user_id,symbol,name,automatic,interval_hours,next_run) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,symbol) DO UPDATE SET name=excluded.name,automatic=excluded.automatic,interval_hours=excluded.interval_hours,next_run=excluded.next_run",
    ).run(
      user,
      s,
      name,
      Number(b.automatic),
      hours,
      Date.now() + hours * 3600000,
    );
    db.prepare(
      "UPDATE research_assets SET metadata=? WHERE user_id=? AND symbol=?",
    ).run(JSON.stringify(metadata), user, s);
    return { ok: true };
  });
  app.delete("/api/research/assets/:symbol", auth, async (req) => {
    const s = symbol(req.params.symbol),
      user = req.auth.user_id;
    db.prepare("DELETE FROM research_assets WHERE user_id=? AND symbol=?").run(
      user,
      s,
    );
    db.prepare(
      "UPDATE ai_jobs SET status='cancelled',finished_at=? WHERE user_id=? AND symbol=? AND status='queued'",
    ).run(Date.now(), user, s);
    return { ok: true };
  });
  app.post("/api/research/collect", limited, async (req) => {
    const asset = researchAsset(db, req.auth.user_id, symbol(req.body?.symbol));
    if (!asset) throw fail("Research asset not found.", 404);
    return (
      (await portfolioSources.collect(req.auth.user_id, asset)) || {
        sources: [],
        coverage: [],
        collection: portfolioSources.state(req.auth.user_id, asset.symbol),
      }
    );
  });
  app.get("/api/research/sources", auth, async (req) => {
    const user = req.auth.user_id,
      s = symbol(req.query.symbol);
    portfolioSources.sync(user);
    return {
      sources: db
        .prepare(
          "SELECT id,symbol,kind,title,url,content,published_at,fetched_at,connector FROM research_sources WHERE user_id=? AND symbol=? ORDER BY fetched_at DESC LIMIT 60",
        )
        .all(user, s),
      collection: portfolioSources.state(user, s),
    };
  });
  app.post("/api/research/sources", limited, async (req) => {
    const user = req.auth.user_id,
      b = req.body || {},
      s = symbol(b.symbol);
    if (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM research_sources WHERE user_id=? AND connector='manual'",
        )
        .get(user).n >= 200
    )
      throw fail("Remove an older source before adding another.");
    const row = putSource(db, user, s, {
      kind: "note",
      title: text(b.title, 300),
      url: safeURL(b.url),
      content: text(b.content, 15000),
      published_at: null,
      connector: "manual",
    });
    return { id: row.id };
  });
  app.delete("/api/research/sources/:id", auth, async (req) => {
    db.prepare("DELETE FROM research_sources WHERE id=? AND user_id=?").run(
      req.params.id,
      req.auth.user_id,
    );
    return { ok: true };
  });
  app.post("/api/research/jobs", limited, async (req) =>
    engine.enqueue(req.auth.user_id, {
      symbol: symbol(req.body?.symbol),
      requestKey: text(req.body?.requestKey, 100),
    }),
  );
  app.get("/api/research/jobs", auth, async (req) => ({
    jobs: db
      .prepare(
        "SELECT id,kind,symbol,status,provider,model,error,created_at,finished_at FROM ai_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 60",
      )
      .all(req.auth.user_id),
  }));
  app.get("/api/research/jobs/:id", auth, async (req) => {
    const row = db
      .prepare("SELECT * FROM ai_jobs WHERE id=? AND user_id=?")
      .get(req.params.id, req.auth.user_id);
    if (!row) throw fail("Research job not found.", 404);
    const input = JSON.parse(row.input);
    return {
      id: row.id,
      kind: row.kind,
      symbol: row.symbol,
      status: row.status,
      model: row.model,
      error: row.error,
      createdAt: row.created_at,
      result: row.result ? JSON.parse(row.result) : null,
      sources: input.sources || [],
      coverage: input.coverage || [],
      article: input.article
        ? { id: input.article.id, revision: input.article.revision }
        : null,
    };
  });
  app.delete("/api/research/jobs/:id", auth, async (req) => {
    engine.cancel(req.auth.user_id, req.params.id);
    return { ok: true };
  });
  app.get("/api/scenarios", auth, async (req) => ({
    sets: db
      .prepare(
        "SELECT * FROM scenario_sets WHERE user_id=? ORDER BY created_at DESC LIMIT 60",
      )
      .all(req.auth.user_id)
      .map((s) => setView(db, s)),
  }));
  app.get("/api/scenarios/:id", auth, async (req) =>
    setView(db, ownedSet(db, req.auth.user_id, req.params.id)),
  );
  app.post("/api/scenarios", auth, async (req) => {
    const b = req.body || {},
      user = req.auth.user_id;
    if (
      db
        .prepare("SELECT COUNT(*) AS n FROM scenario_sets WHERE user_id=?")
        .get(user).n >= 500
    )
      throw fail("Scenario limit reached.");
    return {
      id: createSet(
        db,
        user,
        symbol(b.symbol),
        text(b.title, 200),
        validateBranches(b.branches),
      ),
    };
  });
  app.post("/api/scenarios/:id/revise", auth, async (req) => {
    const previous = ownedSet(db, req.auth.user_id, req.params.id),
      b = req.body || {};
    if (
      db
        .prepare("SELECT 1 FROM article_revisions WHERE set_id=?")
        .get(previous.id)
    )
      throw fail("Revise published scenarios in the author studio.", 409);
    if (
      db
        .prepare("SELECT COUNT(*) AS n FROM scenario_sets WHERE user_id=?")
        .get(req.auth.user_id).n >= 500
    )
      throw fail("Scenario limit reached.");
    return {
      id: createSet(
        db,
        req.auth.user_id,
        previous.symbol,
        text(b.title, 200),
        validateBranches(b.branches),
        {
          kind: "private-revision",
          parentId: previous.id,
          original: previous.provenance
            ? JSON.parse(previous.provenance)
            : null,
        },
      ),
    };
  });
  app.post("/api/scenarios/:id/check", limited, async (req) => {
    const row = ownedSet(db, req.auth.user_id, req.params.id);
    await observePrice(db, market, row);
    return setView(db, ownedSet(db, req.auth.user_id, req.params.id));
  });
  app.post("/api/scenarios/:id/events", auth, async (req) => {
    const row = ownedSet(db, req.auth.user_id, req.params.id),
      b = req.body || {},
      branches = JSON.parse(row.branches);
    if (
      b.verified !== true ||
      !branches.some(
        (x) =>
          b.eventKey === x.eventKey ||
          b.eventKey === x.eventKey + "-invalidated",
      )
    )
      throw fail("Explicitly verify a condition from this scenario.");
    const occurred = integer(b.occurredAt, row.created_at, Date.now());
    const url = safeURL(b.url);
    if (!url) throw fail("Attach the source you used to verify this event.");
    db.prepare(
      "INSERT OR IGNORE INTO scenario_observations VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id(),
      row.id,
      "event",
      b.eventKey,
      null,
      null,
      1,
      text(b.title, 300),
      url,
      occurred,
      Date.now(),
    );
    audit(db, req.auth.user_id, "event-verified", {
      setId: row.id,
      eventKey: b.eventKey,
      url,
      occurredAt: occurred,
    });
    return setView(db, row);
  });
  app.delete("/api/scenarios/:id/events/:event", auth, async (req) => {
    ownedSet(db, req.auth.user_id, req.params.id);
    // Retract verification, retain the evidence record and audit trail.
    transaction(db, () => {
      const result = db
        .prepare(
          "UPDATE scenario_observations SET verified=0 WHERE id=? AND set_id=? AND kind='event' AND verified=1",
        )
        .run(req.params.event, req.params.id);
      if (result.changes)
        audit(db, req.auth.user_id, "event-retracted", {
          setId: req.params.id,
          eventId: req.params.event,
        });
    });
    return { ok: true };
  });
  app.get("/api/research/export", auth, async (req) => {
    const user = req.auth.user_id,
      tables = [
        "research_assets",
        "research_sources",
        "ai_jobs",
        "ai_ledger",
        "ai_audit",
        "scenario_sets",
        "articles",
      ];
    const result = { version: 1, exportedAt: Date.now() };
    for (const table of tables)
      result[table] = db
        .prepare(`SELECT * FROM ${table} WHERE user_id=?`)
        .all(user)
        .map(({ user_id: _user, ...row }) => row);
    result.observations = db
      .prepare(
        "SELECT o.* FROM scenario_observations o JOIN scenario_sets s ON o.set_id=s.id WHERE s.user_id=?",
      )
      .all(user);
    result.article_revisions = db
      .prepare(
        "SELECT r.* FROM article_revisions r JOIN articles a ON r.article_id=a.id WHERE a.user_id=?",
      )
      .all(user);
    return result;
  });
}
