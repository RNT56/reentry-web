import { effectiveModel } from "./catalog.js";
import { id, fail, transaction } from "../platform/util.js";
import { preferences, reserve, settle, release } from "./billing.js";
import { makePrompt, validateResult, PROMPT_VERSION } from "./contract.js";
import { collectSources } from "../intelligence/sources.js";
import { createSet, observePrice } from "../intelligence/scenarios.js";
export function createEngine({
  db,
  vault,
  generate,
  connectors,
  market,
  enabled = false,
  paused = () => false,
}) {
  let timer,
    running = null,
    stopped = false,
    aborter;
  function enqueue(
    user,
    { symbol, kind = "research", article = null, requestKey },
  ) {
    const existing = db
      .prepare(
        "SELECT id,status FROM ai_jobs WHERE user_id=? AND request_key=?",
      )
      .get(user, requestKey);
    if (existing) return existing;
    if (paused()) throw fail("AI is paused by the owner.", 503);
    const p = preferences(db, user);
    if (!enabled)
      throw fail("Background research is not enabled on this server.", 503);
    if (!vault.available || !p.enabled || !p.consent_at)
      throw fail("Connect your key and enable AI in settings.", 409);
    if (
      !db
        .prepare("SELECT 1 FROM ai_credentials WHERE user_id=? AND provider=?")
        .get(user, p.provider)
    )
      throw fail("Connect your own provider key first.", 409);
    if (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_jobs WHERE user_id=? AND status IN ('queued','running')",
        )
        .get(user).n >= 2
    )
      throw fail("Two jobs are already queued or running.", 429);
    if (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_jobs WHERE user_id=? AND created_at>?",
        )
        .get(user, Date.now() - 86400000).n >= 40
    )
      throw fail("Daily research limit reached. Try again tomorrow.", 429);
    const asset = db
      .prepare(
        "SELECT symbol,name FROM research_assets WHERE user_id=? AND symbol=?",
      )
      .get(user, symbol);
    if (!asset) throw fail("Add this asset to your research list first.", 409);
    const job = id();
    db.prepare(
      "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      job,
      user,
      kind,
      symbol,
      p.provider,
      p.model,
      "queued",
      JSON.stringify({ kind, asset, article, promptVersion: PROMPT_VERSION }),
      requestKey,
      Date.now(),
    );
    return { id: job, status: "queued" };
  }
  function recover() {
    const rows = db
      .prepare(
        "SELECT id,dispatched_at FROM ai_jobs WHERE status='running' AND lease_until<?",
      )
      .all(Date.now());
    for (const j of rows) {
      const ledger = db
        .prepare("SELECT state FROM ai_ledger WHERE job_id=?")
        .get(j.id);
      release(db, j.id, !!j.dispatched_at);
      db.prepare(
        "UPDATE ai_jobs SET status='failed',error=?,finished_at=? WHERE id=? AND status='running'",
      ).run(
        j.dispatched_at
          ? ledger?.state === "settled"
            ? "Worker interrupted after usage was recorded. The response is unavailable."
            : "Worker interrupted after dispatch. Usage needs reconciliation."
          : "Worker interrupted before dispatch. No model call was sent.",
        Date.now(),
        j.id,
      );
    }
  }
  async function execute(job) {
    aborter = new AbortController();
    let dispatched = false;
    try {
      if (paused()) throw fail("AI is paused by the owner.", 503);
      const resolvedModel = effectiveModel(job.provider, job.model);
      if (resolvedModel !== job.model) {
        db.prepare("UPDATE ai_jobs SET model=? WHERE id=?").run(
          resolvedModel,
          job.id,
        );
        job.model = resolvedModel;
      }
      const input = JSON.parse(job.input),
        collected = await collectSources(
          db,
          connectors,
          job.user_id,
          input.asset,
        );
      if (
        stopped ||
        db.prepare("SELECT status FROM ai_jobs WHERE id=?").get(job.id)
          ?.status !== "running"
      )
        throw fail("Research cancelled before dispatch.", 409);
      if (!collected.sources.length && !input.article)
        throw fail(
          "No evidence available. Add a source or try again later.",
          409,
        );
      if (input.article) {
        input.article.truncated = input.article.body.length > 18000;
        input.article.body = input.article.body.slice(0, 18000);
        collected.sources.unshift({
          id: "article-" + input.article.id,
          kind: "author-draft",
          title: input.article.title,
          content:
            "The author’s text is supplied in article.body. This source identifies that private draft.",
          url: null,
          connector: "author",
          fetchedAt: Date.now(),
        });
      }
      const watched = db
        .prepare(
          "SELECT id,title,branches FROM scenario_sets WHERE user_id=? AND symbol=? ORDER BY created_at DESC LIMIT 4",
        )
        .all(job.user_id, job.symbol)
        .map((s) => ({
          id: s.id,
          title: s.title,
          branches: JSON.parse(s.branches).map((b) => ({
            eventKey: b.eventKey,
            condition: b.condition,
            invalidation: b.invalidation,
          })),
        }));
      const snapshot = { ...input, ...collected, watched, asOf: Date.now() },
        prompt = makePrompt(snapshot);
      db.prepare("UPDATE ai_jobs SET input=? WHERE id=?").run(
        JSON.stringify(snapshot),
        job.id,
      );
      const credential = db
        .prepare(
          "SELECT encrypted FROM ai_credentials WHERE user_id=? AND provider=?",
        )
        .get(job.user_id, job.provider);
      if (!credential) throw fail("Provider key was removed.", 409);
      if (paused()) throw fail("AI is paused by the owner.", 503);
      const key = vault.open(job.user_id, job.provider, credential.encrypted);
      const { pricing } = reserve(db, job, prompt);
      db.prepare("UPDATE ai_jobs SET dispatched_at=? WHERE id=?").run(
        Date.now(),
        job.id,
      );
      dispatched = true;
      const response = await generate({
        provider: job.provider,
        model: job.model,
        key,
        prompt,
        signal: aborter.signal,
      });
      // Charge valid usage even if the response is refused, truncated or fails our content checks.
      settle(db, job, response, pricing);
      if (!response.complete)
        throw fail(
          "AI response was truncated or declined. Reported usage was recorded.",
          409,
        );
      let parsed;
      try {
        parsed = JSON.parse(response.text);
      } catch {
        throw fail(
          "AI returned invalid JSON. Reported usage was recorded.",
          409,
        );
      }
      const result = validateResult(parsed, snapshot);
      if (input.article?.truncated)
        result.limitations.push(
          "Only the first 18,000 characters of this article were mapped. Later passages were excluded.",
        );
      if (collected.sources.some((s) => s.truncated))
        result.limitations.push(
          "Long source text was excerpted to stay within the context and spending limits.",
        );
      transaction(db, () => {
        if (
          job.kind === "research" &&
          result.scenarios.length &&
          db
            .prepare("SELECT COUNT(*) AS n FROM scenario_sets WHERE user_id=?")
            .get(job.user_id).n < 500
        )
          result.setId = createSet(
            db,
            job.user_id,
            job.symbol,
            `${job.symbol} · AI scenarios`,
            result.scenarios,
            { kind: "ai-research", jobId: job.id },
          );
        db.prepare(
          "UPDATE ai_jobs SET status='completed',result=?,finished_at=?,lease_until=NULL WHERE id=?",
        ).run(JSON.stringify(result), Date.now(), job.id);
      });
    } catch (error) {
      release(db, job.id, dispatched && error.uncertain !== false);
      const safe =
        error.statusCode || error.name === "ProviderError"
          ? error.message
          : "Research could not be completed. Any confirmed usage has been recorded.";
      db.prepare(
        "UPDATE ai_jobs SET status='failed',error=?,finished_at=?,lease_until=NULL WHERE id=? AND status='running'",
      ).run(safe, Date.now(), job.id);
    } finally {
      aborter = null;
    }
  }
  async function tick() {
    if (stopped || running) return;
    running = (async () => {
      recover();
      if (!paused()) {
        const now = Date.now();
        const due = db
          .prepare(
            "SELECT a.* FROM research_assets a JOIN ai_preferences p ON a.user_id=p.user_id WHERE a.automatic=1 AND a.next_run<=? AND p.enabled=1 ORDER BY a.next_run LIMIT 8",
          )
          .all(now);
        for (const a of due) {
          let next = now + a.interval_hours * 3600000;
          try {
            enqueue(a.user_id, {
              symbol: a.symbol,
              requestKey: `auto:${a.symbol}:${Math.floor(now / (a.interval_hours * 3600000))}`,
            });
          } catch (error) {
            // A full owner queue is transient; do not silently skip an entire scheduled interval.
            if (
              error.statusCode === 429 &&
              error.message.startsWith("Two jobs")
            )
              next = now + 60000;
          }
          db.prepare(
            "UPDATE research_assets SET next_run=? WHERE user_id=? AND symbol=?",
          ).run(next, a.user_id, a.symbol);
        }
        const job = transaction(db, () => {
          const row = db
            .prepare(
              "SELECT * FROM ai_jobs WHERE status='queued' ORDER BY created_at LIMIT 1",
            )
            .get();
          if (row)
            db.prepare(
              "UPDATE ai_jobs SET status='running',started_at=?,lease_until=? WHERE id=? AND status='queued'",
            ).run(now, now + 300000, row.id);
          return row;
        });
        if (job) await execute(job);
      }
      if (stopped) return;
      for (const row of db
        .prepare(
          "SELECT * FROM scenario_sets WHERE last_check<? ORDER BY last_check LIMIT 4",
        )
        .all(Date.now() - 900000)) {
        if (stopped) break;
        // Back off even when the connector fails; a stale check must not look successful.
        db.prepare("UPDATE scenario_sets SET last_check=? WHERE id=?").run(
          Date.now(),
          row.id,
        );
        try {
          await observePrice(db, market, row);
        } catch {
          /* No evidence is invented on missing data. */
        }
      }
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  }
  return {
    enabled,
    enqueue,
    tick,
    start() {
      if (!enabled || timer) return;
      timer = setInterval(() => tick().catch(() => {}), 5000);
      timer.unref();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      aborter?.abort();
      await running?.catch(() => {});
    },
    cancel(user, jobId) {
      const job = db
        .prepare("SELECT status FROM ai_jobs WHERE id=? AND user_id=?")
        .get(jobId, user);
      if (!job) throw fail("Job not found.", 404);
      if (job.status !== "queued")
        throw fail(
          "Only queued jobs can be cancelled. Running calls may already be billed.",
          409,
        );
      db.prepare(
        "UPDATE ai_jobs SET status='cancelled',finished_at=? WHERE id=?",
      ).run(Date.now(), jobId);
    },
  };
}
