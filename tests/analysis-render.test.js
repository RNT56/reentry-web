import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartGeometry,
  renderAnalysisPlot,
  renderDrawings,
} from "../src/features/charts/analysis-render.js";
import {
  fibonacciLevels,
  technicalIndicators,
} from "../src/domain/technical-analysis.js";
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
  assert.match(html, /stop-color="#dca295"/);
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

test("every Fibonacci level and its label select the same complete drawing", () => {
  const d = data([100, 120, 90]),
    i = technicalIndicators(d.points),
    g = chartGeometry(d, state, i, 390),
    anchors = [
      { time: 100, price: 100 },
      { time: 300, price: 90 },
    ],
    html = renderDrawings([{ id: "fib-one", type: "fib", anchors }], g, null),
    levels = fibonacciLevels(...anchors);
  const targets = [...html.matchAll(/<path[^>]+class="ta-hit"[^>]*>/g)];
  // Every horizontal retracement and the original diagonal are selectable.
  assert.equal(targets.length, levels.length + 1);
  assert.ok(
    targets.every(
      ([path]) =>
        path.includes('data-drawing="fib-one"') &&
        path.includes('vector-effect="non-scaling-stroke"'),
    ),
  );
  assert.equal(
    [...html.matchAll(/<text[^>]+data-drawing="fib-one"/g)].length,
    levels.length,
  );
});

test("selected tools and their touch handles render above overlaps without changing saved order", () => {
  const d = data([100, 120, 90]),
    i = technicalIndicators(d.points),
    g = chartGeometry(d, state, i, 390),
    anchors = [
      { time: 100, price: 100 },
      { time: 300, price: 90 },
    ],
    drawings = [
      { id: "first", type: "trend", anchors },
      { id: "second", type: "horizontal", anchors: anchors.slice(0, 1) },
    ],
    before = structuredClone(drawings),
    html = renderDrawings(drawings, g, "first");
  assert.ok(
    html.indexOf('data-drawing="second"') <
      html.indexOf('data-drawing="first"'),
  );
  assert.match(html, /class="ta-drawing is-selected" data-drawing="first"/);
  assert.match(html, /stroke-width="2.2"/);
  assert.equal([...html.matchAll(/class="ta-anchor-hit"/g)].length, 2);
  for (const index of [0, 1])
    assert.match(
      html,
      new RegExp(
        `r="12"[^>]+pointer-events="all"[^>]+data-drawing="first" data-anchor="${index}"`,
      ),
    );
  assert.equal(
    [...html.matchAll(/class="ta-anchor" pointer-events="none"/g)].length,
    2,
  );
  assert.deepEqual(drawings, before);
  assert.ok(!renderDrawings(drawings, g, "first", true).includes("ta-anchor"));
});

test("measurement labels, note bodies and level labels are selectable while crosshairs never intercept input", () => {
  const d = data([100, 120, 90]),
    i = technicalIndicators(d.points),
    s = {
      ...state,
      drawings: [
        {
          id: "measure",
          type: "measure",
          anchors: [
            { time: 100, price: 100 },
            { time: 300, price: 90 },
          ],
        },
        {
          id: "note",
          type: "note",
          anchors: [{ time: 200, price: 120 }],
          text: "Watch",
        },
        {
          id: "level",
          type: "horizontal",
          anchors: [{ time: 100, price: 100 }],
        },
      ],
    },
    html = renderAnalysisPlot(d, s, i, chartGeometry(d, s, i, 390)).html;
  for (const id of ["measure", "note", "level"])
    assert.match(html, new RegExp(`<text[^>]+data-drawing="${id}"`));
  assert.match(
    html,
    /r="15" fill="transparent" pointer-events="all" data-drawing="note"/,
  );
  assert.match(html, /class="ta-crosshair" opacity="0" pointer-events="none"/);
});

test("fullscreen allocation fits price and auxiliary panes within physical chart height", () => {
  const d = data(Array.from({ length: 60 }, (_, i) => 100 + i + Math.sin(i))),
    indicators = technicalIndicators(d.points);
  for (const width of [667, 844, 390]) {
    for (const height of [180, 205, 260, 520]) {
      for (const ids of [[], ["rsi"], ["rsi", "macd", "volume"]]) {
        const s = { ...state, indicators: ids },
          geometry = chartGeometry(d, s, indicators, width, height);
        assert.equal(geometry.H + geometry.paneHeight * ids.length, height);
        assert.ok(geometry.B > geometry.T);
        assert.ok(geometry.H >= height * 0.6);
        assert.ok(
          !/NaN|Infinity/.test(
            renderAnalysisPlot(d, s, indicators, geometry).html,
          ),
        );
        const anchor = geometry.anchor(
          geometry.x(20),
          geometry.y(d.points[20].price),
        );
        assert.equal(anchor.time, d.points[20].time);
        assert.ok(Math.abs(anchor.price - d.points[20].price) < 1e-8);
      }
    }
  }
});

test("normal chart allocation stays unchanged when no fullscreen height is supplied", () => {
  const d = data([100, 101, 102]),
    indicators = technicalIndicators(d.points);
  const s = { ...state, indicators: ["rsi", "volume"] };
  const mobile = chartGeometry(d, s, indicators, 390),
    desktop = chartGeometry(d, s, indicators, 844);
  assert.equal(mobile.H + 2 * mobile.paneHeight, 390);
  assert.equal(desktop.H + 2 * desktop.paneHeight, 470);
  assert.equal(mobile.paneHeight, 82);
  assert.equal(desktop.paneHeight, 82);
});
