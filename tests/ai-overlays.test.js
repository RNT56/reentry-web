import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderAIOverlays,
  aiOverlayDrawings,
} from "../src/features/charts/ai-overlays.js";
import { chartGeometry } from "../src/features/charts/analysis-render.js";
import { technicalIndicators } from "../src/domain/technical-analysis.js";
const layer = () => ({
  visible: true,
  currency: "EUR",
  range: "1y",
  jobId: "job-1",
  selectedKey: null,
  overlays: [
    {
      id: "support",
      type: "horizontal",
      label: "Support",
      rationale: "Repeated lows",
      anchors: [{ time: 100, price: 90 }],
      scenarioKeys: ["recover"],
    },
    {
      id: "trend",
      type: "trend",
      label: "Trend",
      anchors: [
        { time: 100, price: 100 },
        { time: 300, price: 120 },
      ],
      scenarioKeys: ["fall"],
    },
    {
      id: "fib",
      type: "fib",
      label: "Retracement",
      anchors: [
        { time: 100, price: 100 },
        { time: 300, price: 120 },
      ],
      scenarioKeys: ["recover"],
    },
  ],
  scenarios: [
    {
      eventKey: "recover",
      title: "Recovery",
      low: 120,
      high: 140,
      chartCondition: { direction: "above", price: 115 },
    },
  ],
});
const g = {
  L: 10,
  R: 270,
  T: 10,
  B: 200,
  timeX: (time) => time / 2,
  y: (price) => 200 - price,
};

test("AI drawings render at the supplied time/price geometry as read-only overlays", () => {
  const html = renderAIOverlays(layer(), g);
  assert.match(html, /d="M10 110H270"/);
  assert.match(html, /d="M50 100L150 80"/);
  assert.match(html, /data-ai-overlay="support" data-ai-scenario="recover"/);
  assert.match(html, /AI · Support/);
  assert.match(html, /stroke="#86c8df"/);
  assert.doesNotMatch(html, /data-drawing|data-anchor|ta-anchor/);
  assert.match(html, /0\.45/);
});

test("scenario selection highlights linked overlays and conditional target/trigger geometry", () => {
  const selected = { ...layer(), selectedKey: "recover" };
  const html = renderAIOverlays(selected, g);
  assert.match(html, /class="ta-ai-target" data-ai-scenario="recover"/);
  assert.match(html, /x="10" y="60" width="260" height="20"/);
  assert.match(html, /d="M10 85H270"/);
  assert.match(html, /AI target/);
  assert.match(html, /AI close &gt;/);
  assert.match(html, /data-ai-overlay="trend"[^>]+opacity="0\.2"/);
  assert.match(html, /ta-ai-overlay is-selected/);
});

test("all model-supplied text and identifiers are escaped; colors cannot be supplied", () => {
  const input = layer();
  input.overlays = [
    {
      ...input.overlays[0],
      id: 'x" onclick="bad',
      label: "<script>alert(1)</script>",
      rationale: "<img src=x onerror=bad>",
      scenarioKeys: ['x" onclick="bad'],
      color: 'red" onload="bad',
    },
  ];
  const html = renderAIOverlays(input, g);
  assert.doesNotMatch(html, /<script|<img|" onclick="bad|onload=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /x&quot; onclick=&quot;bad/);
  assert.match(html, /stroke="#86c8df"/);
});

test("geometry extras are fresh values and cannot mutate the original user or AI state", () => {
  const input = { ...layer(), selectedKey: "recover" },
    before = structuredClone(input),
    extras = aiOverlayDrawings(input);
  assert.equal(extras.length, 6);
  assert.deepEqual(
    extras.slice(-3).map((d) => d.anchors[0].price),
    [120, 140, 115],
  );
  extras[0].anchors[0].price = 999;
  assert.deepEqual(input, before);
  const data = {
      symbol: "TEST",
      points: [100, 105, 110].map((price, i) => ({
        time: 100 + i * 100,
        price,
      })),
    },
    state = {
      indicators: [],
      drawings: [],
      scale: "linear",
      chartType: "line",
      viewport: null,
    },
    geometry = chartGeometry(
      data,
      { ...state, drawings: aiOverlayDrawings(input) },
      technicalIndicators(data.points),
      338,
    );
  assert.ok(geometry.high > 140);
  assert.deepEqual(state.drawings, []);
  assert.deepEqual(input, before);
});

test("hidden layers, malformed coordinates and invalid overlays cannot leak NaN or markup", () => {
  assert.equal(renderAIOverlays({ ...layer(), visible: false }, g), "");
  assert.deepEqual(aiOverlayDrawings({ ...layer(), visible: false }), []);
  const input = layer();
  input.overlays = [
    { ...input.overlays[0], anchors: [{ time: 100, price: NaN }] },
    { ...input.overlays[0], anchors: [{ time: 100, price: -1 }] },
    { ...input.overlays[1], anchors: [{ time: 100, price: 100 }] },
    { ...input.overlays[0], type: "script" },
  ];
  assert.equal(renderAIOverlays(input, g), "");
  assert.deepEqual(aiOverlayDrawings(input), []);
  assert.equal(renderAIOverlays(layer(), { ...g, y: () => Infinity }), "");
});

test("labels stay inside narrow viewports with bounded count and ignore offscreen trend segments", () => {
  const input = layer();
  input.overlays = Array.from({ length: 20 }, (_, i) => ({
    ...input.overlays[0],
    id: "level" + i,
    label: "A very long model label with extensive material",
    anchors: [{ time: 100, price: 100 + i / 100 }],
  }));
  const html = renderAIOverlays(input, g);
  const ys = [...html.matchAll(/<text x="17" y="([0-9.]+)"/g)].map((m) =>
    Number(m[1]),
  );
  assert.ok(ys.length <= 8);
  assert.ok(ys.every((y) => y >= 23 && y <= 195));
  for (let i = 0; i < ys.length; i++)
    for (let j = i + 1; j < ys.length; j++)
      assert.ok(Math.abs(ys[i] - ys[j]) >= 13);
  assert.match(html, /…/);
  assert.doesNotMatch(html, /data-ai-overlay="level8"/);
  assert.equal(
    renderAIOverlays(
      {
        ...layer(),
        overlays: [
          {
            ...layer().overlays[1],
            anchors: [
              { time: 900, price: 100 },
              { time: 1000, price: 120 },
            ],
          },
        ],
      },
      g,
    ),
    "",
  );
});
