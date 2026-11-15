import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { putSource } from "../server/intelligence/sources.js";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";
import {
  writingRequest,
  makeWritingPrompt,
  validateWritingResult,
  writingSchema,
} from "../server/ai/writing-contract.js";
import {
  formatArticle,
  articleContainsPassage,
  articlePassageAnchor,
  safeArticleLink,
} from "../src/domain/article-format.js";

const origin = "http://localhost:4173";
const body =
  "## The thesis\n\nThe **launch** could change demand.\n\nThis are a grammar example.";
const proposal = {
  title: "One central thesis",
  content:
    "## The mechanism\n\nIf the launch succeeds, demand could improve. This remains an assumption to test.",
  summary: "Develops the central mechanism without inventing evidence.",
  issues: [],
};
async function fixture(t) {
  const db = openStore(":memory:"),
    calls = [];
  let output = proposal,
    complete = true;
  const app = await createApp({
    db,
    origin,
    logger: false,
    disableRateLimit: true,
    marketService: { quote: async () => ({}), history: async () => ({}) },
    platform: {
      masterKey: randomBytes(32).toString("base64"),
      authorUsernames: "author,other",
      workerEnabled: true,
      startWorker: false,
      connectors: {
        status: () => [],
        collect: async () => {
          throw Error("Writing must not collect unrelated research");
        },
      },
      generate: async (request) => {
        calls.push(request);
        return {
          text: typeof output === "string" ? output : JSON.stringify(output),
          complete,
          usage: {
            input: 120,
            output: 100,
            cached: 0,
            write5m: 0,
            write1h: 0,
            reasoning: 0,
          },
          reportedUsage: {},
          requestId: "writing-test",
          responseModel: request.model,
        };
      },
    },
  });
  await app.ready();
  const accounts = {};
  for (const name of ["author", "other", "reader"]) {
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      now = Date.now();
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      id,
      name,
      "hash",
      "recovery",
      now,
    );
    db.prepare("INSERT INTO portfolios(user_id,data) VALUES(?,?)").run(
      id,
      JSON.stringify(emptyPortfolio()),
    );
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
      createHash("sha256").update(token).digest("hex"),
      id,
      now,
      now,
      now,
      now + 86400000,
    );
    accounts[name] = { id, cookie: "reentry_dev=" + token };
  }
  const call = (url, method = "GET", payload, user = "author") =>
    app.inject({
      url,
      method,
      payload,
      headers: {
        origin,
        "x-reentry-request": "1",
        ...(accounts[user] ? { cookie: accounts[user].cookie } : {}),
      },
    });
  t.after(async () => {
    await app.close();
    db.close();
  });
  const created = await call("/api/journal", "POST", {
    symbol: "INTC",
    title: "A draft",
    body,
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id,
    url = "/api/journal/" + id;
  async function enable(provider = "gemini", model = "gemini-4-hydrogen") {
    assert.equal(
      (
        await call("/api/ai/credentials/" + provider, "PUT", {
          key: "fixture-not-real-12345678901234567890",
        })
      ).statusCode,
      200,
    );
    const response = await call("/api/ai/preferences", "PUT", {
      enabled: true,
      model,
      monthlyLimit: 5000000,
      runLimit: 2000000,
      consent: true,
    });
    assert.equal(response.statusCode, 200, response.body);
  }
  const queue = (overrides = {}) =>
    call(url + "/assist", "POST", {
      revision: 1,
      body,
      title: "A draft",
      task: "thesis",
      prompt: "Develop the mechanism, with assumptions clearly marked.",
      words: 250,
      requestKey: randomUUID(),
      ...overrides,
    });
  return {
    app,
    db,
    call,
    id,
    url,
    enable,
    queue,
    calls,
    accounts,
    setOutput(value, isComplete = true) {
      output = value;
      complete = isComplete;
    },
  };
}

test("article formatting renders semantic Markdown and preserves exact scenario destinations", () => {
  const text =
    "## Thesis\n\nA **strong** claim with *context* and [evidence](https://example.com).\n\n> A measured quotation.\n\n- First assumption\n- Second assumption\n\n| Metric | Value |\n| --- | --- |\n| EPS | 2.50 |";
  const formatted = formatArticle(text);
  assert.match(formatted.html, /<strong>strong<\/strong>/);
  assert.match(formatted.html, /<em>context<\/em>/);
  assert.match(formatted.html, /<blockquote id="passage-3">/);
  assert.match(formatted.html, /<ul id="passage-4">/);
  assert.match(formatted.html, /<table id="passage-5">/);
  assert.match(formatted.html, /rel="noopener noreferrer" target="_blank"/);
  assert.equal(
    articleContainsPassage(text, "A strong claim with context"),
    true,
  );
  assert.equal(
    articlePassageAnchor(text, "A strong claim with context"),
    "passage-2",
  );
  assert.equal(articlePassageAnchor(text, "missing passage"), null);
  assert.equal(formatted.sections[0].text, "Thesis");
});

test("article formatting escapes executable markup and rejects unsafe links", () => {
  for (const link of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//host.test/path",
    "https://user:secret@example.com",
    "https://example.com\\bad",
    "file:///tmp/private",
  ])
    assert.equal(safeArticleLink(link), false, link);
  const html = formatArticle(
    '<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![x](https://tracker.example/pixel)\n\n<iframe src="evil"></iframe>',
  ).html;
  assert.doesNotMatch(html, /<script|<iframe|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});

test("private preview renders unsaved text and formatting without saving or publishing", async (t) => {
  const f = await fixture(t);
  const response = await f.call(f.url + "/preview", "POST", {
    body: "## Unsaved heading\n\n**Unsaved** text",
    title: "Preview only",
    sources: [],
    branches: [{}],
  });
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json();
  assert.match(result.html, /<strong>Unsaved<\/strong>/);
  assert.match(result.html, /Private draft preview/);
  assert.match(result.html, /noindex,nofollow,noarchive/);
  assert.match(result.html, /data-reading-motion/);
  assert.doesNotMatch(
    result.html,
    /data-reading-share|aria-label="Published editions"/,
  );
  assert.equal(result.warnings.length, 1);
  assert.equal(
    f.db.prepare("SELECT body FROM articles WHERE id=?").get(f.id).body,
    body,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM article_revisions").get().n,
    0,
  );
  assert.equal(
    (await f.call(f.url + "/preview", "POST", { body }, "other")).statusCode,
    404,
  );
  assert.equal(
    (await f.call(f.url + "/preview", "POST", { body }, "reader")).statusCode,
    403,
  );
  assert.equal(
    (await f.call(f.url + "/preview", "POST", { body }, "guest")).statusCode,
    401,
  );
});

test("formatted visible passages can be mapped, saved and published", async (t) => {
  const f = await fixture(t),
    draft = (await f.call(f.url)).json();
  const response = await f.call(f.url, "PUT", {
    ...draft,
    branches: [
      {
        title: "Launch",
        condition: "Launch confirmed",
        eventKey: "launch",
        low: 20,
        high: 30,
        currency: "USD",
        horizonDays: 365,
        invalidation: "Launch cancelled",
        passage: "The launch could change demand.",
      },
    ],
  });
  assert.equal(response.statusCode, 200, response.body);
  const publish = await f.call(f.url + "/publish", "POST", {
    revision: 2,
    reviewed: true,
  });
  assert.equal(publish.statusCode, 200, publish.body);
  const html = await f.call(publish.json().url);
  assert.match(html.body, /href="#passage-2"/);
  assert.match(html.body, /<strong>launch<\/strong>/);
});

test("writing uses the configured provider, accounts for usage and never edits or publishes automatically", async (t) => {
  for (const [provider, model] of [
    ["gemini", "gemini-4-hydrogen"],
    ["anthropic", "claude-sonnet-5-5"],
  ]) {
    const f = await fixture(t);
    await f.enable(provider, model);
    const key = randomUUID();
    const response = await f.queue({
      requestKey: key,
      symbol: "NVDA",
      assets: [
        {
          symbol: "NVDA",
          name: "NVIDIA",
          exchange: "NASDAQ",
          assetType: "EQUITY",
        },
      ],
      body: "\n" + body + "\n\nUnsaved author context.\n\n",
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.json().maxCost > 0);
    const jobId = response.json().id;
    const duplicate = await f.queue({
      requestKey: key,
      symbol: "NVDA",
      assets: [
        {
          symbol: "NVDA",
          name: "NVIDIA",
          exchange: "NASDAQ",
          assetType: "EQUITY",
        },
      ],
      body: "\n" + body + "\n\nUnsaved author context.\n\n",
    });
    assert.equal(duplicate.json().id, jobId);
    assert.equal(
      (await f.queue({ requestKey: key, prompt: "Different request" }))
        .statusCode,
      409,
    );
    await f.app.intelligenceEngine.tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].provider, provider);
    assert.equal(f.calls[0].model, model);
    assert.deepEqual(f.calls[0].schema, writingSchema);
    assert.match(f.calls[0].prompt, /Unsaved author context/);
    assert.match(f.calls[0].prompt, /Never use em dashes/);
    const job = (await f.call(f.url + "/assist/" + jobId)).json();
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.article.symbol, "NVDA");
    assert.equal(job.article.assets[0].exchange, "NASDAQ");
    assert.equal(
      job.article.body,
      "\n" + body + "\n\nUnsaved author context.\n\n",
    );
    assert.deepEqual(job.result, proposal);
    assert.equal(
      f.db.prepare("SELECT body FROM articles WHERE id=?").get(f.id).body,
      body,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM article_revisions").get().n,
      0,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM scenario_sets").get().n,
      0,
    );
    const ledger = f.db
      .prepare("SELECT state,cost FROM ai_ledger WHERE job_id=?")
      .get(jobId);
    assert.equal(ledger.state, "settled");
    assert.ok(ledger.cost > 0);
    assert.equal(
      (await f.call(f.url + "/assist/" + jobId, "GET", undefined, "other"))
        .statusCode,
      404,
    );
    assert.equal(
      (await f.call(f.url + "/assist", "GET", undefined, "reader")).statusCode,
      403,
    );
  }
});

test("writing requires current ownership, enabled AI, consent and sufficient budget", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.queue()).statusCode, 409);
  assert.equal(
    (
      await f.call(
        f.url + "/assist",
        "POST",
        { revision: 1, task: "article" },
        "other",
      )
    ).statusCode,
    404,
  );
  await f.enable();
  assert.equal((await f.queue({ revision: 99 })).statusCode, 409);
  assert.equal((await f.queue({ task: "unknown" })).statusCode, 400);
  assert.equal(
    (await f.queue({ selection: "Not in this article" })).statusCode,
    409,
  );
  assert.equal((await f.queue({ words: 9999 })).statusCode, 400);
  f.db
    .prepare("UPDATE ai_preferences SET run_limit=1 WHERE user_id=?")
    .run(f.accounts.author.id);
  assert.equal((await f.queue()).statusCode, 409);
  assert.equal(f.calls.length, 0);
});

test("queued writing rechecks changed drafts, removed keys and spending caps before dispatch", async (t) => {
  for (const mutate of [
    (f) =>
      f.db
        .prepare("UPDATE articles SET revision=revision+1 WHERE id=?")
        .run(f.id),
    (f) => f.db.prepare("DELETE FROM articles WHERE id=?").run(f.id),
    (f) =>
      f.db
        .prepare("DELETE FROM ai_credentials WHERE user_id=?")
        .run(f.accounts.author.id),
    (f) =>
      f.db
        .prepare("UPDATE ai_preferences SET run_limit=1 WHERE user_id=?")
        .run(f.accounts.author.id),
    (f) =>
      f.db
        .prepare("UPDATE ai_preferences SET enabled=0 WHERE user_id=?")
        .run(f.accounts.author.id),
  ]) {
    const f = await fixture(t);
    await f.enable();
    const response = await f.queue();
    assert.equal(response.statusCode, 200, response.body);
    mutate(f);
    await f.app.intelligenceEngine.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(
      f.db
        .prepare("SELECT status FROM ai_jobs WHERE id=?")
        .get(response.json().id).status,
      "failed",
    );
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  }
});

test("invalid or truncated writing output records usage without changing the article", async (t) => {
  for (const [output, complete] of [
    ["not json", true],
    [{ ...proposal, content: "An invented — em dash." }, true],
    [proposal, false],
  ]) {
    const f = await fixture(t);
    await f.enable();
    f.setOutput(output, complete);
    const response = await f.queue();
    await f.app.intelligenceEngine.tick();
    const job = (await f.call(f.url + "/assist/" + response.json().id)).json();
    assert.equal(job.status, "failed");
    assert.equal(
      f.db.prepare("SELECT state FROM ai_ledger").get().state,
      "settled",
    );
    assert.equal(
      f.db.prepare("SELECT body FROM articles WHERE id=?").get(f.id).body,
      body,
    );
  }
});

test("review contract anchors corrections to actual text and separates advice from content", () => {
  const article = {
    id: "test",
    revision: 1,
    title: "Thesis",
    symbol: "INTC",
    body,
    sources: "[]",
  };
  const request = writingRequest({ task: "grammar", body }, article);
  const input = { article: request.article, writing: request };
  const review = {
    title: "",
    content: "",
    summary: "One agreement correction.",
    issues: [
      {
        category: "grammar",
        quote: "This are a grammar example.",
        replacement: "This is a grammar example.",
        explanation: "Use singular agreement.",
      },
    ],
  };
  assert.deepEqual(validateWritingResult(review, input), review);
  assert.throws(() =>
    validateWritingResult(
      { ...review, issues: [{ ...review.issues[0], quote: "Invented quote" }] },
      input,
    ),
  );
  assert.throws(() =>
    validateWritingResult({ ...review, content: "Unrequested rewrite" }, input),
  );
  assert.match(
    makeWritingPrompt(input),
    /Article source links alone are references, not fetched evidence/,
  );
});

test("request preview uses owned asset knowledge and a queued job preserves the exact reviewed prompt", async (t) => {
  const f = await fixture(t);
  const note = putSource(f.db, f.accounts.author.id, "INTC", {
    kind: "note",
    title: "Execution watch",
    content: "AUTHOR_NOTE: customer adoption requires repeat orders.",
    connector: "manual",
    url: "https://example.com/evidence",
  });
  putSource(f.db, f.accounts.other.id, "INTC", {
    kind: "note",
    title: "Private other",
    content: "DO_NOT_SEND_OTHER_USER",
    connector: "manual",
  });
  putSource(f.db, f.accounts.author.id, "AMD", {
    kind: "note",
    title: "Different asset",
    content: "DO_NOT_SEND_UNSELECTED_ASSET",
    connector: "manual",
  });
  const payload = {
    revision: 1,
    body,
    title: "Unsaved title",
    symbol: "INTC",
    task: "paragraph",
    format: "text",
    prompt: "Write two sentences about repeat orders. Preserve uncertainty.",
    words: 150,
  };
  const before = f.db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n;
  const preview = await f.call(f.url + "/assist/preview", "POST", payload);
  assert.equal(preview.statusCode, 200, preview.body);
  const prepared = preview.json();
  assert.match(prepared.prompt, /AUTHOR_NOTE/);
  assert.match(prepared.prompt, /Write two sentences about repeat orders/);
  assert.doesNotMatch(prepared.prompt, /DO_NOT_SEND/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n, before);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  assert.equal(
    (await f.call(f.url + "/assist/context", "POST", {}, "other")).statusCode,
    404,
  );
  assert.equal(
    (await f.call(f.url + "/assist/preview", "POST", payload, "reader"))
      .statusCode,
    403,
  );
  await f.enable();
  const key = randomUUID();
  const queued = await f.queue({
    ...payload,
    contextHash: prepared.contextHash,
    requestKey: key,
  });
  assert.equal(queued.statusCode, 200, queued.body);
  f.db
    .prepare("UPDATE research_sources SET content=? WHERE id=?")
    .run("CHANGED_AFTER_QUEUE", note.id);
  const retry = await f.queue({
    ...payload,
    contextHash: prepared.contextHash,
    requestKey: key,
  });
  assert.equal(
    retry.json().id,
    queued.json().id,
    "An idempotent retry retains the first snapshot",
  );
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls[0].prompt, prepared.prompt);
  const job = (await f.call(f.url + "/assist/" + queued.json().id)).json();
  assert.equal(job.status, "completed", job.error);
  assert.equal(job.prompt, prepared.prompt);
  assert.match(JSON.stringify(job.assetContext), /AUTHOR_NOTE/);
  assert.doesNotMatch(JSON.stringify(job.assetContext), /CHANGED_AFTER_QUEUE/);
});

test("changed context requires a fresh preview before any new billable writing request", async (t) => {
  const f = await fixture(t);
  await f.enable();
  const payload = {
    revision: 1,
    body,
    task: "thesis",
    prompt: "Develop the execution thesis.",
    words: 200,
  };
  const preview = (
    await f.call(f.url + "/assist/preview", "POST", payload)
  ).json();
  putSource(f.db, f.accounts.author.id, "INTC", {
    kind: "note",
    title: "New observation",
    content: "New information arrived.",
    connector: "manual",
  });
  const rejected = await f.queue({
    ...payload,
    contextHash: preview.contextHash,
  });
  assert.equal(rejected.statusCode, 409, rejected.body);
  assert.match(rejected.body, /context changed/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_jobs").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  const refreshed = (
    await f.call(f.url + "/assist/preview", "POST", payload)
  ).json();
  assert.notEqual(refreshed.contextHash, preview.contextHash);
  assert.equal(
    (await f.queue({ ...payload, contextHash: refreshed.contextHash }))
      .statusCode,
    200,
  );
});
