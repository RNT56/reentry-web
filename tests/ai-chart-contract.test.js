import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChartSnapshot,
  validateChartResult,
  makeChartPrompt,
  chartResultSchema,
} from "../server/ai/chart-contract.js";
import { technicalIndicators } from "../src/domain/technical-analysis.js";

const asOf = Date.parse("2026-11-14T12:00:00Z"),
  start = Math.floor(asOf / 1000) - 300 * 86400;
function history(count = 300) {
  return {
    symbol: "INTC",
    range: "1y",
    currency: "EUR",
    interval: "1d",
    timeZone: "America/New_York",
    source: "Observed fixture",
    points: Array.from({ length: count }, (_, i) => ({
      time: start + i * 86400,
      price: 40 + i * 0.1,
      open: 40.1 + i * 0.1,
      low: 39.8 + i * 0.1,
      high: 40.3 + i * 0.1,
      close: 40 + i * 0.1,
      volume: 12345678 + i,
    })),
  };
}
const options = { symbol: "INTC", range: "1y", currency: "EUR", asOf };
function snapshot() {
  return buildChartSnapshot(history(), options);
}
function result(chart) {
  return {
    summary: "Observed resistance defines a conditional upside path.",
    overlays: [
      {
        id: "resistance",
        type: "horizontal",
        label: "Resistance",
        rationale: "Repeated closes approach this observed region.",
        anchors: [{ time: chart.bars.at(-1).time, price: 70 }],
        scenarioKeys: ["breakout"],
      },
    ],
    scenarios: [
      {
        eventKey: "breakout",
        title: "Breakout holds",
        low: 75,
        high: 80,
        currency: "EUR",
        horizonDays: 60,
        invalidation: "The prior support region fails.",
        trigger: { direction: "above", price: 70 },
        invalidationTrigger: { direction: "below", price: 60 },
        overlayIds: ["resistance"],
      },
    ],
  };
}

test("AI chart evidence is completed, bounded, immutable and reproducibly hashed", () => {
  const raw = history(302),
    before = structuredClone(raw),
    chart = buildChartSnapshot(raw, options);
  assert.equal(chart.bars.length, 260);
  assert.ok(chart.lastTime * 1000 < asOf);
  assert.equal(chart.coverage.excludedIncomplete, 2);
  assert.equal(chart.coverage.candles, 260);
  assert.equal(chart.coverage.volume, 260);
  assert.equal(chart.hash.length, 64);
  assert.equal(chart.hash, buildChartSnapshot(raw, options).hash);
  assert.ok(Buffer.byteLength(JSON.stringify(chart)) < 45000);
  assert.deepEqual(raw, before);
  const expected = technicalIndicators(chart.bars);
  assert.equal(
    chart.indicators.sma50,
    Number(expected.sma50.at(-1).toPrecision(10)),
  );
  assert.equal(
    chart.indicators.rsi,
    Number(expected.rsi.at(-1).toPrecision(10)),
  );
  Object.assign(raw.points[0], {
    price: 1,
    close: 1,
    open: 1,
    low: 1,
    high: 1,
  });
  assert.equal(chart.hash, buildChartSnapshot(raw, options).hash);
});

test("evidence preserves missing observations and warmups without synthetic candles", () => {
  const raw = history(20);
  raw.points = raw.points.map(({ time, price }) => ({ time, price }));
  const chart = buildChartSnapshot(raw, options);
  assert.equal(chart.coverage.candles, 0);
  assert.equal(chart.coverage.volume, 0);
  assert.equal(chart.indicators.sma50, null);
  assert.equal(chart.indicators.sma200, null);
  assert.equal(chart.indicators.macd.signal, null);
  assert.equal(chart.bars[0].open, undefined);
  assert.equal(chart.bars[0].volume, undefined);
});

test("current market date and unknown timezones cannot leak partial daily bars", () => {
  const raw = history(300);
  raw.points.push({ time: Math.floor(asOf / 1000) - 3600, price: 80 });
  const chart = buildChartSnapshot(raw, options);
  assert.equal(chart.coverage.excludedIncomplete, 1);
  raw.timeZone = undefined;
  const conservative = buildChartSnapshot(raw, options);
  assert.ok(asOf - conservative.lastTime * 1000 >= 48 * 3600000);
  raw.timeZone = "Not/AZone";
  assert.throws(() => buildChartSnapshot(raw, options), /timezone/);
});

test("evidence rejects mismatched, malformed, short and overlarge histories", () => {
  for (const update of [
    { currency: "USD" },
    { symbol: "AAPL" },
    { range: "3mo" },
    { interval: "1wk" },
    { points: history(19).points },
    { points: Array(2501).fill({ time: 1, price: 1 }) },
  ])
    assert.throws(() =>
      buildChartSnapshot({ ...history(), ...update }, options),
    );
  const raw = history();
  raw.points[1].time = raw.points[0].time;
  assert.throws(() => buildChartSnapshot(raw, options), /ordered/);
  const badCandle = history();
  badCandle.points[2].low = 999;
  assert.throws(() => buildChartSnapshot(badCandle, options), /candle/);
  const badVolume = history();
  badVolume.points[2].volume = -1;
  assert.throws(() => buildChartSnapshot(badVolume, options), /volume/);
});

test("AI result derives exact daily-close conditions and reciprocal overlay provenance", () => {
  const chart = snapshot(),
    raw = result(chart),
    normalized = validateChartResult(raw, { chart });
  assert.equal(normalized.scenarios[0].condition, "Daily close above 70 EUR");
  assert.equal(
    normalized.scenarios[0].invalidation,
    "Daily close below 60 EUR",
  );
  assert.deepEqual(normalized.scenarios[0].chartCondition, {
    direction: "above",
    price: 70,
    basis: "daily-close",
  });
  assert.deepEqual(normalized.scenarios[0].sourceIds, ["chart:" + chart.hash]);
  assert.equal(normalized.overlays[0].text, "Resistance");
  assert.deepEqual(normalized.overlays[0].scenarioKeys, ["breakout"]);
  assert.equal(
    normalized.scenarios[0].invalidationRationale,
    raw.scenarios[0].invalidation,
  );
  assert.deepEqual(
    validateChartResult(
      { summary: "No defensible structure.", overlays: [], scenarios: [] },
      { chart },
    ).scenarios,
    [],
  );
});

test("result rejects unknown links, duplicates, currency conflict and contradictory thresholds", () => {
  const chart = snapshot();
  const mutations = [
    (r) => r.overlays.push(structuredClone(r.overlays[0])),
    (r) => r.scenarios.push(structuredClone(r.scenarios[0])),
    (r) => r.overlays[0].scenarioKeys.push("unknown"),
    (r) => r.overlays[0].scenarioKeys.splice(0),
    (r) => r.scenarios[0].overlayIds.push("missing"),
    (r) => r.scenarios[0].overlayIds.splice(0),
    (r) => (r.scenarios[0].currency = "USD"),
    (r) => (r.scenarios[0].low = 90),
    (r) => (r.scenarios[0].horizonDays = 366),
    (r) => (r.scenarios[0].invalidationTrigger.direction = "above"),
    (r) => (r.scenarios[0].invalidationTrigger.price = 70),
    (r) => (r.scenarios[0].trigger.price = 1e9),
    (r) => (r.scenarios[0].eventKey = "breakout-invalidated"),
    (r) => (r.confidence = 0.9),
  ];
  for (const mutate of mutations) {
    const candidate = result(chart);
    mutate(candidate);
    assert.throws(() => validateChartResult(candidate, { chart }));
  }
});

test("drawings cannot fabricate timestamps, future anchors or impossible prices", () => {
  const chart = snapshot();
  for (const anchor of [
    { time: chart.lastTime + 1, price: 70 },
    { time: chart.lastTime + 86400, price: 70 },
    { time: chart.lastTime, price: -1 },
    { time: chart.lastTime, price: Infinity },
    { time: chart.lastTime, price: 1e11 },
  ]) {
    const candidate = result(chart);
    candidate.overlays[0].anchors[0] = anchor;
    assert.throws(() => validateChartResult(candidate, { chart }));
  }
  const reversed = result(chart);
  reversed.overlays[0].type = "trend";
  reversed.overlays[0].anchors.push({ time: chart.firstTime, price: 40 });
  assert.throws(() => validateChartResult(reversed, { chart }), /anchor order/);
});

test("prompt only shares chart evidence and provider schema stays structurally compatible", () => {
  const chart = snapshot(),
    prompt = makeChartPrompt({
      chart,
      apiKey: "UNIQUE_PRIVATE_CREDENTIAL_93",
      portfolio: "UNIQUE_PRIVATE_PORTFOLIO_17",
      drawings: ["UNIQUE_PRIVATE_DRAWING_42"],
    });
  assert.ok(prompt.includes(chart.hash));
  assert.ok(prompt.includes("untrusted data"));
  assert.ok(!prompt.includes("UNIQUE_PRIVATE_CREDENTIAL_93"));
  assert.ok(!prompt.includes("UNIQUE_PRIVATE_PORTFOLIO_17"));
  assert.ok(!prompt.includes("UNIQUE_PRIVATE_DRAWING_42"));
  assert.equal(chartResultSchema.additionalProperties, false);
  assert.equal(
    chartResultSchema.properties.overlays.items.additionalProperties,
    false,
  );
});
