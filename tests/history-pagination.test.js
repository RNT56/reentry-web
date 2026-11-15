import { test } from "node:test";
import assert from "node:assert/strict";
import {
  historyWindow,
  withHistoryPaging,
} from "../server/market/history-window.js";
import { historyPath } from "../server/market/yahoo-history.js";
import { createMarketService } from "../server/market/service.js";
import { readMarketJSON } from "../server/market/read-json.js";
import {
  mergeHistory,
  loadChartHistory,
  fullHistoryViewport,
} from "../src/features/charts/history-data.js";
import { mountHistoryBrowser } from "../src/features/charts/history-browser.js";
import { renderAssetPlot } from "../src/features/charts/asset-plot.js";
import { defaultChartViewState } from "../src/domain/chart-view.js";
import { externalURL } from "../src/shared/external-url.js";
const DAY = 86400,
  now = Math.floor(Date.UTC(2026, 10, 15) / 1000);
const history = (times, more = null) => ({
  symbol: "AAPL",
  range: "1mo",
  interval: "1d",
  currency: "EUR",
  points: times.map((time) => ({
    time,
    price: 100,
    open: 98,
    high: 102,
    low: 97,
    close: 100,
  })),
  paging: { before: more, boundary: "Start of history" },
});

test("history windows bound intraday retention and daily/weekly batch size before fetching", () => {
  for (const bad of [[], {}, "", -1, 1.5, "1e4", "__proto__", now + DAY + 1])
    assert.throws(() => historyWindow("AAPL", "1mo", bad, now), {
      statusCode: 400,
    });
  assert.equal(historyWindow("AAPL", "1mo", undefined, now), null);
  for (const [range, days] of [
    ["1d", 5],
    ["1wk", 21],
    ["1mo", 1826],
    ["5y", 7305],
  ]) {
    const w = historyWindow("AAPL", range, now, now);
    assert.equal(w.to - w.from, days * DAY);
    const path = new URL(
      historyPath("AAPL", range, false, w),
      "https://example.com",
    );
    assert.equal(Number(path.searchParams.get("period1")), w.from);
  }
  const w = historyWindow("AAPL", "1d", now - 58 * DAY, now);
  assert.equal(w.from, now - 59 * DAY);
  assert.throws(() => historyWindow("AAPL", "1d", now - 60 * DAY, now), {
    statusCode: 400,
  });
});

test("empty weekend pages advance, inception and retention stop, out-of-window live bars are excluded", () => {
  const w = { from: now - 100 * DAY, to: now - 95 * DAY, floor: 0 };
  const empty = withHistoryPaging(history([]), w, now);
  assert.equal(empty.paging.before, w.from);
  const first = withHistoryPaging(
    { ...history([w.from, w.to, now]), firstTradeTime: w.from + 100 },
    w,
    now,
  );
  assert.deepEqual(
    first.points.map((p) => p.time),
    [w.from],
  );
  assert.equal(first.paging.before, null);
  const intraday = withHistoryPaging(
    { ...history([now - 59 * DAY]), range: "1d" },
    { from: now - 59 * DAY, to: now, floor: now - 59 * DAY },
    now,
  );
  assert.equal(intraday.paging.before, null);
  assert.equal(intraday.paging.boundary, "Intraday limit");
});

test("historical native and FX requests use the same bounded window and deduplicate", async () => {
  const calls = [];
  const service = createMarketService({
    provider: {
      history: async (symbol, range, padded, window) => {
        calls.push({ symbol, range, padded, window });
        return {
          ...history([window.from + 3 * DAY]),
          symbol,
          currency: symbol.endsWith("=X") ? "EUR" : "USD",
        };
      },
    },
  });
  const before = String(now - 365 * DAY);
  const [a, b] = await Promise.all([
    service.history("AAPL", "1mo", "EUR", before),
    service.history("AAPL", "1mo", "EUR", before),
  ]);
  assert.equal(a, b);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].window, calls[1].window);
  assert.equal(calls[1].padded, true);
  await assert.rejects(
    async () => service.history("AAPL", "1mo", "EUR", "evil"),
    { statusCode: 400 },
  );
  assert.equal(calls.length, 2);
});

test("merging pages preserves newer duplicate observations and never mixes identities or currencies", () => {
  const recent = history([300, 400], 300),
    older = history([100, 200, 300], 100);
  older.points.at(-1).price = 99;
  const merged = mergeHistory(recent, older);
  assert.deepEqual(
    merged.points.map((p) => p.time),
    [100, 200, 300, 400],
  );
  assert.equal(merged.points[2].price, 100);
  assert.deepEqual(fullHistoryViewport(merged), { from: 100, to: 400 });
  for (const [key, value] of [
    ["symbol", "NVDA"],
    ["currency", "USD"],
    ["interval", "1wk"],
    ["range", "1y"],
  ])
    assert.throws(() => mergeHistory(recent, { ...older, [key]: value }));
});

test("restoring an old saved view fills every intervening page, bounded and cancellable", async () => {
  const calls = [];
  const read = async (s, r, c, before) => {
    calls.push(before);
    return before === undefined
      ? history([500, 600], 500)
      : before === 500
        ? history([300, 400], 300)
        : history([100, 200], null);
  };
  const state = {
    range: "1mo",
    currency: "EUR",
    viewport: { from: 120, to: 240 },
  };
  const restored = await loadChartHistory("AAPL", state, () => true, read);
  assert.deepEqual(calls, [undefined, 500, 300]);
  assert.deepEqual(
    restored.points.map((p) => p.time),
    [100, 200, 300, 400, 500, 600],
  );
  calls.length = 0;
  await loadChartHistory("AAPL", state, () => false, read);
  assert.deepEqual(calls, [undefined]);
  await assert.rejects(
    loadChartHistory(
      "AAPL",
      state,
      () => true,
      async () => history([500, 600], 500),
    ),
    /cursor/,
  );
});

function browserFixture(fetchHistory) {
  const button = {},
    status = {},
    root = {
      querySelector: (s) => (s === "[data-chart-earlier]" ? button : status),
    };
  const current = {
    data: history([300, 400], 300),
    state: { currency: "EUR", viewport: null },
    geometry: { start: 0, end: 1 },
    busy: false,
    interacting: false,
  };
  const applied = [];
  const browser = mountHistoryBrowser(root, {
    read: () => current,
    fetchHistory,
    apply: (data, viewport) => {
      current.data = data;
      current.state.viewport = viewport;
      applied.push({ data, viewport });
    },
  });
  browser.update(false);
  return { browser, current, applied, button };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("backfill waits for active gestures and anchors the latest viewport, not its request-time snapshot", async () => {
  let resolve;
  const f = browserFixture(() => new Promise((r) => (resolve = r)));
  f.button.onclick({ stopPropagation() {} });
  f.current.interacting = true;
  resolve(history([100, 200], 100));
  await tick();
  assert.equal(f.applied.length, 0);
  f.current.state.viewport = { from: 320, to: 390 };
  f.current.interacting = false;
  f.browser.update(false);
  assert.equal(f.applied.length, 1);
  assert.deepEqual(f.applied[0].viewport, { from: 320, to: 390 });
  f.browser.destroy();
});
test("late backfill cannot overwrite another range, slot or departed chart", async () => {
  let resolve;
  const f = browserFixture(() => new Promise((r) => (resolve = r)));
  f.button.onclick({ stopPropagation() {} });
  f.current.data = history([900, 1000], 900);
  f.browser.update(false);
  resolve(history([100, 200], 100));
  await tick();
  assert.equal(f.applied.length, 0);
  f.browser.destroy();
});
test("expanded history does not alter the visible price scale; market candles retain reference levels", () => {
  const data = history([100, 200, 300, 400]);
  data.points[0] = { time: 100, price: 10000 };
  const state = {
    ...defaultChartViewState("price"),
    viewport: { from: 300, to: 400 },
    chartType: "candle",
  };
  const r = renderAssetPlot(data, state, {
    width: 700,
    height: 400,
    references: [{ id: "target", price: 90, label: "Target" }],
  });
  assert.ok(r.geometry.axis(0) < 200);
  assert.match(r.html, /chart-candles/);
  assert.match(r.html, /Target/);
  const closeOnly = renderAssetPlot(
    {
      ...data,
      points: data.points.map(({ time, price }) => ({ time, price })),
    },
    state,
    { width: 700, height: 400 },
  );
  assert.doesNotMatch(closeOnly.html, /class="chart-candles"/);
  assert.match(closeOnly.html, /asset-series-line/);
  const simulated = renderAssetPlot(
    { ...data, series: [{ points: data.points, primary: true }] },
    state,
    { width: 700, height: 400 },
  );
  assert.doesNotMatch(simulated.html, /class="chart-candles"/);
});
test("upstream response byte limits apply before JSON parsing including chunked bodies", async () => {
  await assert.rejects(
    readMarketJSON(
      new Response("123456", { headers: { "content-length": "6" } }),
      5,
    ),
    /too large/,
  );
  await assert.rejects(readMarketJSON(new Response("123456"), 5), /too large/);
  assert.deepEqual(await readMarketJSON(new Response('{"ok":true}')), {
    ok: true,
  });
});
test("provider and legacy source links cannot use executable URLs or embedded credentials", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//evil.test",
    "https://user:pass@evil.test",
    {},
    null,
  ])
    assert.equal(externalURL(value), "");
  assert.equal(externalURL("https://www.sec.gov/a"), "https://www.sec.gov/a");
});

test("dates on expanded charts distinguish sessions and historical years", async () => {
  const { chartTimeLabel } = await import(
    "../src/features/charts/chart-time.js"
  );
  const same = history([now, now + 3600]);
  same.interval = "5m";
  let label = chartTimeLabel(
    same,
    { visibleFrom: 0, visibleTo: 1 },
    now * 1000,
  );
  assert.notEqual(label(now), label(now + 3600));
  const cross = history([now - 2 * DAY, now]);
  cross.interval = "15m";
  label = chartTimeLabel(cross, { visibleFrom: 0, visibleTo: 1 }, now * 1000);
  assert.match(label(now), /Nov/);
  const old = history([
    Date.UTC(2016, 0, 1) / 1000,
    Date.UTC(2017, 0, 1) / 1000,
  ]);
  label = chartTimeLabel(old, { visibleFrom: 0, visibleTo: 1 }, now * 1000);
  assert.match(label(old.points[0].time), /16/);
  assert.match(label(old.points[1].time), /17/);
});

test("cached data shared by analysis slots cannot accept a late page from the previous slot", async () => {
  let resolve;
  const f = browserFixture(() => new Promise((r) => (resolve = r)));
  f.current.key = 1;
  f.browser.update(false);
  f.button.onclick({ stopPropagation() {} });
  f.current.key = 2;
  f.browser.update(false);
  resolve(history([100, 200], 100));
  await tick();
  assert.equal(f.applied.length, 0);
  f.browser.destroy();
});
