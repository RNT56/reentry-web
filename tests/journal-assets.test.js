import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import { registerJournalRoutes } from "../server/journal/routes.js";
import { assetContext } from "../server/intelligence/asset-context.js";
import { createAssetLookup } from "../src/features/intelligence/article-assets.js";

const intel = {
  symbol: "INTC",
  name: "Intel Corporation",
  exchange: "NASDAQ",
  assetType: "EQUITY",
};
const nvidia = {
  symbol: "NVDA",
  name: "NVIDIA Corporation",
  exchange: "NASDAQ",
  assetType: "EQUITY",
};
const german = {
  symbol: "NVD.DE",
  name: "NVIDIA Corporation",
  exchange: "XETRA",
  assetType: "EQUITY",
};
const body =
  "If delivery improves, the operating thesis becomes more credible.";
const branch = {
  title: "Delivery",
  condition: "Delivery improves",
  eventKey: "delivery",
  low: 20,
  high: 30,
  currency: "USD",
  horizonDays: 365,
  invalidation: "Repeated delays",
  passage: body,
};
async function fixture(t) {
  const db = openStore(":memory:");
  migratePlatform(db);
  for (const id of ["author", "other"])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      id,
      id,
      "test",
      "test",
      1,
    );
  const app = Fastify();
  app.decorate("requireUser", async (req, reply) => {
    if (!req.headers.authorization)
      return reply.code(401).send({ error: "Sign in" });
    req.auth = {
      user_id: req.headers.authorization,
      username: req.headers.authorization,
    };
  });
  const mapped = [];
  registerJournalRoutes(app, {
    db,
    engine: {
      enqueue: (_u, data) => {
        mapped.push(data);
        return { id: "mapping" };
      },
    },
    isAuthor: () => true,
    authorName: "RNT",
  });
  await app.ready();
  const call = (url, method = "GET", payload, user = "author") =>
    app.inject({
      url,
      method,
      payload,
      headers: user ? { authorization: user } : {},
    });
  t.after(async () => {
    await app.close();
    db.close();
  });
  const create = async (assets = [intel, nvidia]) => {
    const r = await call("/api/journal", "POST", {
      symbol: assets[0].symbol,
      assets,
      title: "One thesis",
      body,
    });
    assert.equal(r.statusCode, 200, r.body);
    return "/api/journal/" + r.json().id;
  };
  return { db, app, call, create, mapped };
}

test("selected listings and metadata persist and stale saves cannot change asset associations", async (t) => {
  const f = await fixture(t),
    url = await f.create([german, intel]);
  let draft = (await f.call(url)).json();
  assert.equal(draft.symbol, "NVD.DE");
  assert.deepEqual(
    draft.assets.map((a) => [a.symbol, a.name, a.exchange]),
    [
      ["NVD.DE", german.name, "XETRA"],
      ["INTC", intel.name, "NASDAQ"],
    ],
  );
  const r = await f.call(url, "PUT", {
    ...draft,
    symbol: "INTC",
    assets: [intel, nvidia],
  });
  assert.equal(r.statusCode, 200, r.body);
  const stale = await f.call(url, "PUT", { ...draft, assets: [german] });
  assert.equal(stale.statusCode, 409);
  draft = (await f.call(url)).json();
  assert.deepEqual(
    draft.assets.map((a) => a.symbol),
    ["INTC", "NVDA"],
  );
  assert.equal(draft.revision, 2);
  await f.call(url + "/map", "POST", { requestKey: "test-map" });
  assert.equal(f.mapped[0].symbol, "INTC");
  assert.equal(
    f.db.prepare("SELECT name FROM research_assets WHERE symbol=?").get("INTC")
      .name,
    intel.name,
  );
  assert.equal((await f.call(url, "GET", undefined, "other")).statusCode, 404);
  assert.equal((await f.call(url, "GET", undefined, null)).statusCode, 401);
});

test("published asset links are immutable per edition and exact listing filters include related assets", async (t) => {
  const f = await fixture(t),
    url = await f.create();
  let draft = (await f.call(url)).json();
  draft = (await f.call(url, "PUT", { ...draft, branches: [branch] })).json();
  const published = await f.call(url + "/publish", "POST", {
    revision: draft.revision,
    reviewed: true,
  });
  assert.equal(published.statusCode, 200, published.body);
  const publicUrl = "/api/public/journal/" + draft.slug;
  const saved = await f.call(url, "PUT", {
    ...draft,
    symbol: "NVD.DE",
    assets: [german],
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const live = (await f.call(publicUrl)).json();
  assert.deepEqual(
    live.assets.map((a) => a.symbol),
    ["INTC", "NVDA"],
  );
  assert.equal(live.scenario.symbol, "INTC");
  assert.equal(
    (await f.call("/api/public/journal?symbol=NVDA")).json().articles.length,
    1,
  );
  assert.equal(
    (await f.call("/api/public/journal?symbol=NVD.DE")).json().articles.length,
    0,
  );
  assert.equal(assetContext(f.db, "other", "NVDA").journal.count, 1);
  assert.equal(assetContext(f.db, "other", "NVD.DE").journal.count, 0);
  assert.equal(
    assetContext(f.db, "other", "NVDA").scenarios.count,
    0,
    "Related tags must not create a price scenario for another asset",
  );
  await f.call(url + "/publish", "POST", {
    revision: saved.json().revision,
    reviewed: true,
  });
  assert.equal(
    (await f.call("/api/public/journal?symbol=NVDA")).json().articles.length,
    0,
  );
  assert.equal(assetContext(f.db, "other", "NVD.DE").journal.count, 1);
  assert.deepEqual(
    (await f.call(publicUrl + "?v=2")).json().assets.map((a) => a.symbol),
    ["INTC", "NVDA"],
  );
  const html = await f.call("/journal/" + draft.slug + "?v=2");
  assert.match(html.body, /NVIDIA Corporation/);
  await f.call(url + "/publication", "DELETE");
  assert.equal(assetContext(f.db, "other", "NVD.DE").journal.count, 0);
});

test("unsaved preview assets remain private and deleting a draft removes their associations", async (t) => {
  const f = await fixture(t),
    url = await f.create();
  const r = await f.call(url + "/preview", "POST", {
    symbol: "NVD.DE",
    assets: [german],
    body,
    title: "Preview",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.json().html, /NVD\.DE/);
  assert.deepEqual(
    (await f.call(url)).json().assets.map((a) => a.symbol),
    ["INTC", "NVDA"],
  );
  assert.equal(assetContext(f.db, "other", "NVD.DE").journal.count, 0);
  assert.equal((await f.call(url, "DELETE", { revision: 1 })).statusCode, 200);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM article_assets").get().n,
    0,
  );
});

test("asset input rejects duplicate, mismatched, unbounded or malformed associations atomically", async (t) => {
  const f = await fixture(t),
    url = await f.create();
  const draft = (await f.call(url)).json();
  for (const assets of [
    [],
    [nvidia],
    [intel, intel],
    Array(9).fill(intel),
    [{ ...intel, symbol: "bad symbol" }],
    [{ ...intel, isin: "invalid" }],
  ]) {
    const r = await f.call(url, "PUT", { ...draft, assets });
    assert.equal(r.statusCode, 400, r.body);
  }
  assert.equal((await f.call(url)).json().revision, 1);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM article_assets").get().n,
    2,
  );
});

test("additive asset migration leaves existing articles and editions unchanged", async (t) => {
  const f = await fixture(t);
  f.db.exec(
    "DROP TABLE article_revision_media; DROP TABLE journal_media; DROP TABLE ai_media_preferences; DROP TABLE article_revision_assets; DROP TABLE article_assets; UPDATE module_migrations SET version=8 WHERE module='intelligence';",
  );
  f.db
    .prepare(
      "INSERT INTO articles(id,user_id,slug,symbol,title,body,created_at,updated_at) VALUES('legacy','author','legacy','INTC','Legacy',?,1,1)",
    )
    .run(body);
  const before = f.db.prepare("SELECT * FROM articles").all();
  migratePlatform(f.db);
  migratePlatform(f.db);
  assert.deepEqual(f.db.prepare("SELECT * FROM articles").all(), before);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM article_assets").get().n,
    0,
  );
  assert.equal(
    (await f.call("/api/journal/legacy")).json().assets[0].symbol,
    "INTC",
  );
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
test("autocomplete aborts superseded searches and ignores late results or destroyed views", async () => {
  const pending = [],
    results = [],
    statuses = [];
  const lookup = createAssetLookup({
    delay: 0,
    onResults: (r) => results.push(r),
    onStatus: (s) => statuses.push(s),
    search: (query, signal) =>
      new Promise((resolve) => pending.push({ query, signal, resolve })),
  });
  lookup.query("intel");
  await tick();
  lookup.query("nvidia");
  await tick();
  assert.ok(pending[0].signal.aborted);
  pending[1].resolve({ results: [nvidia, german] });
  await tick();
  assert.deepEqual(
    results.at(-1).map((a) => a.symbol),
    ["NVDA", "NVD.DE"],
  );
  pending[0].resolve({ results: [intel] });
  await tick();
  assert.deepEqual(
    results.at(-1).map((a) => a.symbol),
    ["NVDA", "NVD.DE"],
  );
  lookup.query("asml");
  await tick();
  lookup.cancel();
  const count = results.length;
  pending[2].resolve({ results: [{ symbol: "ASML.AS", name: "ASML" }] });
  await tick();
  assert.equal(results.length, count);
  assert.ok(pending[2].signal.aborted);
});
