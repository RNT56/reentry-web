import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";
import { putSource } from "../server/intelligence/sources.js";
import { createSet } from "../server/intelligence/scenarios.js";
import { defaultChartWorkspaceState } from "../src/domain/chart-workspace.js";
import { researchAsset } from "../server/intelligence/portfolio-sources.js";
import { initializeResearchVisibility } from "../server/intelligence/research-visibility.js";
import { createVault } from "../server/ai/vault.js";
const origin = "http://localhost:4173";
const holding = (symbol, broker = "Trade Republic") => ({
  id: randomUUID(),
  symbol,
  name: symbol + " Company",
  broker,
  lots: [{ id: randomUUID(), qty: 2, price: 10, fee: 1, date: "2026-01-01" }],
});
function seed(db, name, holdings = []) {
  const id = randomUUID(),
    token = randomBytes(32).toString("base64url"),
    now = Date.now();
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    id,
    name,
    "fixture-hash",
    "fixture-recovery",
    now,
  );
  db.prepare("INSERT INTO portfolios(user_id,data) VALUES(?,?)").run(
    id,
    JSON.stringify({ ...emptyPortfolio(), holdings }),
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
function manual(db, user, symbol, automatic = true) {
  db.prepare(
    "INSERT INTO research_assets(user_id,symbol,name,automatic,interval_hours,next_run,metadata) VALUES(?,?,?,?,?,?,?)",
  ).run(
    user,
    symbol,
    symbol + " Company",
    Number(automatic),
    24,
    Date.now() + 100000,
    JSON.stringify({ assetType: "EQUITY" }),
  );
}
function job(db, user, symbol, status = "queued", kind = "research") {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,result,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    user,
    kind,
    symbol,
    "gemini",
    "gemini-4-hydrogen",
    status,
    JSON.stringify({ kind, asset: { symbol, name: symbol + " Company" } }),
    status === "completed"
      ? JSON.stringify({
          summary: "Retained completed brief",
          claims: [],
          sentiment: [],
          scenarios: [],
          eventMatches: [],
          limitations: [],
        })
      : null,
    randomUUID(),
    Date.now(),
  );
  return id;
}
async function fixture(t, { collect } = {}) {
  const db = openStore(":memory:"),
    calls = [],
    vault = createVault(randomBytes(32).toString("base64"));
  const options = {
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
        collect: async (asset) => {
          calls.push(asset.symbol);
          if (collect) return collect(asset);
          return {
            sources: [
              {
                kind: "headline",
                title: asset.symbol + " automatic evidence",
                content: "Public evidence",
                url: "https://example.com/" + asset.symbol,
                connector: "news",
                published_at: Date.now() - 1000,
              },
            ],
            coverage: [{ connector: "news", status: "available", count: 1 }],
          };
        },
      },
      generate: async () => {
        throw Error("No paid call expected");
      },
    },
  };
  let app = await createApp(options);
  await app.ready();
  const a = seed(db, "alice", [
      holding("AAPL"),
      holding("MSFT", "Consorsbank"),
    ]),
    b = seed(db, "bob", [holding("AAPL")]);
  t.after(async () => {
    await app.close();
    db.close();
  });
  return {
    db,
    calls,
    vault,
    a,
    b,
    get app() {
      return app;
    },
    async request(user, method, url, payload) {
      const headers = { ...user.headers };
      if (payload === undefined) delete headers["content-type"];
      return app.inject({
        method,
        url,
        headers,
        ...(payload ? { payload } : {}),
      });
    },
    async restart() {
      await app.close();
      app = await createApp(options);
      await app.ready();
    },
  };
}

test("Research dismissal persists for held and manual assets, scoped to the owner, while free portfolio evidence continues", async (t) => {
  const f = await fixture(t);
  manual(f.db, f.a.id, "AAPL");
  manual(f.db, f.a.id, "NVDA");
  manual(f.db, f.b.id, "AAPL");
  const initial = (await f.request(f.a, "GET", "/api/research/assets")).json()
    .assets;
  assert.deepEqual(
    initial.map((a) => a.symbol),
    ["AAPL", "MSFT", "NVDA"],
  );
  for (const symbol of ["aapl", "NVDA"]) {
    const removed = await f.request(
      f.a,
      "DELETE",
      "/api/research/assets/" + symbol,
    );
    assert.equal(removed.statusCode, 200);
    assert.deepEqual(removed.json(), {
      ok: true,
      hidden: true,
      symbol: symbol.toUpperCase(),
    });
  }
  assert.deepEqual(
    (await f.request(f.a, "GET", "/api/research/assets"))
      .json()
      .assets.map((a) => a.symbol),
    ["MSFT"],
  );
  assert.equal(researchAsset(f.db, f.a.id, "AAPL"), null);
  assert.ok(researchAsset(f.db, f.b.id, "AAPL"));
  assert.equal(
    (await f.request(f.a, "POST", "/api/research/collect", { symbol: "AAPL" }))
      .statusCode,
    404,
  );
  await f.app.portfolioSources.tick();
  await f.app.portfolioSources.tick();
  assert.ok(f.calls.includes("AAPL"));
  assert.ok(f.calls.includes("MSFT"));
  assert.ok(!f.calls.includes("NVDA"));
  assert.ok(
    f.db
      .prepare(
        "SELECT id FROM research_sources WHERE user_id=? AND symbol='AAPL'",
      )
      .get(f.a.id),
  );
  await f.restart();
  assert.deepEqual(
    (await f.request(f.a, "GET", "/api/research/assets"))
      .json()
      .assets.map((a) => a.symbol),
    ["MSFT"],
  );
  assert.deepEqual(
    (await f.request(f.b, "GET", "/api/research/assets"))
      .json()
      .assets.map((a) => a.symbol),
    ["AAPL"],
  );
  assert.equal(
    (await f.request(f.a, "DELETE", "/api/research/assets/AAPL")).statusCode,
    200,
  );
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM research_hidden_assets WHERE user_id=?")
      .get(f.a.id).n,
    2,
  );
});

test("hiding one asset pauses only its AI automation and queued jobs and retains portfolios, histories and analyses", async (t) => {
  const f = await fixture(t);
  for (const [user, symbol] of [
    [f.a.id, "AAPL"],
    [f.a.id, "MSFT"],
    [f.b.id, "AAPL"],
  ]) {
    manual(f.db, user, symbol);
    f.app.intelligenceEngine.sourceMonitor.update(user, symbol, {
      enabled: true,
      setIds: [],
    });
  }
  const cancelled = [
    "research",
    "chart-analysis",
    "source-monitor",
    "map-article",
  ].map((kind) => job(f.db, f.a.id, "AAPL", "queued", kind));
  const other = job(f.db, f.a.id, "MSFT"),
    foreign = job(f.db, f.b.id, "AAPL"),
    running = job(f.db, f.a.id, "AAPL", "running"),
    completed = job(f.db, f.a.id, "AAPL", "completed");
  const source = putSource(f.db, f.a.id, "AAPL", {
    kind: "note",
    title: "Private thesis",
    content: "Keep this private evidence",
    connector: "manual",
  });
  const scenario = createSet(
    f.db,
    f.a.id,
    "AAPL",
    "Private scenario",
    [
      {
        eventKey: "launch",
        title: "Launch",
        condition: "Launch announced",
        invalidation: "Cancelled",
        low: 1,
        high: 2,
        currency: "EUR",
        horizonDays: 90,
      },
    ],
    null,
  );
  f.db
    .prepare("INSERT INTO chart_workspaces VALUES(?,?,?,?,?,?)")
    .run(
      f.a.id,
      "AAPL",
      1,
      1,
      JSON.stringify(defaultChartWorkspaceState()),
      Date.now(),
    );
  const before = {
    portfolio: f.db
      .prepare("SELECT * FROM portfolios WHERE user_id=?")
      .get(f.a.id),
    source: f.db
      .prepare("SELECT * FROM research_sources WHERE id=?")
      .get(source.id),
    scenario: f.db
      .prepare("SELECT * FROM scenario_sets WHERE id=?")
      .get(scenario),
    charts: f.db
      .prepare("SELECT * FROM chart_workspaces WHERE user_id=?")
      .all(f.a.id),
    completed: f.db.prepare("SELECT * FROM ai_jobs WHERE id=?").get(completed),
  };
  assert.equal(
    (await f.request(f.a, "DELETE", "/api/research/assets/AAPL")).statusCode,
    200,
  );
  for (const id of cancelled)
    assert.equal(
      f.db.prepare("SELECT status FROM ai_jobs WHERE id=?").get(id).status,
      "cancelled",
    );
  for (const id of [other, foreign])
    assert.equal(
      f.db.prepare("SELECT status FROM ai_jobs WHERE id=?").get(id).status,
      "queued",
    );
  assert.equal(
    f.db.prepare("SELECT status FROM ai_jobs WHERE id=?").get(running).status,
    "running",
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT automatic FROM research_assets WHERE user_id=? AND symbol='AAPL'",
      )
      .get(f.a.id).automatic,
    0,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT automatic FROM research_assets WHERE user_id=? AND symbol='MSFT'",
      )
      .get(f.a.id).automatic,
    1,
  );
  assert.equal(
    f.app.intelligenceEngine.sourceMonitor.settings(f.a.id, "AAPL").enabled,
    false,
  );
  assert.equal(
    f.app.intelligenceEngine.sourceMonitor.settings(f.a.id, "MSFT").enabled,
    true,
  );
  assert.equal(
    f.app.intelligenceEngine.sourceMonitor.settings(f.b.id, "AAPL").enabled,
    true,
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM portfolios WHERE user_id=?").get(f.a.id),
    before.portfolio,
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM research_sources WHERE id=?").get(source.id),
    before.source,
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM scenario_sets WHERE id=?").get(scenario),
    before.scenario,
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM chart_workspaces WHERE user_id=?").all(f.a.id),
    before.charts,
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM ai_jobs WHERE id=?").get(completed),
    before.completed,
  );
  const exported = (await f.request(f.a, "GET", "/api/research/export")).json();
  assert.deepEqual(
    exported.research_hidden_assets.map((a) => a.symbol),
    ["AAPL"],
  );
  assert.deepEqual(
    (await f.request(f.b, "GET", "/api/research/export")).json()
      .research_hidden_assets,
    [],
  );
});

test("explicit re-add clears the dismissal without restoring paid AI settings and validates before unhiding", async (t) => {
  const f = await fixture(t);
  manual(f.db, f.a.id, "AAPL");
  f.app.intelligenceEngine.sourceMonitor.update(f.a.id, "AAPL", {
    enabled: true,
    setIds: [],
  });
  await f.request(f.a, "DELETE", "/api/research/assets/AAPL");
  assert.equal(
    (
      await f.request(f.a, "PUT", "/api/research/assets/AAPL", {
        name: "Apple",
        automatic: false,
        intervalHours: 1,
      })
    ).statusCode,
    400,
  );
  assert.equal(researchAsset(f.db, f.a.id, "AAPL"), null);
  assert.equal(
    (
      await f.request(f.a, "PUT", "/api/source-monitor/AAPL", {
        enabled: true,
        setIds: [],
      })
    ).statusCode,
    404,
  );
  const restored = await f.request(f.a, "PUT", "/api/research/assets/AAPL", {
    name: "Apple",
    automatic: false,
    intervalHours: 24,
    assetType: "EQUITY",
    isin: "US0378331005",
  });
  assert.equal(restored.statusCode, 200);
  const asset = (await f.request(f.a, "GET", "/api/research/assets"))
    .json()
    .assets.find((a) => a.symbol === "AAPL");
  assert.equal(asset.name, "Apple");
  assert.equal(asset.automatic, 0);
  assert.equal(asset.inPortfolio, true);
  assert.equal(asset.isin, "US0378331005");
  assert.equal(
    f.app.intelligenceEngine.sourceMonitor.settings(f.a.id, "AAPL").enabled,
    false,
  );
  assert.ok(researchAsset(f.db, f.a.id, "AAPL"));
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM research_hidden_assets WHERE user_id=?")
      .get(f.a.id).n,
    0,
  );
});

test("dismissal atomically rolls back when an automation update cannot be saved", async (t) => {
  const f = await fixture(t);
  manual(f.db, f.a.id, "AAPL");
  f.app.intelligenceEngine.sourceMonitor.update(f.a.id, "AAPL", {
    enabled: true,
    setIds: [],
  });
  const queued = job(f.db, f.a.id, "AAPL");
  f.db.exec(
    "CREATE TEMP TRIGGER fail_visibility_change BEFORE UPDATE ON source_monitors BEGIN SELECT RAISE(ABORT,'fixture interruption'); END;",
  );
  const response = await f.request(f.a, "DELETE", "/api/research/assets/AAPL");
  assert.equal(response.statusCode, 500);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM research_hidden_assets").get().n,
    0,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT automatic FROM research_assets WHERE user_id=? AND symbol='AAPL'",
      )
      .get(f.a.id).automatic,
    1,
  );
  assert.equal(
    f.db.prepare("SELECT status FROM ai_jobs WHERE id=?").get(queued).status,
    "queued",
  );
});

test("hidden manual rows do not consume the visible research-list limit and initialization leaves existing durable rows untouched", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 50; i++) {
    manual(f.db, f.a.id, "S" + i);
    f.db
      .prepare("INSERT INTO research_hidden_assets VALUES(?,?,?)")
      .run(f.a.id, "S" + i, Date.now());
  }
  const before = {
    users: f.db.prepare("SELECT * FROM users ORDER BY id").all(),
    portfolios: f.db.prepare("SELECT * FROM portfolios ORDER BY user_id").all(),
    assets: f.db
      .prepare("SELECT * FROM research_assets ORDER BY user_id,symbol")
      .all(),
    hidden: f.db
      .prepare("SELECT * FROM research_hidden_assets ORDER BY user_id,symbol")
      .all(),
  };
  initializeResearchVisibility(f.db);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM users ORDER BY id").all(),
    before.users,
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM portfolios ORDER BY user_id").all(),
    before.portfolios,
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM research_assets ORDER BY user_id,symbol").all(),
    before.assets,
  );
  assert.deepEqual(
    f.db
      .prepare("SELECT * FROM research_hidden_assets ORDER BY user_id,symbol")
      .all(),
    before.hidden,
  );
  const response = await f.request(f.a, "PUT", "/api/research/assets/NEW", {
    name: "New asset",
    automatic: false,
    intervalHours: 24,
  });
  assert.equal(response.statusCode, 200, response.body);
});

for (const kind of ["research", "map-article"])
  test(`a running ${kind} removed during source collection stops before any paid provider reservation`, async (t) => {
    let entered, release;
    const started = new Promise((resolve) => {
        entered = resolve;
      }),
      gate = new Promise((resolve) => {
        release = resolve;
      });
    const f = await fixture(t, {
      collect: async (asset) => {
        entered();
        await gate;
        return {
          sources: [
            {
              kind: "headline",
              title: asset.symbol + " fixture report",
              content: "A report",
              url: "https://example.com/report",
              connector: "news",
              published_at: Date.now() - 1000,
            },
          ],
          coverage: [{ connector: "news", status: "available", count: 1 }],
        };
      },
    });
    manual(f.db, f.a.id, "AAPL");
    const encrypted = f.vault.seal(
      f.a.id,
      "gemini",
      "fixture-key-not-real-12345678901234567890",
    );
    f.db
      .prepare("INSERT INTO ai_credentials VALUES(?,?,?,?,?)")
      .run(
        f.a.id,
        "gemini",
        encrypted.encrypted,
        encrypted.fingerprint,
        Date.now(),
      );
    f.db
      .prepare(
        "INSERT INTO ai_preferences(user_id,enabled,provider,model,monthly_limit,run_limit,consent_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        f.a.id,
        1,
        "gemini",
        "gemini-4-hydrogen",
        5000000,
        250000,
        Date.now(),
        Date.now(),
      );
    const queued = job(f.db, f.a.id, "AAPL", "queued", kind);
    const ticking = f.app.intelligenceEngine.tick();
    await started;
    try {
      assert.equal(
        (await f.request(f.a, "DELETE", "/api/research/assets/AAPL"))
          .statusCode,
        200,
      );
    } finally {
      release();
    }
    await ticking;
    const row = f.db
      .prepare("SELECT status,error,dispatched_at FROM ai_jobs WHERE id=?")
      .get(queued);
    assert.equal(row.status, "failed");
    assert.match(row.error, /removed from Research before dispatch/);
    assert.equal(row.dispatched_at, null);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  });
