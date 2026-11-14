import { createHash } from "node:crypto";
import { id, fail, transaction } from "../platform/util.js";
import { researchAsset } from "../intelligence/portfolio-sources.js";
import { preferences, spending } from "./billing.js";
import { priceFor, reservationFor, MAX_INPUT } from "./catalog.js";
import {
  sourceMonitorSchema,
  makeSourceMonitorPrompt,
  SOURCE_MONITOR_PROMPT_VERSION,
} from "./source-monitor-contract.js";

const INTERVAL = 6 * 3600000;
const QUOTE_LIFE = 300000;
const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const fingerprint = (value) =>
  createHash("sha256").update(stable(value)).digest("hex");
const same = (a, b) => stable(a) === stable(b);
const treeScope = (trees) =>
  [...trees].sort((a, b) => a.id.localeCompare(b.id));
const sameScope = (a, b) => same(treeScope(a), treeScope(b));

export function createSourceMonitor({
  db,
  vault,
  enabled = false,
  paused = () => false,
  now = Date.now,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS source_monitors(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,symbol TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,set_ids TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL,
  last_attempt_at INTEGER NOT NULL DEFAULT 0,last_success_at INTEGER NOT NULL DEFAULT 0,
  last_job_id TEXT,last_snapshot_hash TEXT,baseline_job_id TEXT,blocked_reason TEXT,next_check INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,symbol));
  CREATE INDEX IF NOT EXISTS source_monitor_schedule ON source_monitors(enabled,next_check);
  CREATE TABLE IF NOT EXISTS source_monitor_reviews(
  job_id TEXT PRIMARY KEY REFERENCES ai_jobs(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at INTEGER,dismissed_matches TEXT NOT NULL DEFAULT '[]');`);
  const quotes = new Map();
  const schemaInput = JSON.stringify(sourceMonitorSchema);
  function settings(user, symbol) {
    const row = db
      .prepare("SELECT * FROM source_monitors WHERE user_id=? AND symbol=?")
      .get(user, symbol);
    return row
      ? {
          enabled: !!row.enabled,
          setIds: JSON.parse(row.set_ids),
          intervalHours: 6,
          lastAttemptAt: row.last_attempt_at || null,
          lastSuccessAt: row.last_success_at || null,
          blockedReason: row.blocked_reason,
          nextCheckAt: row.next_check || null,
        }
      : {
          enabled: false,
          setIds: [],
          intervalHours: 6,
          lastAttemptAt: null,
          lastSuccessAt: null,
          blockedReason: null,
          nextCheckAt: null,
        };
  }
  function access(user, { queue = true } = {}) {
    if (!enabled) throw fail("Source AI is unavailable on this server.", 503);
    if (paused()) throw fail("AI is paused by the owner.", 503);
    const p = preferences(db, user);
    if (!vault.available || !p.enabled || !p.consent_at)
      throw fail("Connect your key and enable AI in settings.", 409);
    if (
      !db
        .prepare("SELECT 1 FROM ai_credentials WHERE user_id=? AND provider=?")
        .get(user, p.provider)
    )
      throw fail("Connect your own provider key first.", 409);
    priceFor(p.model, now());
    if (
      queue &&
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_jobs WHERE user_id=? AND status IN ('queued','running')",
        )
        .get(user).n >= 2
    )
      throw fail("Two jobs are already queued or running.", 429);
    if (
      queue &&
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_jobs WHERE user_id=? AND created_at>?",
        )
        .get(user, now() - 86400000).n >= 40
    )
      throw fail("Daily research limit reached. Try again tomorrow.", 429);
    return p;
  }
  function configuration(user) {
    const p = preferences(db, user),
      totals = spending(db, user, now());
    const connected = !!db
      .prepare("SELECT 1 FROM ai_credentials WHERE user_id=? AND provider=?")
      .get(user, p.provider);
    let pricesValid = true;
    try {
      priceFor(p.model, now());
    } catch {
      pricesValid = false;
    }
    return {
      enabled: !!p.enabled,
      ready: !!(
        enabled &&
        vault.available &&
        p.enabled &&
        p.consent_at &&
        connected &&
        pricesValid &&
        !paused()
      ),
      workerEnabled: enabled,
      vaultAvailable: vault.available,
      connected,
      pricesValid,
      paused: !!paused(),
      provider: p.provider,
      model: p.model,
      monthlyLimit: p.monthly_limit,
      runLimit: p.run_limit,
      available: Math.max(0, p.monthly_limit - totals.spent - totals.held),
      spending: totals,
    };
  }
  function privateTrees(user, symbol) {
    return db
      .prepare(
        `SELECT s.* FROM scenario_sets s WHERE s.user_id=? AND s.symbol=?
   AND NOT EXISTS(SELECT 1 FROM article_revisions r WHERE r.set_id=s.id)
   ORDER BY s.created_at DESC,s.id DESC`,
      )
      .all(user, symbol)
      .map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        branches: JSON.parse(row.branches),
        provenance: row.provenance ? JSON.parse(row.provenance) : null,
      }));
  }
  function selectedTrees(user, symbol, setIds) {
    if (
      !Array.isArray(setIds) ||
      setIds.length > 12 ||
      new Set(setIds).size !== setIds.length ||
      setIds.some(
        (value) => typeof value !== "string" || !value || value.length > 100,
      )
    )
      throw fail("Select up to twelve private trees.");
    const trees = privateTrees(user, symbol);
    if (!setIds.length) {
      if (trees.length > 12)
        throw fail("Select up to twelve private scenario trees to watch.", 409);
      return trees;
    }
    const selected = setIds.map((key) => trees.find((tree) => tree.id === key));
    if (selected.some((tree) => !tree))
      throw fail("A selected private scenario tree is unavailable.", 404);
    return selected;
  }
  function update(user, symbol, body) {
    if (typeof body.enabled !== "boolean")
      throw fail("Choose whether to watch this asset.");
    if (!researchAsset(db, user, symbol))
      throw fail("Research asset not found.", 404);
    selectedTrees(user, symbol, body.setIds);
    db.prepare(
      `INSERT INTO source_monitors(user_id,symbol,enabled,set_ids,updated_at) VALUES(?,?,?,?,?)
   ON CONFLICT(user_id,symbol) DO UPDATE SET enabled=excluded.enabled,set_ids=excluded.set_ids,updated_at=excluded.updated_at,next_check=0,blocked_reason=NULL`,
    ).run(
      user,
      symbol,
      Number(body.enabled),
      JSON.stringify(body.setIds),
      now(),
    );
    return settings(user, symbol);
  }
  function latestSuccessful(user, symbol) {
    return db
      .prepare(
        "SELECT * FROM ai_jobs WHERE user_id=? AND symbol=? AND kind='source-monitor' AND status='completed' ORDER BY finished_at DESC,id DESC LIMIT 1",
      )
      .get(user, symbol);
  }
  function sourceRows(user, symbol, asOf) {
    const rows = db
      .prepare(
        `WITH eligible AS (
   SELECT id,kind,title,url,content,connector,published_at,fetched_at,hash,
     ROW_NUMBER() OVER(PARTITION BY CASE WHEN connector='manual' THEN 'manual' ELSE kind END ORDER BY fetched_at DESC,id DESC) AS kind_rank
   FROM research_sources
   WHERE user_id=? AND symbol=? AND (kind IN ('headline','filing','fundamentals') OR connector='manual')
   AND fetched_at<=? AND (published_at IS NULL OR published_at<=?)
   ) SELECT id,kind,title,url,content,connector,published_at,fetched_at,hash FROM eligible
   WHERE kind_rank<=CASE WHEN connector='manual' THEN 24 WHEN kind='fundamentals' THEN 1 WHEN kind='filing' THEN 5 ELSE 24 END
   ORDER BY fetched_at DESC,id DESC LIMIT 54`,
      )
      .all(user, symbol, asOf, asOf);
    const chosen = new Map();
    for (const [kind, limit] of [
      ["manual", 4],
      ["fundamentals", 1],
      ["filing", 5],
      ["headline", 14],
    ]) {
      for (const row of rows
        .filter((row) =>
          kind === "manual"
            ? row.connector === "manual"
            : row.kind === kind && row.connector !== "manual",
        )
        .slice(0, limit))
        chosen.set(row.id, row);
    }
    for (const row of rows) {
      if (chosen.size >= 24) break;
      chosen.set(row.id, row);
    }
    return [...chosen.values()].slice(0, 24).map((row) => {
      const limit =
        row.kind === "fundamentals"
          ? 5000
          : row.connector === "manual"
            ? 3000
            : 1800;
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        url: row.url,
        content: row.content.slice(0, limit),
        connector: row.connector,
        publishedAt: row.published_at,
        fetchedAt: row.fetched_at,
        // Collection timestamps and regenerated row IDs are not new evidence.
        hash: fingerprint({
          kind: row.kind,
          title: row.title,
          url: row.url,
          content: row.content,
        }),
        truncated: row.content.length > limit,
      };
    });
  }
  function snapshot(user, symbol, setIds = settings(user, symbol).setIds) {
    const owned = researchAsset(db, user, symbol);
    if (!owned) throw fail("Research asset not found.", 404);
    const baseline = latestSuccessful(user, symbol);
    const oldInput = baseline ? JSON.parse(baseline.input) : null;
    const asOf = Math.max(now(), (oldInput?.asOf || 0) + 1),
      asset = { symbol: owned.symbol, name: owned.name };
    const watched = selectedTrees(user, symbol, setIds);
    const sources = sourceRows(user, symbol, asOf);
    if (!sources.length)
      throw fail("No news, filings or private sources are available yet.", 409);
    const oldResult = baseline ? JSON.parse(baseline.result) : null;
    const comparisonReset = !!oldInput && !sameScope(oldInput.watched, watched);
    const oldHashes = new Set(
      !comparisonReset
        ? oldInput?.sources.map((source) => source.hash) || []
        : [],
    );
    const newSourceIds = sources
      .filter((source) => !oldHashes.has(source.hash))
      .map((source) => source.id);
    const previous =
      baseline && !comparisonReset
        ? {
            jobId: baseline.id,
            asOf: oldInput.asOf,
            summary: oldResult.summary,
            changes: oldResult.changes,
            sources: oldInput.sources,
          }
        : null;
    const snapshotHash = fingerprint({
      asset,
      sources: sources.map((source) => source.hash).sort(),
      watched: watched
        .map((tree) => ({
          id: tree.id,
          title: tree.title,
          createdAt: tree.createdAt,
          branches: tree.branches,
          provenance: tree.provenance,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
    return {
      kind: "source-monitor",
      asset,
      asOf,
      sources,
      newSourceIds,
      previous,
      watched,
      snapshotHash,
      comparisonReset,
      promptVersion: SOURCE_MONITOR_PROMPT_VERSION,
    };
  }
  function pending(user, symbol) {
    const asOf = now(),
      sources = sourceRows(user, symbol, asOf),
      baseline = latestSuccessful(user, symbol);
    const hashes = new Set(
      baseline
        ? JSON.parse(baseline.input).sources.map((source) => source.hash)
        : [],
    );
    return sources.filter((source) => !hashes.has(source.hash)).length;
  }
  function preparePrompt(input) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const prompt = makeSourceMonitorPrompt(input);
      if (Buffer.byteLength(prompt + schemaInput, "utf8") + 12000 <= MAX_INPUT)
        return prompt;
      let reduced = false;
      for (const source of [
        ...input.sources,
        ...(input.previous?.sources || []),
      ]) {
        if (source.content.length > 160) {
          source.content = source.content.slice(
            0,
            Math.max(160, Math.floor(source.content.length * 0.6)),
          );
          source.truncated = true;
          reduced = true;
        }
      }
      if (!reduced) break;
    }
    throw fail(
      "Selected tree context is too large. Select fewer trees and preview again.",
      409,
    );
  }
  function budget(user, prompt, model, approved) {
    const p = preferences(db, user),
      maximum = reservationFor(prompt + schemaInput, priceFor(model, now())),
      totals = spending(db, user, now());
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
  function unchanged(user, symbol, input) {
    const baseline = latestSuccessful(user, symbol);
    return (
      baseline && JSON.parse(baseline.input).snapshotHash === input.snapshotHash
    );
  }
  const noNewEvidence = (input) =>
    !input.newSourceIds.length && !input.comparisonReset;
  function estimate(user, { symbol, setIds }) {
    const p = access(user),
      input = snapshot(user, symbol, setIds ?? settings(user, symbol).setIds);
    if (noNewEvidence(input) || unchanged(user, symbol, input))
      throw fail("No new source evidence or scenario changes to analyze.", 409);
    if (
      db
        .prepare(
          "SELECT 1 FROM ai_jobs j JOIN ai_ledger l ON l.job_id=j.id WHERE j.user_id=? AND j.symbol=? AND j.kind='source-monitor' AND json_extract(j.input,'$.snapshotHash')=? AND l.state='uncertain'",
        )
        .get(user, symbol, input.snapshotHash)
    )
      throw fail(
        "Previous usage for this evidence is unconfirmed. Reconcile it in AI settings before retrying.",
        409,
      );
    const prompt = preparePrompt(input),
      quoted = budget(user, prompt, p.model),
      at = now();
    for (const [key, value] of quotes)
      if (value.expiresAt <= at) quotes.delete(key);
    while (quotes.size >= 256) quotes.delete(quotes.keys().next().value);
    const own = [...quotes].filter(([, quote]) => quote.user === user);
    for (const [key] of own.slice(0, Math.max(0, own.length - 7)))
      quotes.delete(key);
    const quoteId = id(),
      expiresAt = at + QUOTE_LIFE;
    quotes.set(quoteId, {
      user,
      input,
      prompt,
      provider: p.provider,
      model: p.model,
      maximum: quoted.maximum,
      createdAt: at,
      expiresAt,
    });
    return {
      quoteId,
      expiresAt,
      symbol,
      provider: p.provider,
      model: p.model,
      maxCost: quoted.maximum,
      snapshot: {
        sourceCount: input.sources.length,
        newSourceCount: input.newSourceIds.length,
        treeCount: input.watched.length,
        asOf: input.asOf,
        hash: input.snapshotHash,
        comparisonReset: input.comparisonReset,
      },
      budget: quoted,
    };
  }
  function insert(user, quote, requestKey, quoteId, automatic = false) {
    const p = access(user);
    if (p.provider !== quote.provider || p.model !== quote.model)
      throw fail("AI settings changed. Preview this analysis again.", 409);
    const current = selectedTrees(
      user,
      quote.input.asset.symbol,
      quote.input.watched.map((tree) => tree.id),
    );
    if (!sameScope(current, quote.input.watched))
      throw fail("Scenario trees changed. Preview this analysis again.", 409);
    if (
      noNewEvidence(quote.input) ||
      unchanged(user, quote.input.asset.symbol, quote.input)
    )
      throw fail("No new source evidence or scenario changes to analyze.", 409);
    budget(user, quote.prompt, quote.model, quote.maximum);
    if (
      db
        .prepare(
          "SELECT 1 FROM ai_jobs WHERE user_id=? AND kind='source-monitor' AND symbol=? AND status IN ('queued','running')",
        )
        .get(user, quote.input.asset.symbol)
    )
      throw fail("This asset already has an analysis in progress.", 409);
    const job = id(),
      symbol = quote.input.asset.symbol;
    transaction(db, () => {
      db.prepare(
        "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        job,
        user,
        "source-monitor",
        symbol,
        quote.provider,
        quote.model,
        "queued",
        JSON.stringify({
          ...quote.input,
          quoteId,
          automatic,
          approvedMaximum: quote.maximum,
          preparedAt: quote.createdAt,
        }),
        requestKey,
        now(),
      );
      db.prepare(
        `INSERT INTO source_monitors(user_id,symbol,updated_at,last_attempt_at,last_job_id,last_snapshot_hash,next_check) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id,symbol) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_job_id=excluded.last_job_id,last_snapshot_hash=excluded.last_snapshot_hash,next_check=excluded.next_check,blocked_reason=NULL`,
      ).run(
        user,
        symbol,
        now(),
        now(),
        job,
        quote.input.snapshotHash,
        now() + INTERVAL,
      );
    });
    return { id: job, status: "queued" };
  }
  function enqueue(user, { quoteId, requestKey }) {
    const existing = db
      .prepare(
        "SELECT id,status,kind,input FROM ai_jobs WHERE user_id=? AND request_key=?",
      )
      .get(user, requestKey);
    if (existing) {
      if (
        existing.kind !== "source-monitor" ||
        JSON.parse(existing.input).quoteId !== quoteId
      )
        throw fail("Request key already used.", 409);
      return { id: existing.id, status: existing.status };
    }
    const quote = quotes.get(quoteId);
    if (!quote || quote.user !== user || quote.expiresAt <= now())
      throw fail("Analysis preview expired. Preview again.", 409);
    const job = insert(user, quote, requestKey, quoteId);
    quotes.delete(quoteId);
    return job;
  }
  function schedule() {
    const due = db
      .prepare(
        "SELECT * FROM source_monitors WHERE enabled=1 AND next_check<=? ORDER BY next_check,user_id,symbol LIMIT 8",
      )
      .all(now());
    for (const watch of due) {
      const failure = db
        .prepare(
          "SELECT error FROM ai_jobs WHERE id=? AND user_id=? AND kind='source-monitor' AND status='failed'",
        )
        .get(watch.last_job_id, watch.user_id);
      // A skipped unchanged snapshot cannot clear an actual failed run. Ordinary
      // scheduling blocks (for example a recovered cap) can clear without a run.
      let blocked =
          failure?.error && failure.error === watch.blocked_reason
            ? watch.blocked_reason
            : null,
        next;
      try {
        const input = snapshot(
          watch.user_id,
          watch.symbol,
          JSON.parse(watch.set_ids),
        );
        if (
          input.snapshotHash === watch.last_snapshot_hash ||
          noNewEvidence(input) ||
          unchanged(watch.user_id, watch.symbol, input)
        ) {
          next = now() + 300000;
        } else if (
          watch.last_attempt_at &&
          now() - watch.last_attempt_at < INTERVAL
        )
          next = watch.last_attempt_at + INTERVAL;
        else {
          const p = access(watch.user_id),
            prompt = preparePrompt(input),
            quoted = budget(watch.user_id, prompt, p.model);
          const requestKey =
            "source-watch:" + watch.symbol + ":" + input.snapshotHash;
          const prior = db
            .prepare("SELECT id FROM ai_jobs WHERE user_id=? AND request_key=?")
            .get(watch.user_id, requestKey);
          if (prior) {
            next = now() + 300000;
          } else {
            insert(
              watch.user_id,
              {
                input,
                prompt,
                provider: p.provider,
                model: p.model,
                maximum: quoted.maximum,
                createdAt: now(),
              },
              requestKey,
              "scheduled:" + input.snapshotHash,
              true,
            );
            blocked = null;
            next = now() + INTERVAL;
          }
        }
      } catch (error) {
        blocked = error.statusCode
          ? error.message
          : "Source analysis is unavailable. Try again later.";
        next = now() + 60000;
      }
      db.prepare(
        "UPDATE source_monitors SET blocked_reason=?,next_check=? WHERE user_id=? AND symbol=?",
      ).run(blocked, next, watch.user_id, watch.symbol);
    }
  }
  function dispatch(job, input, prompt) {
    const p = access(job.user_id, { queue: false });
    if (!researchAsset(db, job.user_id, job.symbol))
      throw fail("Research asset was removed before dispatch.", 409);
    if (input.automatic) {
      const current = settings(job.user_id, job.symbol);
      if (!current.enabled)
        throw fail("Source watch was paused before dispatch.", 409);
      if (
        !sameScope(
          selectedTrees(job.user_id, job.symbol, current.setIds),
          input.watched,
        )
      )
        throw fail(
          "Watched trees changed before dispatch. Preview again.",
          409,
        );
    }
    if (p.provider !== job.provider || p.model !== job.model)
      throw fail("AI settings changed. Preview this analysis again.", 409);
    if (!Number.isFinite(input.preparedAt) || now() - input.preparedAt > 900000)
      throw fail(
        "Source snapshot expired before dispatch. Preview again.",
        409,
      );
    const watched = selectedTrees(
      job.user_id,
      job.symbol,
      input.watched.map((tree) => tree.id),
    );
    if (!sameScope(watched, input.watched))
      throw fail("Scenario trees changed before dispatch. Preview again.", 409);
    budget(job.user_id, prompt, job.model, input.approvedMaximum);
  }
  function completed(job) {
    db.prepare(
      "UPDATE source_monitors SET baseline_job_id=?,last_success_at=?,blocked_reason=NULL WHERE user_id=? AND symbol=?",
    ).run(job.id, now(), job.user_id, job.symbol);
  }
  function failed(job, message) {
    db.prepare(
      "UPDATE source_monitors SET blocked_reason=? WHERE user_id=? AND symbol=? AND last_job_id=?",
    ).run(message, job.user_id, job.symbol, job.id);
  }
  function review(user, jobId, body) {
    const job = db
      .prepare(
        "SELECT result FROM ai_jobs WHERE id=? AND user_id=? AND kind='source-monitor' AND status='completed'",
      )
      .get(jobId, user);
    if (!job) throw fail("Source analysis not found.", 404);
    const old = db
      .prepare(
        "SELECT * FROM source_monitor_reviews WHERE user_id=? AND job_id=?",
      )
      .get(user, jobId);
    const matches = JSON.parse(job.result).matches;
    if (body.read !== undefined && body.read !== true)
      throw fail("Invalid read state.");
    const dismissed =
      body.dismissedMatches ?? JSON.parse(old?.dismissed_matches || "[]");
    if (
      !Array.isArray(dismissed) ||
      dismissed.length > 12 ||
      new Set(dismissed).size !== dismissed.length ||
      dismissed.some(
        (index) =>
          !Number.isSafeInteger(index) || index < 0 || index >= matches.length,
      )
    )
      throw fail("Invalid match review.");
    db.prepare(
      "INSERT INTO source_monitor_reviews(job_id,user_id,read_at,dismissed_matches) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET read_at=excluded.read_at,dismissed_matches=excluded.dismissed_matches",
    ).run(
      jobId,
      user,
      old?.read_at || (body.read ? now() : null),
      JSON.stringify(dismissed),
    );
    return {
      readAt: old?.read_at || (body.read ? now() : null),
      dismissedMatches: dismissed,
    };
  }
  return {
    settings,
    configuration,
    privateTrees,
    pending,
    estimate,
    enqueue,
    update,
    schedule,
    dispatch,
    completed,
    failed,
    review,
    schemaInput,
  };
}
