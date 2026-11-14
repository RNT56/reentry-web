import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, emptyPortfolio } from "../server/store.js";
import { createApp } from "../server/app.js";
import { migrate } from "../server/db/migrations.js";
import { migratePlatform } from "../server/platform/schema.js";
import { createVault } from "../server/ai/vault.js";
import { priceFor, costFor, reservationFor } from "../server/ai/catalog.js";
import { reserve, spending } from "../server/ai/billing.js";
import {
  geminiUsage,
  claudeUsage,
  createProviders,
  ProviderError,
} from "../server/ai/providers.js";
import { validateResult } from "../server/ai/contract.js";
import {
  createSet,
  observePrice,
  setView,
} from "../server/intelligence/scenarios.js";
import { createConnectors } from "../server/intelligence/connectors.js";
import { createRequestPacer } from "../server/market/pacing.js";
const origin = "http://localhost:4173",
  key = "test-key-not-real-12345678901234567890";
const branch = {
  title: "Execution improves",
  condition: "Company confirms launch",
  eventKey: "launch-confirmed",
  low: 20,
  high: 30,
  currency: "USD",
  horizonDays: 90,
  invalidation: "Launch cancelled",
  passage: "If the launch happens, a $20–30 range is plausible.",
};
const sample = {
  summary: "A limited evidence-based brief.",
  claims: [],
  sentiment: [],
  scenarios: [],
  eventMatches: [],
  limitations: ["Small evidence sample."],
};
function seed(db, name) {
  const user = randomUUID(),
    token = randomBytes(32).toString("base64url"),
    now = Date.now();
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    user,
    name,
    "fixture-password-hash",
    "fixture-recovery-hash",
    now,
  );
  db.prepare("INSERT INTO portfolios(user_id,data) VALUES(?,?)").run(
    user,
    JSON.stringify(emptyPortfolio()),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    user,
    now,
    now,
    now,
    now + 86400000,
  );
  return { id: user, token };
}
async function fixture(t, overrides = {}, ownsStore = false) {
  const directory = ownsStore
      ? mkdtempSync(path.join(tmpdir(), "reentry-close-"))
      : null,
    databasePath = directory ? path.join(directory, "test.sqlite") : ":memory:",
    db = openStore(databasePath),
    calls = [];
  const market = {
    quote: async (symbol) => ({
      symbol,
      price: 22,
      currency: "EUR",
      originalPrice: 25,
      originalCurrency: "USD",
      time: Date.now() / 1000,
      source: "Fixture market",
    }),
    search: async () => ({ results: [] }),
    history: async () => ({}),
  };
  const connectors = {
    status: () => [{ id: "fixture", label: "Test source", configured: true }],
    collect: async (asset) => ({
      sources: [
        {
          kind: "headline",
          title: asset.symbol + " launch",
          url: "https://example.com/filing",
          content: "The company announced a launch.",
          published_at: Date.now(),
          connector: "fixture",
        },
      ],
      coverage: [{ connector: "fixture", status: "available", count: 1 }],
    }),
  };
  const generate = async (p) => {
    calls.push(p);
    return {
      text: JSON.stringify(sample),
      usage: {
        input: 200,
        output: 100,
        cached: 0,
        reasoning: 0,
        write5m: 0,
        write1h: 0,
      },
      complete: true,
      requestId: "req-fixture",
      responseModel: p.model,
    };
  };
  const app = await createApp({
    db: ownsStore ? undefined : db,
    databasePath,
    origin,
    logger: false,
    disableRateLimit: true,
    marketService: market,
    platform: {
      masterKey: randomBytes(32).toString("base64"),
      workerEnabled: true,
      startWorker: false,
      authorUsernames: "author",
      authorName: "RNT",
      connectors,
      generate,
      ...overrides,
    },
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  const a = seed(db, "author"),
    b = seed(db, "reader");
  const client =
    (user) =>
    async (url, method = "GET", payload) => {
      const response = await app.inject({
        url,
        method,
        payload,
        headers: {
          origin,
          "x-reentry-request": "1",
          ...(user ? { cookie: "reentry_dev=" + user.token } : {}),
        },
      });
      return {
        status: response.statusCode,
        body: response.headers["content-type"]?.includes("application/json")
          ? response.json()
          : response.body,
        headers: response.headers,
      };
    };
  const ca = client(a),
    cb = client(b),
    anon = client(null);
  async function enable(c = ca) {
    assert.equal(
      (await c("/api/ai/credentials/gemini", "PUT", { key })).status,
      200,
    );
    assert.equal(
      (
        await c("/api/ai/preferences", "PUT", {
          enabled: true,
          model: "gemini-4-hydrogen",
          monthlyLimit: 5000000,
          runLimit: 250000,
          consent: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await c("/api/research/assets/INTC", "PUT", {
          name: "Intel",
          automatic: false,
          intervalHours: 24,
        })
      ).status,
      200,
    );
  }
  const enqueue = (c = ca, requestKey = randomUUID()) =>
    c("/api/research/jobs", "POST", { symbol: "INTC", requestKey });
  return { db, app, market, a, b, ca, cb, anon, enable, enqueue, calls };
}
test("credential vault authenticates owner and provider; corruption and absent master key fail closed", () => {
  const vault = createVault(randomBytes(32).toString("base64")),
    sealed = vault.seal("alice", "gemini", key);
  assert.equal(vault.open("alice", "gemini", sealed.encrypted), key);
  assert.ok(!sealed.encrypted.includes(key));
  assert.throws(() => vault.open("bob", "gemini", sealed.encrypted));
  assert.throws(() => vault.open("alice", "anthropic", sealed.encrypted));
  assert.throws(() => createVault("bad"));
  assert.equal(createVault("").available, false);
  assert.throws(() => createVault("").seal("a", "gemini", key));
  assert.notEqual(
    vault.seal("alice", "gemini", key).encrypted,
    sealed.encrypted,
  );
});
test("pricing accounts for reasoning/cache, scheduled price changes and stale catalog refusal", () => {
  const u = geminiUsage({
    promptTokenCount: 1000,
    cachedContentTokenCount: 200,
    candidatesTokenCount: 300,
    thoughtsTokenCount: 100,
    totalTokenCount: 1400,
  });
  assert.equal(u.input, 800);
  assert.equal(u.output, 400);
  assert.equal(
    costFor(u, priceFor("gemini-3.5-flash-lite", Date.parse("2026-11-14"))),
    1246,
  );
  const c = claudeUsage({
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 200,
    cache_creation_input_tokens: 100,
    cache_creation: {
      ephemeral_1h_input_tokens: 40,
      ephemeral_5m_input_tokens: 60,
    },
  });
  assert.equal(
    costFor(c, priceFor("claude-sonnet-5-5", Date.parse("2026-11-14"))),
    1030,
  );
  assert.throws(() => geminiUsage({ promptTokenCount: 5, totalTokenCount: 9 }));
  assert.throws(() => claudeUsage({ input_tokens: -1, output_tokens: 10 }));
  assert.equal(
    priceFor("gemini-3.8-flash", Date.parse("2027-01-01")).input,
    1.5,
  );
  assert.equal(
    priceFor("claude-haiku-5-5", Date.parse("2026-11-14"), 100001).input,
    0.5,
  );
  assert.throws(() =>
    priceFor("gemini-3.5-flash-lite", Date.parse("2027-02-13")),
  );
  assert.throws(() =>
    reservationFor(
      "x".repeat(80000),
      priceFor("gemini-3.5-flash-lite", Date.parse("2026-11-14")),
    ),
  );
});
test("additive intelligence migrations preserve core rows and permit a portfolio-only image rollback", () => {
  const db = openStore(":memory:");
  try {
    seed(db, "existing");
    const before = db.prepare("SELECT * FROM portfolios").all();
    migratePlatform(db);
    migratePlatform(db);
    migrate(db);
    assert.deepEqual(db.prepare("SELECT * FROM portfolios").all(), before);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
  } finally {
    db.close();
  }
});
test("provider adapters send only fixed-host structured calls and sanitize provider errors", async () => {
  const seen = [];
  const generate = createProviders({
    fetcher: async (url, options) => {
      seen.push({ url, options });
      return new Response(
        JSON.stringify({
          modelVersion: "gemini-4-hydrogen",
          responseId: "test",
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30,
          },
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: JSON.stringify(sample) }] },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
  const result = await generate({
    provider: "gemini",
    model: "gemini-4-hydrogen",
    key,
    prompt: "untrusted fixture",
  });
  assert.equal(result.usage.output, 20);
  assert.ok(!seen[0].url.includes(key));
  assert.equal(seen[0].options.headers["x-goog-api-key"], key);
  assert.equal(seen[0].options.redirect, "error");
  const body = JSON.parse(seen[0].options.body);
  assert.equal(body.tools, undefined);
  assert.equal(
    body.generationConfig.responseJsonSchema.additionalProperties,
    false,
  );
  for (const [status, uncertain] of [
    [401, false],
    [429, false],
    [503, true],
  ]) {
    const bad = createProviders({
      fetcher: async () => new Response("SECRET:" + key, { status }),
    });
    await assert.rejects(
      bad({
        provider: "anthropic",
        model: "claude-haiku-5-5",
        key,
        prompt: "x",
      }),
      (e) => e.uncertain === uncertain && !e.message.includes(key),
    );
  }
});
test("AI settings, keys, sources, jobs and ledgers are owner-scoped; user-controlled role flags have no effect", async (t) => {
  const { ca, cb, anon, db, a, enable, enqueue, app, calls } = await fixture(t);
  await enable();
  assert.equal((await anon("/api/intelligence")).status, 401);
  assert.equal((await cb("/api/journal")).status, 403);
  const info = (await ca("/api/intelligence")).body;
  assert.equal(info.author, true);
  assert.equal(info.authorName, "RNT");
  assert.equal(info.preferences.monthlyLimit, 5000000);
  assert.ok(!JSON.stringify(info).includes(key));
  assert.ok(
    !db
      .prepare("SELECT encrypted FROM ai_credentials WHERE user_id=?")
      .get(a.id)
      .encrypted.includes(key),
  );
  assert.deepEqual((await cb("/api/intelligence")).body.credentials, []);
  const j = (await enqueue()).body;
  assert.equal((await cb("/api/research/jobs/" + j.id)).status, 404);
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, key);
  assert.ok(!calls[0].prompt.includes("holdings"));
  assert.ok(!calls[0].prompt.includes("recovery_hash"));
  assert.equal(
    (await ca("/api/research/jobs/" + j.id)).body.status,
    "completed",
  );
  assert.equal((await ca("/api/ai/costs")).body.entries.length, 1);
  assert.equal((await cb("/api/ai/costs")).body.entries.length, 0);
  assert.ok(
    !JSON.stringify((await ca("/api/research/export")).body).includes(key),
  );
  assert.equal(
    (
      await cb("/api/journal", "POST", {
        title: "Hijack",
        symbol: "INTC",
        body: "a",
        author: true,
      })
    ).status,
    403,
  );
});
test("job idempotency, opt-in, reservation caps and key revocation prevent duplicate or unauthorized spend", async (t) => {
  const { db, a, ca, app, enable, enqueue, calls } = await fixture(t);
  assert.equal((await enqueue()).status, 409);
  await enable();
  const j = await enqueue(ca, "same-key");
  assert.deepEqual((await enqueue(ca, "same-key")).body, j.body);
  await app.intelligenceEngine.tick();
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 1);
  db.prepare("UPDATE ai_preferences SET monthly_limit=1 WHERE user_id=?").run(
    a.id,
  );
  const blocked = (await enqueue()).body;
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 1);
  assert.match(
    (await ca("/api/research/jobs/" + blocked.id)).body.error,
    /Spending limit/,
  );
  const queued = (await enqueue()).body;
  await ca("/api/ai/credentials/gemini", "DELETE");
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 1);
  assert.equal(
    (await ca("/api/research/jobs/" + queued.id)).body.status,
    "cancelled",
  );
});
test("reservations serialize against all open holds, including previous months", async (t) => {
  const { db, a, enable, enqueue } = await fixture(t);
  await enable();
  const j1 = (await enqueue()).body,
    j2 = (await enqueue()).body,
    p = priceFor("gemini-4-hydrogen"),
    amount = reservationFor("test", p);
  db.prepare("UPDATE ai_preferences SET monthly_limit=? WHERE user_id=?").run(
    amount,
    a.id,
  );
  const row = (id) => db.prepare("SELECT * FROM ai_jobs WHERE id=?").get(id);
  reserve(db, row(j1.id), "test");
  assert.throws(() => reserve(db, row(j2.id), "test"), /Spending limit/);
  db.prepare(
    "UPDATE ai_ledger SET state='uncertain',created_at=? WHERE job_id=?",
  ).run(Date.parse("2026-01-01"), j1.id);
  assert.equal(spending(db, a.id).held, amount);
  assert.throws(() => reserve(db, row(j2.id), "test"), /Spending limit/);
});
test("ambiguous failures keep a hold, never retry, and only the owner can reconcile once", async (t) => {
  let calls = 0;
  const { app, ca, cb, enable, enqueue } = await fixture(t, {
    generate: async () => {
      calls++;
      throw new ProviderError("Timeout after dispatch.", true);
    },
  });
  await enable();
  const j = (await enqueue()).body;
  await app.intelligenceEngine.tick();
  await app.intelligenceEngine.tick();
  assert.equal(calls, 1);
  let ledger = (await ca("/api/ai/costs")).body;
  assert.equal(ledger.entries[0].state, "uncertain");
  assert.ok(ledger.totals.held > 0);
  assert.equal((await ca("/api/research/jobs/" + j.id)).body.status, "failed");
  const url = "/api/ai/costs/" + ledger.entries[0].id + "/reconcile",
    payload = { cost: 123, note: "Provider request receipt" };
  assert.equal((await cb(url, "POST", payload)).status, 404);
  assert.equal((await ca(url, "POST", payload)).status, 200);
  assert.equal((await ca(url, "POST", payload)).status, 404);
  ledger = (await ca("/api/ai/costs")).body;
  assert.equal(ledger.totals.held, 0);
  assert.equal(ledger.totals.spent, 123);
});
test("invalid structured output is still billed; unknown source citations are rejected", async (t) => {
  const { app, ca, enable, enqueue } = await fixture(t, {
    generate: async (p) => ({
      text: "invalid json",
      complete: true,
      responseModel: p.model,
      requestId: "invalid-result",
      usage: {
        input: 100,
        output: 50,
        cached: 0,
        reasoning: 0,
        write5m: 0,
        write1h: 0,
      },
    }),
  });
  await enable();
  const j = (await enqueue()).body;
  await app.intelligenceEngine.tick();
  assert.equal((await ca("/api/research/jobs/" + j.id)).body.status, "failed");
  const l = (await ca("/api/ai/costs")).body.entries[0];
  assert.equal(l.state, "settled");
  assert.equal(l.cost, 525);
  assert.throws(() =>
    validateResult(
      {
        ...sample,
        claims: [{ text: "Fake", kind: "fact", sourceIds: ["unknown"] }],
      },
      { sources: [] },
    ),
  );
  assert.throws(() =>
    validateResult(
      {
        ...sample,
        scenarios: [{ ...branch, sourceIds: ["a"], passage: "invented quote" }],
      },
      { sources: [{ id: "a" }], article: { body: "actual text" } },
    ),
  );
});
test("expired worker leases are not redispatched and pre-dispatch holds are released", async (t) => {
  const { app, db, ca, enable, enqueue, calls } = await fixture(t);
  await enable();
  const j1 = (await enqueue()).body,
    j2 = (await enqueue()).body;
  for (const [j, dispatched] of [
    [j1, true],
    [j2, false],
  ]) {
    const row = db.prepare("SELECT * FROM ai_jobs WHERE id=?").get(j.id);
    reserve(db, row, "test");
    db.prepare(
      "UPDATE ai_jobs SET status='running',lease_until=?,dispatched_at=? WHERE id=?",
    ).run(Date.now() - 1000, dispatched ? Date.now() - 2000 : null, j.id);
  }
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 0);
  const entries = (await ca("/api/ai/costs")).body.entries;
  assert.equal(entries.find((x) => x.job_id === j1.id).state, "uncertain");
  assert.equal(entries.find((x) => x.job_id === j2.id).cost, 0);
});
test("automatic research is opt-in, uses each owner key and advances the schedule without replaying a bucket", async (t) => {
  const { db, a, app, enable, calls } = await fixture(t);
  await enable();
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 0);
  db.prepare(
    "UPDATE research_assets SET automatic=1,next_run=0 WHERE user_id=?",
  ).run(a.id);
  await app.intelligenceEngine.tick();
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 1);
  assert.ok(
    db.prepare("SELECT next_run FROM research_assets WHERE user_id=?").get(a.id)
      .next_run > Date.now(),
  );
});
test("publication is explicit, versioned, XSS-safe and independent of user forks and private evidence", async (t) => {
  const { ca, cb, anon, db, a } = await fixture(t);
  const body = branch.passage + '\n\n<script>alert("unsafe")</script>';
  const created = await ca("/api/journal", "POST", {
    symbol: "INTC",
    title: "A conditional thesis",
    body,
  });
  assert.equal(created.status, 200);
  const id = created.body.id,
    url = "/api/journal/" + id;
  let draft = (await ca(url)).body;
  assert.equal((await cb(url)).status, 403);
  assert.equal((await anon("/api/public/journal")).body.articles.length, 0);
  assert.equal(
    (
      await ca(url, "PUT", {
        ...draft,
        branches: [branch],
        sources: [
          { title: "Company filing", url: "https://example.com/report" },
        ],
      })
    ).status,
    200,
  );
  assert.equal((await ca(url, "PUT", draft)).status, 409);
  draft = (await ca(url)).body;
  assert.equal(
    (
      await ca(url + "/publish", "POST", {
        revision: draft.revision,
        reviewed: false,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await ca(url + "/publish", "POST", {
        revision: draft.revision,
        reviewed: true,
      })
    ).status,
    200,
  );
  const publicUrl = "/api/public/journal/" + draft.slug,
    pub = (await anon(publicUrl)).body;
  assert.equal(pub.author, "RNT");
  assert.equal(pub.scenario.branches.length, 1);
  assert.ok(!JSON.stringify(pub).includes(a.id));
  assert.equal(pub.user_id, undefined);
  const html = (await anon("/journal/" + draft.slug)).body;
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  const fork = (
    await cb(publicUrl + "/fork", "POST", { revision: draft.revision })
  ).body;
  assert.ok(fork.id);
  const privateSet = (await cb("/api/scenarios")).body.sets[0];
  assert.equal(privateSet.provenance.kind, "public-fork");
  assert.equal(
    (
      await ca("/api/scenarios/" + fork.id + "/events", "POST", {
        eventKey: branch.eventKey,
        title: "Stolen",
        url: "https://example.com",
        occurredAt: Date.now(),
        verified: true,
      })
    ).status,
    404,
  );
  const originalBody = pub.body;
  draft = (
    await ca(url, "PUT", {
      ...draft,
      title: "Revised privately",
      body: "A private edit of the thesis. " + branch.passage,
    })
  ).body;
  assert.equal((await anon(publicUrl)).body.body, originalBody);
  assert.equal(
    (
      await ca(url + "/publish", "POST", {
        revision: draft.revision,
        reviewed: true,
      })
    ).status,
    200,
  );
  assert.equal((await anon(publicUrl)).body.editions.length, 2);
  assert.equal((await anon(publicUrl + "?v=2")).body.body, originalBody);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM article_revisions WHERE article_id=?")
      .get(id).n,
    2,
  );
  await ca(url + "/publication", "DELETE");
  assert.equal((await anon(publicUrl)).status, 404);
  assert.equal((await cb("/api/scenarios")).body.sets.length, 1);
});
test("price evidence respects currencies, publication time and human-verified event gates", async (t) => {
  const { db, a, ca, cb, market } = await fixture(t);
  const start = Date.now() - 10000,
    setId = createSet(db, a.id, "INTC", "Thesis", [branch], null, start),
    row = db.prepare("SELECT * FROM scenario_sets WHERE id=?").get(setId);
  await observePrice(db, market, row);
  assert.equal(setView(db, row).branches[0].status.status, "watching");
  const event = {
    eventKey: branch.eventKey,
    title: "Company launch confirmed",
    url: "https://example.com/launch",
    occurredAt: start + 500,
    verified: true,
  };
  assert.equal(
    (await cb("/api/scenarios/" + setId + "/events", "POST", event)).status,
    404,
  );
  assert.equal(
    (
      await ca("/api/scenarios/" + setId + "/events", "POST", {
        ...event,
        verified: false,
      })
    ).status,
    400,
  );
  const observed = (
    await ca("/api/scenarios/" + setId + "/events", "POST", event)
  ).body;
  assert.equal(observed.branches[0].status.status, "observed");
  const evidence = observed.observations.find((o) => o.kind === "event");
  await ca("/api/scenarios/" + setId + "/events/" + evidence.id, "DELETE");
  assert.equal(setView(db, row).branches[0].status.status, "watching");
});
test("source connectors use fixed hosts, bounded responses, exact ticker news matching and report partial coverage", async () => {
  const urls = [];
  const connectors = createConnectors({
    market: {
      quote: async () => {
        throw Error("Offline");
      },
    },
    secAgent: "",
    fetcher: async (url) => {
      urls.push(url);
      if (url.includes("gdelt")) throw Error("Offline");
      return new Response(
        JSON.stringify({
          news: [
            {
              title: "Wrong company",
              relatedTickers: ["AMD"],
              link: "https://example.com/wrong",
            },
            {
              title: "Intel update",
              relatedTickers: ["INTC"],
              link: "https://example.com/intel",
              providerPublishTime: 123,
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
  const result = await connectors.collect({ symbol: "INTC", name: "Intel" });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].title, "Intel update");
  assert.equal(
    result.coverage.find((c) => c.connector === "sec").status,
    "not-configured",
  );
  assert.equal(
    result.coverage.find((c) => c.connector === "market").status,
    "unavailable",
  );
  assert.ok(
    urls.every(
      (u) =>
        u.startsWith("https://query1.finance.yahoo.com/") ||
        u.startsWith("https://api.gdeltproject.org/"),
    ),
  );
});

test("SEC collection shares normalized results across asset names and keeps reported fact periods", async () => {
  const calls = [];
  const contact = "Reentry tests operator@example.com";
  const connectors = createConnectors({
    secAgent: contact,
    market: {
      quote: async () => {
        throw Error("Not part of this fixture");
      },
    },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      let data = {};
      if (url.endsWith("/company_tickers.json"))
        data = { 0: { ticker: "INTC", cik_str: 50863 } };
      if (url.includes("/submissions/"))
        data = {
          name: "Intel",
          filings: {
            recent: {
              form: ["10-Q"],
              accessionNumber: ["0000050863-26-000001"],
              primaryDocument: ["intc.htm"],
              filingDate: ["2026-10-23"],
              reportDate: ["2026-09-30"],
              items: [""],
            },
          },
        };
      if (url.includes("/companyfacts/"))
        data = {
          facts: {
            "us-gaap": {
              Assets: {
                units: {
                  USD: [
                    {
                      end: "2026-09-30",
                      filed: "2026-10-23",
                      val: 10,
                      form: "10-Q",
                    },
                    {
                      end: "2025-12-31",
                      filed: "2026-02-10",
                      val: 9,
                      form: "10-K",
                    },
                  ],
                },
              },
            },
          },
        };
      return new Response(JSON.stringify(data), { status: 200 });
    },
  });
  const first = await connectors.collect({
    symbol: "INTC",
    name: "Intel Corporation",
  });
  const second = await connectors.collect({ symbol: "INTC", name: "Intel" });
  const sources = first.sources.filter((s) => s.connector === "sec");
  assert.equal(sources.length, 2);
  assert.match(
    sources.find((s) => s.kind === "filing").content,
    /body has not been retrieved/,
  );
  const fact = JSON.parse(
    sources.find((s) => s.kind === "fundamentals").content,
  ).metrics.Assets;
  assert.deepEqual(fact, {
    end: "2026-09-30",
    filed: "2026-10-23",
    val: 10,
    form: "10-Q",
    unit: "USD",
  });
  assert.deepEqual(
    second.sources.filter((s) => s.connector === "sec"),
    sources,
  );
  assert.equal(
    calls.filter((c) => new URL(c.url).hostname.endsWith("sec.gov")).length,
    3,
  );
  assert.ok(
    calls.every(
      (c) =>
        c.options.headers["User-Agent"] ===
        (new URL(c.url).hostname.endsWith("sec.gov") ? contact : undefined),
    ),
  );
});

test("old price hits remain observable beyond the UI sample window; retractions preserve historical knowledge", async (t) => {
  const { db, a } = await fixture(t),
    start = Date.now() - 100000,
    set = createSet(
      db,
      a.id,
      "INTC",
      "Long-lived thesis",
      [branch],
      null,
      start,
    ),
    row = db.prepare("SELECT * FROM scenario_sets WHERE id=?").get(set);
  const insert = db.prepare(
    "INSERT INTO scenario_observations VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  );
  insert.run(
    "condition",
    set,
    "event",
    branch.eventKey,
    null,
    null,
    1,
    "Verified launch",
    "https://example.com",
    start + 10,
    start + 20,
  );
  insert.run(
    "early-hit",
    set,
    "price",
    "quote",
    25,
    "USD",
    1,
    "First quote",
    "https://example.com",
    start + 30,
    start + 30,
  );
  for (let i = 0; i < 1100; i++)
    insert.run(
      "later-" + i,
      set,
      "price",
      "quote",
      50,
      "USD",
      1,
      "Later quote",
      "https://example.com",
      start + 100 + i,
      start + 100 + i,
    );
  assert.equal(setView(db, row).branches[0].status.status, "observed");
  assert.ok(setView(db, row).observations.length < 40);
  assert.equal(setView(db, row).counts.prices, 1101);
  db.prepare("UPDATE scenario_observations SET verified=0 WHERE id=?").run(
    "condition",
  );
  db.prepare("INSERT INTO ai_audit VALUES(?,?,?,?,?)").run(
    randomUUID(),
    a.id,
    "event-retracted",
    JSON.stringify({ setId: set, eventId: "condition" }),
    start + 5000,
  );
  assert.equal(
    setView(db, row, start + 3000).branches[0].status.status,
    "observed",
  );
  assert.equal(setView(db, row).branches[0].status.status, "watching");
});
test("private revisions preserve the source map and cannot alter a published set", async (t) => {
  const { db, a, b, ca, cb } = await fixture(t),
    original = createSet(db, b.id, "INTC", "My fork", [branch], {
      kind: "public-fork",
      slug: "public-thesis",
      revision: 1,
    });
  const revised = await cb("/api/scenarios/" + original + "/revise", "POST", {
    title: "My independent view",
    branches: [{ ...branch, low: 18, high: 24 }],
  });
  assert.equal(revised.status, 200);
  assert.equal(
    JSON.parse(
      db.prepare("SELECT branches FROM scenario_sets WHERE id=?").get(original)
        .branches,
    )[0].low,
    20,
  );
  assert.equal(
    (
      await ca("/api/scenarios/" + original + "/revise", "POST", {
        title: "Other account",
        branches: [branch],
      })
    ).status,
    404,
  );
  const authorSet = createSet(db, a.id, "INTC", "Published", [branch]);
  db.prepare(
    "INSERT INTO articles(id,user_id,slug,symbol,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    "article",
    a.id,
    "published",
    "INTC",
    "Published",
    "Text",
    Date.now(),
    Date.now(),
  );
  db.prepare("INSERT INTO article_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    "edition",
    "article",
    1,
    "RNT",
    "INTC",
    "Published",
    "Text",
    JSON.stringify([branch]),
    "[]",
    authorSet,
    Date.now(),
  );
  assert.equal(
    (
      await ca("/api/scenarios/" + authorSet + "/revise", "POST", {
        title: "Rewrite history",
        branches: [branch],
      })
    ).status,
    409,
  );
});
test("unrecognized model routing retains reported usage and its reservation", async (t) => {
  const { app, ca, enable, enqueue } = await fixture(t, {
    generate: async () => ({
      text: JSON.stringify(sample),
      complete: true,
      responseModel: "unpriced-model",
      requestId: "receipt-unknown",
      usage: {
        input: 100,
        output: 50,
        cached: 0,
        write5m: 0,
        write1h: 0,
        reasoning: 10,
      },
      reportedUsage: { promptTokenCount: 100, totalTokenCount: 150 },
    }),
  });
  await enable();
  await enqueue();
  await app.intelligenceEngine.tick();
  const e = (await ca("/api/ai/costs")).body.entries[0];
  assert.equal(e.state, "uncertain");
  assert.equal(e.request_id, "receipt-unknown");
  assert.equal(e.usage.output, 50);
  assert.equal(e.usage.reported.totalTokenCount, 150);
});
test("research metadata retains crypto and ISIN identity across schedule updates", async (t) => {
  const { ca } = await fixture(t);
  assert.equal(
    (
      await ca("/api/research/assets/BTC-USD", "PUT", {
        name: "Bitcoin",
        assetType: "CRYPTOCURRENCY",
        automatic: false,
        intervalHours: 24,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await ca("/api/research/assets/BTC-USD", "PUT", {
        name: "Bitcoin",
        automatic: true,
        intervalHours: 24,
      })
    ).status,
    200,
  );
  assert.equal(
    (await ca("/api/research/assets")).body.assets[0].assetType,
    "CRYPTOCURRENCY",
  );
});

test("module compatibility explicitly permits additive image rollback and rejects incompatible future schemas", () => {
  const db = openStore(":memory:");
  try {
    migratePlatform(db);
    db.prepare(
      "UPDATE module_migrations SET version=100 WHERE module='intelligence'",
    ).run();
    assert.doesNotThrow(() => migratePlatform(db));
    db.prepare(
      "UPDATE module_compatibility SET minimum_schema=100 WHERE module='intelligence'",
    ).run();
    assert.throws(() => migratePlatform(db), /incompatible/);
  } finally {
    db.close();
  }
});

test("scheduled assets with a full queue are deferred, not skipped for a whole day", async (t) => {
  const { db, a, app, enable, enqueue } = await fixture(t);
  await enable();
  await enqueue();
  await enqueue();
  db.prepare(
    "INSERT INTO research_assets(user_id,symbol,name,automatic,interval_hours,next_run) VALUES(?,?,?,?,?,?)",
  ).run(a.id, "AMD", "AMD", 1, 24, 0);
  const now = Date.now();
  await app.intelligenceEngine.tick();
  const next = db
    .prepare(
      "SELECT next_run FROM research_assets WHERE user_id=? AND symbol='AMD'",
    )
    .get(a.id).next_run;
  assert.ok(next >= now + 59000 && next < now + 120000);
});

test("shutdown records uncertain dispatched usage before closing the application-owned database", async (t) => {
  let dispatched;
  const started = new Promise((resolve) => {
    dispatched = resolve;
  });
  const { db, app, enable, enqueue } = await fixture(
    t,
    {
      generate: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new ProviderError("Interrupted during shutdown.")),
            { once: true },
          );
          dispatched();
        }),
    },
    true,
  );
  await enable();
  const job = (await enqueue()).body;
  const tick = app.intelligenceEngine.tick();
  await started;
  await app.close();
  await tick;
  assert.equal(
    db.prepare("SELECT status FROM ai_jobs WHERE id=?").get(job.id).status,
    "failed",
  );
  assert.equal(
    db.prepare("SELECT state FROM ai_ledger WHERE job_id=?").get(job.id).state,
    "uncertain",
  );
});

test("upstream pacing spaces concurrent starts, bounds in-flight work and recovers after errors", async () => {
  let now = 0;
  const starts = [],
    releases = [];
  const paced = createRequestPacer({
    interval: 160,
    limit: 3,
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
  });
  const calls = Array.from({ length: 3 }, () =>
    paced(() => {
      starts.push(now);
      return new Promise((resolve) => releases.push(resolve));
    }),
  );
  await assert.rejects(
    paced(() => {}),
    /busy/,
  );
  // Let all admitted request starts run; responses are still unresolved.
  for (let n = 0; n < 12; n++) await Promise.resolve();
  assert.deepEqual(starts, [0, 160, 320]);
  releases.forEach((resolve) => resolve());
  await Promise.all(calls);
  await assert.rejects(
    paced(() => {
      throw Error("upstream failure");
    }),
    /upstream failure/,
  );
  assert.equal(await paced(() => "available again"), "available again");
});
