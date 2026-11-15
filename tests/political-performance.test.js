import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  estimateReturns,
  RETURN_MODEL_VERSION,
} from "../server/politics/returns-model.js";
import { buildPoliticalPerformance } from "../server/politics/performance.js";
import { createReturnLedger } from "../server/politics/return-ledger.js";
import { createPoliticalReturns } from "../server/politics/returns-service.js";
import {
  normalizeReturnHistory,
  returnHistoryPath,
} from "../server/market/return-history.js";
import {
  performanceWindow,
  politicalChartSymbol,
} from "../src/domain/political-performance.js";
import { sampleChartPoints } from "../src/domain/chart-sampling.js";
import {
  defaultChartViewState,
  validateChartViewState,
  mergeChartViews,
} from "../src/domain/chart-view.js";
import { renderAssetPlot } from "../src/features/charts/asset-plot.js";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
const history = (values, currency = "USD") => ({
  currency,
  name: "ABC Corporation",
  points: values.map(([date, close]) => ({ date, close })),
});
const histories = () =>
  new Map([
    [
      "ABC",
      history([
        ["2026-01-02", 10],
        ["2026-01-03", 20],
        ["2026-01-04", 30],
      ]),
    ],
    [
      "^GSPC",
      history([
        ["2026-01-02", 100],
        ["2026-01-03", 110],
        ["2026-01-04", 120],
      ]),
    ],
    [
      "^990100-USD-STRD",
      history([
        ["2026-01-02", 200],
        ["2026-01-03", 180],
        ["2026-01-04", 220],
      ]),
    ],
  ]);
const salary = {
  annual: 174000,
  year: 2026,
  role: "Representative",
  source: "https://uscode.house.gov/",
};
let id = 0;
const row = (changes = {}) => ({
  id: "r" + ++id,
  memberId: "person",
  ticker: "ABC",
  asset: "ABC Corporation common stock",
  assetType: "ST",
  owner: "Self",
  side: "buy",
  type: "Purchase",
  traded: "2026-01-02",
  priceDate: "2026-01-02",
  low: 1000,
  high: 1000,
  price: 10,
  ...changes,
});
const sale = (changes = {}) =>
  row({
    side: "sell",
    type: "Sale (Partial)",
    traded: "2026-01-03",
    priceDate: "2026-01-03",
    price: 20,
    ...changes,
  });
const curve = (rows, h = histories(), end = "2026-01-04") =>
  buildPoliticalPerformance(rows, h, salary, {
    from: "2026-01-02",
    through: end,
  });
test("index comparisons invest identical purchase dollars and sell matched lot fractions, not equal share counts", () => {
  const c = curve([row(), sale()]);
  assert.deepEqual(c.variants.mid.gain, [0, 1000, 1500]);
  assert.deepEqual(c.variants.mid.sp500, [0, 100, 150]);
  assert.deepEqual(c.variants.mid.world, [0, -100, 0]);
  assert.equal(c.salary[0], 0);
  assert.equal(
    c.salary.at(-1),
    Math.round(((174000 * 2) / 365.2425) * 100) / 100,
  );
  assert.equal(c.basis, "matched-capital-price-gains");
});
test("all three terminal performance values reconcile to the headline estimate", () => {
  const r = estimateReturns(
    [row({ high: 5000 }), sale({ low: 300, high: 1000 })],
    histories(),
    { salary },
    Date.parse("2026-01-05T12:00Z"),
  );
  for (const key of ["low", "mid", "high"])
    assert.equal(r.performance.variants[key].gain.at(-1), r.variants[key].gain);
  assert.equal(r.performance.salary.at(-1), r.salary.total);
});
test("closing one owner's position preserves a second owner's holdings in the same asset", () => {
  const rows = [
    row(),
    row({ owner: "Spouse" }),
    sale({ owner: "Spouse", type: "Sale (Full)" }),
  ];
  const c = curve(rows);
  assert.equal(c.variants.mid.gain.at(-1), 3000);
  assert.equal(c.variants.mid.sp500.at(-1), 300);
  const ledger = createReturnLedger(0.5);
  rows.forEach(ledger.apply);
  assert.equal(ledger.summary(() => 30).remaining, 3000);
  assert.equal(ledger.summary(() => 30).realized, 1000);
});
test("unmatched sales never introduce index capital or phantom investment gains", () => {
  const c = curve([row(), sale({ owner: "Spouse", low: 10000, high: 10000 })]);
  assert.equal(c.variants.mid.gain.at(-1), 2000);
  assert.equal(c.variants.mid.sp500.at(-1), 200);
  assert.equal(c.variants.mid.world.at(-1), 100);
});
test("after a full sale, realized dollar gains remain constant rather than compounding", () => {
  const c = curve([row(), sale({ type: "Sale (Full)" })]);
  assert.deepEqual(c.variants.mid.gain, [0, 1000, 1000]);
  assert.deepEqual(c.variants.mid.sp500, [0, 100, 100]);
  assert.deepEqual(c.variants.mid.world, [0, -100, -100]);
});
test("missing daily prices create gaps, never use future closes, and can recover", () => {
  const h = histories();
  h.set(
    "ABC",
    history([
      ["2026-01-02", 10],
      ["2026-01-12", 40],
    ]),
  );
  const c = curve([row()], h, "2026-01-12");
  assert.equal(c.variants.mid.gain[7], 0);
  assert.equal(c.variants.mid.gain[8], null);
  assert.equal(c.variants.mid.gain[9], null);
  assert.equal(c.variants.mid.gain[10], 3000);
});
test("a missing benchmark execution price disables that comparison instead of omitting a cash flow", () => {
  const h = histories();
  h.set(
    "^GSPC",
    history([
      ["2026-01-03", 110],
      ["2026-01-04", 120],
    ]),
  );
  const c = curve([row()], h);
  assert.deepEqual(c.variants.mid.sp500, [null, null, null]);
  assert.equal(c.benchmarks.find((b) => b.id === "sp500").available, false);
  assert.equal(c.variants.mid.gain.at(-1), 2000);
  h.set("^990100-USD-STRD", history([["2026-01-02", 200]], "EUR"));
  assert.deepEqual(curve([row()], h).variants.mid.world, [null, null, null]);
});
test("execution on the next priced day is not backdated to the reported holiday", () => {
  const h = histories();
  const c = curve([row({ priceDate: "2026-01-03", price: 20 })], h);
  assert.deepEqual(c.variants.mid.gain, [0, 0, 500]);
  assert.equal(c.variants.mid.sp500.at(-1), 90.91);
});
function windowFixture() {
  const dates = [];
  for (
    let t = Date.parse("2024-01-01T00:00Z");
    t <= Date.parse("2026-03-31T00:00Z");
    t += 86400000
  )
    dates.push(new Date(t).toISOString().slice(0, 10));
  const values = {
    gain: dates.map((_, i) => i * 10),
    sp500: dates.map((_, i) => i * 5),
    world: dates.map((_, i) => i * 2),
  };
  return {
    dates,
    through: dates.at(-1),
    variants: { mid: values },
    salary: dates.map((_, i) => i),
  };
}
test("short timeframes rebase all series on one date while retaining gains on prior holdings", () => {
  const d = windowFixture(),
    w = performanceWindow(d, "mid", "1mo");
  assert.equal(w.from, "2026-02-28");
  assert.equal(w.through, "2026-03-31");
  assert.equal(w.series[0].points[0].price, 0);
  assert.equal(w.series[0].points.at(-1).price, 310);
  assert.equal(w.series[1].points.at(-1).price, 31);
  assert.equal(w.series[2].points.at(-1).price, 155);
  assert.equal(w.series[3].points.at(-1).price, 62);
  assert.equal(performanceWindow(d, "mid", "ytd").from, "2025-12-31");
  assert.equal(performanceWindow(d, "mid", "1y").from, "2025-03-31");
  assert.equal(performanceWindow(d, "mid", "5y").clipped, true);
});
test("missing baseline cannot quietly give a benchmark a different comparison period", () => {
  const d = windowFixture(),
    i = d.dates.indexOf("2026-02-28");
  d.variants.mid.sp500[i] = null;
  const w = performanceWindow(d, "mid", "1mo");
  assert.equal(w.series[2].available, false);
  assert.ok(w.series[2].points.every((p) => p.price === null));
  d.variants.mid.gain[i] = null;
  assert.equal(performanceWindow(d, "mid", "1mo").from, "2026-03-01");
});
test("negative gains and absent salary stay distinct from a zero result", () => {
  const d = windowFixture();
  d.variants.mid.gain = d.variants.mid.gain.map((v) => -v);
  d.salary = d.salary.map(() => null);
  const w = performanceWindow(d, "mid", "1mo");
  assert.equal(w.series[0].points.at(-1).price, -310);
  assert.equal(w.series[1].available, false);
});
test("only the pinned USD MSCI price index may omit its currency metadata", () => {
  const payload = {
    chart: {
      result: [
        {
          meta: {
            symbol: "^990100-USD-STRD",
            instrumentType: "INDEX",
            currency: null,
          },
          timestamp: [Date.parse("2026-01-02T14:30Z") / 1000],
          indicators: { quote: [{ close: [4850] }] },
        },
      ],
    },
  };
  assert.equal(
    normalizeReturnHistory(payload, "^990100-USD-STRD").currency,
    "USD",
  );
  assert.match(returnHistoryPath("^GSPC"), /%5EGSPC/);
  assert.throws(() => returnHistoryPath("^OTHER"));
  payload.chart.result[0].meta.currency = "EUR";
  assert.throws(() => normalizeReturnHistory(payload, "^990100-USD-STRD"));
  payload.chart.result[0].meta.currency = null;
  payload.chart.result[0].meta.symbol = "^GSPC";
  assert.throws(() => normalizeReturnHistory(payload, "^GSPC"));
});
test("performance views persist their custom timeframe and both axes on a separate person-specific surface", () => {
  const b = defaultChartViewState("performance");
  assert.equal(b.range, "all");
  assert.equal(b.currency, "USD");
  const input = {
    ...b,
    range: "ytd",
    priceRange: { min: -1000, max: 5000 },
    viewport: { from: 1767225600, to: 1768003200 },
  };
  const s = validateChartViewState(input, "performance");
  assert.equal(s.range, "ytd");
  assert.deepEqual(s.priceRange, input.priceRange);
  assert.deepEqual(s.viewport, input.viewport);
  assert.equal(
    validateChartViewState(
      { ...input, scale: "log", currency: "EUR" },
      "performance",
    ).scale,
    "linear",
  );
  assert.throws(() =>
    validateChartViewState({ ...input, range: "1d" }, "performance"),
  );
  assert.equal(
    mergeChartViews(b, input, { ...b, chartType: "candle" }, "performance")
      .state.range,
    "ytd",
  );
  const a = politicalChartSymbol("congress:P000197"),
    other = politicalChartSymbol("congress:B001277");
  assert.match(a, /^[A-Z0-9.^=-]{1,32}$/);
  assert.notEqual(a, other);
});
test("drawing reduction preserves peaks, troughs and both sides of missing-price gaps", () => {
  const points = Array.from({ length: 5000 }, (_, i) => ({
    time: 1700000000 + i * 86400,
    price: Math.sin(i / 30),
  }));
  points[235].price = 999;
  points[350].price = -999;
  points[1001].price = null;
  points[1002].price = null;
  const sample = sampleChartPoints(points, 700);
  for (const i of [0, 235, 350, 1000, 1001, 1002, 1003, 4999])
    assert.ok(sample.includes(points[i]));
  assert.ok(sample.length < 800);
  const { html, geometry } = renderAssetPlot(
    { points, series: [{ points, primary: true }] },
    defaultChartViewState("performance"),
    {
      width: 900,
      height: 330,
      sampleLimit: 700,
      yLabel: (n) => "$" + n.toFixed(0),
    },
  );
  assert.equal(geometry.visibleTo, 4999);
  assert.match(html, /\$/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.ok(
    (
      html.match(/class="asset-series-line[^>]*d="([^"]*)"/)?.[1].match(/M/g) ||
      []
    ).length >= 2,
  );
});
test("upgrading an old cached estimate recomputes once, backs off if offline, and omits unchanged payloads on polling", async (t) => {
  const db = openStore(":memory:");
  migratePlatform(db);
  const now = Date.parse("2026-01-05T12:00Z"),
    p = { id: "person" },
    rows = [row()];
  const previous = estimateReturns(rows, histories(), { salary }, now - 1000);
  previous.modelVersion = RETURN_MODEL_VERSION - 1;
  delete previous.performance;
  db.prepare("INSERT INTO political_return_estimates VALUES(?,?,?,?,?,?)").run(
    p.id,
    "old",
    gzipSync(JSON.stringify(previous)),
    now - 1000,
    now + 3600000,
    1,
  );
  let calls = 0;
  const service = createPoliticalReturns({
    db,
    now: () => now,
    market: {
      returnHistory: async () => {
        calls++;
        throw Error("Offline");
      },
    },
  });
  t.after(async () => {
    await service.stop();
    db.close();
  });
  service.get(p, rows);
  let r;
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3));
    r = service.get(p, rows);
    if (r.status === "stale") break;
  }
  assert.equal(r.status, "stale");
  assert.equal(calls, 3);
  assert.equal(r.result.modelVersion, RETURN_MODEL_VERSION - 1);
  const same = service.get(p, rows, { knownRevision: r.revision });
  assert.equal(same.result, null);
  assert.equal(same.revision, r.revision);
  assert.equal(calls, 3);
});

test("people without modeled purchases retain honest coverage instead of failing the cache write", async (t) => {
  const db = openStore(":memory:");
  migratePlatform(db);
  const service = createPoliticalReturns({
    db,
    now: () => Date.parse("2026-01-05T12:00Z"),
    market: { returnHistory: async () => histories().get("ABC") },
  });
  t.after(async () => {
    await service.stop();
    db.close();
  });
  const p = { id: "person" },
    rows = [row({ assetType: "Stock Option" })];
  service.get(p, rows);
  let r;
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3));
    r = service.get(p, rows);
    if (r.status === "ready") break;
  }
  assert.equal(r.status, "ready");
  assert.equal(r.result.available, false);
  assert.equal(r.result.performance, null);
  assert.equal(r.result.coverage.excluded, 1);
});
