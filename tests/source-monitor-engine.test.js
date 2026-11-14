import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";
import { createVault } from "../server/ai/vault.js";
import { ProviderError, createProviders } from "../server/ai/providers.js";
import {
  sourceMonitorSchema,
  makeSourceMonitorPrompt,
} from "../server/ai/source-monitor-contract.js";
import { reserve } from "../server/ai/billing.js";
import { priceFor, reservationFor } from "../server/ai/catalog.js";
import { putSource } from "../server/intelligence/sources.js";
import { createSet } from "../server/intelligence/scenarios.js";

const origin = "http://localhost:4173",
  model = "gemini-4-hydrogen",
  providerKey = "fixture-key-not-real-12345678901234567890";
const branch = {
  eventKey: "launch",
  title: "Launch succeeds",
  condition: "Company confirms the launch",
  invalidation: "Company cancels the launch",
  low: 20,
  high: 30,
  currency: "USD",
  horizonDays: 90,
  passage: "",
};
function owner(db, name) {
  const id = randomUUID(),
    token = randomBytes(32).toString("base64url"),
    now = Date.now();
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    id,
    name,
    "hash",
    "recovery",
    now,
  );
  db.prepare("INSERT INTO portfolios(user_id,data) VALUES(?,?)").run(
    id,
    JSON.stringify(emptyPortfolio()),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    id,
    now,
    now,
    now,
    now + 86400000,
  );
  return {
    id,
    headers: {
      cookie: "reentry_dev=" + token,
      origin,
      "x-reentry-request": "1",
      "content-type": "application/json",
    },
  };
}
function evidence(
  db,
  user,
  title = "Launch announced",
  kind = "headline",
  connector = "news",
) {
  return putSource(db, user, "INTC", {
    kind,
    title,
    url: "https://example.com/" + encodeURIComponent(title),
    content: title + " in a bounded source.",
    published_at: Date.now() - 1000,
    connector,
  });
}
function tree(
  db,
  user,
  title = "Private launch",
  symbol = "INTC",
  provenance = null,
) {
  const id = createSet(
    db,
    user,
    symbol,
    title,
    [branch],
    provenance,
    Date.now() - 10000,
  );
  db.prepare("UPDATE scenario_sets SET last_check=? WHERE id=?").run(
    Date.now(),
    id,
  );
  return id;
}
function resultFor(input) {
  const source = input.newSourceIds[0];
  return {
    summary: "A newly collected report describes the launch.",
    changes: source
      ? [
          {
            title: "Launch report",
            detail: "The source reports a launch announcement.",
            kind: "fact",
            significance: "high",
            sourceIds: [source],
            previousSourceIds: [],
          },
        ]
      : [],
    matches:
      source && input.watched[0]
        ? [
            {
              changeIndex: 0,
              setId: input.watched[0].id,
              eventKey: "launch",
              signal:
                input.watched[0].provenance?.kind === "ai-chart"
                  ? "context"
                  : "supports",
              rationale: "The report is relevant to the launch condition.",
              sourceIds: [source],
            },
          ]
        : [],
  };
}
async function setup(t, { generate } = {}) {
  const db = openStore(":memory:"),
    vault = createVault(randomBytes(32).toString("base64")),
    calls = [];
  const app = await createApp({
    db,
    origin,
    logger: false,
    disableRateLimit: true,
    marketService: {
      quote: async () => {
        throw Error("No quote fixture");
      },
      history: async () => {
        throw Error("No history fixture");
      },
      search: async () => ({ results: [] }),
    },
    platform: {
      vault,
      workerEnabled: true,
      startWorker: false,
      connectors: {
        status: () => [],
        collect: async () => {
          throw Error("Source monitoring must not refetch connectors");
        },
      },
      generate: async (args) => {
        calls.push(args);
        if (generate) return generate(args);
        const input = JSON.parse(
          args.prompt
            .split("UNTRUSTED_DATA_START\n")[1]
            .split("\nUNTRUSTED_DATA_END")[0],
        );
        return {
          text: JSON.stringify(resultFor(input)),
          usage: {
            input: 500,
            output: 300,
            cached: 0,
            write5m: 0,
            write1h: 0,
            reasoning: 0,
          },
          complete: true,
          responseModel: args.model,
          requestId: "fixture-" + calls.length,
        };
      },
    },
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  const a = owner(db, "alice"),
    b = owner(db, "bob");
  for (const user of [a, b]) {
    db.prepare(
      "INSERT INTO research_assets(user_id,symbol,name) VALUES(?,?,?)",
    ).run(user.id, "INTC", "Intel");
    const sealed = vault.seal(user.id, "gemini", providerKey);
    db.prepare("INSERT INTO ai_credentials VALUES(?,?,?,?,?)").run(
      user.id,
      "gemini",
      sealed.encrypted,
      sealed.fingerprint,
      Date.now(),
    );
    db.prepare(
      "INSERT INTO ai_preferences(user_id,enabled,provider,model,monthly_limit,run_limit,consent_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(user.id, 1, "gemini", model, 5000000, 250000, Date.now(), Date.now());
  }
  return {
    app,
    db,
    vault,
    calls,
    a,
    b,
    monitor: app.intelligenceEngine.sourceMonitor,
    async request(user, method, url, payload) {
      return app.inject({
        method,
        url,
        headers: user.headers,
        ...(payload ? { payload } : {}),
      });
    },
    async run(user = a) {
      const quote = await app.inject({
        method: "POST",
        url: "/api/source-monitor/estimate",
        headers: user.headers,
        payload: { symbol: "INTC" },
      });
      assert.equal(quote.statusCode, 200, quote.body);
      const queued = await app.inject({
        method: "POST",
        url: "/api/source-monitor",
        headers: user.headers,
        payload: { quoteId: quote.json().quoteId, requestKey: randomUUID() },
      });
      assert.equal(queued.statusCode, 200, queued.body);
      await app.intelligenceEngine.tick();
      return {
        quote: quote.json(),
        job: queued.json(),
        detail: (
          await app.inject({
            url: "/api/source-monitor/jobs/" + queued.json().id,
            headers: user.headers,
          })
        ).json(),
      };
    },
  };
}

test("source-monitor freezes evidence, uses own key/schema/ledger and never mutates trees or author content", async (t) => {
  const f = await setup(t),
    set = tree(f.db, f.a.id),
    source = evidence(f.db, f.a.id);
  evidence(f.db, f.b.id, "Bob-private");
  const before = f.db
    .prepare("SELECT branches,provenance FROM scenario_sets WHERE id=?")
    .get(set);
  const quote = await f.request(f.a, "POST", "/api/source-monitor/estimate", {
    symbol: "INTC",
  });
  assert.equal(quote.statusCode, 200, quote.body);
  assert.equal(quote.json().snapshot.newSourceCount, 1);
  const additional = evidence(f.db, f.a.id, "Later report");
  const queued = await f.request(f.a, "POST", "/api/source-monitor", {
    quoteId: quote.json().quoteId,
    requestKey: "one-request",
  });
  assert.equal(queued.statusCode, 200);
  const again = await f.request(f.a, "POST", "/api/source-monitor", {
    quoteId: quote.json().quoteId,
    requestKey: "one-request",
  });
  assert.equal(again.json().id, queued.json().id);
  await f.app.intelligenceEngine.tick();
  const detail = (
    await f.request(f.a, "GET", "/api/source-monitor/jobs/" + queued.json().id)
  ).json();
  assert.equal(detail.status, "completed", JSON.stringify(detail));
  assert.deepEqual(
    detail.snapshot.sources.map((s) => s.id),
    [source.id],
  );
  assert.ok(!detail.snapshot.sources.some((s) => s.id === additional.id));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].key, providerKey);
  assert.deepEqual(f.calls[0].schema, sourceMonitorSchema);
  assert.equal(detail.ledger.state, "settled");
  assert.equal(
    detail.ledger.reserved,
    reservationFor(
      f.calls[0].prompt + JSON.stringify(sourceMonitorSchema),
      priceFor(model),
    ),
  );
  assert.equal(detail.result.matches[0].setId, set);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM scenario_observations").get().n,
    0,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM articles").get().n, 0);
  assert.deepEqual(
    f.db
      .prepare("SELECT branches,provenance FROM scenario_sets WHERE id=?")
      .get(set),
    before,
  );
  const other = await f.request(
    f.b,
    "GET",
    "/api/source-monitor/jobs/" + detail.id,
  );
  assert.equal(other.statusCode, 404);
  const overview = await f.request(
    f.a,
    "GET",
    "/api/source-monitor?symbol=INTC",
  );
  assert.match(overview.headers["cache-control"], /no-store/);
  assert.equal(overview.json().settings.enabled, false);
  assert.equal(overview.json().pendingSourceCount, 1);
  assert.equal(overview.json().latest.id, detail.id);
  assert.ok(!("snapshot" in overview.json().jobs[0]));
  const review = await f.request(
    f.a,
    "PATCH",
    "/api/source-monitor/jobs/" + detail.id + "/review",
    { read: true, dismissedMatches: [0] },
  );
  assert.equal(review.statusCode, 200);
  assert.ok(review.json().review.readAt);
  assert.deepEqual(review.json().review.dismissedMatches, [0]);
  assert.equal(
    (
      await f.request(
        f.b,
        "PATCH",
        "/api/source-monitor/jobs/" + detail.id + "/review",
        { read: true },
      )
    ).statusCode,
    404,
  );
  const ownExport = await f.request(f.a, "GET", "/api/research/export");
  assert.equal(ownExport.statusCode, 200);
  assert.equal(ownExport.json().source_monitors.length, 1);
  assert.equal(ownExport.json().source_monitor_reviews[0].job_id, detail.id);
  assert.equal(ownExport.json().ai_jobs[0].kind, "source-monitor");
  assert.ok(!JSON.stringify(ownExport.json()).includes("Bob-private"));
  const otherExport = (
    await f.request(f.b, "GET", "/api/research/export")
  ).json();
  assert.deepEqual(otherExport.source_monitors, []);
  assert.deepEqual(otherExport.source_monitor_reviews, []);
  assert.ok(!otherExport.ai_jobs.some((job) => job.id === detail.id));
});

test("disabled consent, removed keys, lowered caps and queue limits prevent paid dispatch", async (t) => {
  for (const mode of ["key", "consent", "budget", "paused", "settings"]) {
    const f = await setup(t);
    evidence(f.db, f.a.id);
    const quote = f.monitor.estimate(f.a.id, { symbol: "INTC" });
    const job = f.monitor.enqueue(f.a.id, {
      quoteId: quote.quoteId,
      requestKey: mode,
    });
    if (mode === "key")
      f.db.prepare("DELETE FROM ai_credentials WHERE user_id=?").run(f.a.id);
    if (mode === "consent")
      f.db
        .prepare("UPDATE ai_preferences SET enabled=0 WHERE user_id=?")
        .run(f.a.id);
    if (mode === "budget")
      f.db
        .prepare("UPDATE ai_preferences SET run_limit=1 WHERE user_id=?")
        .run(f.a.id);
    if (mode === "paused")
      f.db
        .prepare("INSERT INTO admin_controls VALUES('aiPaused',1,?)")
        .run(Date.now());
    if (mode === "settings")
      f.db
        .prepare(
          "UPDATE ai_preferences SET model='gemini-4-carbon' WHERE user_id=?",
        )
        .run(f.a.id);
    await f.app.intelligenceEngine.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
    assert.equal(
      f.db.prepare("SELECT status FROM ai_jobs WHERE id=?").get(job.id).status,
      mode === "paused" ? "queued" : "failed",
    );
  }
});

test("automatic watch is opt-in, reacts to semantic new evidence and never pays again for unchanged snapshots", async (t) => {
  const f = await setup(t);
  evidence(f.db, f.a.id);
  tree(f.db, f.a.id);
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 0);
  f.monitor.update(f.a.id, "INTC", { enabled: true, setIds: [] });
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 1);
  f.db
    .prepare("UPDATE source_monitors SET next_check=0,last_attempt_at=?")
    .run(Date.now() - 7 * 3600000);
  evidence(f.db, f.a.id, "New market quote", "quote", "market");
  evidence(f.db, f.a.id, "New technical sample", "technical", "strategies");
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 1);
  const prior = f.db
    .prepare(
      "SELECT * FROM research_sources WHERE user_id=? AND kind='headline'",
    )
    .get(f.a.id);
  f.db.prepare("DELETE FROM research_sources WHERE id=?").run(prior.id);
  evidence(f.db, f.a.id);
  f.db.prepare("UPDATE source_monitors SET next_check=0").run();
  await f.app.intelligenceEngine.tick();
  assert.equal(
    f.calls.length,
    1,
    "same content with a new row id must remain unchanged",
  );
  evidence(f.db, f.a.id, "New filing report");
  f.db.prepare("UPDATE source_monitors SET next_check=0").run();
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 2);
  f.db.prepare("UPDATE source_monitors SET next_check=0").run();
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 2);
});

test("ambiguous provider failure keeps the hold and never automatically retries the attempted snapshot", async (t) => {
  const f = await setup(t, {
    generate: async () => {
      throw new ProviderError("Unconfirmed fixture usage");
    },
  });
  evidence(f.db, f.a.id);
  f.monitor.update(f.a.id, "INTC", { enabled: true, setIds: [] });
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(
    f.db.prepare("SELECT state FROM ai_ledger").get().state,
    "uncertain",
  );
  const failureReason = f.monitor.settings(f.a.id, "INTC").blockedReason;
  assert.match(failureReason, /Unconfirmed/);
  f.db
    .prepare("UPDATE source_monitors SET next_check=0,last_attempt_at=?")
    .run(Date.now() - 7 * 3600000);
  await f.app.intelligenceEngine.tick();
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.monitor.settings(f.a.id, "INTC").blockedReason, failureReason);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n, 1);
  assert.equal(
    f.db.prepare("SELECT baseline_job_id FROM source_monitors").get()
      .baseline_job_id,
    null,
  );
  assert.throws(
    () => f.monitor.estimate(f.a.id, { symbol: "INTC" }),
    /unconfirmed/,
  );
});

test("expired source-monitor leases preserve visible failure reasons and never replay their snapshot", async (t) => {
  for (const dispatched of [false, true]) {
    const f = await setup(t);
    evidence(f.db, f.a.id);
    f.monitor.update(f.a.id, "INTC", { enabled: true, setIds: [] });
    const quote = f.monitor.estimate(f.a.id, { symbol: "INTC" });
    const job = f.monitor.enqueue(f.a.id, {
      quoteId: quote.quoteId,
      requestKey: "lost-lease",
    });
    const row = f.db.prepare("SELECT * FROM ai_jobs WHERE id=?").get(job.id);
    reserve(
      f.db,
      row,
      makeSourceMonitorPrompt(JSON.parse(row.input)),
      Date.now(),
      JSON.stringify(sourceMonitorSchema),
    );
    f.db
      .prepare(
        "UPDATE ai_jobs SET status='running',lease_until=?,dispatched_at=? WHERE id=?",
      )
      .run(Date.now() - 1, dispatched ? Date.now() - 1000 : null, job.id);
    await f.app.intelligenceEngine.tick();
    const reason = f.monitor.settings(f.a.id, "INTC").blockedReason;
    assert.match(
      reason,
      dispatched
        ? /after dispatch.*reconciliation/
        : /before dispatch.*No model call/,
    );
    assert.equal(
      f.db.prepare("SELECT state FROM ai_ledger WHERE job_id=?").get(job.id)
        .state,
      dispatched ? "uncertain" : "settled",
    );
    f.db
      .prepare(
        "UPDATE source_monitors SET next_check=0,last_attempt_at=? WHERE user_id=?",
      )
      .run(Date.now() - 7 * 3600000, f.a.id);
    await f.app.intelligenceEngine.tick();
    assert.equal(f.monitor.settings(f.a.id, "INTC").blockedReason, reason);
    assert.equal(f.calls.length, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n, 1);
    f.monitor.update(f.a.id, "INTC", { enabled: true, setIds: [] });
    f.monitor.schedule();
    assert.equal(
      f.monitor.settings(f.a.id, "INTC").blockedReason,
      null,
      "explicit settings update clears the reviewed failure",
    );
  }
});

test("a recovered scheduling budget block clears when there is no new evidence", async (t) => {
  const f = await setup(t);
  evidence(f.db, f.a.id);
  await f.run();
  f.monitor.update(f.a.id, "INTC", { enabled: true, setIds: [] });
  const fresh = evidence(f.db, f.a.id, "New report");
  f.db
    .prepare("UPDATE ai_preferences SET run_limit=1 WHERE user_id=?")
    .run(f.a.id);
  f.db
    .prepare("UPDATE source_monitors SET last_attempt_at=? WHERE user_id=?")
    .run(Date.now() - 7 * 3600000, f.a.id);
  f.monitor.schedule();
  assert.match(
    f.monitor.settings(f.a.id, "INTC").blockedReason,
    /Spending limit/,
  );
  f.db.prepare("DELETE FROM research_sources WHERE id=?").run(fresh.id);
  f.db
    .prepare("UPDATE ai_preferences SET run_limit=250000 WHERE user_id=?")
    .run(f.a.id);
  f.db
    .prepare("UPDATE source_monitors SET next_check=0 WHERE user_id=?")
    .run(f.a.id);
  f.monitor.schedule();
  assert.equal(f.monitor.settings(f.a.id, "INTC").blockedReason, null);
  assert.equal(f.calls.length, 1);
});

test("public author editions, foreign owners/symbols and implicit oversized tree selections are rejected", async (t) => {
  const f = await setup(t);
  evidence(f.db, f.a.id);
  const owned = tree(f.db, f.a.id),
    foreign = tree(f.db, f.b.id),
    wrong = tree(f.db, f.a.id, "Wrong asset", "MSFT");
  const published = tree(f.db, f.a.id, "Published author");
  const article = randomUUID();
  f.db
    .prepare(
      "INSERT INTO articles(id,user_id,slug,symbol,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      article,
      f.a.id,
      "published",
      "INTC",
      "Article",
      "Body",
      Date.now(),
      Date.now(),
    );
  f.db
    .prepare("INSERT INTO article_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      randomUUID(),
      article,
      1,
      "RNT",
      "INTC",
      "Article",
      "Body",
      JSON.stringify([branch]),
      "[]",
      published,
      Date.now(),
    );
  for (const selected of [foreign, wrong, published])
    assert.throws(
      () => f.monitor.estimate(f.a.id, { symbol: "INTC", setIds: [selected] }),
      /private.*unavailable/,
    );
  for (let i = 0; i < 12; i++) tree(f.db, f.a.id, "Extra " + i);
  assert.throws(
    () => f.monitor.estimate(f.a.id, { symbol: "INTC", setIds: [] }),
    /twelve/,
  );
  assert.doesNotThrow(() =>
    f.monitor.estimate(f.a.id, { symbol: "INTC", setIds: [owned] }),
  );
  assert.equal(
    (await f.request(f.a, "GET", "/api/source-monitor?symbol=INTC"))
      .json()
      .trees.some((s) => s.id === published),
    false,
  );
  assert.equal(f.calls.length, 0);
});

test("scope changes restart the comparison once while source removal and scope ordering do not cause paid churn", async (t) => {
  const f = await setup(t);
  const a = tree(f.db, f.a.id, "One"),
    b = tree(f.db, f.a.id, "Two");
  const source = evidence(f.db, f.a.id);
  await f.run();
  assert.throws(
    () => f.monitor.estimate(f.a.id, { symbol: "INTC", setIds: [b, a] }),
    /No new/,
  );
  const quote = f.monitor.estimate(f.a.id, { symbol: "INTC", setIds: [a] });
  assert.equal(quote.snapshot.comparisonReset, true);
  f.monitor.enqueue(f.a.id, { quoteId: quote.quoteId, requestKey: "newscope" });
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 2);
  const latest = f.db
    .prepare(
      "SELECT input FROM ai_jobs WHERE kind='source-monitor' ORDER BY created_at DESC,id DESC LIMIT 1",
    )
    .get();
  assert.equal(JSON.parse(latest.input).previous, null);
  f.db.prepare("DELETE FROM research_sources WHERE id=?").run(source.id);
  assert.throws(
    () => f.monitor.estimate(f.a.id, { symbol: "INTC", setIds: [a] }),
    /No news/,
  );
});

test("automatic queued runs respect paused or changed watch selection before dispatch", async (t) => {
  for (const mode of ["paused", "changed"]) {
    const f = await setup(t);
    evidence(f.db, f.a.id);
    const a = tree(f.db, f.a.id, "One"),
      b = tree(f.db, f.a.id, "Two");
    f.monitor.update(f.a.id, "INTC", { enabled: true, setIds: [a] });
    f.monitor.schedule();
    f.monitor.update(f.a.id, "INTC", {
      enabled: mode !== "paused",
      setIds: [b],
    });
    await f.app.intelligenceEngine.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  }
});

test("malformed paid output settles usage and retains last successful baseline without verifying events", async (t) => {
  let invalid = false;
  const f = await setup(t, {
    generate: async (args) => {
      const input = JSON.parse(
        args.prompt
          .split("UNTRUSTED_DATA_START\n")[1]
          .split("\nUNTRUSTED_DATA_END")[0],
      );
      return {
        text: JSON.stringify(
          invalid
            ? {
                ...resultFor(input),
                matches: [{ ...resultFor(input).matches[0], setId: "foreign" }],
              }
            : resultFor(input),
        ),
        usage: {
          input: 500,
          output: 300,
          cached: 0,
          write5m: 0,
          write1h: 0,
          reasoning: 0,
        },
        complete: true,
        responseModel: args.model,
        requestId: "fixture",
      };
    },
  });
  tree(f.db, f.a.id);
  evidence(f.db, f.a.id);
  const success = await f.run();
  invalid = true;
  evidence(f.db, f.a.id, "Another report");
  const failed = await f.run();
  assert.equal(failed.detail.status, "failed");
  assert.equal(failed.detail.ledger.state, "settled");
  assert.equal(
    f.db
      .prepare("SELECT baseline_job_id FROM source_monitors WHERE user_id=?")
      .get(f.a.id).baseline_job_id,
    success.job.id,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM scenario_observations").get().n,
    0,
  );
});

test("both provider adapters transmit the source-monitor schema on their fixed structured endpoints", async () => {
  for (const provider of ["gemini", "anthropic"]) {
    let payload;
    const models =
      provider === "gemini" ? "gemini-4-hydrogen" : "claude-sonnet-5-5";
    const generate = createProviders({
      fetcher: async (_url, options) => {
        payload = JSON.parse(options.body);
        return new Response(
          JSON.stringify(
            provider === "gemini"
              ? {
                  usageMetadata: {
                    promptTokenCount: 1,
                    candidatesTokenCount: 1,
                    totalTokenCount: 2,
                  },
                  candidates: [
                    {
                      content: { parts: [{ text: "{}" }] },
                      finishReason: "STOP",
                    },
                  ],
                  modelVersion: models,
                }
              : {
                  usage: { input_tokens: 1, output_tokens: 1 },
                  content: [{ type: "text", text: "{}" }],
                  stop_reason: "end_turn",
                  model: models,
                },
          ),
          { status: 200 },
        );
      },
    });
    await generate({
      provider,
      model: models,
      key: providerKey,
      prompt: "fixture",
      schema: sourceMonitorSchema,
    });
    assert.deepEqual(
      provider === "gemini"
        ? payload.generationConfig.responseJsonSchema
        : payload.output_config.format.schema,
      sourceMonitorSchema,
    );
  }
});

test("persistent branch links survive later zero-match reviews and remain owner-reviewed", async (t) => {
  let link = true;
  const f = await setup(t, {
    generate: async (args) => {
      const input = JSON.parse(
        args.prompt
          .split("UNTRUSTED_DATA_START\n")[1]
          .split("\nUNTRUSTED_DATA_END")[0],
      );
      const result = resultFor(input);
      if (!link) result.matches = [];
      return {
        text: JSON.stringify(result),
        usage: {
          input: 500,
          output: 300,
          cached: 0,
          write5m: 0,
          write1h: 0,
          reasoning: 0,
        },
        complete: true,
        responseModel: args.model,
        requestId: "fixture",
      };
    },
  });
  const set = tree(f.db, f.a.id);
  evidence(f.db, f.a.id);
  const first = await f.run();
  link = false;
  evidence(f.db, f.a.id, "Follow-up report");
  await f.run();
  let overview = (
    await f.request(f.a, "GET", "/api/source-monitor?symbol=INTC")
  ).json();
  assert.equal(overview.latest.result.matches.length, 0);
  assert.equal(overview.signals.length, 1);
  assert.equal(overview.signals[0].jobId, first.job.id);
  assert.equal(overview.signals[0].setId, set);
  await f.request(
    f.a,
    "PATCH",
    "/api/source-monitor/jobs/" + first.job.id + "/review",
    { dismissedMatches: [0] },
  );
  overview = (
    await f.request(f.a, "GET", "/api/source-monitor?symbol=INTC")
  ).json();
  assert.deepEqual(overview.signals, []);
});

test("two previews for one snapshot cannot dispatch duplicate jobs and schema-inclusive caps are enforced", async (t) => {
  const f = await setup(t);
  evidence(f.db, f.a.id);
  const first = f.monitor.estimate(f.a.id, { symbol: "INTC" }),
    second = f.monitor.estimate(f.a.id, { symbol: "INTC" });
  f.monitor.enqueue(f.a.id, {
    quoteId: first.quoteId,
    requestKey: "first-preview",
  });
  assert.throws(
    () =>
      f.monitor.enqueue(f.a.id, {
        quoteId: second.quoteId,
        requestKey: "second-preview",
      }),
    /analysis in progress/,
  );
  const queued = f.db
    .prepare(
      "SELECT input FROM ai_jobs WHERE user_id=? AND kind='source-monitor'",
    )
    .get(f.a.id);
  const input = JSON.parse(queued.input);
  const withoutSchema = reservationFor(
    (
      await import("../server/ai/source-monitor-contract.js")
    ).makeSourceMonitorPrompt(input),
    priceFor(model),
  );
  assert.ok(first.maxCost > withoutSchema);
  f.db
    .prepare("UPDATE ai_preferences SET run_limit=? WHERE user_id=?")
    .run(withoutSchema, f.a.id);
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  assert.equal(
    (
      await f.request(f.b, "POST", "/api/source-monitor", {
        quoteId: first.quoteId,
        requestKey: "foreign",
      })
    ).statusCode,
    409,
  );
});

test("source context keeps fundamental and filing coverage bounded alongside headline volume and oversized tree context fails before billing", async (t) => {
  const f = await setup(t);
  evidence(f.db, f.a.id, "Company fundamentals", "fundamentals", "sec");
  evidence(f.db, f.a.id, "Company filing", "filing", "sec");
  for (let i = 0; i < 90; i++) evidence(f.db, f.a.id, "Headline " + i);
  const quote = f.monitor.estimate(f.a.id, { symbol: "INTC" });
  f.monitor.enqueue(f.a.id, { quoteId: quote.quoteId, requestKey: "diverse" });
  const queued = f.db
    .prepare("SELECT input FROM ai_jobs WHERE kind='source-monitor'")
    .get();
  const input = JSON.parse(queued.input);
  assert.equal(input.sources.length, 24);
  assert.ok(input.sources.some((s) => s.kind === "fundamentals"));
  assert.ok(input.sources.some((s) => s.kind === "filing"));
  f.db.prepare("UPDATE ai_jobs SET status='cancelled'").run();
  for (let i = 0; i < 12; i++) {
    const set = tree(f.db, f.a.id, "Huge " + i);
    const branches = Array.from({ length: 12 }, (_, n) => ({
      ...branch,
      eventKey: "event" + n,
      condition: "x".repeat(2000),
      invalidation: "y".repeat(2000),
    }));
    f.db
      .prepare("UPDATE scenario_sets SET branches=? WHERE id=?")
      .run(JSON.stringify(branches), set);
  }
  assert.throws(
    () => f.monitor.estimate(f.a.id, { symbol: "INTC" }),
    (error) => error.statusCode === 409 && /fewer trees/.test(error.message),
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
});
