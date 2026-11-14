import { test } from "node:test";
import assert from "node:assert/strict";
import {
  historyPath,
  normalizeHistory,
} from "../server/market/yahoo-history.js";
import { createMarketService } from "../server/market/service.js";
const payload = (currency = "USD") => ({
  chart: {
    result: [
      {
        meta: {
          currency,
          exchangeTimezoneName: "America/New_York",
          fullExchangeName: "NasdaqGS",
        },
        timestamp: [300, 100, 200, 400, 500, 600],
        indicators: { quote: [{ close: [30, 10, null, NaN, -1, 60] }] },
      },
    ],
    error: null,
  },
});
test("history ranges are bounded and symbols stay exact", () => {
  assert.match(historyPath("SAP.DE", "5y"), /SAP.DE\?range=5y&interval=1wk/);
  assert.match(historyPath("BTC-EUR", "1d"), /interval=5m/);
  const week = new URL(historyPath("BTC-EUR", "1wk"), "https://example.com");
  assert.equal(
    Number(week.searchParams.get("period2")) -
      Number(week.searchParams.get("period1")),
    7 * 86400,
  );
  for (const [symbol, range] of [
    [undefined, "1mo"],
    [["AAPL"], "1mo"],
    ["AAPL", ["1mo"]],
    ["AAPL", "max"],
    ["AAPL", "__proto__"],
    ["../../etc", "1d"],
    ["https://example.com", "1d"],
  ])
    assert.throws(() => historyPath(symbol, range), { statusCode: 400 });
});
test("missing bars are not invented and timestamps are ordered", () => {
  const data = normalizeHistory(payload(), "AAPL", "1mo");
  assert.deepEqual(data.points, [
    { time: 100, price: 10 },
    { time: 300, price: 30 },
    { time: 600, price: 60 },
  ]);
  assert.equal(data.currency, "USD");
  assert.equal(data.timeZone, "America/New_York");
});
test("quote subunits become correctly labelled prices, without fake historic FX", () => {
  const data = normalizeHistory(payload("GBp"), "VOD.L", "1mo");
  assert.equal(data.currency, "GBP");
  assert.equal(data.points[0].price, 0.1);
  assert.equal(
    normalizeHistory(payload("EUR"), "SAP.DE", "1mo").points[0].price,
    10,
  );
});
test("single points, duplicates and invalid provider metadata are handled", () => {
  const p = payload();
  p.chart.result[0].timestamp = [100, 100, 200];
  p.chart.result[0].indicators.quote[0].close = [10, 12, null];
  p.chart.result[0].meta.exchangeTimezoneName = "Invalid/Zone";
  const d = normalizeHistory(p, "AAPL", "1d");
  assert.deepEqual(d.points, [{ time: 100, price: 12 }]);
  assert.equal(d.timeZone, "UTC");
  assert.throws(() =>
    normalizeHistory(
      { chart: { result: null, error: { description: "Unavailable" } } },
      "AAPL",
      "1mo",
    ),
  );
  assert.throws(() => normalizeHistory(payload("INVALID"), "AAPL", "1mo"));
});
test("invalid history input fails before an upstream request", () => {
  assert.throws(() => createMarketService().history("AAPL", "bad"), {
    statusCode: 400,
  });
});
test("real provider OHLC and volume survive normalization and quote subunits", () => {
  const p = payload("GBp");
  const result = p.chart.result[0];
  result.timestamp = [100, 200];
  result.indicators.quote[0] = {
    open: [1000, 1200],
    high: [1250, 1300],
    low: [900, 1100],
    close: [1200, 1150],
    volume: [400, 0],
  };
  const history = normalizeHistory(p, "VOD.L", "1mo");
  assert.deepEqual(history.points, [
    {
      time: 100,
      price: 12,
      open: 10,
      high: 12.5,
      low: 9,
      close: 12,
      volume: 400,
    },
    {
      time: 200,
      price: 11.5,
      open: 12,
      high: 13,
      low: 11,
      close: 11.5,
      volume: 0,
    },
  ]);
  assert.equal(history.currency, "GBP");
});
test("missing or inconsistent candles stay close-only and invalid volume is omitted", () => {
  const p = payload();
  const result = p.chart.result[0];
  result.timestamp = [100, 200, 300, 400, 500];
  result.indicators.quote[0] = {
    close: [10, 11, 12, 13, 14],
    open: [null, 10, 10, 15, 12],
    high: [11, 10.5, 14, 14, Infinity],
    low: [9, 9, 11, 12, 10],
    volume: [null, -1, Infinity, "100", 25],
  };
  assert.deepEqual(normalizeHistory(p, "AAPL", "1mo").points, [
    { time: 100, price: 10 },
    { time: 200, price: 11 },
    { time: 300, price: 12 },
    { time: 400, price: 13 },
    { time: 500, price: 14, volume: 25 },
  ]);
});
