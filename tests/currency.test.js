import { test } from "node:test";
import assert from "node:assert/strict";
import { convertHistory } from "../server/market/history-currency.js";
import { createMarketService } from "../server/market/service.js";
import { referenceLevels } from "../src/domain/chart-levels.js";
test("historical conversion uses only contemporaneous earlier FX observations", () => {
  const native = {
    currency: "USD",
    points: [
      { time: 1000000, price: 10 },
      { time: 1100000, price: 20 },
    ],
  };
  const converted = convertHistory(
    native,
    {
      points: [
        { time: 999999, price: 0.9 },
        { time: 1100001, price: 0.5 },
      ],
    },
    "EUR",
  );
  assert.deepEqual(
    converted.points.map((p) => p.price),
    [9, 18],
  );
  assert.equal(converted.currency, "EUR");
  assert.equal(native.points[0].price, 10);
  const missing = convertHistory(
    native,
    { points: [{ time: 1000001, price: 0.9 }] },
    "EUR",
  );
  assert.equal(missing.currency, "USD");
  assert.equal(missing.conversionUnavailable, true);
  const stale = convertHistory(
    native,
    { points: [{ time: 1, price: 0.9 }] },
    "EUR",
  );
  assert.equal(stale.conversionUnavailable, true);
});
test("market history conversion is currency-keyed and rejects unsupported currency before I/O", async () => {
  const calls = [];
  const market = createMarketService({
    provider: {
      history: async (symbol, _range, padded) => {
        if (symbol !== "INTC") assert.equal(padded, true);
        calls.push(symbol);
        return {
          symbol,
          currency: symbol === "INTC" ? "USD" : "EUR",
          points: [{ time: 1000000, price: symbol === "INTC" ? 20 : 0.8 }],
        };
      },
      quote: async () => ({ price: 1.2, time: Date.now() / 1000 }),
    },
  });
  assert.equal(
    (await market.history("INTC", "1mo", "EUR")).points[0].price,
    16,
  );
  assert.equal(
    (await market.history("INTC", "1mo", "USD")).points[0].price,
    20,
  );
  assert.deepEqual(calls, ["INTC", "USDEUR=X"]);
  assert.throws(
    () => market.history("INTC", "1mo", "GBP"),
    /Invalid chart currency/,
  );
});
test("USD overlays use a fresh EURUSD reference independently of listing currency", () => {
  const now = Date.now();
  const result = referenceLevels({
    currency: "USD",
    symbol: "SAP.DE",
    buyIn: 100,
    target: 90,
    displayFx: { rate: 1.2, time: now / 1000 },
    now,
  });
  assert.deepEqual(
    result.levels.map((l) => l.price),
    [120, 108],
  );
  assert.equal(
    referenceLevels({
      currency: "EUR",
      symbol: "SAP.DE",
      buyIn: 100,
      target: 90,
    }).levels[0].price,
    100,
  );
});
test("daily FX closes become eligible only after the day has completed", () => {
  const native = { currency: "USD", points: [{ time: 200000, price: 10 }] };
  const converted = convertHistory(
    native,
    {
      range: "1mo",
      points: [
        { time: 100000, price: 0.9 },
        { time: 190000, price: 0.5 },
      ],
    },
    "EUR",
  );
  assert.equal(converted.points[0].price, 9);
});
