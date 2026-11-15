import { test } from "node:test";
import assert from "node:assert/strict";
import { mountAssetContext } from "../src/features/portfolio/asset-context.js";
import { setAnimatedText } from "../src/shared/motion.js";

function rootFixture() {
  const node = () => ({
    innerHTML: "",
    textContent: "",
    setAttribute() {},
    removeAttribute() {},
  });
  const cards = Object.fromEntries(
    ["journal", "research", "scenarios", "capitol"].map((key) => {
      const count = node(),
        preview = node();
      return [
        key,
        {
          count,
          preview,
          querySelector: (selector) =>
            selector === "[data-context-count]" ? count : preview,
        },
      ];
    }),
  );
  const root = {
    ...node(),
    isConnected: true,
    classList: { add() {} },
    querySelector: (selector) => cards[selector.match(/"([^"]+)"/)[1]],
  };
  return { root, cards };
}
const settled = () => new Promise((resolve) => setImmediate(resolve));

test("slow responses from a departed asset cannot repaint its context or start AI work", async (t) => {
  const requests = [];
  t.mock.method(
    globalThis,
    "fetch",
    (path, options) =>
      new Promise((resolve) => requests.push({ path, options, resolve })),
  );
  const { root, cards } = rootFixture();
  const view = mountAssetContext(root, { symbol: "AAPL" });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((r) => r.options.method === "GET"));
  view.destroy();
  assert.ok(requests.every((r) => r.options.signal.aborted));
  for (const r of requests)
    r.resolve({
      ok: true,
      json: async () => ({
        symbol: "AAPL",
        journal: { count: 1, items: [{ title: "Late response" }] },
      }),
    });
  await settled();
  assert.ok(Object.values(cards).every((c) => c.preview.innerHTML === ""));
});

test("public disclosure failure does not remove private previews and is never reported as zero trades", async (t) => {
  t.mock.method(globalThis, "fetch", async (path) => ({
    ok: true,
    json: async () =>
      path.startsWith("/api/politics")
        ? { status: "unavailable", summary: { count: 0 } }
        : {
            research: {
              count: 1,
              items: [
                { id: "brief", title: '<script>alert("x")</script>', at: 1 },
              ],
            },
            scenarios: { count: 0, items: [] },
            journal: { count: 0, items: [] },
          },
  }));
  const { root, cards } = rootFixture();
  const view = mountAssetContext(root, { symbol: "AAPL" });
  await settled();
  assert.match(cards.research.preview.innerHTML, /job=brief/);
  assert.match(cards.research.preview.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(cards.research.preview.innerHTML, /<script>/);
  assert.equal(cards.research.count.textContent, "1");
  assert.match(cards.capitol.preview.innerHTML, /Unavailable · Retry/);
  assert.equal(cards.capitol.count.textContent, "—");
  assert.doesNotMatch(cards.capitol.preview.innerHTML, /No filings/);
  view.destroy();
});

test("new chart values appear quietly while subsequent numeric updates retain motion", () => {
  const calls = [];
  const element = {
    textContent: "—",
    isConnected: true,
    closest: () => null,
    animate: (...args) => {
      calls.push(args);
      return { cancel() {} };
    },
  };
  setAnimatedText(element, "42,50");
  assert.equal(element.textContent, "42,50");
  assert.equal(calls.length, 0);
  setAnimatedText(element, "43,00");
  assert.equal(calls.length, 1);
  setAnimatedText(element, "44,00", { animate: false });
  assert.equal(calls.length, 1);
});
