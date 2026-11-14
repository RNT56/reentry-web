import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createApp } from "../server/app.js";
import { openStore } from "../server/store.js";
import {
  defaultChartWorkspaceState,
  validateChartWorkspaceState,
  MAX_CHART_DRAWINGS,
} from "../src/domain/chart-workspace.js";

const state = (name = "Support study") => ({
  ...defaultChartWorkspaceState(name),
  indicators: ["sma20", "rsi"],
  drawings: [
    {
      id: "line-1",
      type: "trend",
      anchors: [
        { time: 1700000000, price: 24 },
        { time: 1700864000, price: 30 },
      ],
      color: "#b9f68b",
    },
  ],
  viewport: { from: 1700000000, to: 1700864000 },
});
const origin = "http://localhost:4173";
async function fixture() {
  const db = openStore(":memory:");
  const app = await createApp({
    db,
    logger: false,
    origin,
    disableRateLimit: true,
    platform: {
      startWorker: false,
      workerEnabled: false,
      connectors: {
        status: () => [],
        collect: async () => ({ sources: [], coverage: [] }),
      },
      macro: { snapshot: async () => ({ series: [] }) },
    },
  });
  await app.ready();
  const tokens = new Map();
  for (const user of ["first", "second"]) {
    const now = Date.now(),
      token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      user,
      user,
      "unused",
      "unused",
      now,
    );
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
      createHash("sha256").update(token).digest("hex"),
      user,
      now,
      now,
      now,
      now + 86400000,
    );
    tokens.set(user, token);
  }
  const call = (user, url, method = "GET", payload) =>
    app.inject({
      url,
      method,
      payload,
      headers: {
        origin,
        "x-reentry-request": "1",
        ...(user ? { cookie: "reentry_dev=" + tokens.get(user) } : {}),
      },
    });
  return {
    app,
    db,
    call,
    async close() {
      await app.close();
      db.close();
    },
  };
}

test("chart workspace validation bounds persisted drawings and preserves only safe fields", () => {
  const input = state();
  const normalized = validateChartWorkspaceState({
    ...input,
    name: "  Support study  ",
    unexpected: "discard",
  });
  assert.equal(normalized.name, "Support study");
  assert.equal(normalized.unexpected, undefined);
  assert.deepEqual(normalized.viewport, input.viewport);
  assert.notEqual(normalized.drawings, input.drawings);
  assert.deepEqual(defaultChartWorkspaceState().indicators, ["sma20", "sma50"]);
  for (const invalid of [
    { ...input, name: " " },
    { ...input, name: "x".repeat(41) },
    { ...input, range: "max" },
    { ...input, currency: "GBP" },
    { ...input, scale: "symlog" },
    { ...input, chartType: "invented" },
    { ...input, indicators: ["rsi", "rsi"] },
    { ...input, indicators: ["arbitrary"] },
    {
      ...input,
      drawings: [
        {
          ...input.drawings[0],
          anchors: [
            { time: 1700000000, price: -1 },
            { time: 1700864000, price: 30 },
          ],
        },
      ],
    },
    {
      ...input,
      drawings: [{ ...input.drawings[0], color: "red;position:fixed" }],
    },
    { ...input, drawings: [{ ...input.drawings[0], text: "x".repeat(121) }] },
    {
      ...input,
      drawings: [
        {
          ...input.drawings[0],
          anchors: [
            { time: Infinity, price: 20 },
            { time: 1700864000, price: 30 },
          ],
        },
      ],
    },
    { ...input, drawings: [input.drawings[0], input.drawings[0]] },
    {
      ...input,
      drawings: Array.from({ length: MAX_CHART_DRAWINGS + 1 }, (_, i) => ({
        ...input.drawings[0],
        id: String(i),
      })),
    },
    { ...input, viewport: { from: 1700864000, to: 1700000000 } },
  ])
    assert.throws(
      () => validateChartWorkspaceState(invalid),
      (error) => error.statusCode === 400,
    );
  assert.equal(
    validateChartWorkspaceState({
      ...input,
      drawings: [
        {
          id: "h",
          type: "horizontal",
          anchors: [{ time: 1700000000, price: 0.0000001 }],
        },
        {
          id: "n",
          type: "note",
          anchors: [{ time: 1700000000, price: 22 }],
          text: "<script>literal text</script>",
        },
      ],
    }).drawings[1].text,
    "<script>literal text</script>",
  );
});

test("saved analyses are authenticated, isolated by user and asset, and bounded to three slots", async () => {
  const f = await fixture();
  try {
    for (const [url, method, payload] of [
      ["/api/chart-workspaces?symbol=INTC", "GET"],
      ["/api/chart-workspaces/INTC/1", "PUT", { revision: 0, state: state() }],
      ["/api/chart-workspaces/INTC/1", "DELETE", { revision: 0 }],
    ])
      assert.equal((await f.call(null, url, method, payload)).statusCode, 401);
    const initial = await f.call("first", "/api/chart-workspaces?symbol=intc");
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.headers["cache-control"], "no-store");
    assert.deepEqual(initial.json(), {
      symbol: "INTC",
      slots: [1, 2, 3].map((slot) => ({
        slot,
        revision: 0,
        state: null,
        updatedAt: null,
      })),
    });
    for (const slot of [1, 2, 3]) {
      const saved = await f.call(
        "first",
        "/api/chart-workspaces/intc/" + slot,
        "PUT",
        { revision: 0, state: state("Analysis " + slot) },
      );
      assert.equal(saved.statusCode, 200, saved.body);
      assert.equal(saved.json().revision, 1);
      assert.equal(saved.json().symbol, "INTC");
    }
    assert.equal(
      (
        await f.call("first", "/api/chart-workspaces/INTC/4", "PUT", {
          revision: 0,
          state: state(),
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.call("first", "/api/chart-workspaces/INTC/01", "PUT", {
          revision: 0,
          state: state(),
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await f.call("second", "/api/chart-workspaces?symbol=INTC"))
        .json()
        .slots.filter((s) => s.state).length,
      0,
    );
    assert.equal(
      (await f.call("first", "/api/chart-workspaces?symbol=AAPL"))
        .json()
        .slots.filter((s) => s.state).length,
      0,
    );
    assert.equal(
      (
        await f.call("second", "/api/chart-workspaces/INTC/1", "PUT", {
          revision: 0,
          state: state("Other account"),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.call("first", "/api/chart-workspaces?symbol=INTC")).json()
        .slots[0].state.name,
      "Analysis 1",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) AS count FROM chart_workspaces WHERE user_id='first' AND symbol='INTC'",
        )
        .get().count,
      3,
    );
  } finally {
    await f.close();
  }
});

test("revision conflicts and tombstones prevent stale overwrites after deleting and recreating an analysis", async () => {
  const f = await fixture();
  try {
    const path = "/api/chart-workspaces/INTC/1";
    const put = (revision, name) =>
      f.call("first", path, "PUT", { revision, state: state(name) });
    assert.equal((await put(0, "Original")).json().revision, 1);
    assert.equal((await put(0, "Stale")).statusCode, 409);
    assert.equal((await put(1, "Latest")).json().revision, 2);
    assert.equal(
      (await f.call("second", path, "DELETE", { revision: 2 })).statusCode,
      409,
    );
    const removed = await f.call("first", path, "DELETE", { revision: 2 });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().state, null);
    assert.equal(removed.json().revision, 3);
    assert.equal((await put(0, "Old empty slot")).statusCode, 409);
    assert.equal((await put(2, "Old edit")).statusCode, 409);
    assert.equal((await put(3, "Restored")).json().revision, 4);
    assert.equal(
      (await f.call("first", path, "DELETE", { revision: 1 })).statusCode,
      409,
    );
    assert.equal(
      (await f.call("first", "/api/chart-workspaces?symbol=INTC")).json()
        .slots[0].state.name,
      "Restored",
    );
    assert.equal(
      (await f.call("first", path, "PUT", { state: state() })).statusCode,
      400,
    );
    assert.equal(
      (await f.call("first", "/api/chart-workspaces?symbol=bad%20symbol"))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await f.call("first", path, "PUT", {
          revision: 4,
          state: state(),
          extra: "x".repeat(50000),
        })
      ).statusCode,
      413,
    );
  } finally {
    await f.close();
  }
});

test("chart migration is additive and repeated startup retains saved state and revisions", async () => {
  const f = await fixture();
  try {
    const usersBefore = f.db.prepare("SELECT * FROM users ORDER BY id").all();
    await f.call("first", "/api/chart-workspaces/INTC/1", "PUT", {
      revision: 0,
      state: state(),
    });
    const { migratePlatform } = await import("../server/platform/schema.js");
    migratePlatform(f.db);
    assert.deepEqual(
      f.db.prepare("SELECT * FROM users ORDER BY id").all(),
      usersBefore,
    );
    assert.equal(f.db.prepare("PRAGMA user_version").get().user_version, 1);
    const slots = (
      await f.call("first", "/api/chart-workspaces?symbol=INTC")
    ).json().slots;
    assert.equal(slots[0].revision, 1);
    assert.deepEqual(slots[0].state, state());
    assert.equal(
      f.db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
  } finally {
    await f.close();
  }
});
