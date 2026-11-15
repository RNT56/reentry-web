import test from "node:test";
import assert from "node:assert/strict";
import { mergeChartStates } from "../src/domain/chart-merge.js";
import { defaultChartWorkspaceState } from "../src/domain/chart-workspace.js";

const line = (id, price = 10) => ({
  id,
  type: "horizontal",
  anchors: [{ time: 1700000000, price }],
});
const base = () => ({
  ...defaultChartWorkspaceState(),
  drawings: [line("a"), line("b")],
});

test("independent drawing moves, additions, labels and indicator toggles combine", () => {
  const b = base();
  const mine = {
    ...b,
    drawings: [{ ...line("a", 12), text: "Support" }, line("b")],
    indicators: ["sma20", "sma50", "rsi"],
  };
  const theirs = {
    ...b,
    drawings: [line("a"), line("b", 20), line("c")],
    indicators: ["sma50"],
  };
  const result = mergeChartStates(b, mine, theirs);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.state.drawings, [
    { ...line("a", 12), text: "Support" },
    line("b", 20),
    line("c"),
  ]);
  assert.deepEqual(result.state.indicators, ["sma50", "rsi"]);
});

test("deletion combines with unrelated edits but conflicts with moving the deleted line", () => {
  const b = base();
  const mine = { ...b, drawings: [line("b")] };
  assert.deepEqual(
    mergeChartStates(b, mine, { ...b, scale: "log" }).state.drawings,
    [line("b")],
  );
  assert.deepEqual(
    mergeChartStates(b, mine, { ...b, drawings: [line("a", 12), line("b")] })
      .conflicts,
    ["horizontal"],
  );
});

test("currency and drawing geometry are atomic, and time-window conflicts are explicit", () => {
  const b = base();
  const mine = { ...b, drawings: [line("a", 12), line("b")] };
  assert.deepEqual(
    mergeChartStates(b, mine, { ...b, currency: "USD" }).conflicts,
    ["Currency / drawings"],
  );
  assert.deepEqual(
    mergeChartStates(
      b,
      { ...b, range: "5y" },
      { ...b, viewport: { from: 1700000000, to: 1700864000 } },
    ).conflicts,
    ["Time window"],
  );
});

test("cleared analyses never silently resurrect and merged limits remain valid", () => {
  const b = base();
  assert.equal(mergeChartStates(b, b, null).state, null);
  assert.deepEqual(
    mergeChartStates(b, { ...b, name: "Mine" }, null).conflicts,
    ["Cleared analysis"],
  );
  const empty = defaultChartWorkspaceState();
  const many = (prefix) => ({
    ...empty,
    drawings: Array.from({ length: 25 }, (_, i) => line(prefix + i)),
  });
  assert.deepEqual(mergeChartStates(empty, many("a"), many("b")).conflicts, [
    "Drawing limit",
  ]);
});

test("independent time and price scaling merge while competing price edits require review", () => {
  const b = base();
  const priceRange = { min: 8, max: 18 };
  const viewport = { from: 1700000000, to: 1700864000 };
  const result = mergeChartStates(b, { ...b, priceRange }, { ...b, viewport });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.state.priceRange, priceRange);
  assert.deepEqual(result.state.viewport, viewport);
  for (const remote of [
    { ...b, priceRange: { min: 9, max: 20 } },
    { ...b, scale: "log" },
  ])
    assert.deepEqual(
      mergeChartStates(b, { ...b, priceRange }, remote).conflicts,
      ["Price scale"],
    );
  assert.deepEqual(
    mergeChartStates(b, { ...b, priceRange }, { ...b, currency: "USD" })
      .conflicts,
    ["Currency / drawings"],
  );
  const saved = { ...b, priceRange };
  assert.deepEqual(
    mergeChartStates(saved, b, { ...saved, priceRange: { min: 9, max: 20 } })
      .conflicts,
    ["Price scale"],
  );
});
