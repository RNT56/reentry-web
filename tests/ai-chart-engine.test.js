import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";
import { createProviders } from "../server/ai/providers.js";
import { chartResultSchema } from "../server/ai/chart-contract.js";

const origin = "http://localhost:4173";
const key = "fixture-key-not-real-12345678901234567890";
function user(db, name) {
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
  return { id, token };
}
function modelResult(chart) {
  return {
    summary: "A daily-close break above resistance opens the upper range.",
    overlays: [
      {
        id: "resistance",
        type: "horizontal",
        label: "Resistance",
        rationale: "Repeated closes cluster near this level.",
        anchors: [{ time: chart.bars.at(-1).time, price: 120 }],
        scenarioKeys: ["breakout"],
      },
    ],
    scenarios: [
      {
        eventKey: "breakout",
        title: "Close clears resistance",
        low: 125,
        high: 145,
        currency: chart.currency,
        horizonDays: 90,
        invalidation: "A daily close loses support.",
        trigger: { direction: "above", price: 120 },
        invalidationTrigger: { direction: "below", price: 100 },
        overlayIds: ["resistance"],
      },
    ],
  };
}
async function setup(t, { result, generate, history } = {}) {
  const db = openStore(":memory:"),
    calls = [],
    histories = [];
  const market = {
    search: async () => ({ results: [] }),
    quote: async () => {
      throw Error("Daily chart scenarios must not request quotes");
    },
    history: async (symbol, range, currency) => {
      histories.push({ symbol, range, currency });
      if (history) return history(symbol, range, currency);
      const start = Math.floor(Date.now() / 86400000) * 86400 - 45 * 86400;
      return {
        symbol,
        range,
        currency,
        source: "Fixture market",
        timeZone: "UTC",
        interval: "1d",
        points: Array.from({ length: 40 }, (_, i) => ({
          time: start + i * 86400,
          price: 100 + i,
          open: 99 + i,
          high: 101 + i,
          low: 98 + i,
          close: 100 + i,
          volume: 1000 + i,
        })),
      };
    },
  };
  const app = await createApp({
    db,
    origin,
    logger: false,
    disableRateLimit: true,
    marketService: market,
    platform: {
      masterKey: randomBytes(32).toString("base64"),
      workerEnabled: true,
      startWorker: false,
      connectors: {
        status: () => [],
        collect: async () => {
          throw Error("Chart job must not collect private research sources");
        },
      },
      generate: async (p) => {
        calls.push(p);
        if (generate) return generate(p);
        const chart = JSON.parse(
          p.prompt
            .split("UNTRUSTED_DATA_START\n")[1]
            .split("\nUNTRUSTED_DATA_END")[0],
        ).chart;
        return {
          text:
            result === undefined ? JSON.stringify(modelResult(chart)) : result,
          usage: {
            input: 100,
            output: 100,
            cached: 0,
            write5m: 0,
            write1h: 0,
            reasoning: 0,
          },
          complete: true,
          requestId: "fixture-request",
          responseModel: p.model,
        };
      },
    },
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  const a = user(db, "chartuser"),
    b = user(db, "otheruser");
  const call = (who, url, method = "GET", payload) =>
    app.inject({
      url,
      method,
      payload,
      headers: {
        origin,
        "x-reentry-request": "1",
        ...(who ? { cookie: "reentry_dev=" + who.token } : {}),
      },
    });
  for (const who of [a, b]) {
    assert.equal(
      (
        await call(who, "/api/research/assets/INTC", "PUT", {
          name: "Intel",
          automatic: false,
          intervalHours: 24,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await call(who, "/api/ai/credentials/gemini", "PUT", { key }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await call(who, "/api/ai/preferences", "PUT", {
          enabled: true,
          model: "gemini-4-hydrogen",
          monthlyLimit: 5000000,
          runLimit: 250000,
          consent: true,
        })
      ).statusCode,
      200,
    );
  }
  const preview = async (who = a) => {
    const r = await call(who, "/api/chart-analysis/estimate", "POST", {
      symbol: "INTC",
      range: "1y",
      currency: "EUR",
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const enqueue = async (q, who = a, requestKey = randomUUID()) =>
    call(who, "/api/chart-analysis", "POST", {
      quoteId: q.quoteId,
      requestKey,
    });
  return { app, db, a, b, call, preview, enqueue, calls, histories };
}
test("private chart quote, job, overlays and scenario links are isolated and idempotent", async (t) => {
  const { app, db, a, b, call, preview, enqueue, calls } = await setup(t);
  db.prepare("INSERT INTO chart_workspaces VALUES(?,?,?,?,?,?)").run(
    a.id,
    "INTC",
    1,
    1,
    '{"private":"manual drawing"}',
    Date.now(),
  );
  const manual = db.prepare("SELECT * FROM chart_workspaces").get();
  assert.equal(
    (await call(null, "/api/chart-analysis?symbol=INTC")).statusCode,
    401,
  );
  const q = await preview();
  assert.equal(q.snapshot.barCount, 40);
  assert.ok(q.maxCost > 0 && q.maxCost <= 250000);
  assert.equal(calls.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  assert.equal((await enqueue(q, b)).statusCode, 409);
  const first = await enqueue(q, a, "same-request");
  assert.equal(first.statusCode, 200, first.body);
  const job = first.json();
  assert.deepEqual((await enqueue(q, a, "same-request")).json(), job);
  assert.equal((await enqueue(q, a, "other-request")).statusCode, 409);
  const different = await preview();
  assert.equal((await enqueue(different, a, "same-request")).statusCode, 409);
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, key);
  assert.deepEqual(calls[0].schema, chartResultSchema);
  assert.ok(!calls[0].prompt.includes("manual drawing"));
  assert.ok(!calls[0].prompt.includes("recovery"));
  const detail = await call(a, "/api/chart-analysis/" + job.id);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.headers["cache-control"], "no-store");
  const d = detail.json();
  assert.equal(d.status, "completed", d.error);
  assert.equal(d.result.overlays.length, 1);
  assert.ok(d.result.setId);
  assert.equal(d.ledger.state, "settled");
  assert.ok(d.ledger.cost > 0);
  assert.equal(
    (await call(b, "/api/chart-analysis/" + job.id)).statusCode,
    404,
  );
  assert.equal(
    (await call(b, "/api/chart-analysis?symbol=INTC")).json().jobs.length,
    0,
  );
  const set = db
    .prepare("SELECT * FROM scenario_sets WHERE id=?")
    .get(d.result.setId);
  assert.equal(set.user_id, a.id);
  assert.equal(JSON.parse(set.provenance).kind, "ai-chart");
  assert.equal(JSON.parse(set.provenance).snapshotHash, d.snapshot.hash);
  assert.equal(JSON.parse(set.branches)[0].chartCondition.basis, "daily-close");
  const linked = await call(a, "/api/scenarios/" + d.result.setId);
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal(linked.headers["cache-control"], "no-store");
  assert.equal(linked.json().id, d.result.setId);
  assert.equal(linked.json().symbol, "INTC");
  assert.equal(linked.json().provenance.jobId, job.id);
  assert.equal(linked.json().branches[0].eventKey, "breakout");
  assert.equal(
    (await call(b, "/api/scenarios/" + d.result.setId)).statusCode,
    404,
  );
  assert.equal(
    (await call(null, "/api/scenarios/" + d.result.setId)).statusCode,
    401,
  );
  assert.deepEqual(db.prepare("SELECT * FROM chart_workspaces").get(), manual);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM articles").get().n, 0);
});
test("chart budget and settings changes stop dispatch without paid calls", async (t) => {
  const { app, db, a, call, preview, enqueue, calls } = await setup(t);
  const q = await preview();
  db.prepare("UPDATE ai_preferences SET run_limit=1000 WHERE user_id=?").run(
    a.id,
  );
  assert.equal((await enqueue(q)).statusCode, 409);
  assert.equal(calls.length, 0);
  db.prepare("UPDATE ai_preferences SET run_limit=250000 WHERE user_id=?").run(
    a.id,
  );
  const next = await preview(),
    j = (await enqueue(next)).json();
  db.prepare("UPDATE ai_preferences SET model=? WHERE user_id=?").run(
    "gemini-4-argon",
    a.id,
  );
  await app.intelligenceEngine.tick();
  const detail = (await call(a, "/api/chart-analysis/" + j.id)).json();
  assert.equal(detail.status, "failed");
  assert.match(detail.error, /settings changed/);
  assert.equal(calls.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
});
test("queued chart cancellation and removed credentials never dispatch", async (t) => {
  const { app, db, a, call, preview, enqueue, calls } = await setup(t);
  const q = await preview(),
    job = (await enqueue(q)).json();
  assert.equal(
    (await call(a, "/api/research/jobs/" + job.id, "DELETE")).statusCode,
    200,
  );
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 0);
  const q2 = await preview(),
    j2 = (await enqueue(q2)).json();
  assert.equal(
    (await call(a, "/api/ai/credentials/gemini", "DELETE")).statusCode,
    200,
  );
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 0);
  assert.equal(
    (await call(a, "/api/chart-analysis/" + j2.id)).json().status,
    "cancelled",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
});
test("invalid paid chart output settles usage and never creates partial overlays or trees", async (t) => {
  const { app, db, a, call, preview, enqueue, calls } = await setup(t, {
    result:
      '{"summary":"unsupported","overlays":[{"bad":"shape"}],"scenarios":[]}',
  });
  const q = await preview(),
    job = (await enqueue(q)).json();
  await app.intelligenceEngine.tick();
  const d = (await call(a, "/api/chart-analysis/" + job.id)).json();
  assert.equal(d.status, "failed");
  assert.equal(d.ledger.state, "settled");
  assert.ok(d.ledger.cost > 0);
  assert.equal(d.result, null);
  assert.equal(calls.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM scenario_sets").get().n, 0);
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 1);
});
test("chart history mismatch and invalid time ranges fail before any ledger reservation", async (t) => {
  const { db, a, call, calls } = await setup(t, { history: async () => ({}) });
  for (const payload of [
    { symbol: "INTC", range: "1d", currency: "EUR" },
    { symbol: "INTC", range: "1y", currency: "EUR" },
  ]) {
    const r = await call(a, "/api/chart-analysis/estimate", "POST", payload);
    assert.ok(r.statusCode >= 400, r.body);
  }
  assert.equal(calls.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
});
test("both provider adapters use the requested chart schema", async () => {
  const bodies = [];
  const generate = createProviders({
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      return new Response(
        JSON.stringify(
          url.includes("googleapis")
            ? {
                candidates: [
                  {
                    finishReason: "STOP",
                    content: { parts: [{ text: "{}" }] },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 2,
                  candidatesTokenCount: 1,
                  totalTokenCount: 3,
                },
              }
            : {
                content: [{ type: "text", text: "{}" }],
                usage: { input_tokens: 2, output_tokens: 1 },
                stop_reason: "end_turn",
                model: "claude-sonnet-5-5",
              },
        ),
      );
    },
  });
  for (const [provider, model] of [
    ["gemini", "gemini-4-hydrogen"],
    ["anthropic", "claude-sonnet-5-5"],
  ])
    await generate({
      provider,
      model,
      key,
      prompt: "fixture",
      schema: chartResultSchema,
    });
  assert.deepEqual(
    bodies[0].generationConfig.responseJsonSchema,
    chartResultSchema,
  );
  assert.deepEqual(bodies[1].output_config.format.schema, chartResultSchema);
});

test("chart dispatch rechecks a reduced spending cap and stale snapshot before reserving", async (t) => {
  const { app, db, a, call, preview, enqueue, calls } = await setup(t);
  const q = await preview(),
    job = (await enqueue(q)).json();
  db.prepare("UPDATE ai_preferences SET monthly_limit=1 WHERE user_id=?").run(
    a.id,
  );
  await app.intelligenceEngine.tick();
  assert.equal(
    (await call(a, "/api/chart-analysis/" + job.id)).json().status,
    "failed",
  );
  assert.equal(calls.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  db.prepare(
    "UPDATE ai_preferences SET monthly_limit=5000000 WHERE user_id=?",
  ).run(a.id);
  const next = await preview(),
    stale = (await enqueue(next)).json();
  const row = db.prepare("SELECT input FROM ai_jobs WHERE id=?").get(stale.id),
    input = JSON.parse(row.input);
  input.preparedAt = Date.now() - 900001;
  db.prepare("UPDATE ai_jobs SET input=? WHERE id=?").run(
    JSON.stringify(input),
    stale.id,
  );
  await app.intelligenceEngine.tick();
  const d = (await call(a, "/api/chart-analysis/" + stale.id)).json();
  assert.equal(d.status, "failed");
  assert.match(d.error, /expired before dispatch/);
  assert.equal(calls.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
});

test("unconfirmed chart usage keeps its hold without retrying the paid call", async (t) => {
  const { app, db, a, call, preview, enqueue, calls } = await setup(t, {
    generate: async () => {
      throw Error("lost response");
    },
  });
  const q = await preview(),
    job = (await enqueue(q)).json();
  await app.intelligenceEngine.tick();
  const d = (await call(a, "/api/chart-analysis/" + job.id)).json();
  assert.equal(d.status, "failed");
  assert.equal(d.ledger.state, "uncertain");
  assert.equal(d.ledger.cost, null);
  assert.equal(d.ledger.reserved, q.maxCost);
  assert.equal(d.budget.spending.held, q.maxCost);
  await app.intelligenceEngine.tick();
  assert.equal(calls.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM scenario_sets").get().n, 0);
});
