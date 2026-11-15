import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultChartViewState,
  validateChartViewState,
  mergeChartViews,
} from "../src/domain/chart-view.js";
import { renderAssetPlot } from "../src/features/charts/asset-plot.js";
import {
  savedChartViewport,
  restoreChartWindow,
} from "../src/domain/chart-viewport.js";
import { createChartAutosave } from "../src/features/charts/chart-autosave.js";
const base = () => defaultChartViewState();
test("asset view validation separates numeric share axes from time and never stores analyses", () => {
  const input = {
    ...base(),
    viewport: { from: -3.5, to: 11.25 },
    priceRange: { min: 12, max: 32 },
    drawings: [{ unsafe: "text" }],
    indicators: ["nonsense"],
  };
  assert.throws(() => validateChartViewState(input), /chart date/);
  const view = validateChartViewState(input, "buyback");
  assert.deepEqual(view.viewport, input.viewport);
  assert.deepEqual(view.drawings, []);
  assert.deepEqual(view.indicators, []);
  for (const bad of [
    null,
    {},
    { ...input, viewport: { from: 1, to: 1 } },
    { ...input, viewport: { from: -1e7, to: 1 } },
    { ...input, viewport: { from: 0, to: Infinity } },
  ])
    assert.throws(() => validateChartViewState(bad, "buyback"));
});
test("concurrent view edits merge separate axes but preserve conflicting navigation for review", () => {
  const initial = base(),
    horizontal = { ...initial, viewport: { from: 1700000000, to: 1701000000 } },
    vertical = { ...initial, priceRange: { min: 10, max: 20 } };
  const merged = mergeChartViews(initial, horizontal, vertical);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.state.viewport, horizontal.viewport);
  assert.deepEqual(merged.state.priceRange, vertical.priceRange);
  const conflict = mergeChartViews(initial, horizontal, {
    ...horizontal,
    viewport: { from: 1700000200, to: 1700999999 },
  });
  assert.deepEqual(conflict.conflicts, ["Time view"]);
  assert.deepEqual(conflict.state, horizontal);
  const currencyConflict = mergeChartViews(initial, vertical, {
    ...initial,
    currency: "USD",
  });
  assert.deepEqual(currencyConflict.conflicts, ["Price view"]);
});
test("asset renderer keeps all series and reference levels aligned under pan, zoom and log scale", () => {
  const points = Array.from({ length: 30 }, (_, i) => ({
    time: 1700000000 + i * 86400,
    price: 30 + i,
  }));
  const data = {
    currency: "EUR",
    points,
    series: [
      { points, primary: true },
      {
        points: points.map((p) => ({ ...p, price: p.price * 2 })),
        color: "#83bdf1",
      },
    ],
  };
  for (const [width, height] of [
    [340, 290],
    [844, 250],
    [1440, 700],
  ]) {
    const state = {
      ...base(),
      viewport: savedChartViewport(points, { from: 5.5, to: 22.5 }),
      priceRange: { min: 25, max: 130 },
      scale: "log",
    };
    const { geometry: g, html } = renderAssetPlot(data, state, {
      width,
      height,
      references: [{ id: "buy", label: "Buy-in", price: 35 }],
    });
    assert.equal(g.start, 5.5);
    assert.equal(g.end, 22.5);
    assert.ok(Math.abs(g.low - 25) < 1e-10);
    assert.equal(g.timeX(points[10].time), g.x(10));
    assert.equal(g.y(130), g.T);
    assert.match(html, /data-ta-axis="price"/);
    assert.match(html, /data-ta-axis="time"/);
    assert.match(html, /clip-path=/);
    assert.match(html, /Buy-in/);
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  }
});
test("numeric buyback axis persists fractional negative whitespace without pretending to be dates", () => {
  const points = Array.from({ length: 81 }, (_, i) => ({
    time: i / 4,
    price: 100 / (1 + i / 400),
  }));
  const viewport = savedChartViewport(
    points,
    { from: -5, to: 40 },
    { min: -1e6, max: 1e6 },
  );
  assert.deepEqual(viewport, { from: -1.25, to: 10 });
  assert.deepEqual(restoreChartWindow(points, viewport), { from: -5, to: 40 });
  const { html } = renderAssetPlot(
    { points },
    { ...base(), viewport },
    { width: 320, height: 210, xLabel: (v) => "+" + v + "%" },
  );
  assert.match(html, /\+10%/);
  assert.doesNotMatch(html, /Jan|1970|NaN|undefined/);
});
test("a single-slot view uses its own account journal and CAS endpoint, restores drafts and gates remote changes during gestures", async () => {
  const data = new Map(),
    calls = [];
  let remote = { slot: 1, revision: 0, state: null };
  const storage = {
    getItem: (k) => data.get(k),
    setItem: (k, v) => data.set(k, v),
  };
  const make = () =>
    createChartAutosave({
      ownerId: "alice",
      symbol: "INTC",
      storage,
      setTimer: () => 0,
      clearTimer: () => {},
      policy: {
        slots: [1],
        initial: base,
        validate: validateChartViewState,
        merge: mergeChartViews,
        collection: "/views?symbol=INTC",
        path: () => "/views/INTC/price",
        storageKey: "views:alice:INTC:price",
      },
      request: async (path, method, payload, options) => {
        calls.push({ path, method, options });
        assert.equal(options.ownerId, "alice");
        if (method === "GET") return { slots: [structuredClone(remote)] };
        if (payload.revision !== remote.revision)
          throw Object.assign(Error("Conflict"), { status: 409 });
        remote = {
          slot: 1,
          revision: remote.revision + 1,
          state: payload.state,
        };
        return structuredClone(remote);
      },
    });
  const a = make();
  await a.load();
  assert.equal(a.slots().length, 1);
  a.update(1, { ...base(), priceRange: { min: 20, max: 30 } });
  const resumed = make();
  await resumed.load();
  assert.equal(resumed.get(1).phase, "pending");
  assert.equal(await resumed.flush(1), true);
  assert.equal(remote.revision, 1);
  assert.equal(calls.at(-1).path, "/views/INTC/price");
  assert.equal(data.size, 1);
  const release = resumed.hold(1);
  remote = {
    ...remote,
    revision: 2,
    state: { ...remote.state, priceRange: { min: 25, max: 35 } },
  };
  resumed.receive([remote]);
  assert.equal(resumed.get(1).state.priceRange.min, 20);
  release();
  assert.equal(resumed.get(1).state.priceRange.min, 25);
  await resumed.reset(1);
  assert.equal(resumed.get(1).phase, "saved");
  assert.ok(calls.every((c) => !c.path.includes("chart-workspaces")));
  a.pause();
  resumed.pause();
});

test("flat zero buyback ceilings have a finite linear scale and an honest empty log scale", () => {
  const points = [
    { time: 0, price: 0 },
    { time: 20, price: 0 },
  ];
  const linear = renderAssetPlot({ points }, defaultChartViewState("buyback"), {
    width: 320,
    height: 210,
    xLabel: (v) => v + "%",
  });
  assert.ok(linear.geometry.high > linear.geometry.low);
  assert.doesNotMatch(linear.html, /NaN|Infinity/);
  const log = renderAssetPlot(
    { points },
    { ...base(), scale: "log" },
    { width: 320, height: 210 },
  );
  assert.equal(log.geometry, null);
  assert.match(log.html, /No values/);
  const fallback = validateChartViewState({ ...base(), priceCurrency: "GBP" });
  assert.equal(fallback.priceCurrency, "GBP");
  assert.throws(() =>
    validateChartViewState({ ...base(), priceCurrency: "<bad>" }),
  );
});
