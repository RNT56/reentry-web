import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";
import {
  mediaMarkdown,
  validateMedia,
  renderMedia,
  parseData,
  dataCSV,
  chartRows,
  statisticValues,
  priceDataset,
  youtubeReference,
} from "../src/domain/article-media.js";
import { articleMedia, formatArticle } from "../src/domain/article-format.js";
import { createProviders } from "../server/ai/providers.js";
import { priceFor, costFor, imageModels } from "../server/ai/catalog.js";
import { validateMediaResult } from "../server/ai/media-contract.js";
import { createCommons } from "../server/journal/media-routes.js";
import { tooltipPlacement } from "../src/shared/tooltips.js";

const chart = {
  type: "chart",
  title: "Revenue",
  columns: ["Period", "Revenue"],
  rows: [
    ["2024", 100],
    ["2025", null],
    ["2026", 125],
  ],
  unit: "USD million",
  sources: [{ title: "Filing", url: "https://example.com/filing" }],
};
test("visual blocks round-trip safely through Markdown and retain source values", () => {
  const text = "## One thesis\n\nEvidence follows.\n\n" + mediaMarkdown(chart);
  assert.deepEqual(articleMedia(text), [validateMedia(chart)]);
  const formatted = formatArticle(text);
  assert.match(formatted.html, /media-chart/);
  assert.match(formatted.html, /https:\/\/example.com\/filing/);
  assert.doesNotMatch(formatted.plainText || "", /version.*columns/);
  assert.match(
    renderMedia({ ...chart, title: "<script>alert(1)</script>" }),
    /&lt;script&gt;/,
  );
  assert.throws(
    () =>
      validateMedia({ ...chart, sources: [{ url: "javascript:alert(1)" }] }),
    /HTTPS/,
  );
  assert.throws(
    () => validateMedia({ ...chart, rows: [["x", Infinity]] }),
    /numbers/,
  );
  assert.throws(
    () => validateMedia({ ...chart, rows: [["x", null]] }),
    /numeric/,
  );
  assert.throws(
    () => validateMedia({ ...chart, rows: [["x", 1, 2]] }),
    /column count/,
  );
  assert.throws(
    () =>
      validateMedia({
        ...chart,
        chart: "bar",
        rows: Array.from({ length: 37 }, () => ["x", 1]),
      }),
    /36/,
  );
  assert.match(
    renderMedia({ ...chart, rows: [["x", 1.23456789]] }),
    /1\.23456789/,
  );
});
test("CSV quoting, missing observations, index bases and deterministic statistics", () => {
  const data = parseData('"Period","Revenue, USD"\r\n"2025",100\r\n"2026",125');
  assert.equal(data.columns[1], "Revenue, USD");
  assert.equal(data.rows[1][1], 125);
  assert.deepEqual(parseData(dataCSV(data)), data);
  assert.deepEqual(parseData("Period\tValue\n2025\t0\n2026\t").rows, [
    ["2025", 0],
    ["2026", null],
  ]);
  assert.throws(() => parseData('Period,Value\nx,"unclosed'), /quoted/);
  assert.deepEqual(
    chartRows({ ...chart, transform: "index" }).map((r) => r[1]),
    [100, null, 125],
  );
  assert.deepEqual(
    chartRows({ ...chart, transform: "change" }).map((r) => r[1]),
    [0, null, 25],
  );
  assert.equal(
    chartRows({
      ...chart,
      rows: [
        ["x", 0],
        ["y", 20],
      ],
      transform: "index",
    })[1][1],
    null,
  );
  assert.equal(statisticValues({ ...chart, aggregate: "sum" })[0].value, 225);
  assert.equal(
    statisticValues({ ...chart, aggregate: "average" })[0].value,
    112.5,
  );
  assert.equal(statisticValues({ ...chart, aggregate: "change" })[0].value, 25);
  assert.equal(
    statisticValues({ ...chart, aggregate: "latest" })[0].value,
    125,
  );
});
test("price snapshots preserve exchange dates and distinguish sampled weekly bars", () => {
  const base = {
    symbol: "TEST",
    currency: "USD",
    retrievedAt: Date.UTC(2026, 10, 15),
    timeZone: "Australia/Sydney",
  };
  const sample = priceDataset({
    ...base,
    points: [{ time: Date.UTC(2026, 0, 1, 22) / 1000, price: 100 }],
  });
  assert.equal(sample.rows[0][0], "2026-01-02");
  const weeks = priceDataset({
    ...base,
    interval: "1wk",
    points: Array.from({ length: 250 }, (_, i) => ({
      time: Date.UTC(2021, 0, 4) / 1000 + i * 604800,
      price: 100 + i,
    })),
  });
  assert.ok(weeks.rows.length < 200);
  assert.match(weeks.caption, /monthly samples/);
  assert.equal(weeks.columns[0], "Week of");
  assert.deepEqual(
    chartRows({
      ...chart,
      rows: [
        ["x", -100],
        ["y", -50],
      ],
      transform: "change",
    }).map((r) => r[1]),
    [0, 50],
  );
  assert.equal(
    validateMedia({ ...chart, type: "statistics", aggregate: "average" }).basis,
    "calculated",
  );
});
test("YouTube embeds accept exact video hosts and timestamp formats only", () => {
  assert.deepEqual(youtubeReference("https://youtu.be/dQw4w9WgXcQ?t=1m20s"), {
    videoId: "dQw4w9WgXcQ",
    start: 80,
  });
  assert.equal(
    youtubeReference("https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=32")
      .start,
    32,
  );
  for (const url of [
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://youtube.com/@channel",
    "http://youtu.be/dQw4w9WgXcQ",
  ])
    assert.throws(() => youtubeReference(url));
  const html = renderMedia({
    type: "youtube",
    url: "https://youtu.be/dQw4w9WgXcQ?t=20",
  });
  assert.match(html, /data-start="20"/);
  assert.doesNotMatch(html, /<iframe|autoplay/);
  const im = validateMedia({
    type: "image",
    fileId: randomUUID(),
    alt: "Chip",
    focalX: 0,
    pixelWidth: 800,
    pixelHeight: 600,
  });
  assert.equal(im.focalX, 0);
  assert.match(renderMedia(im), /width="800" height="600"/);
});
test("AI proposals reject invented source URLs and unsourced reported values", () => {
  const proposal = (b) => ({
    summary: "Proposal",
    proposals: [
      {
        reason: "Clarifies evidence",
        placement: "After thesis",
        block: JSON.stringify(b),
      },
    ],
  });
  assert.throws(() => validateMediaResult(proposal(chart), {}), /not supplied/);
  assert.throws(
    () => validateMediaResult(proposal({ ...chart, sources: [] }), {}),
    /source or dataset/,
  );
  assert.equal(
    validateMediaResult(proposal(chart), { dataset: chart }).proposals[0].block
      .rows[2][1],
    125,
  );
  assert.equal(
    validateMediaResult(
      proposal({ ...chart, sources: [], basis: "scenario" }),
      {},
    ).proposals[0].block.basis,
    "scenario",
  );
});
test("tooltip geometry stays within screen edges and flips below cramped anchors", () => {
  assert.deepEqual(
    tooltipPlacement(
      { left: 0, top: 4, bottom: 24, width: 30 },
      { width: 300, height: 100 },
      { width: 390, height: 800 },
    ),
    { left: 12, top: 34, side: "below" },
  );
  const p = tooltipPlacement(
    { left: 360, top: 780, bottom: 800, width: 20 },
    { width: 300, height: 100 },
    { width: 390, height: 800 },
  );
  assert.equal(p.left, 78);
  assert.equal(p.top, 670);
  assert.equal(p.side, "above");
});

const origin = "http://localhost:4173";
async function fixture(t) {
  const db = openStore(":memory:"),
    calls = [];
  const png = await sharp({
    create: { width: 80, height: 60, channels: 3, background: "#b8df91" },
  })
    .png()
    .toBuffer();
  let output = {
    summary: "One chart",
    proposals: [
      {
        reason: "Evidence",
        placement: "After thesis",
        block: JSON.stringify(chart),
      },
    ],
  };
  const app = await createApp({
    db,
    origin,
    logger: false,
    disableRateLimit: true,
    marketService: {
      history: async (symbol, range, currency) => ({
        symbol,
        range,
        currency,
        points: [
          { time: 1700000000, price: 100 },
          { time: 1700600000, price: 125 },
        ],
      }),
    },
    platform: {
      masterKey: randomBytes(32).toString("base64"),
      authorUsernames: "author,other",
      workerEnabled: true,
      startWorker: false,
      connectors: {
        status: () => [],
        collect: async () => ({ sources: [], coverage: [] }),
      },
      commons: {
        search: async () => [
          {
            id: 1,
            title: "File:Sample",
            license: "CC BY 4.0",
            source: "https://commons.wikimedia.org/?curid=1",
            thumbnail: "https://upload.wikimedia.org/sample.png",
          },
        ],
        download: async () => ({
          bytes: png,
          item: {
            title: "File:Sample",
            license: "CC BY 4.0",
            credit: "Test author",
            source: "https://commons.wikimedia.org/?curid=1",
          },
        }),
      },
      generate: async (req) => {
        calls.push(req);
        return {
          text: JSON.stringify(output),
          ...(req.imageConfig
            ? { images: [{ mime: "image/png", data: png.toString("base64") }] }
            : {}),
          complete: true,
          usage: {
            input: 120,
            output: 100,
            cached: 0,
            write5m: 0,
            write1h: 0,
            imageOutput: req.imageConfig ? 1120 : 0,
          },
          reportedUsage: {},
          requestId: "media-fixture",
          responseModel: req.model,
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
    title: "One thesis",
    body: "Evidence for one thesis with enough text to publish.",
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().id,
    url = "/api/journal/" + id;
  const enable = async () => {
    await call("/api/ai/credentials/gemini", "PUT", {
      key: "fixture-not-real-12345678901234567890",
    });
    const r = await call("/api/ai/preferences", "PUT", {
      enabled: true,
      model: "gemini-4-hydrogen",
      monthlyLimit: 5000000,
      runLimit: 2000000,
      consent: true,
    });
    assert.equal(r.statusCode, 200, r.body);
  };
  const upload = () =>
    call("/api/journal/media/upload", "POST", {
      symbol: "INTC",
      name: "Test image",
      data: png.toString("base64"),
    });
  const prepare = async (overrides = {}) => {
    const d = (await call(url)).json();
    const input = {
      ...d,
      task: "chart",
      prompt: "Show the supplied dataset",
      dataset: chart,
      ...overrides,
    };
    const r = await call(url + "/media/ai/preview", "POST", input);
    assert.equal(r.statusCode, 200, r.body);
    return {
      ...input,
      contextHash: r.json().contextHash,
      model: r.json().model,
      maximum: r.json().maximum,
      requestKey: randomUUID(),
    };
  };
  return {
    app,
    db,
    call,
    calls,
    id,
    url,
    enable,
    upload,
    prepare,
    accounts,
    png,
    setOutput: (v) => {
      output = v;
    },
  };
}
test("uploaded images are normalized, owner-private and protected against foreign draft references", async (t) => {
  const f = await fixture(t);
  const response = await f.upload();
  assert.equal(response.statusCode, 200, response.body);
  const im = response.json();
  assert.equal(im.mime, "image/webp");
  assert.equal(im.width, 80);
  assert.equal((await f.call(im.url)).statusCode, 200);
  assert.equal(
    (await f.call(im.url, "GET", undefined, "reader")).statusCode,
    404,
  );
  assert.equal(
    (await f.call(im.url, "GET", undefined, "guest")).statusCode,
    401,
  );
  assert.equal(
    (
      await f.call("/api/journal/media/upload", "POST", {
        symbol: "INTC",
        data: Buffer.from("<svg onload='x'/>").toString("base64"),
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/api/journal",
        "POST",
        {
          symbol: "INTC",
          title: "Foreign",
          body: mediaMarkdown({ type: "image", fileId: im.id, alt: "Image" }),
        },
        "other",
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await f.call("/api/journal/media/library", "GET", undefined, "reader"))
      .statusCode,
    403,
  );
});
test("publication freezes visual data and image references across edits and unpublishing", async (t) => {
  const f = await fixture(t),
    im = (await f.upload()).json();
  let draft = (await f.call(f.url)).json();
  const body =
    draft.body +
    "\n\n" +
    mediaMarkdown(chart) +
    "\n\n" +
    mediaMarkdown({
      type: "image",
      fileId: im.id,
      alt: "Evidence illustration",
    });
  const saved = await f.call(f.url, "PUT", { ...draft, body });
  assert.equal(saved.statusCode, 200, saved.body);
  draft = (await f.call(f.url)).json();
  const pub = await f.call(f.url + "/publish", "POST", {
    revision: draft.revision,
    reviewed: true,
  });
  assert.equal(pub.statusCode, 200, pub.body);
  assert.equal(
    (await f.call(im.url, "GET", undefined, "guest")).statusCode,
    200,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM article_revision_media").get().n,
    1,
  );
  assert.equal(
    (await f.call("/api/journal/media/" + im.id, "DELETE")).statusCode,
    200,
  );
  assert.equal(
    (await f.call("/api/journal/media/library")).json().images.length,
    0,
  );
  assert.equal(
    (await f.call(im.url, "GET", undefined, "guest")).statusCode,
    200,
  );
  assert.equal(
    (await f.call(f.url, "PUT", { ...draft, body: "Changed private draft." }))
      .statusCode,
    200,
  );
  assert.equal(
    f.db
      .prepare("SELECT body FROM article_revisions WHERE article_id=?")
      .get(f.id).body,
    body,
  );
  assert.equal(
    (await f.call(f.url + "/publication", "DELETE")).statusCode,
    200,
  );
  assert.equal(
    (await f.call(im.url, "GET", undefined, "guest")).statusCode,
    401,
  );
});
test("source imports retain credits and market data only accepts article assets", async (t) => {
  const f = await fixture(t);
  const images = (await f.call("/api/journal/media/commons?q=chip")).json()
    .images;
  assert.equal(images[0].id, 1);
  const imported = await f.call("/api/journal/media/commons", "POST", {
    pageId: 1,
    symbol: "INTC",
  });
  assert.equal(imported.statusCode, 200, imported.body);
  assert.equal(imported.json().provenance.credit, "Test author");
  const prices = await f.call(f.url + "/media/prices", "POST", {
    asset: "INTC",
    range: "3mo",
    currency: "USD",
  });
  assert.equal(prices.json().points[1].price, 125);
  assert.equal(
    (await f.call(f.url + "/media/prices", "POST", { asset: "NVDA" }))
      .statusCode,
    400,
  );
});
test("AI media preview is free, requests are idempotent, outputs remain proposals", async (t) => {
  const f = await fixture(t);
  await f.enable();
  const payload = await f.prepare();
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  const first = await f.call(f.url + "/media/ai", "POST", payload);
  assert.equal(first.statusCode, 200, first.body);
  const duplicate = await f.call(f.url + "/media/ai", "POST", payload);
  assert.equal(duplicate.json().id, first.json().id);
  assert.equal(
    (
      await f.call(f.url + "/media/ai", "POST", {
        ...payload,
        prompt: "Different",
      })
    ).statusCode,
    409,
  );
  await f.app.intelligenceEngine.tick();
  const job = f.db
    .prepare("SELECT * FROM ai_jobs WHERE id=?")
    .get(first.json().id);
  assert.equal(job.status, "completed", job.error);
  assert.equal(JSON.parse(job.result).proposals[0].block.rows[2][1], 125);
  assert.equal((await f.call(f.url)).json().revision, 1);
  assert.equal(
    f.db.prepare("SELECT state FROM ai_ledger WHERE job_id=?").get(job.id)
      .state,
    "settled",
  );
  const inspected = await f.call(f.url + "/media/ai/" + job.id);
  assert.equal(inspected.statusCode, 200, inspected.body);
  assert.match(inspected.json().prompt, /Show the supplied dataset/);
  assert.equal(
    (await f.call(f.url + "/media/ai/" + job.id, "GET", undefined, "other"))
      .statusCode,
    404,
  );
  assert.equal(f.calls.length, 1);
});
test("stale contexts, changed settings and deleted drafts prevent paid dispatch", async (t) => {
  const f = await fixture(t);
  await f.enable();
  const payload = await f.prepare();
  assert.equal(
    (
      await f.call(f.url + "/media/ai", "POST", {
        ...payload,
        contextHash: "stale",
      })
    ).statusCode,
    409,
  );
  const queued = await f.call(f.url + "/media/ai", "POST", payload);
  assert.equal(queued.statusCode, 200, queued.body);
  assert.equal(
    (await f.call(f.url, "DELETE", { revision: 1 })).statusCode,
    200,
  );
  await f.app.intelligenceEngine.tick();
  assert.equal(f.calls.length, 0);
});
test("image generation uses its own model and cap and settles image tokens", async (t) => {
  const f = await fixture(t);
  await f.enable();
  const payload = await f.prepare({
    task: "image",
    prompt: "Create a chip illustration",
    dataset: undefined,
  });
  assert.equal(payload.model, imageModels[0].id);
  const queued = await f.call(f.url + "/media/ai", "POST", payload);
  assert.equal(queued.statusCode, 200, queued.body);
  await f.app.intelligenceEngine.tick();
  const job = f.db
    .prepare("SELECT * FROM ai_jobs WHERE id=?")
    .get(queued.json().id);
  assert.equal(job.status, "completed", job.error);
  const result = JSON.parse(job.result);
  assert.equal(result.image.provenance.kind, "ai");
  assert.equal((await f.call(result.image.url)).statusCode, 200);
  const ledger = f.db
    .prepare("SELECT * FROM ai_ledger WHERE job_id=?")
    .get(job.id);
  assert.equal(ledger.state, "settled");
  assert.equal(JSON.parse(ledger.usage).imageOutput, 1120);
  assert.ok(ledger.cost > 67000 && ledger.cost < 70000);
  assert.equal(
    (
      await f.call("/api/ai/media-preferences", "PUT", {
        model: imageModels[0].id,
        runLimit: 1000,
      })
    ).statusCode,
    200,
  );
  const small = await f.prepare({
    task: "image",
    prompt: "Chip",
    dataset: undefined,
  });
  assert.equal(
    (await f.call(f.url + "/media/ai", "POST", small)).statusCode,
    409,
  );
  assert.equal(f.calls.length, 1);
});
test("Gemini image requests split priced text and image usage, failing closed on missing accounting", async () => {
  let sent;
  const raw = {
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            { text: "Illustration" },
            { inlineData: { mimeType: "image/png", data: "YWJj" } },
          ],
        },
      },
    ],
    modelVersion: imageModels[0].id,
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 1130,
      thoughtsTokenCount: 20,
      totalTokenCount: 1250,
      candidatesTokensDetails: [
        { modality: "TEXT", tokenCount: 10 },
        { modality: "IMAGE", tokenCount: 1120 },
      ],
    },
  };
  const generate = createProviders({
    fetcher: async (url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify(raw), { status: 200 });
    },
  });
  const response = await generate({
    provider: "gemini",
    model: imageModels[0].id,
    key: "synthetic",
    prompt: "Chip",
    imageConfig: { aspectRatio: "4:3" },
  });
  assert.equal(sent.generationConfig.imageConfig.aspectRatio, "4:3");
  assert.deepEqual(sent.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  assert.equal(response.usage.output, 30);
  assert.equal(response.usage.imageOutput, 1120);
  assert.equal(costFor(response.usage, priceFor(imageModels[0].id)), 67340);
  delete raw.usageMetadata.candidatesTokensDetails;
  await assert.rejects(
    () =>
      generate({
        provider: "gemini",
        model: imageModels[0].id,
        key: "synthetic",
        prompt: "Chip",
      }),
    /Image token usage/,
  );
});
test("Commons sourcing filters untrusted hosts and requires license metadata", async () => {
  const info = {
    url: "https://upload.wikimedia.org/test.png",
    thumburl: "https://evil.test/test.png",
    mime: "image/png",
    extmetadata: {
      LicenseShortName: { value: "CC BY 4.0" },
      Artist: { value: "<b>Author</b>" },
    },
  };
  const commons = createCommons(
    async () =>
      new Response(
        JSON.stringify({
          query: {
            pages: { 1: { pageid: 1, title: "File:Image", imageinfo: [info] } },
          },
        }),
      ),
  );
  const [item] = await commons.search("chip");
  assert.equal(item.thumbnail, info.url);
  assert.equal(item.credit, "Author");
  info.url = "https://upload.wikimedia.org.evil.test/test.png";
  assert.deepEqual(await commons.search("chip"), []);
});
