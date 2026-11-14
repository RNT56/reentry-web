import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import {
  createSet,
  observePrice,
  setView,
} from "../server/intelligence/scenarios.js";
import { completedDailyBars } from "../server/intelligence/chart-observations.js";

const time = (date) => Date.parse(date);
const point = (date, price) => ({ time: time(date) / 1000, price });
const branch = {
  title: "Breakout",
  condition: "Daily close above 100 EUR",
  eventKey: "breakout",
  low: 110,
  high: 120,
  currency: "EUR",
  horizonDays: 90,
  invalidation: "Daily close below 90 EUR",
  chartCondition: { direction: "above", price: 100 },
  chartInvalidation: { direction: "below", price: 90 },
};
function fixture(t, branches = [branch], created = "2026-11-01T12:00:00Z") {
  const db = openStore(":memory:");
  migratePlatform(db);
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    "chart-owner",
    "chart-owner",
    "fixture",
    "fixture",
    1,
  );
  const id = createSet(
    db,
    "chart-owner",
    "INTC",
    "AI chart",
    branches,
    { kind: "ai-chart", jobId: "fixture-job" },
    time(created),
  );
  t.after(() => db.close());
  return {
    db,
    row: db.prepare("SELECT * FROM scenario_sets WHERE id=?").get(id),
  };
}
function market(points, overrides = {}) {
  const calls = [];
  return {
    calls,
    quote: async () => {
      throw Error("Chart scenarios cannot use intraday quotes");
    },
    history: async (...args) => {
      calls.push(args);
      return {
        symbol: "INTC",
        interval: "1d",
        currency: "EUR",
        timeZone: "Europe/Berlin",
        source: "Fixture market",
        points,
        ...overrides,
      };
    },
  };
}
test("daily evidence excludes unfinished sessions and handles market-local DST", () => {
  const h = {
    interval: "1d",
    timeZone: "America/New_York",
    points: [
      point("2026-11-01T05:00:00Z", 105),
      point("2026-11-02T14:30:00Z", 106),
    ],
  };
  const result = completedDailyBars(h, time("2026-11-02T17:00:00Z"));
  assert.deepEqual(result, [
    {
      value: 105,
      occurredAt: time("2026-11-02T05:00:00Z"),
      sessionAt: time("2026-11-01T05:00:00Z"),
    },
  ]);
  assert.deepEqual(completedDailyBars({ ...h, interval: "15m" }), []);
  assert.equal(
    completedDailyBars(
      { ...h, timeZone: undefined },
      time("2026-11-03T05:00:00Z"),
    ).length,
    1,
  );
  assert.throws(() =>
    completedDailyBars({ ...h, points: [...h.points].reverse() }),
  );
});
test("chart scenario closes trigger, observe targets, retain chronology and deduplicate", async (t) => {
  const { db, row } = fixture(t);
  const data = market([
    point("2026-10-30T08:00:00Z", 115),
    point("2026-11-02T08:00:00Z", 105),
    point("2026-11-03T08:00:00Z", 115),
    point("2026-11-04T08:00:00Z", 85),
    point("2026-11-05T08:00:00Z", 140),
  ]);
  const now = time("2026-11-05T12:00:00Z");
  await observePrice(db, data, row, now);
  let view = setView(db, row, now);
  assert.equal(view.branches[0].status.status, "observed");
  assert.equal(view.branches[0].status.invalidatedAfterOutcome, true);
  assert.equal(view.counts.prices, 3);
  assert.equal(view.counts.events, 2);
  assert.deepEqual(data.calls[0], ["INTC", "1mo", "EUR"]);
  assert.ok(view.observations.every((o) => o.currency === "EUR"));
  assert.ok(view.observations.every((o) => o.recordedAt === now));
  assert.equal(setView(db, row, now - 1).counts.events, 0);
  assert.equal(setView(db, row, now - 1).branches[0].status.status, "watching");
  await observePrice(db, data, row, now + 1000);
  view = setView(db, row, now + 1000);
  assert.equal(view.counts.prices, 3);
  assert.equal(view.counts.events, 2);
  assert.equal(view.provenance.kind, "ai-chart");
});
test("invalidation wins over later target and price equality does not cross", async (t) => {
  const { db, row } = fixture(t);
  const data = market([
    point("2026-11-02T08:00:00Z", 100),
    point("2026-11-03T08:00:00Z", 90),
    point("2026-11-04T08:00:00Z", 85),
    point("2026-11-05T08:00:00Z", 115),
  ]);
  const now = time("2026-11-07T12:00:00Z");
  await observePrice(db, data, row, now);
  const view = setView(db, row, now);
  assert.equal(view.branches[0].status.status, "invalidated");
  assert.equal(view.branches[0].status.outcome, false);
  const events = view.observations.filter((o) => o.kind === "event");
  assert.equal(events.length, 2);
  assert.ok(events.every((o) => o.value !== 90 && o.value !== 100));
});
test("missing, mismatched or future chart history invents no observations", async (t) => {
  const { db, row } = fixture(t);
  const now = time("2026-11-05T12:00:00Z");
  for (const data of [
    market([], { currency: "USD" }),
    market([point("2026-11-02T08:00:00Z", 115)], { symbol: "AAPL" }),
    market([point("2026-11-08T08:00:00Z", 115)]),
    market([point("2026-11-02T08:00:00Z", NaN)]),
    market([point("2026-11-02T08:00:00Z", 115)], { interval: "1wk" }),
    market([]),
  ])
    await observePrice(db, data, row, now);
  assert.equal(setView(db, row, now).counts.prices, 0);
  assert.equal(setView(db, row, now).counts.events, 0);
});
test("long gaps request bounded daily history and ignore bars beyond the branch horizon", async (t) => {
  const { db, row } = fixture(t, [{ ...branch, horizonDays: 2 }]);
  const data = market([point("2026-11-06T08:00:00Z", 115)]);
  const now = time("2026-12-05T12:00:00Z");
  await observePrice(db, data, row, now);
  assert.deepEqual(data.calls[0], ["INTC", "1y", "EUR"]);
  assert.equal(setView(db, row, now).branches[0].status.status, "review");
  assert.equal(setView(db, row, now).counts.events, 0);
});

test("publication-session history and retracted automatic events cannot be reverified", async (t) => {
  const { db, row } = fixture(t, [branch], "2026-11-02T20:00:00Z");
  const data = market([
    point("2026-11-02T08:00:00Z", 115),
    point("2026-11-03T08:00:00Z", 105),
  ]);
  const now = time("2026-11-05T12:00:00Z");
  await observePrice(db, data, row, now);
  let view = setView(db, row, now);
  assert.equal(view.counts.prices, 1);
  assert.equal(view.branches[0].status.status, "triggered");
  db.prepare(
    "UPDATE scenario_observations SET verified=0 WHERE set_id=? AND kind='event'",
  ).run(row.id);
  await observePrice(db, data, row, now + 1000);
  view = setView(db, row, now + 1000);
  assert.equal(view.counts.events, 0);
  assert.equal(view.branches[0].status.status, "watching");
});
