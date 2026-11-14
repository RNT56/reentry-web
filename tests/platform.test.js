import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { referenceLevels, chartScale } from "../src/domain/chart-levels.js";
import { calculate, target } from "../src/domain/reentry.js";
import { createSaveQueue } from "../src/shared/save-queue.js";
import { createRequestCache } from "../server/market/cache.js";
import { createMarketService } from "../server/market/service.js";
import { migrate, migrations } from "../server/db/migrations.js";
import {
  evaluateBranch,
  validateScenarioGraph,
} from "../src/domain/scenarios.js";
import { parseRoute, routeURL } from "../src/app/router.js";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
test("chart levels share the listing currency and never use a mismatched, missing or stale FX rate", () => {
  const quote = {
    symbol: "AAPL",
    originalCurrency: "USD",
    fxRate: 0.8,
    fxTime: 1000,
  };
  let result = referenceLevels({
    currency: "USD",
    symbol: "AAPL",
    buyIn: 80,
    target: 100,
    quote,
    now: 1000000,
  });
  assert.deepEqual(
    result.levels.map((l) => l.price),
    [100, 125],
  );
  for (const replacement of [
    undefined,
    { ...quote, fxRate: 0 },
    { ...quote, symbol: "SAP.DE" },
    { ...quote, fxTime: 1 },
    { ...quote, originalCurrency: "GBP" },
  ])
    assert.equal(
      referenceLevels({
        currency: "USD",
        symbol: "AAPL",
        buyIn: 80,
        quote: replacement,
        now: 700000000,
      }).levels.length,
      0,
    );
  assert.equal(
    referenceLevels({
      currency: "EUR",
      symbol: "SAP.DE",
      buyIn: 100,
      target: null,
    }).levels.length,
    1,
  );
  assert.equal(
    referenceLevels({
      currency: "GBP",
      symbol: "VOD.L",
      buyIn: 1,
      quote: { ...quote, symbol: "VOD.L", originalCurrency: "GBp" },
      now: 1000000,
    }).levels[0].price,
    1.25,
  );
});
test("FIFO sell quantity, fees, whole shares and target percentage flow into the displayed ceiling", () => {
  const lots = [
    { qty: 10, price: 100, fee: 2, date: "2025-01-01" },
    { qty: 10, price: 150, fee: 0, date: "2025-02-01" },
  ];
  const line = (q, g, whole = false) =>
    referenceLevels({
      currency: "EUR",
      buyIn: 125.1,
      target: target(calculate(lots, q, 200, 1, 1, 27), g, whole).price,
    }).levels;
  assert.equal(line(5, 5)[0].price, line(15, 5)[0].price);
  assert.notEqual(line(5, 5)[1].price, line(15, 5)[1].price);
  assert.ok(line(5, 10)[1].price < line(5, 5)[1].price);
  assert.ok(line(5, 5, true)[1].price < line(5, 5)[1].price);
  assert.equal(
    referenceLevels({ currency: "EUR", buyIn: 100, target: NaN }).levels.length,
    1,
  );
  const scale = chartScale(
    [{ price: 200 }, { price: 210 }],
    [{ price: 100 }, { price: 0 }],
  );
  assert.equal(scale.low, 0);
  assert.ok(scale.y(100) < 184);
  assert.ok(scale.y(210) > 12);
});
test("save queue serializes, coalesces and waits for in-flight writes", async () => {
  const gate = deferred(),
    calls = [];
  const queue = createSaveQueue({
    delay: 60000,
    write: async (state, revision) => {
      calls.push({ state, revision });
      if (calls.length === 1) await gate.promise;
      return { revision: revision + 1 };
    },
  });
  queue.reset(7);
  queue.enqueue({ value: 1 });
  const first = queue.flush();
  await Promise.resolve();
  queue.enqueue({ value: 2 });
  queue.enqueue({ value: 3 });
  assert.equal(queue.flush(), first);
  assert.throws(() => queue.reset(0));
  gate.resolve();
  await first;
  assert.deepEqual(calls, [
    { state: { value: 1 }, revision: 7 },
    { state: { value: 3 }, revision: 8 },
  ]);
  assert.equal(queue.status.revision, 9);
  assert.equal(queue.status.pendingSave, false);
});
test("save failures preserve newest edits, conflicts pause automatic writes, reset requires explicit resolution", async () => {
  const gate = deferred();
  let calls = 0;
  const queue = createSaveQueue({
    delay: 60000,
    write: async () => {
      calls++;
      return gate.promise;
    },
  });
  queue.enqueue({ value: 1 });
  const pending = queue.flush();
  await Promise.resolve();
  queue.enqueue({ value: 2 });
  gate.reject(Object.assign(Error("conflict"), { status: 409 }));
  await pending;
  assert.equal(queue.status.pendingSave, true);
  assert.equal(queue.status.saveProblem.status, 409);
  queue.enqueue({ value: 3 });
  await queue.flush();
  assert.equal(calls, 1);
  queue.reset(12);
  assert.equal(queue.status.pendingSave, false);
});
test("temporary save failures are retryable without losing the snapshot", async () => {
  let calls = 0;
  const queue = createSaveQueue({
    delay: 60000,
    write: async (state, revision) => {
      if (!calls++) throw Error("offline");
      assert.deepEqual(state, { n: 2 });
      return { revision: revision + 1 };
    },
  });
  queue.enqueue({ n: 2 });
  await queue.flush();
  assert.equal(queue.status.pendingSave, true);
  await queue.flush();
  assert.equal(queue.status.pendingSave, false);
});
test("market cache deduplicates in flight, bounds work, expires and does not cache errors", async () => {
  let now = 0,
    calls = 0;
  const cached = createRequestCache({
      limit: 1,
      maxPending: 1,
      ttl: 10,
      now: () => now,
    }),
    gate = deferred();
  const a = cached("a", () => {
      calls++;
      return gate.promise;
    }),
    b = cached("a", () => {
      throw Error("duplicate");
    });
  await assert.rejects(
    cached("b", () => 2),
    { statusCode: 503 },
  );
  gate.resolve(1);
  assert.deepEqual(await Promise.all([a, b]), [1, 1]);
  assert.equal(calls, 1);
  now = 11;
  assert.equal(await cached("a", () => 3), 3);
  await assert.rejects(
    cached("error", () => {
      throw Error("bad feed");
    }),
  );
  assert.equal(await cached("error", () => 4), 4);
});
test("market provider is replaceable and normalizes FX and quote subunits once", async () => {
  const service = createMarketService({
    provider: {
      quote: async (symbol) =>
        symbol === "VOD.L"
          ? { symbol, price: 120, currency: "GBp", time: 1 }
          : { symbol, price: 1.2, currency: "EUR", time: 2 },
    },
  });
  const quote = await service.quote("VOD.L");
  assert.equal(quote.price, 1.44);
  assert.equal(quote.fxRate, 1.2);
  assert.equal(quote.originalCurrency, "GBp");
  assert.throws(() => service.quote("https://evil.test"), { statusCode: 400 });
  assert.throws(() => service.history("VOD.L", "max"), { statusCode: 400 });
});
test("migrations preserve existing data, reject downgrades and roll back failed steps", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db);
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      "u",
      "alice",
      "hash",
      "recovery",
      1,
    );
    migrate(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
    assert.throws(() =>
      migrate(db, [
        ...migrations,
        { version: 2, sql: "CREATE TABLE partial (id TEXT); INVALID SQL" },
      ]),
    );
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get(),
      undefined,
    );
    db.exec("PRAGMA user_version=99");
    assert.throws(() => migrate(db), /downgrade/);
    assert.equal(
      db.prepare("SELECT username FROM users").get().username,
      "alice",
    );
  } finally {
    db.close();
  }
});
test("scenario replay excludes future knowledge, wrong assets/currencies and unverified events", () => {
  const branch = {
    asset: "INTC",
    publishedAt: 0,
    deadline: 100,
    currency: "USD",
    requires: ["win"],
    invalidatedBy: ["cancel"],
    target: [20, 25],
  };
  const event = {
    id: "event",
    asset: "INTC",
    kind: "event",
    key: "win",
    verified: true,
    occurredAt: 10,
    recordedAt: 30,
  };
  const price = {
    id: "price",
    asset: "INTC",
    kind: "price",
    value: 21,
    currency: "USD",
    verified: true,
    occurredAt: 20,
    recordedAt: 20,
  };
  assert.equal(evaluateBranch(branch, [event, price], 25).status, "watching");
  assert.equal(evaluateBranch(branch, [event, price], 30).status, "observed");
  for (const replacement of [
    { ...price, currency: "EUR" },
    { ...price, asset: "AAPL" },
    { ...price, occurredAt: 5 },
  ])
    assert.equal(
      evaluateBranch(branch, [event, replacement], 30).status,
      "triggered",
    );
  assert.equal(
    evaluateBranch(branch, [{ ...event, verified: false }, price], 30).status,
    "watching",
  );
  assert.equal(
    evaluateBranch(
      branch,
      [{ ...event, key: "cancel", recordedAt: 10 }, price],
      30,
    ).status,
    "invalidated",
  );
  assert.equal(evaluateBranch(branch, [], 101).status, "review");
});
test("scenario graphs reject cycles and broken references; valid branches remain independent", () => {
  const nodes = [{ id: "thesis" }, { id: "risk" }, { id: "upside" }];
  assert.doesNotThrow(() =>
    validateScenarioGraph({
      nodes,
      edges: [
        { from: "thesis", to: "risk" },
        { from: "thesis", to: "upside" },
      ],
    }),
  );
  assert.throws(
    () =>
      validateScenarioGraph({
        nodes,
        edges: [
          { from: "thesis", to: "risk" },
          { from: "risk", to: "thesis" },
        ],
      }),
    /cycles/,
  );
  assert.throws(
    () =>
      validateScenarioGraph({
        nodes,
        edges: [{ from: "thesis", to: "missing" }],
      }),
    /reference/,
  );
});
test("navigation preserves an exact holding identity and tolerates unknown URLs", () => {
  assert.deepEqual(parseRoute(routeURL("portfolio", "a&b/1")), {
    page: "portfolio",
    selected: "a&b/1",
  });
  assert.equal(parseRoute("#/unknown").page, "portfolio");
  assert.equal(parseRoute("#/explore").page, "explore");
});

test("trade commands are atomic, retain FIFO lots and reject duplicate or unaffordable buybacks", async () => {
  const { recordSale, recordBuyback } = await import("../src/domain/trades.js");
  const { emptyPortfolio } = await import("../src/domain/portfolio.js");
  const initial = emptyPortfolio();
  initial.holdings = [
    {
      id: "h",
      symbol: "AAPL",
      name: "Apple",
      broker: "Other",
      lots: [{ id: "lot", qty: 10, price: 100, fee: 2, date: "2025-01-01" }],
    },
  ];
  const snapshot = structuredClone(initial);
  const sale = recordSale(initial, {
    id: "sale",
    holdingId: "h",
    quantity: 5,
    price: 150,
    sellFee: 1,
    buyFee: 1,
    tax: 67,
    targetGain: 5,
    date: "2025-02-01",
  });
  assert.deepEqual(initial, snapshot);
  assert.equal(sale.holdings[0].lots[0].qty, 5);
  assert.equal(sale.holdings[0].lots[0].fee, 1);
  assert.throws(() =>
    recordSale(initial, {
      id: "bad",
      holdingId: "h",
      quantity: 11,
      price: 150,
      sellFee: 1,
      buyFee: 1,
      tax: 0,
      targetGain: 5,
      date: "2025-02-01",
    }),
  );
  assert.deepEqual(initial, snapshot);
  const input = {
    saleId: "sale",
    quantity: 5,
    price: 120,
    fee: 1,
    date: "2025-03-01",
    holdingId: "new",
    lotId: "rebuy-lot",
  };
  assert.throws(() => recordBuyback(sale, { ...input, quantity: 500 }));
  const done = recordBuyback(sale, input);
  assert.equal(done.sales[0].status, "complete");
  assert.equal(sale.sales[0].status, "waiting");
  assert.equal(done.holdings[0].lots.length, 2);
  assert.throws(() => recordBuyback(done, input));
  assert.throws(() => recordBuyback(sale, { ...input, date: "2024-01-01" }));
});

test("scenario chronology preserves observed outcomes and ignores events beyond the thesis horizon", () => {
  const b = {
    asset: "INTC",
    publishedAt: 0,
    deadline: 100,
    requires: ["launch"],
    invalidatedBy: ["cancel"],
    target: [20, 30],
    currency: "USD",
  };
  const event = (id, key, time) => ({
    id,
    key,
    asset: "INTC",
    kind: "event",
    occurredAt: time,
    recordedAt: time,
    verified: true,
  });
  const price = {
    id: "hit",
    asset: "INTC",
    kind: "price",
    value: 25,
    currency: "USD",
    occurredAt: 20,
    recordedAt: 20,
    verified: true,
  };
  const result = evaluateBranch(
    b,
    [event("launch", "launch", 10), price, event("cancel", "cancel", 30)],
    40,
  );
  assert.equal(result.status, "observed");
  assert.equal(result.invalidatedAfterOutcome, true);
  assert.equal(
    evaluateBranch(
      b,
      [event("launch", "launch", 10), price, event("cancel", "cancel", 15)],
      40,
    ).status,
    "invalidated",
  );
  assert.equal(
    evaluateBranch(b, [event("late", "cancel", 110)], 120).status,
    "review",
  );
});
