import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { openStore, emptyPortfolio } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import {
  createPortfolioSources,
  portfolioAssets,
} from "../server/intelligence/portfolio-sources.js";
import { createApp } from "../server/app.js";
import { putSource } from "../server/intelligence/sources.js";
const origin = "http://localhost:4173";
const holding = (symbol, broker = "Trade Republic") => ({
  id: randomBytes(8).toString("hex"),
  symbol,
  name: symbol + " Company",
  broker,
  lots: [{ id: "lot", qty: 1, price: 10, fee: 0, date: "2026-01-01" }],
});
function seed(db, user, holdings = []) {
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    user,
    user,
    "fixture-hash",
    "fixture-recovery",
    Date.now(),
  );
  db.prepare("INSERT INTO portfolios(user_id,data) VALUES(?,?)").run(
    user,
    JSON.stringify({ ...emptyPortfolio(), holdings }),
  );
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    user,
    now,
    now,
    now,
    now + 86400000,
  );
  return {
    cookie: "reentry_dev=" + token,
    origin,
    "x-reentry-request": "1",
    "content-type": "application/json",
  };
}
function fixture(t, collect) {
  const db = openStore(":memory:");
  migratePlatform(db);
  let time = 100000000;
  const service = createPortfolioSources({
    db,
    connectors: { collect },
    now: () => time,
  });
  t.after(async () => {
    await service.stop();
    db.close();
  });
  return {
    db,
    service,
    advance(ms) {
      time += ms;
    },
  };
}
const evidence = (asset) => ({
  sources: [
    {
      kind: "headline",
      title: asset.symbol + " public source",
      content: "Evidence",
      url: "https://example.com/source",
      published_at: 1,
      connector: "news",
    },
  ],
  coverage: [{ connector: "news", status: "available", count: 1 }],
});

test("portfolio sources union all depots, deduplicate assets and never create AI jobs or alter research preferences", async (t) => {
  const calls = [];
  const f = fixture(t, async (asset) => {
    calls.push(asset.symbol);
    return evidence(asset);
  });
  seed(f.db, "owner", [
    holding("aapl"),
    holding("AAPL", "Consorsbank"),
    holding("MSFT"),
    { ...holding("DEMO"), demo: true },
  ]);
  f.db
    .prepare(
      "INSERT INTO research_assets(user_id,symbol,name,automatic) VALUES(?,?,?,0)",
    )
    .run("owner", "AAPL", "My name");
  assert.deepEqual(
    portfolioAssets(f.db, "owner").map((a) => a.symbol),
    ["AAPL", "MSFT"],
  );
  await f.service.tick();
  assert.deepEqual(calls.sort(), ["AAPL", "MSFT"]);
  assert.equal(f.service.state("owner", "AAPL").status, "ready");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n, 0);
  assert.equal(
    f.db
      .prepare("SELECT automatic FROM research_assets WHERE user_id=?")
      .get("owner").automatic,
    0,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  await f.service.tick();
  assert.equal(calls.length, 2);
  f.advance(6 * 3600000 + 1);
  await f.service.tick();
  assert.equal(calls.length, 4);
});

test("concurrent owners share only public retrieval and retain separate notes and sources", async (t) => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const f = fixture(t, async (asset) => {
    calls++;
    await gate;
    return evidence(asset);
  });
  seed(f.db, "alice", [holding("AAPL")]);
  seed(f.db, "bob", [holding("AAPL")]);
  putSource(f.db, "alice", "AAPL", {
    kind: "note",
    title: "Private thesis",
    content: "Alice-only note",
    connector: "manual",
  });
  const tick = f.service.tick();
  await Promise.resolve();
  release();
  await tick;
  assert.equal(calls, 1);
  const alice = f.db
    .prepare("SELECT * FROM research_sources WHERE user_id=?")
    .all("alice");
  const bob = f.db
    .prepare("SELECT * FROM research_sources WHERE user_id=?")
    .all("bob");
  assert.equal(alice.length, 2);
  assert.equal(bob.length, 1);
  assert.ok(bob.every((source) => source.content !== "Alice-only note"));
  assert.ok(alice.every((source) => source.id !== bob[0].id));
});

test("failures retain evidence, back off durably, and recover expired in-flight leases", async (t) => {
  let fail = false,
    calls = 0;
  const f = fixture(t, async (asset) => {
    calls++;
    if (fail) throw Error("offline");
    return evidence(asset);
  });
  seed(f.db, "owner", [holding("AAPL")]);
  await f.service.tick();
  fail = true;
  f.advance(6 * 3600000 + 1);
  await f.service.tick();
  assert.equal(f.service.state("owner", "AAPL").status, "retrying");
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM research_sources").get().n,
    1,
  );
  await f.service.tick();
  assert.equal(calls, 2);
  f.advance(300001);
  await f.service.tick();
  assert.equal(calls, 3);
  const row = f.db.prepare("SELECT next_run FROM source_refresh_states").get();
  f.db
    .prepare(
      "UPDATE source_refresh_states SET status='collecting',lease_until=?,next_run=0",
    )
    .run(row.next_run + 1000);
  f.advance(1000);
  await f.service.tick();
  assert.equal(calls, 3);
  f.advance(600001);
  fail = false;
  await f.service.tick();
  assert.equal(calls, 4);
  assert.equal(f.service.state("owner", "AAPL").status, "ready");
});

test("partial connector coverage retains usable sources and schedules a shorter retry", async (t) => {
  const f = fixture(t, async (asset) => ({
    ...evidence(asset),
    coverage: [
      ...evidence(asset).coverage,
      { connector: "sec", status: "unavailable", count: 0 },
    ],
  }));
  seed(f.db, "owner", [holding("AAPL")]);
  await f.service.tick();
  const state = f.service.state("owner", "AAPL");
  assert.equal(state.status, "partial");
  assert.equal(state.nextRefreshAt - state.updatedAt, 1800000);
});

test("removed holdings stop automatic requests while preserved sources and manual research remain available", async (t) => {
  let calls = 0;
  const f = fixture(t, async (asset) => {
    calls++;
    return evidence(asset);
  });
  seed(f.db, "owner", [holding("AAPL")]);
  await f.service.tick();
  f.db
    .prepare("UPDATE portfolios SET data=?,revision=revision+1 WHERE user_id=?")
    .run(JSON.stringify(emptyPortfolio()), "owner");
  f.advance(6 * 3600000 + 1);
  await f.service.tick();
  assert.equal(calls, 1);
  assert.equal(
    f.db.prepare("SELECT in_portfolio FROM source_refresh_states").get()
      .in_portfolio,
    0,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM research_sources").get().n,
    1,
  );
});

test("startup with background disabled creates only new schema and changes no durable account rows", async (t) => {
  const db = openStore(":memory:");
  migratePlatform(db);
  seed(db, "owner", [holding("AAPL")]);
  const before = db.prepare("SELECT * FROM portfolios").all();
  const service = createPortfolioSources({
    db,
    connectors: {
      collect: () => {
        throw Error("must not run");
      },
    },
    enabled: false,
  });
  t.after(async () => {
    await service.stop();
    db.close();
  });
  service.start();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(db.prepare("SELECT * FROM portfolios").all(), before);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM source_refresh_states").get().n,
    0,
  );
});

test("asset/source APIs expose only own portfolio assets and queue successful portfolio saves without AI", async (t) => {
  const db = openStore(":memory:");
  const app = await createApp({
    db,
    logger: false,
    disableRateLimit: true,
    platform: {
      workerEnabled: false,
      startWorker: false,
      connectors: {
        status: () => [],
        collect: async (asset) => evidence(asset),
      },
      generate: () => {
        throw Error("No paid AI call allowed");
      },
    },
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  const alice = seed(db, "alice", [holding("AAPL")]),
    bob = seed(db, "bob", [holding("MSFT")]);
  const get = await app.inject({
    method: "GET",
    url: "/api/research/assets",
    headers: alice,
  });
  assert.equal(get.statusCode, 200);
  const assets = get.json().assets;
  assert.deepEqual(
    assets.map((a) => a.symbol),
    ["AAPL"],
  );
  assert.equal(assets[0].inPortfolio, true);
  assert.equal(assets[0].automatic, 0);
  const collected = await app.inject({
    method: "POST",
    url: "/api/research/collect",
    headers: alice,
    payload: { symbol: "AAPL" },
  });
  assert.equal(collected.statusCode, 200);
  assert.equal(collected.json().sources.length, 1);
  const foreign = await app.inject({
    method: "POST",
    url: "/api/research/collect",
    headers: bob,
    payload: { symbol: "AAPL" },
  });
  assert.equal(foreign.statusCode, 404);
  const source = await app.inject({
    url: "/api/research/sources?symbol=AAPL",
    headers: alice,
  });
  assert.equal(source.json().sources.length, 1);
  assert.equal(source.json().collection.status, "ready");
  assert.match(source.headers["cache-control"], /no-store/);
  const other = await app.inject({
    url: "/api/research/sources?symbol=AAPL",
    headers: bob,
  });
  assert.deepEqual(other.json().sources, []);
  assert.equal(other.json().collection, null);
  const unauth = await app.inject({ url: "/api/research/assets" });
  assert.equal(unauth.statusCode, 401);
  const state = { ...emptyPortfolio(), holdings: [holding("NVDA")] };
  const saved = await app.inject({
    method: "PUT",
    url: "/api/portfolio",
    headers: bob,
    payload: { state, revision: 0 },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(app.portfolioSources.state("bob", "NVDA").status, "pending");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n, 0);
});

test("manual refreshes bound shared upstream concurrency and same-owner requests join once", async (t) => {
  let active = 0,
    maximum = 0,
    calls = 0;
  const releases = [];
  const f = fixture(t, async (asset) => {
    active++;
    calls++;
    maximum = Math.max(maximum, active);
    await new Promise((r) => releases.push(r));
    active--;
    return evidence(asset);
  });
  seed(f.db, "owner");
  const first = f.service.collect("owner", { symbol: "S0", name: "Company0" });
  const duplicate = f.service.collect("owner", {
    symbol: "S0",
    name: "Company0",
  });
  assert.equal(first, duplicate);
  const rest = Array.from({ length: 5 }, (_, i) =>
    f.service.collect("owner", {
      symbol: "S" + (i + 1),
      name: "Company" + (i + 1),
    }),
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(maximum, 4);
  for (let i = 0; i < 3; i++) {
    for (const release of releases.splice(0)) release();
    await new Promise((r) => setImmediate(r));
  }
  await Promise.all([first, ...rest]);
  assert.equal(maximum, 4);
  assert.equal(calls, 6);
});

test("large portfolios cannot monopolize refreshes ahead of another owner", async (t) => {
  const calls = [];
  const f = fixture(t, async (asset) => {
    calls.push(asset.symbol);
    return evidence(asset);
  });
  seed(f.db, "alice", [
    holding("A1"),
    holding("A2"),
    holding("A3"),
    holding("A4"),
  ]);
  seed(f.db, "bob", [holding("B1")]);
  await f.service.tick();
  assert.deepEqual(calls, ["A1", "A2"]);
  f.advance(15000);
  await f.service.tick();
  assert.ok(calls.includes("B1"));
});
