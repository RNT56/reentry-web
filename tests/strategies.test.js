import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareStrategies,
  powerLaw,
  confirmedPivots,
  waveSetup,
} from "../src/domain/strategies.js";
const points = (prices) =>
  prices.map((price, i) => ({ time: 1577836800 + i * 7 * 86400, price }));
test("strategy comparison retains identical capital, fees and cash with no forced investment", () => {
  const data = points(Array.from({ length: 160 }, (_, i) => 20 + i * 0.2));
  const result = compareStrategies(data, { capital: 10000, fee: 2, bps: 10 });
  for (const s of result.strategies) {
    assert.ok(s.cash >= -1e-8);
    assert.equal(s.curve.length, 108);
    assert.ok(Math.abs(s.cash + s.shares * data.at(-1).price - s.value) < 1e-6);
    assert.ok(
      Math.abs(s.trades.reduce((v, t) => v + t.spend, 0) + s.cash - 10000) <
        1e-6,
    );
    assert.ok(
      s.trades.every(
        (t) => Math.abs(t.shares * t.price + t.cost - t.spend) < 1e-6,
      ),
    );
  }
  assert.equal(result.strategies[0].trades.length, 1);
  assert.ok(result.strategies[1].trades.length > 20);
  assert.equal(result.strategies[3].trades.length, 0);
  assert.equal(result.strategies[3].value, 10000);
});
test("prior-data trade signals are invariant to future price changes", () => {
  const a = points(
    Array.from({ length: 160 }, (_, i) => 20 + Math.sin(i / 3) * 3 + i * 0.05),
  );
  const b = a.map((p, i) => ({
    ...p,
    price: i > 120 ? p.price * 10 : p.price,
  }));
  const first = compareStrategies(a),
    second = compareStrategies(b);
  for (let j = 0; j < 4; j++)
    assert.deepEqual(
      first.strategies[j].trades.filter((t) => t.time <= a[120].time),
      second.strategies[j].trades.filter((t) => t.time <= a[120].time),
    );
});
test("power regression recovers a known exponent without producing results from short windows", () => {
  const p = points(
    Array.from({ length: 80 }, (_, i) => 3 * (1 + i * 7) ** 0.5),
  );
  assert.ok(Math.abs(powerLaw(p).slope - 0.5) < 1e-10);
  assert.ok(powerLaw(p).r2 > 0.999999);
  assert.equal(powerLaw(p.slice(0, 20)), null);
});
test("wave setup waits for pivot confirmation and respects retracement limits", () => {
  const p = points([10, 9, 8, 9, 11, 15, 20, 18, 15, 13, 14, 15]);
  assert.equal(waveSetup(p.slice(0, 11)).active, false);
  const wave = waveSetup(p);
  assert.equal(wave.active, true);
  assert.equal(wave.invalidation, 8);
  assert.ok(wave.projected[1] > wave.projected[0]);
  assert.ok(confirmedPivots(p).every((p) => p.confirmedAt > p.time));
  assert.equal(
    waveSetup(points([10, 9, 8, 9, 11, 15, 20, 18, 9, 7, 8, 10])).active,
    false,
  );
});
test("invalid prices and unreasonable comparison parameters fail cleanly", () => {
  assert.throws(() => compareStrategies([]), /64/);
  assert.throws(
    () => compareStrategies(points(Array(100).fill(1)), { capital: Infinity }),
    /Invalid/,
  );
  const r = compareStrategies(points(Array(100).fill(1)), { fee: 0 });
  assert.equal(r.strategies[0].return, 0);
  assert.equal(r.strategies[0].drawdown, 0);
});
test("asset structure returns bounded observed samples with finite positive fitted prices", () => {
  const data = points(
    Array.from({ length: 800 }, (_, i) => 5 * (1 + i * 7) ** 0.4),
  );
  const r = compareStrategies(data);
  assert.ok(r.structure.length <= 260);
  assert.equal(r.structure[0].time, data[0].time);
  assert.equal(r.structure.at(-1).time, data.at(-1).time);
  assert.ok(r.structure.every((p) => Number.isFinite(p.fit) && p.fit > 0));
  assert.ok(r.structure.every((p) => Math.abs(p.fit - p.price) < 1e-8));
});
