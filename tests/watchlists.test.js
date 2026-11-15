import { normalizePoliticalFeed } from "../server/politics/feed.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";
const origin = "http://localhost:4173";
const holding = (symbol) => ({
  id: randomUUID(),
  symbol,
  name: symbol + " Company",
  broker: "Trade Republic",
  lots: [{ id: randomUUID(), qty: 1, price: 10, fee: 0, date: "2026-01-01" }],
});
function seed(db, name, symbols) {
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
    JSON.stringify({ ...emptyPortfolio(), holdings: symbols.map(holding) }),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    id,
    now,
    now,
    now,
    now + 86400000,
  );
  return {
    id,
    headers: {
      cookie: "reentry_dev=" + token,
      origin,
      "x-reentry-request": "1",
    },
  };
}
async function fixture(t, { symbols = ["MSFT", "AAPL"], politics } = {}) {
  const db = openStore(":memory:");
  const options = {
    db,
    origin,
    logger: false,
    disableRateLimit: true,
    platform: {
      politics,
      workerEnabled: false,
      startWorker: false,
      connectors: {
        status: () => [],
        collect: async () => {
          throw Error("No connector call expected");
        },
      },
    },
  };
  let app = await createApp(options);
  await app.ready();
  const a = seed(db, "alice", symbols),
    b = seed(db, "bob", ["NVDA", "AAPL"]);
  t.after(async () => {
    await app.close();
    db.close();
  });
  return {
    db,
    a,
    b,
    async request(user, method, url, payload) {
      return app.inject({
        method,
        url,
        headers: user.headers,
        ...(payload === undefined ? {} : { payload }),
      });
    },
    async assets(user = a) {
      const response = await app.inject({
        url: "/api/research/assets",
        headers: user.headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    },
    async order(symbols, revision, user = a) {
      return app.inject({
        method: "PUT",
        url: "/api/research/order",
        headers: user.headers,
        payload: { symbols, revision },
      });
    },
    async restart() {
      await app.close();
      app = await createApp(options);
      await app.ready();
    },
    get app() {
      return app;
    },
  };
}
const create = async (f, name, user = f.a) => {
  const r = await f.request(user, "POST", "/api/watchlists", { name });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const add = async (f, list, symbol, user = f.a) =>
  f.request(user, "PUT", "/api/research/assets/" + symbol, {
    name: symbol,
    automatic: false,
    intervalHours: 24,
    watchlistId: list.id,
  });
test("Watchlists persist selection, membership and ordering independently per account", async (t) => {
  const f = await fixture(t),
    tech = await create(f, "Technology"),
    income = await create(f, "Income");
  assert.equal((await add(f, tech, "NVDA")).statusCode, 200);
  assert.equal((await add(f, tech, "AAPL")).statusCode, 200);
  await add(f, income, "AAPL");
  await f.request(f.a, "PUT", "/api/watchlists/selection", { id: tech.id });
  let assets = await f.assets();
  assert.deepEqual(
    assets.assets.map((a) => a.symbol),
    ["NVDA", "AAPL"],
  );
  assert.equal(assets.selectedId, tech.id);
  let saved = await f.request(f.a, "PUT", "/api/research/order", {
    listId: tech.id,
    symbols: ["AAPL", "NVDA"],
    revision: assets.orderRevision,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  await f.restart();
  assert.deepEqual(
    (await f.assets()).assets.map((a) => a.symbol),
    ["AAPL", "NVDA"],
  );
  assert.deepEqual(
    (await f.request(f.b, "GET", "/api/watchlists")).json().lists,
    [],
  );
  assert.equal(
    (await f.request(f.b, "GET", "/api/research/assets?list=" + tech.id))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await f.request(f.b, "DELETE", "/api/watchlists/" + tech.id, {
        revision: saved.json().revision,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await f.request(f.b, "PUT", "/api/watchlists/selection", { id: tech.id }))
      .statusCode,
    404,
  );
  assert.equal((await add(f, tech, "AMD", f.b)).statusCode, 404);
  assert.equal(
    f.db
      .prepare("SELECT 1 FROM research_assets WHERE user_id=? AND symbol=?")
      .get(f.b.id, "AMD"),
    undefined,
  );
});
test("Removing list membership or the list never deletes holdings, analyses or other lists", async (t) => {
  const f = await fixture(t),
    first = await create(f, "One"),
    second = await create(f, "Two");
  await add(f, first, "AAPL");
  await add(f, first, "NVDA");
  await add(f, second, "AAPL");
  const before = f.db
    .prepare("SELECT data FROM portfolios WHERE user_id=?")
    .get(f.a.id).data;
  const remove = await f.request(
    f.a,
    "DELETE",
    `/api/watchlists/${first.id}/assets/AAPL`,
  );
  assert.equal(remove.statusCode, 200);
  assert.deepEqual(remove.json().symbols, ["NVDA"]);
  assert.deepEqual(
    (await f.request(f.a, "GET", "/api/research/assets?list=" + second.id))
      .json()
      .assets.map((a) => a.symbol),
    ["AAPL"],
  );
  assert.equal(
    f.db.prepare("SELECT data FROM portfolios WHERE user_id=?").get(f.a.id)
      .data,
    before,
  );
  assert.ok(
    f.db
      .prepare("SELECT 1 FROM research_assets WHERE user_id=? AND symbol=?")
      .get(f.a.id, "AAPL"),
  );
  await f.request(f.a, "PUT", "/api/watchlists/selection", { id: first.id });
  const del = await f.request(f.a, "DELETE", "/api/watchlists/" + first.id, {
    revision: remove.json().revision,
  });
  assert.equal(del.statusCode, 200);
  assert.equal(
    (await f.request(f.a, "GET", "/api/watchlists")).json().selectedId,
    null,
  );
  assert.ok((await f.assets()).assets.some((a) => a.symbol === "NVDA"));
});
test("Concurrent membership edits merge and stale reorders / renames / deletes cannot overwrite them", async (t) => {
  const f = await fixture(t),
    list = await create(f, "Growth");
  await add(f, list, "AAPL");
  const state = (
    await f.request(f.a, "GET", "/api/research/assets?list=" + list.id)
  ).json();
  await add(f, list, "AMD");
  const stale = await f.request(f.a, "PUT", "/api/research/order", {
    listId: list.id,
    symbols: ["AAPL"],
    revision: state.orderRevision,
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(
    (
      await f.request(f.a, "PATCH", "/api/watchlists/" + list.id, {
        name: "Old",
        revision: state.orderRevision,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.request(f.a, "DELETE", "/api/watchlists/" + list.id, {
        revision: state.orderRevision,
      })
    ).statusCode,
    409,
  );
  const removed = await f.request(
    f.a,
    "DELETE",
    `/api/watchlists/${list.id}/assets/AAPL`,
  );
  assert.deepEqual(removed.json().symbols, ["AMD"]);
  const renamed = await f.request(f.a, "PATCH", "/api/watchlists/" + list.id, {
    name: "New",
    revision: removed.json().revision,
  });
  assert.equal(renamed.json().name, "New");
});
test("Dismissal from All preserves custom list membership and validation rejects invalid lists", async (t) => {
  const f = await fixture(t),
    list = await create(f, "Focus");
  await add(f, list, "AAPL");
  await f.request(f.a, "DELETE", "/api/research/assets/AAPL");
  assert.ok(!(await f.assets()).assets.some((a) => a.symbol === "AAPL"));
  assert.ok(
    (await f.request(f.a, "GET", "/api/research/assets?list=" + list.id))
      .json()
      .assets.some((a) => a.symbol === "AAPL"),
  );
  assert.equal(
    (await f.request(f.a, "POST", "/api/watchlists", { name: "focus" }))
      .statusCode,
    409,
  );
  assert.equal(
    (await f.request(f.a, "POST", "/api/watchlists", { name: " " })).statusCode,
    400,
  );
  assert.equal(
    (await f.request(f.a, "POST", "/api/watchlists", { name: "a".repeat(41) }))
      .statusCode,
    400,
  );
  assert.equal(
    (await f.app.inject({ url: "/api/watchlists" })).statusCode,
    401,
  );
});
test("Political scopes use only the signed-in account, paginate deterministically and reject changed snapshots", async (t) => {
  const date = new Date().toISOString().slice(0, 10);
  const raw = Array.from({ length: 55 }, (_, i) => ({
    id: "trade-" + i,
    filer_id: "member",
    filer_name: "Example Member",
    source_id: "house_clerk",
    filing_date: date,
    transaction_date: date,
    ticker: i % 2 ? "NVDA" : "AAPL",
    asset_name: "Example asset",
    transaction_type: "Purchase",
    amount_range_low: 1001,
    amount_range_high: 15000,
    amount_range_label: "$1,001 - $15,000",
    doc_url:
      "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/123.pdf",
  }));
  const data = {
    ...normalizePoliticalFeed(raw, []),
    status: "available",
    fetchedAt: Date.now(),
    version: "fixture",
  };
  const f = await fixture(t, {
    symbols: ["AAPL"],
    politics: { get: async () => data },
  });
  const list = await create(f, "AAPL only");
  await add(f, list, "AAPL");
  const all = (await f.request(f.a, "GET", "/api/politics?days=0")).json();
  assert.equal(all.rows.length, 50);
  assert.equal(all.nextOffset, 50);
  assert.equal(all.summary.count, 55);
  const page = (
    await f.request(
      f.a,
      "GET",
      "/api/politics?days=0&offset=50&version=fixture",
    )
  ).json();
  assert.equal(page.rows.length, 5);
  assert.equal(page.nextOffset, null);
  assert.equal(new Set([...all.rows, ...page.rows].map((r) => r.id)).size, 55);
  const scoped = (
    await f.request(f.a, "GET", "/api/politics?scope=portfolio")
  ).json();
  assert.ok(scoped.rows.every((r) => r.ticker === "AAPL"));
  assert.equal(scoped.summary.count, 28);
  assert.equal(
    (await f.request(f.b, "GET", "/api/politics?scope=list:" + list.id))
      .statusCode,
    404,
  );
  assert.equal((await f.app.inject({ url: "/api/politics" })).statusCode, 401);
  assert.equal(
    (await f.request(f.a, "GET", "/api/politics?version=stale")).statusCode,
    409,
  );
  assert.equal(
    (await f.request(f.a, "GET", "/api/politics?offset=-1")).statusCode,
    400,
  );
  const own = (await f.request(f.a, "GET", "/api/research/export")).json();
  assert.equal(own.watchlists[0].name, "AAPL only");
  assert.deepEqual(
    (await f.request(f.b, "GET", "/api/research/export")).json().watchlists,
    [],
  );
});
test("Assigning existing assets to watchlists preserves automation and the next scheduled research run", async (t) => {
  const f = await fixture(t),
    list = await create(f, "Thesis");
  await f.request(f.a, "PUT", "/api/research/assets/AAPL", {
    name: "Apple",
    automatic: true,
    intervalHours: 12,
  });
  const before = f.db
    .prepare(
      "SELECT name,automatic,interval_hours,next_run FROM research_assets WHERE user_id=? AND symbol=?",
    )
    .get(f.a.id, "AAPL");
  await add(f, list, "AAPL");
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT name,automatic,interval_hours,next_run FROM research_assets WHERE user_id=? AND symbol=?",
      )
      .get(f.a.id, "AAPL"),
    before,
  );
});
