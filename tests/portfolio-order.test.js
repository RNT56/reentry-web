import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";

const origin = "http://localhost:4173";
const holding = (symbol, broker, qty, price) => ({
  id: randomUUID(),
  name: symbol + " fixture",
  symbol,
  broker,
  lots: [
    {
      id: randomUUID(),
      qty,
      price,
      fee: 1.25,
      date: "2026-03-02",
    },
  ],
});
const sale = () => ({
  id: randomUUID(),
  name: "Recorded sale fixture",
  symbol: "AAPL",
  broker: "Trade Republic",
  status: "waiting",
  date: "2026-04-03",
  cash: 500,
  q: 2,
  price: 270,
  tax: 39,
  buyFee: 1,
  targetGain: 5,
  taxRate: 27.99511,
});

function seed(db, username, state) {
  const id = randomUUID(),
    token = randomBytes(32).toString("base64url"),
    now = Date.now();
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    id,
    username,
    "fixture-password-hash",
    "fixture-recovery",
    now,
  );
  db.prepare("INSERT INTO portfolios(user_id,data) VALUES(?,?)").run(
    id,
    JSON.stringify(state),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    id,
    now,
    now,
    now,
    now + 86400000,
  );
  return token;
}

async function fixture(t) {
  const db = openStore(":memory:");
  const options = {
    db,
    origin,
    logger: false,
    disableRateLimit: true,
    marketService: {
      search: async () => ({ results: [] }),
      quote: async () => {
        throw Error("Reordering cannot request market data");
      },
      history: async () => {
        throw Error("Reordering cannot request market history");
      },
    },
    platform: {
      workerEnabled: false,
      startWorker: false,
      connectors: {
        status: () => [],
        collect: async () => {
          throw Error("Reordering cannot collect sources");
        },
      },
      generate: async () => {
        throw Error("Reordering cannot invoke a paid model");
      },
    },
  };
  let app = await createApp(options);
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  const initial = {
    ...emptyPortfolio(),
    holdings: [
      holding("AAPL", "Trade Republic", 4.75, 160.25),
      holding("AAPL", "Consorsbank", 2.5, 190.5),
      holding("MSFT", "ING", 3, 315.75),
    ],
    sales: [sale()],
  };
  const a = seed(db, "order-alice", initial),
    // Identical imported holding IDs make owner isolation observable even when
    // the accounts happen to contain copies of the same portfolio backup.
    b = seed(db, "order-bob", initial);
  return {
    initial,
    a,
    b,
    async read(token) {
      const response = await app.inject({
        url: "/api/portfolio",
        headers: { cookie: "reentry_dev=" + token },
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    },
    write(token, state, revision) {
      return app.inject({
        method: "PUT",
        url: "/api/portfolio",
        headers: {
          cookie: "reentry_dev=" + token,
          origin,
          "x-reentry-request": "1",
          "content-type": "application/json",
        },
        payload: { state, revision },
      });
    },
    async restart() {
      await app.close();
      app = await createApp(options);
      await app.ready();
    },
  };
}

const order = (state) => state.holdings.map((asset) => asset.id);
const positions = (state) =>
  Object.fromEntries(state.holdings.map((asset) => [asset.id, asset]));

test("holding order belongs to the account and persists without merging depots or changing financial data", async (t) => {
  const f = await fixture(t),
    before = await f.read(f.a),
    otherBefore = await f.read(f.b);
  const state = structuredClone(before.state);
  state.holdings = [state.holdings[2], state.holdings[1], state.holdings[0]];
  const saved = await f.write(f.a, state, before.revision);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().revision, before.revision + 1);
  const persisted = await f.read(f.a);
  assert.deepEqual(order(persisted.state), order(state));
  assert.deepEqual(positions(persisted.state), positions(before.state));
  assert.deepEqual(persisted.state.sales, before.state.sales);
  assert.deepEqual(persisted.state.settings, before.state.settings);
  const apple = persisted.state.holdings.filter(
    (asset) => asset.symbol === "AAPL",
  );
  assert.equal(apple.length, 2);
  assert.equal(new Set(apple.map((asset) => asset.id)).size, 2);
  assert.deepEqual(
    apple.map((asset) => [asset.broker, asset.lots[0].qty]),
    [
      ["Consorsbank", 2.5],
      ["Trade Republic", 4.75],
    ],
  );
  assert.deepEqual(await f.read(f.b), otherBefore);
  await f.restart();
  assert.deepEqual(await f.read(f.a), persisted);
  assert.deepEqual(await f.read(f.b), otherBefore);
});

test("a stale reorder cannot overwrite another device's purchase or recorded sale", async (t) => {
  const f = await fixture(t),
    orderingDevice = await f.read(f.a),
    purchaseDevice = await f.read(f.a);
  const purchased = structuredClone(purchaseDevice.state);
  purchased.holdings[0].lots.push({
    id: randomUUID(),
    qty: 1.125,
    price: 175.5,
    fee: 0.75,
    date: "2026-05-04",
  });
  purchased.holdings.push(holding("NVDA", "DKB", 6.25, 99.5));
  purchased.sales.push({ ...sale(), symbol: "MSFT", broker: "ING" });
  const purchase = await f.write(f.a, purchased, purchaseDevice.revision);
  assert.equal(purchase.statusCode, 200, purchase.body);
  const stale = structuredClone(orderingDevice.state);
  stale.holdings.reverse();
  const rejected = await f.write(f.a, stale, orderingDevice.revision);
  assert.equal(rejected.statusCode, 409, rejected.body);
  const latest = await f.read(f.a);
  assert.deepEqual(latest.state, purchased);
  assert.equal(latest.revision, purchase.json().revision);
  // Reapplying only the desired order to a fresh snapshot retains the new lot,
  // newly added holding, and sale instead of replaying stale financial fields.
  const freshOrder = structuredClone(latest.state);
  freshOrder.holdings.reverse();
  const reordered = await f.write(f.a, freshOrder, latest.revision);
  assert.equal(reordered.statusCode, 200, reordered.body);
  const final = await f.read(f.a);
  assert.deepEqual(order(final.state), order(freshOrder));
  assert.deepEqual(positions(final.state), positions(purchased));
  assert.deepEqual(final.state.sales, purchased.sales);
  assert.deepEqual(final.state.settings, purchased.settings);
  assert.deepEqual((await f.read(f.b)).state, f.initial);
});
