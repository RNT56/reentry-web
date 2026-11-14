import { models, priceFor } from "./catalog.js";
import { preferences, spending } from "./billing.js";
import { fail, text, integer, audit, transaction } from "../platform/util.js";
export function registerAIRoutes(
  app,
  { db, vault, engine, connectors, isAuthor, authorName },
) {
  const auth = { preHandler: app.requireUser };
  app.get("/api/intelligence", auth, async (req) => {
    const user = req.auth.user_id,
      p = preferences(db, user);
    let pricesValid = true;
    try {
      priceFor(p.model);
    } catch {
      pricesValid = false;
    }
    return {
      author: isAuthor(req.auth.username),
      authorName,
      vaultAvailable: vault.available,
      workerEnabled: engine.enabled,
      pricesValid,
      models: models.map((m) => {
        try {
          return priceFor(m.id);
        } catch {
          return { ...m, expired: true };
        }
      }),
      connectors: connectors.status(),
      preferences: {
        enabled: !!p.enabled,
        provider: p.provider,
        model: p.model,
        monthlyLimit: p.monthly_limit,
        runLimit: p.run_limit,
        consentAt: p.consent_at,
      },
      spending: spending(db, user),
      credentials: db
        .prepare(
          "SELECT provider,fingerprint,updated_at FROM ai_credentials WHERE user_id=?",
        )
        .all(user),
    };
  });
  app.put("/api/ai/preferences", auth, async (req) => {
    const b = req.body || {},
      user = req.auth.user_id,
      model = models.find((m) => m.id === b.model);
    if (!model || typeof b.enabled !== "boolean")
      throw fail("Choose a supported model and AI setting.");
    const limit = integer(b.monthlyLimit, 0, 1000000000),
      perRun = integer(b.runLimit, 1000, 10000000),
      p = preferences(db, user);
    if (b.enabled && !p.consent_at && b.consent !== true)
      throw fail("Approve sending selected research data to your provider.");
    if (
      b.enabled &&
      !db
        .prepare("SELECT 1 FROM ai_credentials WHERE user_id=? AND provider=?")
        .get(user, model.provider)
    )
      throw fail("Connect a key for the selected provider first.");
    if (b.enabled && !vault.available)
      throw fail("Server key storage is unavailable.", 503);
    if (b.enabled) {
      try {
        priceFor(model.id);
      } catch {
        throw fail("Model prices require an operator update.", 409);
      }
    }
    db.prepare(
      "UPDATE ai_preferences SET enabled=?,provider=?,model=?,monthly_limit=?,run_limit=?,consent_at=?,updated_at=? WHERE user_id=?",
    ).run(
      Number(b.enabled),
      model.provider,
      model.id,
      limit,
      perRun,
      p.consent_at || (b.consent === true ? Date.now() : null),
      Date.now(),
      user,
    );
    if (!b.enabled)
      db.prepare(
        "UPDATE ai_jobs SET status='cancelled',finished_at=? WHERE user_id=? AND status='queued'",
      ).run(Date.now(), user);
    audit(db, user, "preferences-updated", {
      enabled: b.enabled,
      model: model.id,
      monthlyLimit: limit,
      runLimit: perRun,
    });
    return { ok: true };
  });
  app.put(
    "/api/ai/credentials/:provider",
    {
      ...auth,
      bodyLimit: 4096,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const provider = req.params.provider,
        user = req.auth.user_id;
      if (!["gemini", "anthropic"].includes(provider))
        throw fail("Unknown provider.");
      const sealed = vault.seal(user, provider, req.body?.key);
      db.prepare(
        "INSERT INTO ai_credentials VALUES(?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted=excluded.encrypted,fingerprint=excluded.fingerprint,updated_at=excluded.updated_at",
      ).run(user, provider, sealed.encrypted, sealed.fingerprint, Date.now());
      audit(db, user, "credential-saved", {
        provider,
        fingerprint: sealed.fingerprint,
      });
      return { ok: true, fingerprint: sealed.fingerprint };
    },
  );
  app.delete("/api/ai/credentials/:provider", auth, async (req) => {
    const user = req.auth.user_id,
      provider = req.params.provider;
    db.prepare("DELETE FROM ai_credentials WHERE user_id=? AND provider=?").run(
      user,
      provider,
    );
    db.prepare(
      "UPDATE ai_jobs SET status='cancelled',finished_at=? WHERE user_id=? AND provider=? AND status='queued'",
    ).run(Date.now(), user, provider);
    db.prepare(
      "UPDATE ai_preferences SET enabled=0 WHERE user_id=? AND provider=?",
    ).run(user, provider);
    audit(db, user, "credential-deleted", { provider });
    return { ok: true };
  });
  app.get("/api/ai/costs", auth, async (req) => ({
    totals: spending(db, req.auth.user_id),
    entries: db
      .prepare(
        "SELECT l.id,l.job_id,l.provider,l.model,l.state,l.reserved,l.cost,l.pricing,l.usage,l.request_id,l.response_model,l.created_at,l.settled_at,j.kind,j.symbol FROM ai_ledger l JOIN ai_jobs j ON l.job_id=j.id WHERE l.user_id=? ORDER BY l.created_at DESC LIMIT 500",
      )
      .all(req.auth.user_id)
      .map((r) => ({
        ...r,
        pricing: JSON.parse(r.pricing),
        usage: r.usage ? JSON.parse(r.usage) : null,
      })),
  }));
  app.post("/api/ai/costs/:id/reconcile", auth, async (req) => {
    const amount = integer(req.body?.cost, 0, 1000000000),
      note = text(req.body?.note, 500),
      user = req.auth.user_id;
    transaction(db, () => {
      const r = db
        .prepare(
          "UPDATE ai_ledger SET state='reconciled',cost=?,settled_at=? WHERE id=? AND user_id=? AND state='uncertain'",
        )
        .run(amount, Date.now(), req.params.id, user);
      if (!r.changes) throw fail("Unconfirmed charge not found.", 404);
      audit(db, user, "cost-reconciled", {
        ledgerId: req.params.id,
        cost: amount,
        note,
      });
    });
    return { ok: true };
  });
}
