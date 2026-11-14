import { preferences, spending } from "./billing.js";
import { priceFor } from "./catalog.js";
import { fail, symbol, text } from "../platform/util.js";

export function registerChartAnalysisRoutes(
  app,
  { db, vault, engine, controls },
) {
  const auth = { preHandler: app.requireUser };
  const limited = {
    ...auth,
    bodyLimit: 2048,
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  };
  function configuration(user) {
    const p = preferences(db, user),
      totals = spending(db, user),
      connected = !!db
        .prepare("SELECT 1 FROM ai_credentials WHERE user_id=? AND provider=?")
        .get(user, p.provider);
    let pricesValid = true;
    try {
      priceFor(p.model);
    } catch {
      pricesValid = false;
    }
    return {
      enabled: !!p.enabled,
      ready: !!(
        engine.enabled &&
        vault.available &&
        p.enabled &&
        p.consent_at &&
        connected &&
        pricesValid &&
        !controls?.get().aiPaused
      ),
      workerEnabled: engine.enabled,
      vaultAvailable: vault.available,
      connected,
      pricesValid,
      paused: !!controls?.get().aiPaused,
      provider: p.provider,
      model: p.model,
      monthlyLimit: p.monthly_limit,
      runLimit: p.run_limit,
      available: Math.max(0, p.monthly_limit - totals.spent - totals.held),
      spending: totals,
    };
  }
  function ledger(jobId, user) {
    const row = db
      .prepare(
        "SELECT state,reserved,cost,usage,request_id,response_model,created_at,settled_at FROM ai_ledger WHERE job_id=? AND user_id=?",
      )
      .get(jobId, user);
    return row
      ? { ...row, usage: row.usage ? JSON.parse(row.usage) : null }
      : null;
  }
  function jobView(row, user, detail = false) {
    const input = JSON.parse(row.input),
      chart = input.chart,
      result = row.result ? JSON.parse(row.result) : null;
    return {
      id: row.id,
      symbol: row.symbol,
      status: row.status,
      provider: row.provider,
      model: row.model,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      error: row.error,
      range: chart?.range,
      currency: chart?.currency,
      snapshotHash: chart?.hash,
      setId: result?.setId || null,
      ledger: ledger(row.id, user),
      ...(detail
        ? { result, snapshot: chart, budget: configuration(user) }
        : {}),
    };
  }
  app.get("/api/chart-analysis", auth, async (req) => {
    const user = req.auth.user_id,
      asset = symbol(req.query.symbol);
    return {
      jobs: db
        .prepare(
          "SELECT * FROM ai_jobs WHERE user_id=? AND kind='chart-analysis' AND symbol=? ORDER BY created_at DESC,id DESC LIMIT 12",
        )
        .all(user, asset)
        .map((row) => jobView(row, user)),
      configuration: configuration(user),
    };
  });
  app.post("/api/chart-analysis/estimate", limited, async (req) =>
    engine.estimateChart(req.auth.user_id, {
      symbol: symbol(req.body?.symbol),
      range: req.body?.range ?? "1y",
      currency: req.body?.currency ?? "EUR",
    }),
  );
  app.post("/api/chart-analysis", limited, async (req) =>
    engine.enqueueChart(req.auth.user_id, {
      quoteId: text(req.body?.quoteId, 100),
      requestKey: text(req.body?.requestKey, 100),
    }),
  );
  app.get("/api/chart-analysis/:id", auth, async (req) => {
    const row = db
      .prepare(
        "SELECT * FROM ai_jobs WHERE user_id=? AND id=? AND kind='chart-analysis'",
      )
      .get(req.auth.user_id, req.params.id);
    if (!row) throw fail("Chart analysis not found.", 404);
    return jobView(row, req.auth.user_id, true);
  });
}
