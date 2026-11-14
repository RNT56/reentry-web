import { statfsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { models, priceFor, PRICING_VERSION } from "../ai/catalog.js";
import { fail, transaction, audit } from "../platform/util.js";
export function registerAdminRoutes(
  app,
  { db, isAuthor, engine, connectors, vault, controls },
) {
  const auth = {
    preHandler: async (req, reply) => {
      await app.requireUser(req, reply);
      if (reply.sent) return;
      if (!isAuthor(req.auth.username))
        throw fail("Owner access required.", 403);
    },
  };
  const count = (table) =>
    db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  app.get("/api/admin", auth, async () => {
    const jobs = Object.fromEntries(
      db
        .prepare("SELECT status,COUNT(*) n FROM ai_jobs GROUP BY status")
        .all()
        .map((r) => [r.status, r.n]),
    );
    const ledger = db
      .prepare(
        "SELECT COUNT(*) calls,COALESCE(SUM(CASE WHEN state IN ('settled','reconciled') THEN cost ELSE 0 END),0) cost,COALESCE(SUM(CASE WHEN state IN ('reserved','uncertain') THEN reserved ELSE 0 END),0) held,SUM(CASE WHEN state='uncertain' THEN 1 ELSE 0 END) uncertain FROM ai_ledger",
      )
      .get();
    let disk = null;
    try {
      const s = statfsSync(
        dirname(resolve(process.env.DATABASE_PATH || "data/reentry.sqlite")),
      );
      disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch {
      /* Optional host metric. */
    }
    return {
      revision: process.env.REENTRY_REVISION || "local",
      at: Date.now(),
      controls: controls.get(),
      counts: {
        accounts: count("users"),
        portfolios: count("portfolios"),
        passkeys: count("passkeys"),
        assets: count("research_assets"),
        articles: count("articles"),
        published: db
          .prepare(
            "SELECT COUNT(*) n FROM articles WHERE published_revision IS NOT NULL",
          )
          .get().n,
        scenarios: count("scenario_sets"),
      },
      jobs,
      ledger: { ...ledger, uncertain: ledger.uncertain || 0 },
      runtime: {
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage().rss,
        memoryLimit: 768 * 1024 * 1024,
        node: process.version,
        disk,
        worker: engine.enabled,
        vault: vault.available,
      },
      connectors: connectors.status(),
      pricing: {
        version: PRICING_VERSION,
        models: models.map((m) => {
          try {
            return { ...priceFor(m.id), valid: true };
          } catch {
            return { id: m.id, label: m.label, valid: false };
          }
        }),
      },
      activity: db
        .prepare(
          "SELECT action,details,created_at FROM ai_audit WHERE action IN ('platform-controls-updated','platform-queue-cancelled') ORDER BY created_at DESC LIMIT 12",
        )
        .all()
        .map((r) => ({
          action: r.action,
          details: JSON.parse(r.details),
          at: r.created_at,
        })),
    };
  });
  app.put("/api/admin/settings", auth, async (req) => ({
    controls: controls.set(req.body, req.auth.user_id),
  }));
  app.post("/api/admin/queue/cancel", auth, async (req) => {
    if (req.body?.confirmed !== true) throw fail("Confirm queue cancellation.");
    return transaction(db, () => {
      const result = db
        .prepare(
          "UPDATE ai_jobs SET status='cancelled',finished_at=? WHERE status='queued'",
        )
        .run(Date.now());
      audit(db, req.auth.user_id, "platform-queue-cancelled", {
        count: result.changes,
      });
      return { cancelled: result.changes };
    });
  });
}
