import { fail, symbol, text } from "../platform/util.js";

export function registerSourceMonitorRoutes(app, { db, engine }) {
  const monitor = engine.sourceMonitor;
  const auth = { preHandler: app.requireUser };
  const limited = {
    ...auth,
    bodyLimit: 4096,
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  };
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
  function review(jobId, user) {
    const row = db
      .prepare(
        "SELECT read_at,dismissed_matches FROM source_monitor_reviews WHERE job_id=? AND user_id=?",
      )
      .get(jobId, user);
    return {
      readAt: row?.read_at || null,
      dismissedMatches: JSON.parse(row?.dismissed_matches || "[]"),
    };
  }
  function jobView(row, user, detail = false) {
    const input = JSON.parse(row.input),
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
      snapshotHash: input.snapshotHash,
      changeCount: result?.changes.length || 0,
      matchCount: result?.matches.length || 0,
      readAt: review(row.id, user).readAt,
      ledger: ledger(row.id, user),
      ...(detail
        ? {
            result,
            snapshot: {
              asset: input.asset,
              asOf: input.asOf,
              sources: input.sources,
              newSourceIds: input.newSourceIds,
              previous: input.previous,
              watched: input.watched,
              snapshotHash: input.snapshotHash,
              comparisonReset: !!input.comparisonReset,
            },
            review: review(row.id, user),
          }
        : {}),
    };
  }
  app.get("/api/source-monitor", auth, async (req) => {
    const user = req.auth.user_id,
      asset = symbol(req.query.symbol);
    const rows = db
      .prepare(
        "SELECT * FROM ai_jobs WHERE user_id=? AND symbol=? AND kind='source-monitor' ORDER BY created_at DESC,id DESC LIMIT 12",
      )
      .all(user, asset);
    const latest = db
      .prepare(
        "SELECT * FROM ai_jobs WHERE user_id=? AND symbol=? AND kind='source-monitor' AND status='completed' ORDER BY finished_at DESC,id DESC LIMIT 1",
      )
      .get(user, asset);
    const trees = monitor.privateTrees(user, asset);
    const privateBranches = new Map(
      trees.map((tree) => [
        tree.id,
        new Set(tree.branches.map((branch) => branch.eventKey)),
      ]),
    );
    const linked = db
      .prepare(
        "SELECT * FROM ai_jobs WHERE user_id=? AND symbol=? AND kind='source-monitor' AND status='completed' AND json_array_length(result,'$.matches')>0 ORDER BY finished_at DESC,id DESC LIMIT 12",
      )
      .all(user, asset);
    const signals = [];
    for (const job of linked) {
      const result = JSON.parse(job.result),
        dismissed = new Set(review(job.id, user).dismissedMatches);
      for (const [matchIndex, match] of result.matches.entries()) {
        if (
          dismissed.has(matchIndex) ||
          !privateBranches.get(match.setId)?.has(match.eventKey)
        )
          continue;
        signals.push({
          jobId: job.id,
          changeIndex: match.changeIndex,
          matchIndex,
          setId: match.setId,
          eventKey: match.eventKey,
          signal: match.signal,
          title: result.changes[match.changeIndex].title,
          rationale: match.rationale,
          createdAt: job.finished_at || job.created_at,
        });
        if (signals.length >= 48) break;
      }
      if (signals.length >= 48) break;
    }
    return {
      settings: monitor.settings(user, asset),
      configuration: monitor.configuration(user),
      pendingSourceCount: monitor.pending(user, asset),
      trees: trees.map((tree) => ({
        ...tree,
        branches: tree.branches.map((branch) => ({
          eventKey: branch.eventKey,
          title: branch.title,
        })),
      })),
      totalTreeCount: trees.length,
      signals,
      jobs: rows.map((row) => jobView(row, user)),
      latest: latest ? jobView(latest, user, true) : null,
    };
  });
  app.put("/api/source-monitor/:symbol", limited, async (req) => ({
    settings: monitor.update(
      req.auth.user_id,
      symbol(req.params.symbol),
      req.body || {},
    ),
  }));
  app.post("/api/source-monitor/estimate", limited, async (req) =>
    monitor.estimate(req.auth.user_id, {
      symbol: symbol(req.body?.symbol),
      setIds: req.body?.setIds,
    }),
  );
  app.post("/api/source-monitor", limited, async (req) =>
    monitor.enqueue(req.auth.user_id, {
      quoteId: text(req.body?.quoteId, 100),
      requestKey: text(req.body?.requestKey, 100),
    }),
  );
  app.get("/api/source-monitor/jobs/:id", auth, async (req) => {
    const row = db
      .prepare(
        "SELECT * FROM ai_jobs WHERE user_id=? AND id=? AND kind='source-monitor'",
      )
      .get(req.auth.user_id, req.params.id);
    if (!row) throw fail("Source analysis not found.", 404);
    return jobView(row, req.auth.user_id, true);
  });
  app.patch("/api/source-monitor/jobs/:id/review", limited, async (req) => ({
    review: monitor.review(req.auth.user_id, req.params.id, req.body || {}),
  }));
}
