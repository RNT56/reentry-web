import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartInkPaths,
  renderChartInk,
  newChartInkId,
} from "../src/shared/chart-ink.js";
import {
  chartGeometry,
  renderAnalysisPlot,
} from "../src/features/charts/analysis-render.js";
import { technicalIndicators } from "../src/domain/technical-analysis.js";
const options = { x: (i) => i * 10, y: (price) => 100 - price, baseline: 100 };

test("chart ink preserves every sharp observed peak and trough without interpolation", () => {
  const points = [10, 90, 1, 80, 30].map((price) => ({ price })),
    output = chartInkPaths(points, options);
  assert.equal(output.linePath, "M0 90L10 10L20 99L30 20L40 70");
  assert.equal(output.areaPath, "M0 90L10 10L20 99L30 20L40 70L40 100L0 100Z");
  assert.equal(output.segments[0].length, points.length);
  assert.doesNotMatch(output.linePath, /[CQST]/);
});

test("non-finite values and projections make independent paths and independent fill areas", () => {
  const points = [10, 20, null, 30, 40, NaN, Infinity, 50].map((price) => ({
      price,
    })),
    output = chartInkPaths(points, options);
  assert.equal(output.linePath, "M0 90L10 80M30 70L40 60M70 50");
  assert.equal(
    output.areaPath,
    "M0 90L10 80L10 100L0 100ZM30 70L40 60L40 100L30 100Z",
  );
  const invalidProjection = chartInkPaths(
    [{ price: 1 }, { price: 2 }, { price: 3 }],
    { ...options, x: (i) => (i === 1 ? NaN : i) },
  );
  assert.equal(invalidProjection.linePath, "M0 99M2 97");
  assert.equal(invalidProjection.areaPath, "");
});

test("single observations have a precise endpoint and no invented area or line extent", () => {
  const ink = renderChartInk([{ price: 25 }], { ...options, id: "single" });
  assert.equal(ink.linePath, "M0 75");
  assert.equal(ink.areaPath, "");
  assert.match(ink.markup, /class="chart-ink-end" cx="0" cy="75"/);
  assert.doesNotMatch(ink.markup, /chart-ink-wash/);
  assert.equal(renderChartInk([], options).markup, "");
});

test("dense series preserve all observations and geometry inputs are never mutated", () => {
  const points = Array.from({ length: 4000 }, (_, i) => ({
      price: i % 2 ? 90 : 10,
    })),
    before = structuredClone(points),
    output = chartInkPaths(points, options);
  assert.equal(output.segments[0].length, 4000);
  assert.equal((output.linePath.match(/L/g) || []).length, 3999);
  assert.deepEqual(points, before);
  assert.deepEqual(output.endpoint, { x: 39990, y: 10, index: 3999 });
});

test("definitions are unique and label/style injection cannot enter SVG markup", () => {
  const a = renderChartInk([{ price: 10 }, { price: 20 }], options),
    b = renderChartInk([{ price: 10 }, { price: 20 }], options);
  assert.notEqual(a.id, b.id);
  assert.notEqual(newChartInkId("same"), newChartInkId("same"));
  const bad = renderChartInk([{ price: 10 }], {
    ...options,
    id: 'x" onload="bad',
    className: 'x" onload="bad',
    color: 'red" onclick="bad',
  });
  assert.doesNotMatch(bad.defs + bad.markup, /" onload="bad|onclick=/);
  assert.match(bad.defs, /#9bd5aa/);
  assert.match(bad.markup, /pointer-events="none"/);
});

test("Research zoom uses exact selected observations and line ink leaves candles unchanged", () => {
  const data = {
      symbol: "TEST",
      timeZone: "UTC",
      points: [10, 100, 20, 80, 50].map((price, i) => ({
        time: 100 + i * 100,
        price,
        open: price,
        high: price + 1,
        low: price - 1,
        close: price,
      })),
    },
    state = {
      chartType: "line",
      scale: "linear",
      indicators: [],
      drawings: [],
      viewport: { from: 200, to: 400 },
    },
    indicators = technicalIndicators(data.points),
    geometry = chartGeometry(data, state, indicators, 338),
    line = renderAnalysisPlot(data, state, indicators, geometry, null).html;
  const expected = `M${geometry.x(1)} ${geometry.y(100)}L${geometry.x(2)} ${geometry.y(20)}L${geometry.x(3)} ${geometry.y(80)}`;
  assert.ok(line.includes(`d="${expected}"`));
  assert.match(line, /chart-ink-wash/);
  assert.match(line, /ta-price-line chart-ink-line/);
  const endpoint = line.match(
    /<g class="ta-line-endpoint"[^>]*>(.*?)<\/g>/,
  )?.[1];
  assert.ok(
    endpoint,
    "The endpoint is a separate layer outside the price clip",
  );
  assert.ok(endpoint.includes(`cx="${geometry.R}"`));
  assert.match(line, /<\/g><\/g><g class="ta-line-endpoint"/);
  assert.doesNotMatch(
    line.slice(0, line.indexOf('class="ta-line-endpoint"')),
    /chart-ink-end-ring/,
  );
  const candle = renderAnalysisPlot(
    data,
    { ...state, chartType: "candle" },
    indicators,
    geometry,
    null,
  ).html;
  assert.doesNotMatch(
    candle,
    /chart-ink-wash|chart-ink-line|linearGradient|ta-line-endpoint/,
  );
  assert.match(candle, /fill="#8bd5ab"/);
});
