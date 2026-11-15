import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createChartChanges } from "../server/chart-workspaces/changes.js";
import { createChartWatch } from "../src/features/charts/chart-watch.js";

test("chart wakeups isolate accounts and assets, bound connections and release on disconnect", async () => {
  const events = createChartChanges({ limit: 1 });
  const controller = new AbortController();
  let done = false;
  const pending = events
    .wait("a", "INTC", controller.signal)
    .then(() => (done = true));
  assert.throws(() => events.wait("a", "AAPL", new AbortController().signal), {
    statusCode: 429,
  });
  events.publish("b", "INTC");
  events.publish("a", "AAPL");
  await Promise.resolve();
  assert.equal(done, false);
  controller.abort();
  await pending;
  const next = events.wait("a", "INTC", new AbortController().signal);
  events.publish("a", "INTC");
  await next;
  const closing = events.wait("a", "AAPL", new AbortController().signal);
  events.close();
  await closing;
});

test("quiet chart subscriptions return periodically to catch restarts and missed events", async () => {
  const events = createChartChanges({ timeout: 5 });
  await Promise.all([
    events.wait("a", "INTC", new AbortController().signal),
    delay(10),
  ]);
  events.close();
});

test("live client uses owner-bound cursors, retries and ignores aborted old responses", async () => {
  const pending = [],
    timers = new Map(),
    received = [],
    connections = [];
  let timerId = 0,
    resumes = 0;
  const sync = {
    revisions: () => [3, 0, 1],
    receive: (slots) => received.push(slots),
    connection: (value) => connections.push(value),
    resume: () => resumes++,
  };
  const watch = createChartWatch({
    sync,
    ownerId: "alice",
    symbol: "INTC",
    request: (...args) =>
      new Promise((resolve, reject) => pending.push({ args, resolve, reject })),
    setTimer: (fn, ms) => {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  watch.start();
  watch.start();
  assert.equal(pending.length, 1);
  assert.match(pending[0].args[0], /revisions=3,0,1/);
  assert.equal(pending[0].args[3].ownerId, "alice");
  pending[0].reject(Error("offline"));
  await settle();
  assert.equal(connections.at(-1), "reconnecting");
  const retry = [...timers.values()][0];
  assert.equal(retry.ms, 1000);
  retry.fn();
  pending[1].resolve({ slots: [{ slot: 1, revision: 4 }] });
  await settle();
  assert.equal(received.length, 1);
  assert.equal(resumes, 1);
  assert.equal(connections.at(-1), "live");
  watch.stop();
  watch.start();
  const last = pending.at(-1);
  watch.stop();
  assert.equal(last.args[3].signal.aborted, true);
  last.resolve({ slots: [{ slot: 1, revision: 99 }] });
  await settle();
  assert.equal(received.length, 1);
});
