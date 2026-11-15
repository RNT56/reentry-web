import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import { createSet } from "../server/intelligence/scenarios.js";
import {
  assetContext,
  assetContextList,
  registerAssetContextRoutes,
} from "../server/intelligence/asset-context.js";
import { assetRoute, applyAssetRoute, parseRoute } from "../src/app/router.js";

function fixture(t) {
  const db = openStore(":memory:");
  migratePlatform(db);
  t.after(() => db.close());
  for (const id of ["alice", "bob", "author"])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      id,
      id,
      "test-hash",
      "test-recovery",
      1,
    );
  const job = db.prepare(
    "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,result,request_key,created_at) VALUES(?,?,'research',?,'gemini','test-model',?,'{}',?,?,?)",
  );
  const addJob = (id, owner, symbol, status, summary, at) =>
    job.run(id, owner, symbol, status, JSON.stringify({ summary }), id, at);
  addJob(
    "alice-brief",
    "alice",
    "AAPL",
    "completed",
    "Apple: services momentum",
    10,
  );
  addJob("bob-brief", "bob", "AAPL", "completed", "BOB PRIVATE", 20);
  addJob("unfinished", "alice", "AAPL", "running", "UNFINISHED", 30);
  for (let i = 0; i < 65; i++)
    addJob("other-" + i, "alice", "MSFT", "completed", "OTHER SYMBOL", 100 + i);
  createSet(
    db,
    "alice",
    "AAPL",
    "Apple thesis",
    [{ title: "Launch" }],
    null,
    10,
  );
  createSet(db, "bob", "AAPL", "BOB PRIVATE TREE", [], null, 20);
  createSet(db, "alice", "AAPL.DE", "OTHER LISTING", [], null, 20);
  db.prepare(
    "INSERT INTO articles(id,user_id,slug,symbol,title,body,branches,sources,revision,published_revision,created_at,updated_at) VALUES('article','author','apple-thesis','MSFT','UNPUBLISHED TITLE','UNPUBLISHED BODY','[]','[]',2,1,1,2)",
  ).run();
  db.prepare(
    "INSERT INTO article_revisions VALUES('edition','article',1,'RNT','AAPL','Apple: the long view','# Published snapshot','[]','[]',?,1)",
  ).run(createSet(db, "author", "AAPL", "Public snapshot", [], null, 1));
  db.prepare(
    "INSERT INTO articles(id,user_id,slug,symbol,title,body,created_at,updated_at) VALUES('draft','author','private','AAPL','PRIVATE DRAFT','PRIVATE DRAFT',1,1)",
  ).run();
  return db;
}

test("asset context returns exact-listing private previews and only published journal snapshots", (t) => {
  const db = fixture(t);
  const result = assetContext(db, "alice", "AAPL");
  assert.equal(
    result.research.count,
    1,
    "a relevant brief is found beyond the global latest-60 list",
  );
  assert.equal(result.research.items[0].id, "alice-brief");
  assert.equal(result.scenarios.count, 1);
  assert.equal(result.journal.count, 1);
  assert.equal(result.journal.items[0].title, "Apple: the long view");
  assert.equal(result.journal.items[0].excerpt, "Published snapshot");
  assert.doesNotMatch(
    JSON.stringify(result),
    /BOB|UNPUBLISHED|UNFINISHED|OTHER|PRIVATE DRAFT/,
  );
  assert.equal(
    assetContext(db, "bob", "AAPL").research.items[0].id,
    "bob-brief",
  );
  assert.equal(assetContext(db, "alice", "UNKNOWN").research.count, 0);
});

test("asset context endpoint requires an account, validates symbols and performs no writes", async (t) => {
  const db = fixture(t),
    app = Fastify();
  app.decorate("requireUser", async (req, reply) => {
    if (req.headers.authorization !== "fixture-alice")
      return reply.code(401).send({ error: "Sign in" });
    req.auth = { user_id: "alice" };
  });
  registerAssetContextRoutes(app, { db });
  const changes = db.prepare("SELECT total_changes() AS n").get().n;
  try {
    assert.equal(
      (await app.inject("/api/asset-context?symbol=AAPL")).statusCode,
      401,
    );
    const response = await app.inject({
      url: "/api/asset-context?symbol=aapl",
      headers: { authorization: "fixture-alice" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.json().symbol, "AAPL");
    assert.equal(
      (
        await app.inject({
          url: "/api/asset-context?symbol=%3Cscript%3E",
          headers: { authorization: "fixture-alice" },
        })
      ).statusCode,
      400,
    );
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n, changes);
  } finally {
    await app.close();
  }
});

test("context deep links preserve the portfolio selection and open exact research, tree or Capitol assets", () => {
  const model = {
    selected: "holding-123",
    intelligence: { watchlistId: "old-list", aiJobId: "old-ai" },
  };
  const link = assetRoute("explore", "SAP.DE", {
    tab: "scenarios",
    scenario: "tree&1",
  });
  assert.equal(parseRoute(link).page, "explore");
  applyAssetRoute(model, link);
  assert.equal(model.selected, "holding-123");
  assert.equal(model.intelligence.symbol, "SAP.DE");
  assert.equal(model.intelligence.focusSetId, "tree&1");
  assert.equal(model.intelligence.watchlistId, null);
  assert.equal(model.intelligence.aiJobId, null);
  applyAssetRoute(model, assetRoute("explore", "AAPL", { job: "brief-1" }));
  assert.equal(model.intelligence.jobId, "brief-1");
  assert.equal(model.intelligence.tab, "research");
  applyAssetRoute(model, assetRoute("politics", "AAPL"));
  assert.deepEqual(model.politics, {
    ticker: "AAPL",
    days: 90,
    member: "",
    q: "",
    chamber: "all",
    side: "all",
    scope: "all",
  });
  applyAssetRoute(model, "#/politics?symbol=%3Cscript%3E");
  assert.equal(model.politics.ticker, "AAPL");
});

test("context lists paginate exact assets, preserve privacy and validate all page parameters", async (t) => {
  const db = fixture(t),
    app = Fastify();
  app.decorate("requireUser", async (req, reply) => {
    if (req.headers.authorization !== "fixture-alice")
      return reply.code(401).send({ error: "Sign in" });
    req.auth = { user_id: "alice" };
  });
  registerAssetContextRoutes(app, { db });
  t.after(() => app.close());
  const before = db.prepare("SELECT total_changes() AS n").get().n;
  const seen = new Set();
  let offset = 0;
  do {
    const page = assetContextList(db, "alice", "MSFT", "research", offset);
    assert.equal(page.count, 65);
    assert.ok(page.items.length <= 20);
    for (const item of page.items) {
      assert.ok(!seen.has(item.id));
      seen.add(item.id);
    }
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(seen.size, 65);
  assert.equal(
    assetContextList(db, "alice", "AAPL", "research").items[0].id,
    "alice-brief",
  );
  assert.equal(
    assetContextList(db, "alice", "AAPL", "journal").items[0].title,
    "Apple: the long view",
  );
  assert.equal(
    assetContextList(db, "author", "AAPL", "scenarios").count,
    0,
    "published snapshots are not private trees",
  );
  for (const section of ["journal", "research", "scenarios"]) {
    assert.equal(
      (await app.inject("/api/asset-context/" + section + "?symbol=AAPL"))
        .statusCode,
      401,
    );
    const response = await app.inject({
      url: "/api/asset-context/" + section + "?symbol=AAPL",
      headers: { authorization: "fixture-alice" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.doesNotMatch(
      response.body,
      /BOB|UNPUBLISHED|PRIVATE DRAFT|UNFINISHED/,
    );
  }
  for (const suffix of [
    "research?symbol=AAPL&offset=-1",
    "research?symbol=AAPL&offset=1.5",
    "research?symbol=AAPL&offset=NaN",
    "research?symbol=AAPL&offset=100001",
    "research?symbol=%3Cscript%3E",
    "__proto__?symbol=AAPL",
  ]) {
    const res = await app.inject({
      url: "/api/asset-context/" + suffix,
      headers: { authorization: "fixture-alice" },
    });
    assert.ok([400, 404].includes(res.statusCode), suffix);
  }
  assert.equal(db.prepare("SELECT total_changes() AS n").get().n, before);
});
