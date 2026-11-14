import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";
import { initializeResearchOrder } from "../server/intelligence/research-order.js";
const origin = "http://localhost:4173";
const holding = (symbol) => ({
  id: randomUUID(),
  symbol,
  name: symbol + " Company",
  broker: "Trade Republic",
  lots: [{ id: randomUUID(), qty: 1, price: 10, fee: 0, date: "2026-01-01" }],
});
function seed(db, name, symbols) {
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
    JSON.stringify({ ...emptyPortfolio(), holdings: symbols.map(holding) }),
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
    },
  };
}
async function fixture(t, { symbols = ["MSFT", "AAPL"] } = {}) {
  const db = openStore(":memory:");
  const options = {
    db,
    origin,
    logger: false,
    disableRateLimit: true,
    platform: {
      workerEnabled: false,
      startWorker: false,
      connectors: {
        status: () => [],
        collect: async () => {
          throw Error("No connector call expected");
        },
      },
    },
  };
  let app = await createApp(options);
  await app.ready();
  const a = seed(db, "alice", symbols),
    b = seed(db, "bob", ["NVDA", "AAPL"]);
  t.after(async () => {
    await app.close();
    db.close();
  });
  return {
    db,
    a,
    b,
    async request(user, method, url, payload) {
      return app.inject({
        method,
        url,
        headers: user.headers,
        ...(payload === undefined ? {} : { payload }),
      });
    },
    async assets(user = a) {
      const response = await app.inject({
        url: "/api/research/assets",
        headers: user.headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    },
    async order(symbols, revision, user = a) {
      return app.inject({
        method: "PUT",
        url: "/api/research/order",
        headers: user.headers,
        payload: { symbols, revision },
      });
    },
    async restart() {
      await app.close();
      app = await createApp(options);
      await app.ready();
    },
    get app() {
      return app;
    },
  };
}
const symbols = (data) => data.assets.map((asset) => asset.symbol);

test("Research order persists across reloads for the held/manual union and remains owner-scoped", async (t) => {
  const f = await fixture(t);
  f.db
    .prepare("INSERT INTO research_assets(user_id,symbol,name) VALUES(?,?,?)")
    .run(f.a.id, "AMD", "AMD");
  let initial = await f.assets();
  assert.deepEqual(symbols(initial), ["AAPL", "AMD", "MSFT"]);
  assert.equal(initial.orderRevision, 0);
  const saved = await f.order(["MSFT", "AMD", "AAPL"], initial.orderRevision);
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json(), {
    symbols: ["MSFT", "AMD", "AAPL"],
    revision: 1,
  });
  const other = await f.assets(f.b);
  assert.deepEqual(symbols(other), ["AAPL", "NVDA"]);
  assert.equal(other.orderRevision, 0);
  await f.restart();
  initial = await f.assets();
  assert.deepEqual(symbols(initial), ["MSFT", "AMD", "AAPL"]);
  assert.equal(initial.orderRevision, 1);
  const ownExport = (
      await f.request(f.a, "GET", "/api/research/export")
    ).json(),
    otherExport = (await f.request(f.b, "GET", "/api/research/export")).json();
  assert.deepEqual(JSON.parse(ownExport.research_asset_order[0].symbols), [
    "MSFT",
    "AMD",
    "AAPL",
  ]);
  assert.deepEqual(JSON.parse(otherExport.research_asset_order[0].symbols), [
    "AAPL",
    "NVDA",
  ]);
  assert.ok(!JSON.stringify(otherExport.research_asset_order).includes("MSFT"));
});

test("reorder validates duplicate, foreign, missing and oversized symbols without changing the saved order", async (t) => {
  const f = await fixture(t);
  const before = await f.assets();
  for (const [values, status] of [
    [["MSFT", "MSFT"], 400],
    [["msft", "MSFT"], 400],
    [["MSFT", "NVDA"], 409],
    [["MSFT"], 409],
    [["MSFT", "AAPL", "NVDA"], 409],
    [["MSFT", "AAPL", "INVALID SYMBOL"], 400],
    [Array.from({ length: 2051 }, (_, i) => "S" + i), 400],
  ]) {
    const response = await f.order(values, before.orderRevision);
    assert.equal(response.statusCode, status, response.body);
  }
  for (const revision of [-1, 1.5, "0", null])
    assert.equal((await f.order(["MSFT", "AAPL"], revision)).statusCode, 400);
  assert.deepEqual(await f.assets(), before);
  const unauth = await f.app.inject({
    method: "PUT",
    url: "/api/research/order",
    headers: { origin, "x-reentry-request": "1" },
    payload: { symbols: ["MSFT", "AAPL"], revision: 0 },
  });
  assert.equal(unauth.statusCode, 401);
});

test("CAS rejects stale tabs while no-op requests preserve the current revision", async (t) => {
  const f = await fixture(t);
  const initial = await f.assets();
  const changed = await f.order(["MSFT", "AAPL"], initial.orderRevision);
  assert.equal(changed.json().revision, 1);
  const stale = await f.order(["AAPL", "MSFT"], initial.orderRevision);
  assert.equal(stale.statusCode, 409);
  const same = await f.order(["MSFT", "AAPL"], changed.json().revision);
  assert.equal(same.statusCode, 200);
  assert.equal(same.json().revision, 1);
  assert.deepEqual(symbols(await f.assets()), ["MSFT", "AAPL"]);
});

test("new assets append deterministically and invalidate the old visible-set revision", async (t) => {
  const f = await fixture(t);
  const initial = await f.assets();
  await f.order(["MSFT", "AAPL"], initial.orderRevision);
  const old = await f.assets();
  for (const ticker of ["ZZZ", "AMD"])
    assert.equal(
      (
        await f.request(f.a, "PUT", "/api/research/assets/" + ticker, {
          name: ticker,
          automatic: false,
          intervalHours: 24,
        })
      ).statusCode,
      200,
    );
  assert.equal(
    (await f.order(["MSFT", "AAPL"], old.orderRevision)).statusCode,
    409,
  );
  const added = await f.assets();
  assert.deepEqual(symbols(added), ["MSFT", "AAPL", "AMD", "ZZZ"]);
  assert.equal(added.orderRevision, old.orderRevision + 1);
  assert.equal(
    (await f.order(["ZZZ", "AMD", "MSFT", "AAPL"], old.orderRevision))
      .statusCode,
    409,
  );
  assert.equal(
    (await f.order(["ZZZ", "AMD", "MSFT", "AAPL"], added.orderRevision))
      .statusCode,
    200,
  );
});

test("hidden assets remain hidden and re-added assets append without re-enabling AI automation", async (t) => {
  const f = await fixture(t);
  const initial = await f.assets();
  await f.order(["MSFT", "AAPL"], initial.orderRevision);
  const ordered = await f.assets();
  assert.equal(
    (await f.request(f.a, "DELETE", "/api/research/assets/MSFT")).statusCode,
    200,
  );
  assert.equal(
    (await f.order(["MSFT", "AAPL"], ordered.orderRevision)).statusCode,
    409,
  );
  const hidden = await f.assets();
  assert.deepEqual(symbols(hidden), ["AAPL"]);
  assert.equal(hidden.orderRevision, ordered.orderRevision + 1);
  assert.equal(
    (
      await f.request(f.a, "PUT", "/api/research/assets/MSFT", {
        name: "Microsoft",
        automatic: false,
        intervalHours: 24,
      })
    ).statusCode,
    200,
  );
  const restored = await f.assets();
  assert.deepEqual(symbols(restored), ["AAPL", "MSFT"]);
  assert.equal(restored.orderRevision, hidden.orderRevision + 1);
  assert.equal(restored.assets.find((a) => a.symbol === "MSFT").automatic, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n, 0);
});

test("portfolio membership changes reject stale reorders without modifying holdings or preferences", async (t) => {
  const f = await fixture(t);
  const old = await f.assets();
  const portfolio = f.db
    .prepare("SELECT data,revision FROM portfolios WHERE user_id=?")
    .get(f.a.id);
  const state = JSON.parse(portfolio.data);
  state.holdings.push(holding("GOOG"));
  assert.equal(
    (
      await f.request(f.a, "PUT", "/api/portfolio", {
        state,
        revision: portfolio.revision,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.order(["MSFT", "AAPL"], old.orderRevision)).statusCode,
    409,
  );
  const current = await f.assets();
  assert.deepEqual(symbols(current), ["AAPL", "MSFT", "GOOG"]);
  assert.ok(current.orderRevision > old.orderRevision);
  const savedPortfolio = f.db
    .prepare("SELECT * FROM portfolios WHERE user_id=?")
    .get(f.a.id);
  await f.order(["GOOG", "MSFT", "AAPL"], current.orderRevision);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM portfolios WHERE user_id=?").get(f.a.id),
    savedPortfolio,
  );
});

test("empty lists reset safely and additive initialization rewrites no existing durable rows", async (t) => {
  const f = await fixture(t, { symbols: [] });
  const empty = await f.assets();
  assert.deepEqual(empty, { assets: [], orderRevision: 0 });
  assert.deepEqual((await f.order([], 0)).json(), { symbols: [], revision: 0 });
  const tables = [
    "users",
    "portfolios",
    "research_assets",
    "research_asset_order",
    "research_hidden_assets",
  ];
  const before = new Map(
    tables.map((table) => [
      table,
      f.db.prepare("SELECT * FROM " + table).all(),
    ]),
  );
  initializeResearchOrder(f.db);
  await f.restart();
  for (const table of tables)
    assert.deepEqual(
      f.db.prepare("SELECT * FROM " + table).all(),
      before.get(table),
    );
});

test("Research accepts the full bounded portfolio/manual union order beyond fifty assets", async (t) => {
  const f = await fixture(t, {
    symbols: Array.from({ length: 2000 }, (_, i) => "H" + i),
  });
  for (let i = 0; i < 50; i++)
    f.db
      .prepare("INSERT INTO research_assets(user_id,symbol,name) VALUES(?,?,?)")
      .run(f.a.id, "M" + i, "Manual " + i);
  const initial = await f.assets();
  assert.equal(initial.assets.length, 2050);
  const values = symbols(initial).reverse();
  const reordered = await f.order(values, initial.orderRevision);
  assert.equal(reordered.statusCode, 200, reordered.body);
  assert.deepEqual(symbols(await f.assets()), values);
});
