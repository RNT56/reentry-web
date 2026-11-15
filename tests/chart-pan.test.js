import test from "node:test";
import assert from "node:assert/strict";
import { panPriceRange } from "../src/domain/chart-axis.js";
import {
  observationIndex,
  observationTime,
  savedChartViewport,
  restoreChartWindow,
} from "../src/domain/chart-viewport.js";
import { panChartPlane } from "../src/features/charts/chart-gestures.js";
import {
  chartGeometry,
  renderAnalysisPlot,
} from "../src/features/charts/analysis-render.js";
import {
  defaultChartWorkspaceState,
  validateChartWorkspaceState,
} from "../src/domain/chart-workspace.js";
import { technicalIndicators } from "../src/domain/technical-analysis.js";

const points = Array.from({ length: 100 }, (_, i) => ({
  time: 1700000000 + (i + Math.floor(i / 5) * 2) * 86400,
  price: 90 + Math.sin(i / 4) * 5,
  open: 90,
  low: 80,
  high: 100,
  close: 90 + Math.sin(i / 4) * 5,
  volume: 100 + i,
}));
const near = (a, b, epsilon = 1e-7) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} ≈ ${b}`);

test("linear pans preserve price span; logarithmic pans preserve price ratio", () => {
  assert.deepEqual(panPriceRange({ low: 80, high: 120 }, 0.25), {
    min: 90,
    max: 130,
  });
  const next = panPriceRange({ low: 10, high: 100, log: true }, 1);
  near(next.min, 100);
  near(next.max, 1000);
  near(next.max / next.min, 10);
  for (const log of [false, true])
    for (const fraction of [-1e300, 1e300]) {
      const range = panPriceRange({ low: 10, high: 100, log }, fraction);
      validateChartWorkspaceState({
        ...defaultChartWorkspaceState(),
        scale: log ? "log" : "linear",
        priceRange: range,
      });
      assert.ok(range.min < range.max);
      if (log) near(range.max / range.min, 10);
      else near(range.max - range.min, 90);
    }
  assert.equal(panPriceRange({ low: 10, high: 100 }, NaN), null);
});

test("fractional and off-edge time windows round-trip across weekends without fabricating bars", () => {
  for (const index of [-20.5, 0, 4.75, 39.123, 95.82, 110.5])
    near(observationIndex(points, observationTime(points, index)), index);
  for (const window of [
    { from: 0.125, to: 40.125 },
    { from: -20.5, to: 78.5 },
    { from: 20.25, to: 119.25 },
  ]) {
    const saved = savedChartViewport(points, window),
      restored = restoreChartWindow(points, saved);
    near(restored.from, window.from);
    near(restored.to, window.to);
    validateChartWorkspaceState({
      ...defaultChartWorkspaceState(),
      viewport: saved,
    });
  }
  assert.equal(savedChartViewport(points, { from: 0, to: 99 }), null);
  assert.deepEqual(restoreChartWindow(points, { from: 10, to: 100 }), {
    from: 0,
    to: 99,
  });
});

test("diagonal pans translate price, drawings and indicator coordinates exactly at desktop and landscape sizes", () => {
  const data = { points },
    indicators = technicalIndicators(points);
  const original = structuredClone(points);
  for (const scale of ["linear", "log"])
    for (const chartType of ["line", "candle"])
      for (const [width, height] of [
        [390, undefined],
        [844, 230],
        [1280, 700],
      ]) {
        const state = {
          ...defaultChartWorkspaceState(),
          scale,
          chartType,
          indicators: ["sma20", "volume", "rsi"],
          viewport: { from: points[20].time, to: points[70].time },
        };
        const before = chartGeometry(data, state, indicators, width, height);
        const moved = panChartPlane(
          {
            ...before,
            from: before.start,
            to: before.end,
            length: points.length,
          },
          12.25,
          8.5,
        );
        const saved = validateChartWorkspaceState({
          ...state,
          viewport: savedChartViewport(points, moved),
          priceRange: moved.priceRange,
        });
        const after = chartGeometry(data, saved, indicators, width, height);
        near(after.x(40) - before.x(40), 12.25);
        near(after.y(points[40].price) - before.y(points[40].price), 8.5);
        near(
          after.timeX(points[40].time) - before.timeX(points[40].time),
          12.25,
        );
        assert.equal(
          after.anchor(after.x(40), after.y(points[40].price)).time,
          points[40].time,
        );
        near(
          after.anchor(after.x(40), after.y(points[40].price)).price,
          points[40].price,
        );
        const html = renderAnalysisPlot(data, saved, indicators, after).html;
        assert.doesNotMatch(html, /NaN|Infinity|undefined/);
        assert.match(html, /clipPath id="pane-/);
      }
  assert.deepEqual(points, original);
});

test("full-history panning leaves visible observations and persists the same position after resizing", () => {
  const data = { points },
    indicators = technicalIndicators(points),
    state = defaultChartWorkspaceState();
  const g = chartGeometry(data, state, indicators, 1280);
  const moved = panChartPlane(
    { ...g, from: g.start, to: g.end, length: points.length },
    200,
    -25,
  );
  assert.ok(moved.from < 0);
  const saved = {
    ...state,
    viewport: savedChartViewport(points, moved),
    priceRange: moved.priceRange,
  };
  const resized = chartGeometry(data, saved, indicators, 390, 250);
  near(resized.start, moved.from);
  near(resized.end, moved.to);
  near(resized.low, moved.priceRange.min);
  near(resized.high, moved.priceRange.max);
  assert.ok(resized.points.length >= points.length / 2);
  const extreme = panChartPlane(
    { ...g, from: g.start, to: g.end, length: points.length },
    -1e9,
    0,
  );
  const bounded = chartGeometry(
    data,
    { ...state, viewport: savedChartViewport(points, extreme) },
    indicators,
    390,
  );
  assert.ok(bounded.visibleFrom <= bounded.visibleTo);
  assert.doesNotMatch(
    renderAnalysisPlot(data, state, indicators, bounded).html,
    /NaN|undefined/,
  );
});
