import test from "node:test";
import assert from "node:assert/strict";
import {
  axisDragFactor,
  chartAxisAt,
  scalePriceRange,
} from "../src/domain/chart-axis.js";
import {
  defaultChartWorkspaceState,
  validateChartWorkspaceState,
} from "../src/domain/chart-workspace.js";
import {
  chartGeometry,
  renderAnalysisPlot,
} from "../src/features/charts/analysis-render.js";
import { technicalIndicators } from "../src/domain/technical-analysis.js";

test("linear and log axis scaling preserve arithmetic and geometric centers respectively", () => {
  assert.deepEqual(scalePriceRange({ low: 80, high: 120 }, 0.5), {
    min: 90,
    max: 110,
  });
  const log = scalePriceRange({ low: 10, high: 1000, log: true }, 0.5);
  assert.ok(Math.abs(log.min * log.max - 10000) < 1e-8);
  assert.ok(Math.abs(log.max / log.min - 10) < 1e-10);
  assert.equal(axisDragFactor(0), 1);
  assert.ok(axisDragFactor(-90) < 1 && axisDragFactor(90) > 1);
  assert.equal(scalePriceRange({ low: 0, high: 10, log: true }, 1), null);
  assert.equal(scalePriceRange({ low: 10, high: 20 }, Infinity), null);
});

test("repeated extreme scaling stays finite, non-degenerate and persistable", () => {
  for (const log of [false, true]) {
    for (const factor of [1e-100, 1e100]) {
      let range = { min: 1e-9, max: 1e11 };
      for (let i = 0; i < 40; i++) {
        range = scalePriceRange(
          { low: range.min, high: range.max, log },
          factor,
        );
        assert.ok(
          Number.isFinite(range.min) &&
            Number.isFinite(range.max) &&
            range.min < range.max,
        );
        validateChartWorkspaceState({
          ...defaultChartWorkspaceState(),
          scale: log ? "log" : "linear",
          priceRange: range,
        });
      }
    }
  }
});

test("axis hit regions exclude the plot, outer margins and shared corner", () => {
  const view = { W: 1000, H: 500, L: 10, R: 924, T: 16, B: 468 };
  assert.equal(chartAxisAt({ x: 950, y: 200 }, view), "price");
  assert.equal(chartAxisAt({ x: 500, y: 485 }, view), "time");
  for (const [x, y] of [
    [500, 200],
    [950, 485],
    [950, 5],
    [1001, 200],
    [5, 485],
    [500, 501],
  ])
    assert.equal(chartAxisAt({ x, y }, view), null);
});

test("manual price range controls rendered coordinates independently of time, style and chart dimensions", () => {
  const data = {
    points: [10, 20, 30, 40, 50].map((price, i) => ({
      time: 1700000000 + i * 86400,
      price,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price,
    })),
  };
  const indicators = technicalIndicators(data.points);
  for (const scale of ["linear", "log"])
    for (const chartType of ["line", "candle"]) {
      const state = {
        ...defaultChartWorkspaceState(),
        scale,
        chartType,
        priceRange: { min: 15, max: 35 },
      };
      for (const [width, height] of [
        [338, undefined],
        [844, 200],
        [1400, 600],
      ]) {
        const g = chartGeometry(data, state, indicators, width, height);
        assert.ok(Math.abs(g.y(35) - g.T) < 1e-9);
        assert.ok(Math.abs(g.y(15) - g.B) < 1e-9);
        assert.ok(g.y(50) < g.T);
        const plot = renderAnalysisPlot(data, state, indicators, g, null).html;
        assert.match(plot, /data-ta-axis="price"/);
        assert.match(plot, /data-ta-axis="time"/);
        assert.doesNotMatch(plot, /NaN|Infinity|class="ta-line-endpoint"/);
      }
    }
});
