import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import {
  estimateReturns,
  prepareReturns,
  returnCutoff,
} from "../server/politics/returns-model.js";
import {
  normalizeReturnHistory,
  returnHistoryPath,
} from "../server/market/return-history.js";
import { createPoliticalReturns } from "../server/politics/returns-service.js";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import { createApp } from "../server/app.js";
import { returnView } from "../src/features/politics/returns.js";
const now = Date.parse("2026-11-15T12:00:00Z");
const career = {
  salary: {
    annual: 174000,
    year: 2026,
    role: "Representative",
    source: "https://uscode.house.gov/",
  },
  service: null,
};
const person = { id: "congress:P000197", bioguide: "P000197" };
let serial = 0;
const row = (changes = {}) => ({
  id: "r" + ++serial,
  memberId: person.id,
  ticker: "ABC",
  asset: "ABC Corporation common stock",
  assetType: "ST",
  owner: "Self",
  side: "buy",
  type: "Purchase",
  traded: "2026-01-02",
  filed: "2026-02-01",
  low: 1000,
  high: 1000,
  ...changes,
});
const history = (
  pairs = [
    ["2026-01-02", 10],
    ["2026-02-02", 20],
    ["2026-03-02", 30],
    ["2026-11-13", 40],
  ],
) => ({
  currency: "USD",
  name: "ABC Corporation",
  points: pairs.map(([date, close]) => ({ date, close })),
});
const calc = (rows, h = history(), c = career) =>
  estimateReturns(rows, new Map([["ABC", h]]), c, now);
const settle = async (f) => {
  for (let i = 0; i < 150; i++) {
    const d = f();
    if (!["calculating", "queued"].includes(d.status)) return d;
    await new Promise((r) => setTimeout(r, 3));
  }
  throw Error("Job did not settle");
};

test("FIFO separates realized and open gains, with salary over exactly the same period", () => {
  const r = calc([
    row(),
    row({ traded: "2026-02-02", low: 2000, high: 2000 }),
    row({
      side: "sell",
      type: "Sale (Partial)",
      traded: "2026-03-02",
      low: 1500,
      high: 1500,
    }),
  ]);
  assert.equal(r.label, "Estimate");
  assert.equal(r.variants.mid.realized, 1000);
  assert.equal(r.variants.mid.open, 3500);
  assert.equal(r.variants.mid.gain, 4500);
  assert.equal(r.variants.mid.gainOnBuys, 150);
  assert.equal(r.through, "2026-11-13");
  assert.equal(r.salary.days, 315);
  assert.equal(
    r.salary.total,
    Math.round(((174000 * 315) / 365.2425) * 100) / 100,
  );
  assert.equal(r.variants.mid.remaining, 6000);
  assert.equal(r.coverage.modeled, 3);
});
test("lower / midpoint / upper are distinct amount assumptions, not profit confidence bounds", () => {
  const r = calc([row({ low: 1000, high: 5000 })]);
  assert.equal(r.variants.low.gain, 3000);
  assert.equal(r.variants.mid.gain, 9000);
  assert.equal(r.variants.high.gain, 15000);
  const losses = calc(
    [row({ low: 1000, high: 5000 })],
    history([
      ["2026-01-02", 40],
      ["2026-11-13", 10],
    ]),
  );
  assert.equal(losses.variants.low.gain, -750);
  assert.equal(losses.variants.high.gain, -3750);
  assert.match(returnView(losses), /is-loss/);
  assert.match(returnView(losses), /Salary benchmark/);
  assert.match(returnView(losses), /not confidence bounds/);
});
test("spouse sales cannot consume self lots; unknown cost basis never creates profit", () => {
  const r = calc([
    row(),
    row({
      owner: "Spouse",
      side: "sell",
      type: "Sale",
      traded: "2026-03-02",
      low: 1500,
      high: 1500,
    }),
  ]);
  assert.equal(r.variants.mid.realized, 0);
  assert.equal(r.variants.mid.open, 3000);
  assert.equal(r.variants.mid.unmatchedSales, 1500);
  assert.equal(r.variants.mid.matchedSales, 0);
  const sellsOnly = calc([row({ side: "sell" })]);
  assert.equal(sellsOnly.available, false);
  assert.equal(sellsOnly.variants.mid.gain, 0);
});
test("sales larger than known holdings only realize the matched shares, never shorts", () => {
  const r = calc([
    row(),
    row({
      side: "sell",
      type: "Sale",
      traded: "2026-03-02",
      low: 9000,
      high: 9000,
    }),
  ]);
  assert.equal(r.variants.mid.realized, 2000);
  assert.equal(r.variants.mid.open, 0);
  assert.equal(r.variants.mid.unmatchedSales, 6000);
  assert.equal(r.variants.mid.remaining, 0);
});
test("declared full sales close reconstructed holdings despite wide amount bands", () => {
  const r = calc([
    row(),
    row({
      side: "sell",
      type: "Sale (Full)",
      traded: "2026-03-02",
      low: 1001,
      high: 15000,
    }),
  ]);
  assert.equal(r.variants.mid.realized, 2000);
  assert.equal(r.variants.mid.remaining, 0);
});
test("same-day sales do not use purchases whose intraday order is unknown", () => {
  const r = calc([
    row(),
    row({ side: "sell", type: "Sale", low: 200, high: 200 }),
  ]);
  assert.equal(r.variants.mid.unmatchedSales, 200);
  assert.equal(r.variants.mid.realized, 0);
  assert.equal(r.variants.mid.open, 3000);
});
test("options, exercises, debt and transfers are not priced as the underlying stock", () => {
  const rows = [
    row({ assetType: "Stock Option" }),
    row({ assetType: null, comment: "Purchased 20 call options" }),
    row({ comment: "Exercised options to buy shares" }),
    row({ assetType: "CS" }),
    row({ asset: "ABC Corporate Bond", assetType: null }),
    row({ ticker: null }),
    row({ side: "exchange" }),
  ];
  const r = calc(rows);
  assert.equal(r.available, false);
  assert.equal(r.coverage.excluded, rows.length);
  assert.equal(r.coverage.modeled, 0);
});
test("missing amounts and stock transfers invalidate the affected owner/asset lot chain only", () => {
  const rows = [
    row(),
    row({ high: null, traded: "2026-02-02" }),
    row({ owner: "Spouse" }),
  ];
  const p = prepareReturns(rows, "2026-11-14");
  assert.equal(p.eligible.length, 1);
  assert.equal(p.eligible[0].owner, "Spouse");
  assert.equal(p.excluded.length, 2);
  const r = calc([row(), row({ side: "exchange", type: "Exchange" })]);
  assert.equal(r.available, false);
});
test("missing execution prices cannot silently skip a buy then misprice later sales", () => {
  const r = calc([
    row({ traded: "2025-01-02" }),
    row(),
    row({ side: "sell", traded: "2026-03-02" }),
  ]);
  assert.equal(r.available, false);
  assert.equal(r.coverage.excluded, 3);
  assert.equal(
    calc([row()], { ...history(), currency: "EUR" }).available,
    false,
  );
  assert.equal(
    calc(
      [row()],
      history([
        ["2026-01-02", 10],
        ["2026-10-01", 40],
      ]),
    ).available,
    false,
  );
});
test("holiday dates use the next close with a bounded gap, not a remote future price", () => {
  const r = calc([row({ traded: "2026-01-01" })]);
  assert.equal(r.coverage.shiftedDates, 1);
  assert.equal(r.variants.mid.gain, 3000);
  assert.equal(calc([row({ traded: "2025-12-20" })]).available, false);
});
test("former officeholder valuation stops at the recorded service end", () => {
  const c = {
    ...career,
    service: { from: "2010-01-01", through: "2026-03-02" },
  };
  assert.equal(returnCutoff(c, now), "2026-03-02");
  const r = calc([row(), row({ traded: "2026-04-01" })], history(), c);
  assert.equal(r.through, "2026-03-02");
  assert.equal(r.variants.mid.gain, 2000);
  assert.equal(r.coverage.excluded, 1);
});
test("daily provider normalization uses exchange dates and split-adjusted closes, not dividend adjusted values", () => {
  const payload = {
    chart: {
      result: [
        {
          meta: {
            symbol: "ABC",
            currency: "USD",
            instrumentType: "EQUITY",
            exchangeTimezoneName: "America/New_York",
          },
          timestamp: [
            Date.parse("2026-01-02T14:30Z") / 1000,
            Date.parse("2026-11-13T14:30Z") / 1000,
          ],
          indicators: {
            quote: [{ close: [10, 40] }],
            adjclose: [{ adjclose: [8, 40] }],
          },
        },
      ],
    },
  };
  const h = normalizeReturnHistory(payload, "ABC", now);
  assert.deepEqual(h.points, [
    { date: "2026-01-02", close: 10 },
    { date: "2026-11-13", close: 40 },
  ]);
  assert.match(returnHistoryPath("ABC", now), /interval=1d/);
  assert.match(returnHistoryPath("ABC", now), /period1=1325376000/);
  assert.throws(() => returnHistoryPath("../foo"));
  payload.chart.result[0].meta.currency = "EUR";
  assert.throws(() => normalizeReturnHistory(payload, "ABC", now));
  payload.chart.result[0].meta.currency = "USD";
  payload.chart.result[0].meta.symbol = "OTHER";
  assert.throws(() => normalizeReturnHistory(payload, "ABC", now));
});
test("shared result / price caches coalesce browsers, survive restarts, and pick up corrections", async (t) => {
  const db = openStore(":memory:");
  migratePlatform(db);
  let calls = 0,
    clock = now;
  const market = {
    returnHistory: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return history();
    },
  };
  let s = createPoliticalReturns({ db, market, now: () => clock });
  t.after(async () => {
    await s.stop();
    db.close();
  });
  const rows = [row()];
  for (let i = 0; i < 20; i++) s.get(person, rows);
  const r = await settle(() => s.get(person, rows));
  assert.equal(r.status, "ready");
  assert.equal(calls, 3);
  assert.equal(r.result.variants.mid.gain, 3000);
  await s.stop();
  s = createPoliticalReturns({ db, market, now: () => clock });
  assert.equal(s.get(person, rows).status, "ready");
  assert.equal(calls, 3);
  const corrected = [{ ...rows[0], low: 2000, high: 2000 }];
  s.get(person, corrected);
  const correctedResult = await settle(() => s.get(person, corrected));
  assert.equal(correctedResult.result.variants.mid.gain, 6000);
  assert.equal(calls, 3);
  clock += 12 * 3600000 + 1;
  s.get(person, corrected);
  await settle(() => s.get(person, corrected));
  assert.equal(calls, 6);
});
test("provider outage keeps the previous estimate labeled stale and backs off for an hour", async (t) => {
  const db = openStore(":memory:");
  migratePlatform(db);
  let calls = 0,
    clock = now,
    fail = false;
  const s = createPoliticalReturns({
    db,
    now: () => clock,
    market: {
      returnHistory: async () => {
        calls++;
        if (fail) throw Error("Offline");
        return history();
      },
    },
  });
  t.after(async () => {
    await s.stop();
    db.close();
  });
  const rows = [row()];
  s.get(person, rows);
  const first = await settle(() => s.get(person, rows));
  clock += 13 * 3600000;
  fail = true;
  s.get(person, rows);
  const failed = await settle(() => s.get(person, rows));
  assert.equal(failed.status, "stale");
  assert.equal(failed.result.computedAt, first.result.computedAt);
  assert.equal(failed.result.variants.mid.gain, 3000);
  assert.equal(calls, 6);
  for (let i = 0; i < 20; i++) s.get(person, rows);
  assert.equal(calls, 6);
  clock += 3600001;
  s.get(person, rows);
  await settle(() => s.get(person, rows));
  assert.equal(calls, 9);
});
test("return markup escapes data, exposes estimates and distinguishes missing salary", () => {
  const r = calc([row()], history(), { salary: null });
  r.variants.mid.assets[0].symbol = "<script>alert(1)</script>";
  const html = returnView(r);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Unavailable/);
  assert.match(html, /before dividends, taxes and fees/);
});
test("returns endpoint requires authentication, validates member, and cannot write private finance tables", async (t) => {
  const db = openStore(":memory:"),
    origin = "http://localhost:4173",
    rows = [row()];
  const app = await createApp({
    db,
    origin,
    logger: false,
    disableRateLimit: true,
    marketService: { returnHistory: async () => history() },
    platform: {
      politics: { get: async () => ({ rows, people: [person] }) },
      startWorker: false,
      workerEnabled: false,
    },
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  assert.equal(
    (await app.inject("/api/politics/returns?member=" + person.id)).statusCode,
    401,
  );
  const token = randomBytes(32).toString("base64url"),
    id = "returns-test";
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    id,
    "returns_test",
    "hash",
    "recovery",
    now,
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    id,
    Date.now(),
    Date.now(),
    Date.now(),
    Date.now() + 86400000,
  );
  const headers = { cookie: "reentry_dev=" + token };
  assert.equal(
    (await app.inject({ url: "/api/politics/returns", headers })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: "/api/politics/returns?member=absent", headers }))
      .statusCode,
    404,
  );
  const url = "/api/politics/returns?member=" + person.id;
  assert.equal((await app.inject({ url, headers })).statusCode, 200);
  // Await the actual endpoint job without allowing any external data call.
  let data;
  for (let i = 0; i < 20; i++) {
    data = (await app.inject({ url, headers })).json();
    if (data.status === "ready") break;
    await new Promise((r) => setTimeout(r, 3));
  }
  assert.equal(data.result.label, "Estimate");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM portfolios").get().n, 0);
});

test("reused ticker symbols cannot join an old issuer to a new company’s prices", () => {
  const rows = [row({ ticker: "SUNE", asset: "SunEdison Inc." })];
  const h = { ...history(), symbol: "SUNE", name: "SUNation Energy Inc." };
  const r = estimateReturns(rows, new Map([["SUNE", h]]), career, now);
  assert.equal(r.available, false);
  assert.equal(r.coverage.reasons[0].key, "identity");
  const valid = estimateReturns(
    [row({ asset: "The ABC Corporation [ST]" })],
    new Map([["ABC", history()]]),
    career,
    now,
  );
  assert.equal(valid.available, true);
});
test("sale-only symbols do not inflate the number of modeled investments", () => {
  const r = estimateReturns(
    [
      row(),
      row({
        ticker: "DEF",
        asset: "DEF Corporation",
        side: "sell",
        type: "Sale",
      }),
    ],
    new Map([
      ["ABC", history()],
      ["DEF", { ...history(), name: "DEF Corporation" }],
    ]),
    career,
    now,
  );
  assert.equal(r.coverage.assets, 1);
  assert.equal(r.variants.mid.assets.length, 1);
  assert.equal(r.variants.mid.unmatchedSales, 1000);
});
