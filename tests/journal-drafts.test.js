import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";

const origin = "http://localhost:4173";
async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "reentry-draft-delete-"));
  const filename = path.join(directory, "test.sqlite");
  let db = openStore(filename);
  const options = {
    origin,
    logger: false,
    disableRateLimit: true,
    platform: {
      authorUsernames: "author,other",
      workerEnabled: false,
      startWorker: false,
      connectors: {
        status: () => [],
        collect: async () => ({ sources: [], coverage: [] }),
      },
    },
  };
  let app = await createApp({ ...options, db });
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
  const call = (
    url,
    method = "GET",
    payload,
    user = "author",
    requestOrigin = origin,
  ) =>
    app.inject({
      url,
      method,
      payload,
      headers: {
        origin: requestOrigin,
        "x-reentry-request": "1",
        ...(accounts[user] ? { cookie: accounts[user].cookie } : {}),
      },
    });
  t.after(async () => {
    await app.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    call,
    get db() {
      return db;
    },
    async create() {
      const response = await call("/api/journal", "POST", {
        symbol: "INTC",
        title: "Disposable draft",
        body: "If the launch is confirmed, this thesis becomes relevant.",
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json().id;
    },
    async restart() {
      await app.close();
      db.close();
      db = openStore(filename);
      app = await createApp({ ...options, db });
      await app.ready();
    },
  };
}

test("deleting a mapped draft removes the durable article and survives server restart", async (t) => {
  const f = await fixture(t),
    id = await f.create(),
    url = "/api/journal/" + id;
  const initial = (await f.call(url)).json();
  assert.equal(initial.canDelete, true);
  const saved = await f.call(url, "PUT", {
    ...initial,
    sources: [{ title: "Source", url: "https://example.com/filing" }],
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
        passage: initial.body,
      },
    ],
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const revision = saved.json().revision;
  assert.equal((await f.call(url, "DELETE", { revision })).statusCode, 200);
  assert.equal(
    f.db.prepare("SELECT id FROM articles WHERE id=?").get(id),
    undefined,
  );
  assert.equal((await f.call(url)).statusCode, 404);
  assert.deepEqual((await f.call("/api/journal")).json().articles, []);
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM ai_audit WHERE action='article-draft-deleted'",
      )
      .get().n,
    1,
  );
  await f.restart();
  assert.equal((await f.call(url)).statusCode, 404);
  assert.deepEqual((await f.call("/api/journal")).json().articles, []);
  assert.equal((await f.call(url, "DELETE", { revision })).statusCode, 404);
  assert.equal((await f.call(url, "PUT", saved.json())).statusCode, 404);
  assert.equal(
    (await f.call(url + "/publish", "POST", { revision, reviewed: true }))
      .statusCode,
    404,
  );
});

test("draft deletion requires author ownership, same origin and the current saved revision", async (t) => {
  const f = await fixture(t),
    id = await f.create(),
    url = "/api/journal/" + id;
  assert.equal(
    (await f.call(url, "DELETE", { revision: 1 }, "guest")).statusCode,
    401,
  );
  assert.equal(
    (await f.call(url, "DELETE", { revision: 1 }, "reader")).statusCode,
    403,
  );
  assert.equal(
    (await f.call(url, "DELETE", { revision: 1 }, "other")).statusCode,
    404,
  );
  assert.equal(
    (
      await f.call(
        url,
        "DELETE",
        { revision: 1 },
        "author",
        "https://elsewhere.example",
      )
    ).statusCode,
    403,
  );
  assert.equal((await f.call(url, "DELETE", {})).statusCode, 400);
  const draft = (await f.call(url)).json();
  assert.equal(
    (await f.call(url, "PUT", { ...draft, title: "A newer edit" })).statusCode,
    200,
  );
  const stale = await f.call(url, "DELETE", { revision: 1 });
  assert.equal(stale.statusCode, 409);
  assert.match(stale.body, /changed on another device/);
  assert.equal((await f.call(url)).json().title, "A newer edit");
  assert.equal((await f.call(url, "DELETE", { revision: 2 })).statusCode, 200);
});

test("published editions and their history cannot be removed through draft deletion", async (t) => {
  const f = await fixture(t),
    id = await f.create(),
    url = "/api/journal/" + id;
  const publication = await f.call(url + "/publish", "POST", {
    revision: 1,
    reviewed: true,
  });
  assert.equal(publication.statusCode, 200, publication.body);
  assert.equal((await f.call(url)).json().canDelete, false);
  assert.equal((await f.call(url, "DELETE", { revision: 1 })).statusCode, 409);
  assert.equal((await f.call(publication.json().url)).statusCode, 200);
  assert.equal((await f.call(url + "/publication", "DELETE")).statusCode, 200);
  const unpublished = (await f.call(url)).json();
  assert.equal(unpublished.publishedRevision, null);
  assert.equal(unpublished.canDelete, false);
  assert.equal((await f.call(url, "DELETE", { revision: 1 })).statusCode, 409);
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM article_revisions WHERE article_id=?")
      .get(id).n,
    1,
  );
});
