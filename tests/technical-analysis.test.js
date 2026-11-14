import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sma,
  ema,
  bollingerBands,
  rsi,
  macd,
  technicalIndicators,
  fibonacciLevels,
  measureRange,
} from "../src/domain/technical-analysis.js";
const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} ≠ ${expected}`,
  );
const history = (values) =>
  values.map((price, i) => ({
    time: 1700000000 + i * 86400,
    price,
    volume: i * 20,
  }));

test("averages use complete trailing periods and EMA is SMA seeded", () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([1, 2, 3, 4, 8], 3), [null, null, 2, 3, 5.5]);
  assert.deepEqual(sma([1, 2, null, 4, 5, 6], 3), [
    null,
    null,
    null,
    null,
    null,
    5,
  ]);
  assert.deepEqual(ema([1, 2, 3, null, 10, 11, 12, 14], 3), [
    null,
    null,
    2,
    null,
    null,
    null,
    11,
    12.5,
  ]);
});

test("Bollinger bands use population variance and retain stable large-price deviations", () => {
  const { middle, upper, lower } = bollingerBands([1, 2, 3, 4, 5], 3, 2);
  assert.deepEqual(middle, [null, null, 2, 3, 4]);
  close(upper[2], 2 + 2 * Math.sqrt(2 / 3));
  close(lower[4], 4 - 2 * Math.sqrt(2 / 3));
  const offset = bollingerBands([1e9 + 1, 1e9 + 2, 1e9 + 3, 1e9 + 4], 3);
  close(offset.upper[3] - offset.middle[3], 2 * Math.sqrt(2 / 3), 1e-6);
  assert.deepEqual(bollingerBands([2, null, 4, 4], 2).middle, [
    null,
    null,
    null,
    4,
  ]);
});

test("Wilder RSI matches the published initial example and smoothing arithmetic", () => {
  const values = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
    46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
  ];
  const result = rsi(values);
  assert.ok(result.slice(0, 14).every((v) => v === null));
  close(result[14], 70.46413502109705);
  close(result[15], 66.24961855355505);
  close(result[19], 57.91502067008556);
  assert.equal(rsi(Array(15).fill(5)).at(-1), 50);
  assert.equal(rsi(Array.from({ length: 15 }, (_, i) => i + 1)).at(-1), 100);
  assert.equal(rsi(Array.from({ length: 15 }, (_, i) => 20 - i)).at(-1), 0);
  assert.deepEqual(rsi([1, 2, 3, null, 10, 11, 12], 2), [
    null,
    null,
    100,
    null,
    null,
    null,
    100,
  ]);
});

test("MACD line and signal warmups stay aligned without fabricated leading zeroes", () => {
  const values = Array.from({ length: 40 }, (_, i) => i + 1),
    result = macd(values);
  assert.ok(result.line.slice(0, 25).every((v) => v === null));
  close(result.line[25], 7);
  assert.ok(result.signal.slice(0, 33).every((v) => v === null));
  close(result.signal[33], 7);
  close(result.histogram[33], 0);
  const shorter = macd([1, 2, 4, 8, 16, 32], 2, 3, 2);
  close(shorter.line[2], 5 / 6);
  close(shorter.signal[3], 37 / 36);
  close(shorter.histogram[3], 7 / 36);
});

test("all indicator prefixes are invariant to future bars; missing values reset warmup", () => {
  const values = Array.from(
    { length: 260 },
    (_, i) => 50 + i * 0.1 + Math.sin(i / 4),
  );
  const a = technicalIndicators(history(values)),
    b = technicalIndicators(
      history(values.map((v, i) => (i > 210 ? v * 10 : v))),
    );
  function prefix(first, second) {
    for (const key of Object.keys(first)) {
      if (Array.isArray(first[key]))
        assert.deepEqual(first[key].slice(0, 211), second[key].slice(0, 211));
      else prefix(first[key], second[key]);
    }
  }
  prefix(a, b);
  assert.equal(a.sma200[198], null);
  assert.notEqual(a.sma200[199], null);
  const gapped = history(values);
  gapped[240].price = null;
  const gapResult = technicalIndicators(gapped);
  assert.equal(gapResult.sma20[259], null);
  assert.equal(gapResult.rsi[254], null);
  assert.notEqual(gapResult.rsi[255], null);
  assert.deepEqual(technicalIndicators([{ time: 1, close: 20 }]).volume, [
    null,
  ]);
});

test("invalid data is rejected rather than sorted, dropped or relabelled", () => {
  for (const points of [
    [{ time: 1, price: 0 }],
    [{ time: 1, price: Infinity }],
    [
      { time: 2, price: 1 },
      { time: 1, price: 2 },
    ],
    [
      { time: 1, price: 1 },
      { time: 1, price: 2 },
    ],
    [{ time: 1, price: 1, volume: -1 }],
  ])
    assert.throws(() => technicalIndicators(points));
  assert.throws(() => sma([1, NaN], 2));
  assert.throws(() => ema([1, 2], 0));
  assert.throws(() => macd([1, 2], 26, 12));
});

test("retracements preserve drawn direction and measurements count observed bar intervals", () => {
  const a = { time: 0, price: 100 },
    b = { time: 172800, price: 200 };
  const levels = fibonacciLevels(a, b);
  assert.equal(levels[0].price, 200);
  close(levels[4].price, 138.2);
  assert.equal(levels.at(-1).price, 100);
  close(fibonacciLevels(b, a)[4].price, 161.8);
  assert.deepEqual(
    measureRange(a, b, [{ time: 0 }, { time: 86400 }, { time: 172800 }]),
    { absolute: 100, percent: 100, seconds: 172800, days: 2, bars: 2 },
  );
  assert.equal(measureRange(b, a).percent, -50);
  assert.equal(measureRange(b, a).days, 2);
  assert.equal(measureRange(a, a).bars, null);
  assert.throws(() => fibonacciLevels({ time: 0, price: 0 }, b));
});
