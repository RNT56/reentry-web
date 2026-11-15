import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import { putSource } from "../server/intelligence/sources.js";
import { createSet } from "../server/intelligence/scenarios.js";
import {
  collectWritingContext,
  writingContextHash,
} from "../server/ai/writing-context.js";
import {
  writingRequest,
  makeWritingPrompt,
  validateWritingResult,
} from "../server/ai/writing-contract.js";
import {
  writingPresets,
  createWritingPresetState,
} from "../src/domain/writing-presets.js";
import { writingContextMarkup } from "../src/features/intelligence/writing-context.js";

function fixture(t) {
  const db = openStore(":memory:");
  migratePlatform(db);
  t.after(() => db.close());
  for (const user of ["alice", "bob"])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      user,
      user,
      "password-hash",
      "recovery-secret",
      1,
    );
  const source = (
    user,
    symbol,
    title,
    content,
    kind = "note",
    connector = "manual",
  ) =>
    putSource(db, user, symbol, {
      title,
      content,
      kind,
      connector,
      url: "https://example.com/" + title,
      published_at: 1000,
    });
  return { db, source };
}
const article = {
  id: "current",
  symbol: "INTC",
  title: "Execution",
  revision: 1,
  body: "A conditional execution thesis.",
  sources: "[]",
  assets: [
    { symbol: "INTC", name: "Intel" },
    { symbol: "NVDA", name: "NVIDIA" },
  ],
};

test("context covers owned selected-asset knowledge with provenance and exact listing boundaries", (t) => {
  const { db, source } = fixture(t);
  source("alice", "INTC", "author-note", "OWN_NOTE");
  source(
    "alice",
    "INTC",
    "quarterly-filing",
    "Revenue: 100 USD. Quarter ended 2025-12-31.",
    "fundamentals",
    "sec",
  );
  source("alice", "NVDA", "related-note", "RELATED_NOTE");
  source("alice", "NVD.DE", "other-listing", "WRONG_LISTING");
  source("bob", "INTC", "other-owner", "OTHER_OWNER_SECRET");
  const set = createSet(db, "alice", "INTC", "OWN_SCENARIO", [
    {
      condition: "Orders repeat",
      eventKey: "orders",
      low: 20,
      high: 30,
      currency: "USD",
    },
  ]);
  db.prepare(
    "INSERT INTO scenario_observations VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "event",
    set,
    "event",
    "orders",
    null,
    null,
    0,
    "Retracted event",
    "https://example.com/event",
    100,
    200,
  );
  createSet(db, "bob", "INTC", "OTHER_OWNER_SCENARIO", []);
  db.prepare("INSERT INTO chart_workspaces VALUES('alice','INTC',1,1,?,1)").run(
    JSON.stringify({
      name: "OWN_CHART",
      currency: "EUR",
      range: "1y",
      indicators: ["sma20"],
      drawings: [{ type: "note", text: "Watch repeat orders" }],
      viewport: { privateUI: "EXCLUDE_UI" },
    }),
  );
  db.prepare(
    "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,result,request_key,created_at) VALUES('analysis','alice','research','INTC','gemini','test','completed',?,?,?,1)",
  ).run(
    JSON.stringify({
      key: "DO_NOT_SEND_CREDENTIAL",
      sources: [
        { id: "s", title: "Filing", url: "https://example.com/filing" },
      ],
    }),
    JSON.stringify({ summary: "PRIOR_AI_INTERPRETATION", claims: [] }),
    "analysis",
  );
  db.prepare(
    "INSERT INTO articles(id,user_id,slug,symbol,title,body,created_at,updated_at) VALUES('own-draft','alice','own-draft','INTC','OWN_OTHER_ARTICLE','Author discussion',1,1)",
  ).run();
  db.prepare(
    "INSERT INTO articles(id,user_id,slug,symbol,title,body,created_at,updated_at) VALUES('other-draft','bob','other-draft','INTC','OTHER_PRIVATE_ARTICLE','Secret draft',1,1)",
  ).run();
  db.prepare("INSERT INTO political_feed VALUES('kadoa',?,1,'test')").run(
    JSON.stringify({
      rows: [
        {
          id: "trade",
          ticker: "INTC",
          member: "Example Member",
          side: "buy",
          low: 1001,
          high: 15000,
          filed: "2026-01-12",
          traded: "2025-12-20",
          url: "https://example.com/disclosure",
        },
      ],
    }),
  );
  const context = collectWritingContext(db, "alice", article),
    serialized = JSON.stringify(context);
  for (const marker of [
    "OWN_NOTE",
    "RELATED_NOTE",
    "OWN_SCENARIO",
    "OWN_CHART",
    "OWN_OTHER_ARTICLE",
    "PRIOR_AI_INTERPRETATION",
    "Example Member",
    "2025-12-20",
  ])
    assert.ok(serialized.includes(marker), marker);
  assert.doesNotMatch(
    serialized,
    /OTHER_OWNER|WRONG_LISTING|OTHER_PRIVATE|DO_NOT_SEND|EXCLUDE_UI|password-hash|recovery-secret/,
  );
  assert.equal(context.assets[1].role, "related");
  assert.match(serialized, /not independently verified/);
  assert.match(
    context.assets[0].groups.scenarios.items[0].content,
    /"verified":0/,
  );
  assert.equal(context.assets[0].groups.sources.items[0].publishedAt, 1000);
  const changes = db.prepare("SELECT total_changes() n").get().n;
  assert.equal(
    writingContextHash(context),
    writingContextHash(collectWritingContext(db, "alice", article)),
  );
  assert.equal(db.prepare("SELECT total_changes() n").get().n, changes);
});

test("context bounds excerpts and explicitly counts omitted records across related assets", (t) => {
  const { db, source } = fixture(t);
  const assets = Array.from({ length: 8 }, (_, i) => ({
    symbol: "ASSET" + i,
    name: "Asset " + i,
  }));
  for (const a of assets)
    for (let i = 0; i < 20; i++)
      source("alice", a.symbol, "note-" + i, "Long evidence ".repeat(1000));
  const context = collectWritingContext(db, "alice", {
    ...article,
    symbol: assets[0].symbol,
    assets,
  });
  let characters = 0;
  for (const a of context.assets)
    for (const g of Object.values(a.groups)) {
      characters += g.items.reduce((sum, r) => sum + r.content.length, 0);
      assert.equal(g.included + g.omitted, g.available);
    }
  assert.ok(characters <= 36000, characters);
  assert.ok(
    context.assets.every(
      (a) =>
        a.groups.notes.included > 0 &&
        a.groups.notes.omitted > 0 &&
        a.groups.notes.truncated > 0,
    ),
  );
  const html = writingContextMarkup(context);
  assert.match(html, /omitted/);
  assert.match(html, /Excerpt shortened/);
  assert.ok(JSON.stringify(context).length < 80000);
});

test("context markup escapes records and refuses executable provenance links", () => {
  const html = writingContextMarkup({
    asOf: "2026-01-01",
    limits: { source: "Stored" },
    assets: [
      {
        symbol: "INTC",
        name: "Intel",
        role: "primary",
        groups: {
          sources: {
            label: "Sources",
            available: 1,
            included: 1,
            omitted: 0,
            items: [
              {
                title: "<script>bad</script>",
                epistemic: "<img onerror=x>",
                content: "<iframe src=x>",
                url: "javascript:alert(1)",
                updatedAt: 1,
                truncated: false,
              },
            ],
          },
        },
      },
    ],
  });
  assert.doesNotMatch(html, /<script>|<iframe|javascript:/);
  assert.match(html, /&lt;script&gt;/);
});

test("editable prompts are the task instruction while output format remains explicit", () => {
  const custom =
    "Write exactly one sentence about delivery. Do not use the paragraph preset.";
  const request = writingRequest(
    { task: "paragraph", prompt: custom, format: "text" },
    article,
  );
  const prompt = makeWritingPrompt({
    article: request.article,
    writing: request,
  });
  assert.ok(prompt.includes(custom));
  assert.ok(!prompt.includes(writingPresets.paragraph.prompt));
  const review = writingRequest(
    {
      task: "custom",
      prompt: "Give only structural advice.",
      format: "review",
    },
    article,
  );
  assert.deepEqual(
    validateWritingResult(
      { title: "", content: "", summary: "Clear structure.", issues: [] },
      { article: review.article, writing: review },
    ).issues,
    [],
  );
  const state = createWritingPresetState();
  state.save("article", custom);
  state.save("paragraph", "My paragraph prompt");
  assert.equal(state.get("article"), custom);
  state.reset("paragraph");
  assert.equal(state.get("article"), custom);
  assert.equal(state.get("paragraph"), writingPresets.paragraph.prompt);
});
