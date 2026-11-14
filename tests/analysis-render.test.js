import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartGeometry,
  renderAnalysisPlot,
} from "../src/features/charts/analysis-render.js";
import { technicalIndicators } from "../src/domain/technical-analysis.js";
const state = {
  chartType: "line",
  scale: "linear",
  viewport: null,
  indicators: [],
  drawings: [],
};
const data = (prices) => ({
  symbol: "TEST",
  timeZone: "UTC",
  points: prices.map((price, i) => ({ time: 100 + i * 100, price })),
});

test("saved anchors before and after the observed range project outside the plot symmetrically", () => {
  const d = data([100, 120, 90]),
    i = technicalIndicators(d.points),
    g = chartGeometry(d, state, i, 390);
  assert.ok(g.timeX(50) < g.L);
  assert.ok(g.timeX(350) > g.R);
  assert.equal(g.timeX(100), g.L);
  assert.equal(g.timeX(300), g.R);
  assert.equal(g.L - g.timeX(50), g.timeX(350) - g.R);
});

test("linear Bollinger geometry includes negative lower bands while log plots omit them", () => {
  const d = data([...Array(19).fill(1), 100]),
    i = technicalIndicators(d.points),
    s = { ...state, indicators: ["bollinger"] };
  assert.ok(i.bollinger.lower.at(-1) < 0);
  const linear = chartGeometry(d, s, i, 390);
  assert.ok(linear.low < i.bollinger.lower.at(-1));
  assert.ok(linear.y(i.bollinger.lower.at(-1)) <= linear.B);
  const logarithmic = chartGeometry(d, { ...s, scale: "log" }, i, 390);
  assert.ok(logarithmic.low > 0);
  const html = renderAnalysisPlot(
    d,
    { ...s, scale: "log" },
    i,
    logarithmic,
  ).html;
  assert.ok(!/NaN|Infinity/.test(html));
});

test("candles require positive internally consistent OHLC values", () => {
  const d = data([10, 11, 12]),
    s = { ...state, chartType: "candle", scale: "log" };
  for (const p of d.points)
    Object.assign(p, { open: 0, high: 12, low: 0, close: p.price });
  const i = technicalIndicators(d.points),
    g = chartGeometry(d, s, i, 390);
  const invalid = renderAnalysisPlot(d, s, i, g);
  assert.equal(invalid.candleAvailable, false);
  assert.ok(!/NaN|Infinity/.test(invalid.html));
  Object.assign(d.points[1], { open: 10, high: 12, low: 9, close: 11 });
  assert.equal(
    renderAnalysisPlot(d, s, i, chartGeometry(d, s, i, 390)).candleAvailable,
    true,
  );
});

test("viewport trend color follows its own endpoints", () => {
  const d = data([10, 100, 90, 80, 1000]),
    i = technicalIndicators(d.points),
    s = { ...state, viewport: { from: 200, to: 400 } };
  const g = chartGeometry(d, s, i, 390),
    html = renderAnalysisPlot(d, s, i, g).html;
  assert.equal(g.from, 1);
  assert.equal(g.to, 3);
  assert.match(html, /ta-price-line[^>]+stroke="#e3a295"/);
  assert.throws(() =>
    chartGeometry(
      data([10]),
      state,
      technicalIndicators(data([10]).points),
      390,
    ),
  );
});

test("negative chart numbers retain the same precision as positive numbers", async () => {
  const { chartNumber } = await import(
    "../src/features/charts/analysis-render.js"
  );
  assert.equal(chartNumber(-12.34567), "-12,35");
  assert.equal(chartNumber(12.34567), "12,35");
  assert.equal(chartNumber(-0.01234567), "-0,012346");
});

test("unavailable indicator panes show direct signals without fabricated axes", () => {
  const d = data([100, 101, 102]),
    i = technicalIndicators(d.points),
    s = { ...state, indicators: ["volume", "rsi", "macd"] };
  const html = renderAnalysisPlot(d, s, i, chartGeometry(d, s, i, 390)).html;
  assert.match(html, />No volume</);
  assert.match(html, />Needs 15 bars</);
  assert.match(html, />Needs 34 bars</);
  const panes = html.slice(html.indexOf('class="ta-pane"'));
  assert.ok(!panes.includes('class="ta-axis"'));
  const longer = data(Array.from({ length: 28 }, (_, i) => 100 + i)),
    more = technicalIndicators(longer.points),
    m = { ...state, indicators: ["macd"] };
  assert.ok(
    !renderAnalysisPlot(
      longer,
      m,
      more,
      chartGeometry(longer, m, more, 390),
    ).html.includes("Needs 34 bars"),
  );
});

test("labels on analytical drawings are rendered as escaped selectable text", () => {
  const d = data([100, 101, 102]),
    i = technicalIndicators(d.points),
    s = {
      ...state,
      drawings: [
        {
          id: "custom",
          type: "horizontal",
          anchors: [{ time: 200, price: 101 }],
          text: 'Support <img src=x onerror="bad">',
        },
      ],
    };
  const html = renderAnalysisPlot(d, s, i, chartGeometry(d, s, i, 390)).html;
  assert.match(html, /class="ta-drawing-label"/);
  assert.match(html, /Support &lt;img/);
  assert.ok(!html.includes("<img"));
});
