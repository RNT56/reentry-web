import { createHash } from "node:crypto";
import {
  collectWritingContext,
  writingContextHash,
} from "./writing-context.js";
import {
  makeWritingPrompt,
  writingSchema,
  validateWritingResult,
} from "./writing-contract.js";
import {
  effectiveModel,
  priceFor,
  reservationFor,
  imageModels,
} from "./catalog.js";
import {
  prepareMedia,
  validateMediaResult,
  mediaSchema,
} from "./media-contract.js";
import { storeImage } from "../journal/media-store.js";
import { id, fail, transaction } from "../platform/util.js";
import { preferences, spending, reserve, settle, release } from "./billing.js";
import { makePrompt, validateResult, PROMPT_VERSION } from "./contract.js";
import {
  buildChartSnapshot,
  makeChartPrompt,
  validateChartResult,
  chartResultSchema,
} from "./chart-contract.js";
import { collectSources } from "../intelligence/sources.js";
import { createSourceMonitor } from "./source-monitor.js";
import {
  makeSourceMonitorPrompt,
  validateSourceMonitorResult,
  sourceMonitorSchema,
} from "./source-monitor-contract.js";
import { researchAsset } from "../intelligence/portfolio-sources.js";
import { researchHidden } from "../intelligence/research-visibility.js";
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
  const chartQuotes = new Map();
  const chartSchemaInput = JSON.stringify(chartResultSchema);
  const sourceMonitor = createSourceMonitor({ db, vault, enabled, paused });
  function chartAccess(user, { scenario = true } = {}) {
    if (paused()) throw fail("AI is paused by the owner.", 503);
    const p = preferences(db, user);
    if (!enabled) throw fail("AI is unavailable on this server.", 503);
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
    if (
      scenario &&
      db
        .prepare("SELECT COUNT(*) AS n FROM scenario_sets WHERE user_id=?")
        .get(user).n >= 500
    )
      throw fail("Scenario limit reached. No AI request was sent.", 409);
    return p;
  }
  function chartBudget(user, prompt, model, approved) {
    const p = preferences(db, user),
      maximum = reservationFor(prompt + chartSchemaInput, priceFor(model)),
      totals = spending(db, user);
    if (
      maximum > p.run_limit ||
      maximum + totals.spent + totals.held > p.monthly_limit
    )
      throw fail("Spending limit reached. No AI request was sent.", 409);
    if (approved !== undefined && maximum > approved)
      throw fail("Model pricing changed. Preview this analysis again.", 409);
    return {
      maximum,
      totals,
      monthlyLimit: p.monthly_limit,
      runLimit: p.run_limit,
      available: Math.max(0, p.monthly_limit - totals.spent - totals.held),
    };
  }
  async function estimateChart(
    user,
    { symbol, range = "1y", currency = "EUR" },
  ) {
    if (
      !["1mo", "3mo", "1y"].includes(range) ||
      !["EUR", "USD"].includes(currency)
    )
      throw fail("Choose 1M, 3M or 1Y and EUR or USD.");
    const p = chartAccess(user),
      asset = researchAsset(db, user, symbol);
    if (!asset) throw fail("Add this asset to your research list first.", 409);
    let chart;
    try {
      chart = buildChartSnapshot(
        await market.history(symbol, range, currency),
        { symbol, range, currency, asOf: Date.now() },
      );
    } catch (error) {
      throw fail(
        error.message?.startsWith("Chart analysis:")
          ? error.message
          : "Chart history is unavailable. Try again later.",
        409,
      );
    }
    const input = {
        kind: "chart-analysis",
        asset,
        chart,
        promptVersion: "chart-v1",
      },
      prompt = makeChartPrompt(input),
      current = chartAccess(user);
    if (current.provider !== p.provider || current.model !== p.model)
      throw fail("AI settings changed. Preview this analysis again.", 409);
    const budget = chartBudget(user, prompt, p.model),
      now = Date.now();
    for (const [key, q] of chartQuotes)
      if (q.expiresAt <= now) chartQuotes.delete(key);
    while (chartQuotes.size >= 256)
      chartQuotes.delete(chartQuotes.keys().next().value);
    const own = [...chartQuotes].filter(([, q]) => q.user === user);
    for (const [key] of own.slice(0, Math.max(0, own.length - 7)))
      chartQuotes.delete(key);
    const quoteId = id(),
      expiresAt = now + 300000;
    chartQuotes.set(quoteId, {
      user,
      provider: p.provider,
      model: p.model,
      input,
      prompt,
      maximum: budget.maximum,
      createdAt: now,
      expiresAt,
    });
    return {
      quoteId,
      expiresAt,
      symbol,
      range,
      currency,
      provider: p.provider,
      model: p.model,
      maxCost: budget.maximum,
      snapshot: chartSummary(chart),
      budget,
    };
  }
  function chartSummary(chart) {
    const summary = { ...chart, barCount: chart.bars.length };
    delete summary.bars;
    delete summary.indicators;
    return summary;
  }
  function enqueueChart(user, { quoteId, requestKey }) {
    const existing = db
      .prepare(
        "SELECT id,status,kind,input FROM ai_jobs WHERE user_id=? AND request_key=?",
      )
      .get(user, requestKey);
    if (existing) {
      if (
        existing.kind !== "chart-analysis" ||
        JSON.parse(existing.input).quoteId !== quoteId
      )
        throw fail("Request key already used.", 409);
      return { id: existing.id, status: existing.status };
    }
    const quote = chartQuotes.get(quoteId);
    if (!quote || quote.user !== user || quote.expiresAt <= Date.now())
      throw fail("Analysis preview expired. Preview again.", 409);
    const p = chartAccess(user);
    if (p.provider !== quote.provider || p.model !== quote.model)
      throw fail("AI settings changed. Preview this analysis again.", 409);
    chartBudget(user, quote.prompt, quote.model, quote.maximum);
    const job = id();
    db.prepare(
      "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      job,
      user,
      "chart-analysis",
      quote.input.asset.symbol,
      quote.provider,
      quote.model,
      "queued",
      JSON.stringify({
        ...quote.input,
        quoteId,
        approvedMaximum: quote.maximum,
        preparedAt: quote.createdAt,
      }),
      requestKey,
      Date.now(),
    );
    chartQuotes.delete(quoteId);
    return { id: job, status: "queued" };
  }
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
    const asset = researchAsset(db, user, symbol);
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
  function writingBudget(user, prompt, model) {
    const p = preferences(db, user);
    let maximum;
    try {
      maximum = reservationFor(
        prompt + JSON.stringify(writingSchema),
        priceFor(model),
      );
    } catch (error) {
      throw fail(error.message, 409);
    }
    const totals = spending(db, user);
    if (
      maximum > p.run_limit ||
      maximum + totals.spent + totals.held > p.monthly_limit
    )
      throw fail("Spending limit reached. No AI request was sent.", 409);
    return maximum;
  }
  function prepareWriting(user, request) {
    const { article, ...writing } = request;
    const assetContext = collectWritingContext(db, user, article);
    const input = {
      kind: "studio-writing",
      article,
      writing,
      assetContext,
      contextHash: writingContextHash(assetContext),
      promptVersion: "studio-writing-v2",
    };
    return { input, prompt: makeWritingPrompt(input) };
  }
  function mediaPreferences(user) {
    db.prepare(
      "INSERT OR IGNORE INTO ai_media_preferences(user_id) VALUES(?)",
    ).run(user);
    return db
      .prepare("SELECT * FROM ai_media_preferences WHERE user_id=?")
      .get(user);
  }
  function previewMedia(user, article, value) {
    const input = prepareMedia(db, user, article, value),
      p = preferences(db, user),
      mp = mediaPreferences(user);
    const model = input.task === "image" ? mp.image_model : p.model;
    const maximum = reservationFor(
      input.renderedPrompt +
        (input.task === "image" ? "" : JSON.stringify(mediaSchema)),
      priceFor(model),
    );
    return {
      input,
      prompt: input.renderedPrompt,
      contextHash: input.contextHash,
      model,
      provider: input.task === "image" ? "gemini" : p.provider,
      maximum,
      runLimit:
        input.task === "image"
          ? Math.min(p.run_limit, mp.run_limit)
          : p.run_limit,
    };
  }
  function enqueueMedia(user, article, value) {
    const key = String(value.requestKey || "");
    if (!key || key.length > 100) throw fail("A request key is required.");
    const requestHash = createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");
    const previous = db
      .prepare(
        "SELECT id,status,input FROM ai_jobs WHERE user_id=? AND request_key=?",
      )
      .get(user, key);
    if (previous) {
      if (JSON.parse(previous.input).requestHash !== requestHash)
        throw fail("This request key was already used.", 409);
      return { id: previous.id, status: previous.status };
    }
    chartAccess(user, { scenario: false });
    const preview = previewMedia(user, article, value),
      p = preferences(db, user),
      totals = spending(db, user);
    if (value.contextHash !== preview.contextHash)
      throw fail("Asset context changed. Preview again.", 409);
    if (value.model !== preview.model || value.maximum !== preview.maximum)
      throw fail("Model or price changed. Preview again.", 409);
    if (
      !db
        .prepare("SELECT 1 FROM ai_credentials WHERE user_id=? AND provider=?")
        .get(user, preview.provider)
    )
      throw fail("Connect a Gemini key for image generation.", 409);
    if (
      preview.maximum > preview.runLimit ||
      preview.maximum + totals.spent + totals.held > p.monthly_limit
    )
      throw fail(
        "Raise the per-run cap or reduce the request. No AI call was sent.",
        409,
      );
    const job = id();
    db.prepare(
      "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      job,
      user,
      preview.input.task === "image" ? "studio-image" : "studio-media",
      preview.input.article.symbol,
      preview.provider,
      preview.model,
      "queued",
      JSON.stringify({
        ...preview.input,
        requestHash,
        approvedMaximum: preview.maximum,
      }),
      key,
      Date.now(),
    );
    return { id: job, status: "queued" };
  }
  function previewWriting(user, request) {
    const p = preferences(db, user);
    const prepared = prepareWriting(user, request);
    return {
      context: prepared.input.assetContext,
      contextHash: prepared.input.contextHash,
      prompt: prepared.prompt,
      schema: writingSchema,
      model: p.model,
    };
  }
  function enqueueWriting(user, request, requestKey, expectedContextHash) {
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ request, expectedContextHash }))
      .digest("hex");
    const previous = db
      .prepare(
        "SELECT id,status,kind,input FROM ai_jobs WHERE user_id=? AND request_key=?",
      )
      .get(user, requestKey);
    if (previous) {
      if (
        previous.kind !== "studio-writing" ||
        JSON.parse(previous.input).requestHash !== requestHash
      )
        throw fail(
          "Request key already used for a different writing task.",
          409,
        );
      return { id: previous.id, status: previous.status };
    }
    const p = chartAccess(user, { scenario: false });
    const { input, prompt } = prepareWriting(user, request);
    if (expectedContextHash && expectedContextHash !== input.contextHash)
      throw fail(
        "Asset context changed. Review the refreshed context and send again.",
        409,
      );
    input.requestHash = requestHash;
    input.renderedPrompt = prompt;
    const maximum = writingBudget(user, prompt, p.model);
    const job = id();
    db.prepare(
      "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      job,
      user,
      "studio-writing",
      request.article.symbol,
      p.provider,
      p.model,
      "queued",
      JSON.stringify(input),
      requestKey,
      Date.now(),
    );
    return { id: job, status: "queued", model: p.model, maxCost: maximum };
  }
  function recover() {
    const rows = db
      .prepare(
        "SELECT id,kind,user_id,symbol,dispatched_at FROM ai_jobs WHERE status='running' AND lease_until<?",
      )
      .all(Date.now());
    for (const j of rows) {
      const ledger = db
        .prepare("SELECT state FROM ai_ledger WHERE job_id=?")
        .get(j.id);
      const error = j.dispatched_at
        ? ledger?.state === "settled"
          ? "Worker interrupted after usage was recorded. The response is unavailable."
          : "Worker interrupted after dispatch. Usage needs reconciliation."
        : "Worker interrupted before dispatch. No model call was sent.";
      transaction(db, () => {
        release(db, j.id, !!j.dispatched_at);
        db.prepare(
          "UPDATE ai_jobs SET status='failed',error=?,finished_at=? WHERE id=? AND status='running'",
        ).run(error, Date.now(), j.id);
        if (j.kind === "source-monitor") sourceMonitor.failed(j, error);
      });
    }
  }
  async function execute(job) {
    aborter = new AbortController();
    let dispatched = false;
    try {
      if (paused()) throw fail("AI is paused by the owner.", 503);
      const resolvedModel =
        job.kind === "studio-image" &&
        imageModels.some((m) => m.id === job.model)
          ? job.model
          : effectiveModel(job.provider, job.model);
      if (
        [
          "chart-analysis",
          "source-monitor",
          "studio-writing",
          "studio-media",
          "studio-image",
        ].includes(job.kind) &&
        resolvedModel !== job.model
      )
        throw fail("Quoted model is no longer available. Preview again.", 409);
      if (resolvedModel !== job.model) {
        db.prepare("UPDATE ai_jobs SET model=? WHERE id=?").run(
          resolvedModel,
          job.id,
        );
        job.model = resolvedModel;
      }
      const input = JSON.parse(job.input),
        chartJob = job.kind === "chart-analysis",
        sourceJob = job.kind === "source-monitor",
        writingJob = job.kind === "studio-writing",
        mediaJob = ["studio-media", "studio-image"].includes(job.kind),
        imageJob = job.kind === "studio-image",
        collected = sourceJob
          ? { sources: input.sources, coverage: [] }
          : chartJob || writingJob || mediaJob
            ? { sources: [], coverage: [] }
            : await collectSources(db, connectors, job.user_id, input.asset);
      if (
        stopped ||
        db.prepare("SELECT status FROM ai_jobs WHERE id=?").get(job.id)
          ?.status !== "running"
      )
        throw fail("Research cancelled before dispatch.", 409);
      if (!chartJob && !collected.sources.length && !input.article)
        throw fail(
          "No evidence available. Add a source or try again later.",
          409,
        );
      if (input.article && !writingJob && !mediaJob) {
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
      const watched = sourceJob
        ? input.watched
        : chartJob || writingJob || mediaJob
          ? []
          : db
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
      const snapshot =
          chartJob || sourceJob || writingJob || mediaJob
            ? input
            : { ...input, ...collected, watched, asOf: Date.now() },
        prompt = mediaJob
          ? input.renderedPrompt
          : writingJob
            ? snapshot.renderedPrompt || makeWritingPrompt(snapshot)
            : sourceJob
              ? makeSourceMonitorPrompt(snapshot)
              : chartJob
                ? makeChartPrompt(snapshot)
                : makePrompt(snapshot);
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
      if (writingJob || mediaJob) {
        const p = preferences(db, job.user_id);
        if (
          imageJob
            ? mediaPreferences(job.user_id).image_model !== job.model
            : p.provider !== job.provider || p.model !== job.model
        )
          throw fail("AI settings changed. Run this writing task again.", 409);
        const article = db
          .prepare("SELECT revision FROM articles WHERE id=? AND user_id=?")
          .get(input.article.id, job.user_id);
        if (!article || article.revision !== input.article.revision)
          throw fail(
            "The draft changed or was deleted before this writing task ran. No AI request was sent.",
            409,
          );
        if (mediaJob) {
          const cost = reservationFor(
            prompt + (imageJob ? "" : JSON.stringify(mediaSchema)),
            priceFor(job.model),
          );
          if (
            cost > input.approvedMaximum ||
            (imageJob && cost > mediaPreferences(job.user_id).run_limit)
          )
            throw fail(
              "Image cap or model pricing changed. Preview again.",
              409,
            );
        } else writingBudget(job.user_id, prompt, job.model);
      }
      if (chartJob) {
        const p = preferences(db, job.user_id);
        if (p.provider !== job.provider || p.model !== job.model)
          throw fail("AI settings changed. Preview this analysis again.", 409);
        if (
          !Number.isFinite(input.preparedAt) ||
          Date.now() - input.preparedAt > 900000
        )
          throw fail(
            "Chart snapshot expired before dispatch. Preview again.",
            409,
          );
        if (
          db
            .prepare("SELECT COUNT(*) AS n FROM scenario_sets WHERE user_id=?")
            .get(job.user_id).n >= 500
        )
          throw fail("Scenario limit reached. No AI request was sent.", 409);
        chartBudget(job.user_id, prompt, job.model, input.approvedMaximum);
      }
      if (
        (!writingJob &&
          !mediaJob &&
          researchHidden(db, job.user_id, job.symbol)) ||
        (["research", "chart-analysis"].includes(job.kind) &&
          !researchAsset(db, job.user_id, job.symbol))
      )
        throw fail("Asset was removed from Research before dispatch.", 409);
      if (sourceJob) sourceMonitor.dispatch(job, input, prompt);
      const key = vault.open(job.user_id, job.provider, credential.encrypted);
      const { pricing } = reserve(
        db,
        job,
        prompt,
        Date.now(),
        mediaJob
          ? imageJob
            ? ""
            : JSON.stringify(mediaSchema)
          : writingJob
            ? JSON.stringify(writingSchema)
            : sourceJob
              ? sourceMonitor.schemaInput
              : chartJob
                ? chartSchemaInput
                : "",
      );
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
        ...(mediaJob
          ? imageJob
            ? { imageConfig: { aspectRatio: input.aspectRatio } }
            : { schema: mediaSchema }
          : writingJob
            ? { schema: writingSchema }
            : sourceJob
              ? { schema: sourceMonitorSchema }
              : chartJob
                ? { schema: chartResultSchema }
                : {}),
        signal: aborter.signal,
      });
      // Charge valid usage even if the response is refused, truncated or fails our content checks.
      settle(db, job, response, pricing);
      if (!response.complete)
        throw fail(
          "AI response was truncated or declined. Reported usage was recorded.",
          409,
        );
      if (imageJob) {
        if (response.images?.length !== 1)
          throw fail(
            "The provider did not return exactly one image. Usage recorded.",
            409,
          );
        const generated = response.images[0];
        if (
          typeof generated.data !== "string" ||
          generated.data.length > 12 * 1024 * 1024
        )
          throw fail("The generated image is too large. Usage recorded.", 409);
        const image = await storeImage(
          db,
          job.user_id,
          {
            symbol: job.symbol,
            name: (input.article.title + " · illustration").slice(0, 200),
            provenance: {
              kind: "ai",
              model: job.model,
              jobId: job.id,
              credit: "AI illustration · " + job.model,
            },
          },
          Buffer.from(generated.data, "base64"),
        );
        db.prepare(
          "UPDATE ai_jobs SET status='completed',result=?,finished_at=?,lease_until=NULL WHERE id=?",
        ).run(
          JSON.stringify({ image, summary: "Illustration ready" }),
          Date.now(),
          job.id,
        );
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(response.text);
      } catch {
        throw fail(
          "AI returned invalid JSON. Reported usage was recorded.",
          409,
        );
      }
      const result = mediaJob
        ? validateMediaResult(parsed, snapshot)
        : writingJob
          ? validateWritingResult(parsed, snapshot)
          : sourceJob
            ? validateSourceMonitorResult(parsed, snapshot)
            : chartJob
              ? validateChartResult(parsed, snapshot)
              : validateResult(parsed, snapshot);
      if (input.article?.truncated)
        result.limitations.push(
          "Only the first 18,000 characters of this article were mapped. Later passages were excluded.",
        );
      if (!sourceJob && collected.sources.some((s) => s.truncated))
        result.limitations.push(
          "Long source text was excerpted to stay within the context and spending limits.",
        );
      transaction(db, () => {
        if (
          chartJob &&
          result.scenarios.length &&
          db
            .prepare("SELECT COUNT(*) AS n FROM scenario_sets WHERE user_id=?")
            .get(job.user_id).n >= 500
        )
          throw fail(
            "Scenario limit reached while this analysis ran. Usage was recorded; no partial analysis was saved.",
            409,
          );
        if (
          ["research", "chart-analysis"].includes(job.kind) &&
          result.scenarios.length &&
          db
            .prepare("SELECT COUNT(*) AS n FROM scenario_sets WHERE user_id=?")
            .get(job.user_id).n < 500
        )
          result.setId = createSet(
            db,
            job.user_id,
            job.symbol,
            `${job.symbol} · ${chartJob ? "AI chart" : "AI scenarios"}`,
            result.scenarios,
            chartJob
              ? {
                  kind: "ai-chart",
                  jobId: job.id,
                  snapshotHash: input.chart.hash,
                  range: input.chart.range,
                  currency: input.chart.currency,
                  lastTime: input.chart.lastTime,
                  provider: job.provider,
                  model: job.model,
                }
              : { kind: "ai-research", jobId: job.id },
          );
        if (sourceJob) sourceMonitor.completed(job);
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
      if (job.kind === "source-monitor") sourceMonitor.failed(job, safe);
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
        sourceMonitor.schedule();
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
    sourceMonitor,
    enqueue,
    estimateChart,
    enqueueChart,
    enqueueWriting,
    previewWriting,
    previewMedia,
    enqueueMedia,
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
