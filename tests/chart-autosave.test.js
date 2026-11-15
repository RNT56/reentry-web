import test from "node:test";
import assert from "node:assert/strict";
import { createChartAutosave } from "../src/features/charts/chart-autosave.js";
import { defaultChartWorkspaceState } from "../src/domain/chart-workspace.js";

const copy = (v) => structuredClone(v);
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
function fixture() {
  const storageData = new Map(),
    rows = new Map(),
    calls = [],
    timers = new Map();
  let clock = 0,
    nextTimer = 0,
    owner = "alice",
    intercept = null;
  const storage = {
    getItem: (k) => storageData.get(k),
    setItem: (k, v) => storageData.set(k, v),
  };
  const row = (o, s, n) =>
    rows.get(JSON.stringify([o, s, n])) || {
      slot: n,
      revision: 0,
      state: null,
    };
  async function request(path, method = "GET", body, options) {
    const symbol = decodeURIComponent(
      method === "GET" ? path.split("symbol=")[1] : path.split("/")[3],
    );
    const slot = method === "GET" ? null : Number(path.split("/")[4]);
    calls.push({ path, method, body: copy(body), options: copy(options) });
    if (options.ownerId !== owner)
      throw Object.assign(Error("Account changed"), { status: 401 });
    if (intercept) await intercept({ method, body, slot });
    if (method === "GET")
      return { slots: [1, 2, 3].map((n) => copy(row(owner, symbol, n))) };
    const previous = row(owner, symbol, slot);
    if (body.revision !== previous.revision)
      throw Object.assign(Error("Conflict"), { status: 409 });
    const result = {
      slot,
      revision: previous.revision + 1,
      state: method === "DELETE" ? null : copy(body.state),
    };
    rows.set(JSON.stringify([owner, symbol, slot]), result);
    return copy(result);
  }
  function make(o = "alice", symbol = "INTC", extra = {}) {
    return createChartAutosave({
      ownerId: o,
      symbol,
      request,
      storage,
      canWrite: () => owner === o,
      setTimer: (fn, ms) => {
        const id = ++nextTimer;
        timers.set(id, { fn, at: clock + ms });
        return id;
      },
      clearTimer: (id) => timers.delete(id),
      ...extra,
    });
  }
  return {
    make,
    storage,
    storageData,
    calls,
    rows,
    row,
    timers,
    owner: (value) => (owner = value),
    intercept: (fn) => (intercept = fn),
    async advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= clock) {
          timers.delete(id);
          timer.fn();
        }
      await settle();
    },
    external(o, symbol, slot, state) {
      rows.set(JSON.stringify([o, symbol, slot]), {
        slot,
        revision: row(o, symbol, slot).revision + 1,
        state: copy(state),
      });
    },
  };
}
const drawing = {
  id: "line-1",
  type: "trend",
  anchors: [
    { time: 1700000000, price: 24 },
    { time: 1700864000, price: 30 },
  ],
  color: "#a4dec0",
};

test("all chart state autosaves after a quiet interval without creating empty default slots", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  await f.advance(1000);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
  const next = {
    ...sync.get(1).state,
    name: "My study",
    range: "5y",
    currency: "USD",
    scale: "log",
    chartType: "candle",
    indicators: ["rsi"],
    drawings: [drawing],
    viewport: { from: 1700000000, to: 1700864000 },
  };
  sync.update(1, next);
  await f.advance(200);
  sync.update(1, {
    ...next,
    drawings: [
      {
        ...drawing,
        text: "Support",
        anchors: [{ time: 1700000000, price: 22 }, drawing.anchors[1]],
      },
    ],
  });
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
  await f.advance(350);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(sync.get(1).phase, "saved");
  assert.deepEqual(f.row("alice", "INTC", 1).state, sync.get(1).state);
  assert.equal(f.calls.at(-1).options.keepalive, true);
  assert.equal(f.calls.at(-1).options.ownerId, "alice");
});

test("edits remain usable during a save and the newest snapshot drains with the new revision", async () => {
  const f = fixture(),
    sync = f.make(),
    gate = deferred();
  await sync.load();
  let blocked = false;
  f.intercept(async ({ method }) => {
    if (method === "PUT" && !blocked) {
      blocked = true;
      await gate.promise;
    }
  });
  sync.update(1, { ...sync.get(1).state, drawings: [drawing] });
  const flushed = sync.flush(1);
  sync.update(1, {
    ...sync.get(1).state,
    drawings: [{ ...drawing, text: "Newest" }],
    scale: "log",
  });
  gate.resolve();
  assert.equal(await flushed, true);
  const writes = f.calls.filter((c) => c.method === "PUT");
  assert.deepEqual(
    writes.map((c) => c.body.revision),
    [0, 1],
  );
  assert.equal(f.row("alice", "INTC", 1).state.drawings[0].text, "Newest");
  assert.equal(sync.get(1).dirty, false);
});

test("undo back to the original state during an in-flight save still persists the undo", async () => {
  const f = fixture(),
    sync = f.make(),
    gate = deferred();
  await sync.load();
  const original = sync.get(1).state;
  let first = true;
  f.intercept(async ({ method }) => {
    if (method === "PUT" && first) {
      first = false;
      await gate.promise;
    }
  });
  sync.update(1, { ...original, drawings: [drawing] });
  const flushing = sync.flush(1);
  sync.update(1, original);
  gate.resolve();
  await flushing;
  assert.deepEqual(f.row("alice", "INTC", 1).state.drawings, []);
  assert.equal(sync.get(1).dirty, false);
});

test("slot, asset and account journals never share drafts and remember the selected slot", async () => {
  const f = fixture(),
    intel = f.make(),
    apple = f.make("alice", "AAPL");
  await intel.load();
  await apple.load();
  intel.select(3);
  intel.update(3, {
    ...intel.get(3).state,
    name: "Intel third",
    drawings: [drawing],
  });
  apple.update(1, { ...apple.get(1).state, name: "Apple first" });
  await intel.flushAll();
  await apple.flushAll();
  const remount = f.make();
  await remount.load();
  assert.equal(remount.selected, 3);
  assert.equal(remount.get(3).state.name, "Intel third");
  assert.equal(remount.get(1).saved, false);
  f.owner("bob");
  const bob = f.make("bob");
  await bob.load();
  assert.deepEqual(bob.get(3).state.drawings, []);
  assert.equal(bob.selected, 1);
  assert.equal(f.row("alice", "AAPL", 1).state.name, "Apple first");
});

test("a reload before the debounce fires recovers and saves the pending chart", async () => {
  const f = fixture(),
    before = f.make();
  await before.load();
  before.update(1, {
    ...before.get(1).state,
    drawings: [drawing],
    indicators: [],
  });
  before.pause();
  const after = f.make();
  await after.load();
  assert.equal(after.get(1).state.drawings.length, 1);
  assert.equal(await after.flushAll(), true);
  assert.deepEqual(f.row("alice", "INTC", 1).state.indicators, []);
});

test("recovery recognizes a committed keepalive snapshot without dropping newer local edits", async () => {
  const f = fixture(),
    before = f.make(),
    gate = deferred();
  await before.load();
  f.intercept(async ({ method }) => {
    if (method === "PUT") await gate.promise;
  });
  const first = { ...before.get(1).state, name: "First", drawings: [drawing] };
  before.update(1, first);
  const pending = before.flush(1);
  before.update(1, { ...first, name: "Newest" });
  before.pause();
  const persisted = new Map(f.storageData);
  f.external("alice", "INTC", 1, first);
  const storage = {
    getItem: (k) => persisted.get(k),
    setItem: (k, v) => persisted.set(k, v),
  };
  f.intercept(null);
  const after = f.make("alice", "INTC", { storage });
  await after.load();
  assert.equal(after.get(1).phase, "pending");
  await after.flushAll();
  assert.equal(f.row("alice", "INTC", 1).state.name, "Newest");
  gate.resolve();
  await pending;
});

test("transient errors retry automatically, keep the draft, and stop after bounded attempts", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  f.intercept(({ method }) => {
    if (method === "PUT") throw Error("Offline");
  });
  sync.update(1, { ...sync.get(1).state, chartType: "candle" });
  assert.equal(await sync.flush(1), false);
  assert.equal(sync.get(1).phase, "retrying");
  await f.advance(1000);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 2);
  for (let i = 0; i < 5; i++) await f.advance(15000);
  assert.equal(sync.get(1).phase, "error");
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 6);
  assert.equal(sync.get(1).dirty, true);
  f.intercept(null);
  await sync.retry(1);
  assert.equal(sync.get(1).phase, "saved");
  assert.equal(f.row("alice", "INTC", 1).state.chartType, "candle");
});

test("a concurrent device change stays intact and requires explicit conflict resolution", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  sync.update(1, { ...sync.get(1).state, name: "Local" });
  f.external("alice", "INTC", 1, {
    ...defaultChartWorkspaceState(),
    name: "Other device",
  });
  assert.equal(await sync.flush(1), false);
  assert.equal(sync.get(1).phase, "conflict");
  await f.advance(60000);
  assert.equal(f.row("alice", "INTC", 1).state.name, "Other device");
  assert.equal(sync.get(1).state.name, "Local");
  await sync.reset(1);
  assert.equal(sync.get(1).state.name, "Other device");
  assert.equal(sync.get(1).dirty, false);
});

test("clear waits for a previous write and cannot be resurrected by its queued successor", async () => {
  const f = fixture(),
    sync = f.make(),
    gate = deferred();
  await sync.load();
  let first = true;
  f.intercept(async ({ method }) => {
    if (method === "PUT" && first) {
      first = false;
      await gate.promise;
    }
  });
  sync.update(1, { ...sync.get(1).state, drawings: [drawing] });
  const pending = sync.flush(1);
  sync.update(1, { ...sync.get(1).state, name: "Queued" });
  const clearing = sync.reset(1, true);
  gate.resolve();
  await pending;
  await clearing;
  await f.advance(1000);
  assert.equal(f.row("alice", "INTC", 1).state, null);
  assert.equal(sync.get(1).dirty, false);
  assert.deepEqual(
    f.calls.filter((c) => c.method !== "GET").map((c) => c.method),
    ["PUT", "DELETE"],
  );
});

test("an account change stops pending retries before they can use the next user's session", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  sync.update(1, { ...sync.get(1).state, name: "Alice only" });
  f.owner("bob");
  sync.pause();
  await f.advance(1000);
  assert.equal(await sync.flushAll(), false);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
  f.owner("alice");
  sync.resume();
  await f.advance(0);
  assert.equal(f.row("alice", "INTC", 1).state.name, "Alice only");
  assert.equal(f.row("bob", "INTC", 1).state, null);
});

test("unavailable local storage retains an unload guard only while changes need saving", async () => {
  const f = fixture(),
    sync = f.make("alice", "INTC", {
      storage: {
        getItem: () => null,
        setItem: () => {
          throw Error("Quota");
        },
      },
    });
  await sync.load();
  sync.update(1, { ...sync.get(1).state, scale: "log" });
  assert.equal(sync.needsUnloadWarning(), true);
  await sync.flushAll();
  assert.equal(sync.needsUnloadWarning(), false);
});

test("one conflicted slot does not prevent other slots flushing on page exit", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  sync.update(1, { ...sync.get(1).state, name: "Local conflict" });
  f.external("alice", "INTC", 1, {
    ...defaultChartWorkspaceState(),
    name: "Remote",
  });
  await sync.flush(1);
  sync.update(2, { ...sync.get(2).state, name: "Safe second slot" });
  assert.equal(await sync.flushAll(), false);
  assert.equal(f.row("alice", "INTC", 2).state.name, "Safe second slot");
});

test("repeated unresolved 409s stop instead of creating an unbounded write loop", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  f.intercept(({ method }) => {
    if (method === "PUT")
      throw Object.assign(Error("Conflict"), { status: 409 });
  });
  sync.update(1, { ...sync.get(1).state, name: "Still local" });
  assert.equal(await sync.flush(1), false);
  assert.equal(sync.get(1).phase, "error");
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 6);
});

test("edits and navigation during backoff retain the retry and save the newest state", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  f.intercept(({ method }) => {
    if (method === "PUT")
      throw Object.assign(Error("Unavailable"), { status: 503 });
  });
  sync.update(1, { ...sync.get(1).state, name: "Before outage" });
  await sync.flush(1);
  assert.equal(sync.get(1).phase, "retrying");
  sync.update(1, { ...sync.get(1).state, name: "Edited during outage" });
  await sync.flush(1);
  await f.advance(350);
  assert.equal(sync.get(1).phase, "retrying");
  f.intercept(null);
  await f.advance(650);
  assert.equal(sync.get(1).phase, "saved");
  assert.equal(f.row("alice", "INTC", 1).state.name, "Edited during outage");
});

test("live clean updates and clears notify the view without generating echo writes", async () => {
  const f = fixture(),
    sync = f.make(),
    events = [];
  await sync.load();
  sync.subscribe((event) => events.push(event));
  const saved = { ...sync.get(1).state, drawings: [drawing] };
  f.external("alice", "INTC", 1, saved);
  sync.receive([f.row("alice", "INTC", 1)]);
  assert.deepEqual(sync.get(1).state, saved);
  f.external("alice", "INTC", 1, null);
  sync.receive([f.row("alice", "INTC", 1)]);
  assert.deepEqual(sync.get(1).state.drawings, []);
  assert.equal(sync.get(1).phase, "saved");
  await f.advance(1000);
  assert.equal(f.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(events.filter((e) => e.type === "remote").length, 2);
});

test("live updates merge unsaved independent changes and ignore late older snapshots", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  const original = sync.get(1).state;
  sync.update(1, { ...original, drawings: [drawing] });
  f.external("alice", "INTC", 1, { ...original, scale: "log" });
  const old = copy(f.row("alice", "INTC", 1));
  sync.receive([old]);
  assert.equal(sync.get(1).state.scale, "log");
  assert.equal(sync.get(1).state.drawings.length, 1);
  await sync.flush(1);
  sync.receive([old]);
  assert.deepEqual(sync.get(1).state, f.row("alice", "INTC", 1).state);
  assert.equal(sync.get(1).revision, 2);
});

test("remote updates wait for a gesture to finish then merge its final position", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  sync.update(1, { ...sync.get(1).state, drawings: [drawing] });
  await sync.flush(1);
  const before = sync.get(1).state,
    release = sync.hold(1);
  f.external("alice", "INTC", 1, { ...before, indicators: ["rsi"] });
  sync.receive([f.row("alice", "INTC", 1)]);
  assert.deepEqual(sync.get(1).state.indicators, before.indicators);
  sync.update(1, {
    ...before,
    drawings: [
      {
        ...drawing,
        anchors: [{ time: 1700000000, price: 22 }, drawing.anchors[1]],
      },
    ],
  });
  release();
  await sync.flush(1);
  assert.deepEqual(sync.get(1).state.indicators, ["rsi"]);
  assert.equal(sync.get(1).state.drawings[0].anchors[0].price, 22);
});

test("updates received while a write is in flight reconcile after its acknowledgment", async () => {
  const f = fixture(),
    sync = f.make(),
    gate = deferred();
  await sync.load();
  const before = sync.get(1).state;
  let first = true;
  f.intercept(async ({ method }) => {
    if (method === "PUT" && first) {
      first = false;
      await gate.promise;
    }
  });
  sync.update(1, { ...before, drawings: [drawing] });
  const flushing = sync.flush(1);
  f.external("alice", "INTC", 1, { ...before, scale: "log" });
  sync.receive([f.row("alice", "INTC", 1)]);
  gate.resolve();
  await flushing;
  assert.equal(sync.get(1).state.scale, "log");
  assert.equal(sync.get(1).state.drawings.length, 1);
  assert.equal(sync.get(1).phase, "saved");
});

test("same-field conflicts retain both versions and Keep both uses an empty slot", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  const before = sync.get(1).state;
  sync.update(1, { ...before, name: "Mine" });
  f.external("alice", "INTC", 1, { ...before, name: "Theirs" });
  sync.receive([f.row("alice", "INTC", 1)]);
  assert.equal(sync.get(1).phase, "conflict");
  assert.deepEqual(sync.get(1).conflicts, ["Name"]);
  assert.equal(sync.revisions()[0], 1);
  const result = await sync.keepBoth(1);
  assert.equal(result.slot, 2);
  assert.equal(result.state.name, "Mine · Copy");
  assert.equal(sync.get(1).state.name, "Theirs");
  assert.equal(f.row("alice", "INTC", 1).state.name, "Theirs");
});

test("Keep both cannot overwrite a slot taken by another device during the copy", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  const before = sync.get(1).state;
  sync.update(1, { ...before, name: "Mine" });
  f.external("alice", "INTC", 1, { ...before, name: "Theirs" });
  sync.receive([f.row("alice", "INTC", 1)]);
  f.intercept(({ method, slot }) => {
    if (method === "PUT" && slot === 2)
      f.external("alice", "INTC", 2, { ...before, name: "Newer" });
  });
  await assert.rejects(sync.keepBoth(1), { status: 409 });
  assert.equal(f.row("alice", "INTC", 2).state.name, "Newer");
  assert.equal(sync.get(1).state.name, "Mine");
  assert.equal(sync.get(1).phase, "conflict");
});

test("a newer deletion tombstone also protects an initially empty slot from resurrection", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  sync.update(1, { ...sync.get(1).state, drawings: [drawing] });
  f.external("alice", "INTC", 1, {
    ...defaultChartWorkspaceState(),
    name: "Created elsewhere",
  });
  f.external("alice", "INTC", 1, null);
  sync.receive([f.row("alice", "INTC", 1)]);
  assert.equal(sync.get(1).phase, "conflict");
  assert.deepEqual(sync.get(1).conflicts, ["Cleared analysis"]);
  assert.equal(await sync.flushAll(), false);
  assert.equal(f.row("alice", "INTC", 1).state, null);
});

test("resolving from an older read cannot replace a newer revision already received live", async () => {
  const f = fixture(),
    sync = f.make();
  await sync.load();
  const release = sync.hold(1);
  sync.receive([
    {
      slot: 1,
      revision: 2,
      state: { ...defaultChartWorkspaceState(), name: "Newest known" },
    },
  ]);
  // The fixture's read still returns revision zero, simulating a delayed GET.
  await sync.reset(1);
  release();
  assert.equal(sync.get(1).revision, 2);
  assert.equal(sync.get(1).state.name, "Newest known");
});
