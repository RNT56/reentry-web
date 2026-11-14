import { test } from "node:test";
import assert from "node:assert/strict";
import { publicDocument } from "../server/journal/public.js";
const branch = {
  title: "Range",
  low: 20,
  high: 30,
  currency: "USD",
  condition: "Launch confirmed",
  horizonDays: 90,
  passage: "The launch could change demand.",
  invalidation: "Launch cancelled",
  status: { status: "watching", evidence: [] },
};
const article = {
  title: "A thesis",
  symbol: "INTC",
  author: "RNT",
  slug: "a-thesis",
  publishedAt: Date.UTC(2026, 10, 14),
  revision: 1,
  body: "## Demand\n\nThe launch could change demand.\n\n<script>alert(1)</script>",
  scenario: { branches: [branch], observations: [] },
  sources: [{ title: "<script>source</script>", url: "javascript:alert(1)" }],
  editions: [{ revision: 1, published_at: Date.UTC(2026, 10, 14) }],
};
test("public reading is complete without JavaScript and preserves safe passage/scenario navigation", () => {
  const html = publicDocument({ article, authorName: "RNT" });
  assert.match(html, /<h2 id="passage-1">Demand<\/h2>/);
  assert.match(html, /href="#passage-2"/);
  assert.match(html, /id="scenario-map"/);
  assert.match(html, /The launch could change demand\./);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /src="\/journal.js"/);
  assert.match(html, /aria-label="Published editions"/);
  assert.match(html, /data-reading-focus/);
});
test("journal index renders actual published content and escapes public fields", () => {
  const html = publicDocument({
    authorName: "RNT",
    articles: [
      {
        ...article,
        title: "<img onerror=alert(1)>",
        excerpt: "Published excerpt",
      },
    ],
  });
  assert.match(html, /Published excerpt/);
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.match(html, /href="\/journal\/a-thesis"/);
  assert.doesNotMatch(html, /concept-tag|research-empty|Private AI enabled/);
});
