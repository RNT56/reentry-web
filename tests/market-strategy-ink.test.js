import { test } from "node:test";
import assert from "node:assert/strict";
import { macroChartInk } from "../src/features/macro/workspace.js";
import {
  strategyCurveInk,
  structureChart,
} from "../src/features/strategies/workspace.js";

const pathFor = (markup, className) =>
  markup.match(new RegExp(`<path class="${className}[^"]*" d="([^"]*)"`))?.[1];

test("market chart ink retains real observations and gaps in focused and spark lines", () => {
  const points = [{ value: 10 }, { value: null }, { value: 30 }, { value: 20 }];
  const ink = macroChartInk(points, { id: "macro-test" });
  assert.equal(ink.low, 10);
  assert.equal(ink.high, 30);
  assert.equal(ink.linePath, "M0 234M533.3333333333333 16L800 125");
  assert.ok(!/NaN|Infinity|C|Q/.test(ink.linePath));
  const spark = macroChartInk(points, { spark: true });
  assert.ok(spark.markup.includes(`d="${ink.linePath}"`));
  assert.equal(spark.defs, "");
  assert.ok(!spark.markup.includes("chart-ink-wash"));
  const single = macroChartInk([{ value: 4 }], { id: "single" });
  assert.equal(single.linePath, "M0 234");
  assert.equal(single.areaPath, "");
  assert.ok(!/NaN|Infinity/.test(single.markup));
});

test("strategy comparisons use one selected wash, preserve colors and actual time spacing", () => {
  const data = {
    start: 100,
    end: 400,
    strategies: [
      {
        curve: [
          { time: 100, value: 100 },
          { time: 200, value: null },
          { time: 400, value: 120 },
        ],
      },
      {
        curve: [
          { time: 100, value: 100 },
          { time: 200, value: 110 },
          { time: 400, value: 130 },
        ],
      },
    ],
  };
  const before = structuredClone(data);
  const ink = strategyCurveInk(data, 1, "strategy-test");
  assert.equal([...ink.markup.matchAll(/class="chart-ink-wash"/g)].length, 1);
  assert.equal([...ink.markup.matchAll(/class="chart-ink-end"/g)].length, 1);
  assert.match(ink.defs, /#b9f68b/);
  assert.match(ink.defs, /#83bdf1/);
  assert.ok(
    ink.markup.indexOf('data-strategy-series="0"') <
      ink.markup.indexOf('data-strategy-series="1"'),
  );
  const paths = [
    ...ink.markup.matchAll(/class="strategy-account-line[^"]*" d="([^"]*)"/g),
  ].map((match) => match[1]);
  assert.equal([...paths[0].matchAll(/M/g)].length, 2);
  assert.match(paths[1], /L337\.3333333333333 /);
  assert.match(paths[1], /L988 /);
  assert.ok(!/NaN|Infinity/.test(ink.markup));
  assert.deepEqual(data, before);
});

test("structure chart stops observed ink at real last close and keeps fit gaps and extensions dashed", () => {
  const d = {
    currency: "EUR",
    source: "Fixture",
    symbol: "TEST",
    structure: [
      { time: 100, price: 100, fit: 101 },
      { time: 200, price: 110, fit: null },
      { time: 300, price: 120, fit: 119 },
    ],
    wave: { active: true, projected: [140, 160], pivots: [] },
  };
  const html = structureChart(d, String, "structure-test");
  const observed = pathFor(html, "structure-price-line");
  assert.match(observed, /L780 [^L]+$/);
  assert.ok(!observed.includes("960"));
  const fit = pathFor(html, "structure-fit-line");
  assert.equal([...fit.matchAll(/M/g)].length, 2);
  assert.match(html, /class="structure-fit-line[^>]+stroke-dasharray="6 5"/);
  assert.equal([...html.matchAll(/stroke-dasharray="5 5"/g)].length, 2);
  assert.equal([...html.matchAll(/class="chart-ink-end"/g)].length, 1);
  assert.ok(!/NaN|Infinity/.test(html));
  const single = structureChart(
    {
      ...d,
      structure: d.structure.slice(0, 1),
      wave: { active: false, projected: null, pivots: [] },
    },
    String,
    "single-structure",
  );
  assert.ok(!/NaN|Infinity/.test(single));
});
