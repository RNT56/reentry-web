import { test } from "node:test";
import assert from "node:assert/strict";
import {
  zoomChartView,
  panChartView,
  panChartPlane,
  mountChartGestures,
} from "../src/features/charts/chart-gestures.js";

const view = { length: 251, from: 50, to: 149 };

test("zoom keeps the pointed observation anchored within rounding precision", () => {
  for (const anchor of [0, 0.2, 0.5, 0.8, 1]) {
    const result = zoomChartView(view, 0.6, anchor);
    assert.ok(Math.abs(result.to - result.from + 1 - 60) < 1e-10);
    assert.ok(
      Math.abs(result.from + anchor * 59 - (view.from + anchor * 99)) < 1e-10,
    );
  }
});

test("zoom and pan stay bounded, preserve inclusive counts, and stop at minimum scale", () => {
  assert.deepEqual(zoomChartView(view, 1000), { from: 0, to: 250 });
  assert.deepEqual(zoomChartView({ length: 8, from: 0, to: 7 }, 0.01), {
    from: 0,
    to: 7,
  });
  assert.equal(
    zoomChartView(view, 0.001).to - zoomChartView(view, 0.001).from + 1,
    12,
  );
  assert.deepEqual(panChartView(view, -1000), { from: -49.5, to: 49.5 });
  assert.deepEqual(panChartView(view, 1000), { from: 200.5, to: 299.5 });
  assert.deepEqual(panChartView({ length: 251, from: 0, to: 250 }, 15), {
    from: 15,
    to: 265,
  });
  assert.deepEqual(zoomChartView(view, NaN), { from: 50, to: 149 });
  assert.deepEqual(panChartView(view, Infinity), { from: 50, to: 149 });
});

test("viewport math remains bounded for repeated extreme zooms and pans", () => {
  let current = { length: 251, from: 0, to: 250 };
  for (let i = 0; i < 500; i++) {
    current = {
      ...current,
      ...zoomChartView(current, i % 2 ? 1.23 : 0.78, (i % 11) / 10),
    };
    current = { ...current, ...panChartView(current, (i % 21) - 10) };
    const span = current.to - current.from;
    assert.ok(
      current.from >= -span / 2 - 1e-8 &&
        current.to <= current.length - 1 + span / 2 + 1e-8,
    );
    assert.ok(span + 1 >= 12 - 1e-8);
    assert.ok(Number.isFinite(current.from) && Number.isFinite(current.to));
  }
});

function harness(overrides = {}, options = {}) {
  const handlers = new Map(),
    captures = new Set(),
    frames = new Map();
  let nextFrame = 0;
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const plot = {
    classList: { toggle() {}, remove() {}, add() {} },
    querySelector: () => ({
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1000,
        height: 500,
      }),
    }),
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: (type) => handlers.delete(type),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
  };
  let current = {
    ...view,
    W: 1000,
    H: 500,
    L: 0,
    R: 1000,
    T: 0,
    B: 500,
    low: 80,
    high: 120,
    ...overrides,
  };
  const starts = [],
    changes = [],
    ends = [],
    resets = [],
    interactions = [];
  const controller = mountChartGestures(plot, {
    ...options,
    getView: () => current,
    onResetAxis: (axis) => resets.push(axis),
    onInteraction: (active) => interactions.push(active),
    onStart: (value) => starts.push(value),
    onChange: (value) => {
      current = { ...current, ...value };
      changes.push(value);
    },
    onEnd: (value) => ends.push(value),
  });
  return {
    controller,
    resets,
    interactions,
    current: () => current,
    starts,
    changes,
    ends,
    captures,
    event(type, values = {}) {
      const event = {
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: 500,
        clientY: 200,
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        target: { closest: () => null },
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopImmediatePropagation() {
          this.stopped = true;
        },
        ...values,
      };
      handlers.get(type)?.(event);
      return event;
    },
    flush() {
      const work = [...frames.values()];
      frames.clear();
      for (const fn of work) fn();
    },
    close() {
      controller.destroy();
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}

test("a chart drag batches rendering, captures its pointer and commits one transaction", () => {
  const h = harness();
  try {
    h.event("pointerdown", { clientX: 300 });
    assert.ok(h.controller.isActive());
    assert.equal(h.starts.length, 0);
    h.event("pointermove", { clientX: 400 });
    h.event("pointermove", { clientX: 500 });
    assert.equal(h.changes.length, 0);
    h.flush();
    assert.equal(h.changes.length, 1);
    assert.deepEqual(h.changes[0], {
      from: 30.2,
      to: 129.2,
      priceRange: { min: 80, max: 120 },
    });
    h.event("pointerup", { clientX: 500 });
    assert.equal(h.starts.length, 1);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].changed, true);
    assert.equal(h.ends[0].cancelled, false);
    assert.equal(h.captures.size, 0);
  } finally {
    h.close();
  }
});

test("vertical touch motion pans the chart and saves one gesture", () => {
  const h = harness();
  try {
    h.event("pointerdown", { pointerType: "touch" });
    const event = h.event("pointermove", {
      pointerType: "touch",
      clientX: 500,
      clientY: 230,
    });
    assert.ok(event.defaultPrevented && event.stopped);
    assert.equal(h.controller.isActive(), true);
    h.event("pointerup", { pointerType: "touch", clientY: 230 });
    assert.equal(h.starts.length, 1);
    assert.equal(h.ends.length, 1);
    assert.deepEqual(h.current().priceRange, { min: 82.4, max: 122.4 });
    assert.equal(h.current().from, view.from);
    assert.equal(h.current().to, view.to);
  } finally {
    h.close();
  }
});

test("pinch zooms only the chart and cancellation reports a single rollback", () => {
  const h = harness();
  try {
    h.event("pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 400,
    });
    const second = h.event("pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 600,
    });
    assert.ok(second.defaultPrevented && second.stopped);
    h.event("pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 800,
    });
    h.flush();
    assert.equal(h.changes[0].to - h.changes[0].from + 1, 50);
    h.event("pointercancel", { pointerId: 1, pointerType: "touch" });
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].cancelled, true);
    assert.equal(h.captures.size, 0);
  } finally {
    h.close();
  }
});

test("wheel zoom is anchored, grouped until finish and ignores drawing targets for pointer drags", () => {
  const h = harness();
  try {
    h.event("pointerdown", {
      target: { closest: () => ({ dataset: { drawing: "personal" } }) },
    });
    assert.equal(h.controller.isActive(), false);
    const event = h.event("wheel", {
      deltaY: -150,
      ctrlKey: true,
      clientX: 100,
    });
    assert.ok(event.defaultPrevented && event.stopped);
    h.flush();
    h.event("wheel", { deltaY: -50, clientX: 100 });
    h.controller.finish();
    assert.equal(h.starts.length, 1);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].cancelled, false);
    assert.ok(h.ends[0].view.to - h.ends[0].view.from + 1 < 100);
  } finally {
    h.close();
  }
});

test("zooming out at the full range never creates an undo transaction", () => {
  const h = harness();
  try {
    h.event("wheel", { deltaY: 2000 });
    h.controller.finish();
    // One bounded step caps wheel acceleration; complete the zoom first.
    for (let i = 0; i < 4; i++) {
      h.event("wheel", { deltaY: 2000 });
      h.controller.finish();
    }
    const starts = h.starts.length,
      ends = h.ends.length;
    h.event("wheel", { deltaY: 2000 });
    h.controller.finish();
    assert.equal(h.starts.length, starts);
    assert.equal(h.ends.length, ends);
    assert.equal(h.controller.isActive(), false);
  } finally {
    h.close();
  }
});

const axes = {
  L: 10,
  R: 924,
  T: 16,
  B: 468,
  low: 80,
  high: 120,
  priceRange: null,
};

test("price axis drags scale only price, batch frames, and commit a single undo/save transaction", () => {
  const h = harness(axes);
  try {
    const down = h.event("pointerdown", { clientX: 950 });
    assert.ok(down.defaultPrevented && down.stopped);
    assert.deepEqual(h.interactions, [true]);
    assert.equal(h.starts.length, 0);
    h.event("pointermove", { clientX: 700, clientY: 160 });
    h.event("pointermove", { clientX: 600, clientY: 100 });
    h.flush();
    assert.equal(h.changes.length, 1);
    assert.equal(h.current().from, view.from);
    assert.equal(h.current().to, view.to);
    const range = h.current().priceRange;
    assert.ok(range.max - range.min < 40);
    assert.equal((range.min + range.max) / 2, 100);
    h.event("pointerup");
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].changed, true);
    assert.equal(h.captures.size, 0);
    assert.equal(h.interactions.at(-1), false);
  } finally {
    h.close();
  }
});

test("time axis drag anchors the latest visible bar and retains manual price range", () => {
  const priceRange = { min: 90, max: 110 };
  const h = harness({ ...axes, priceRange });
  try {
    h.event("pointerdown", { clientX: 500, clientY: 485 });
    h.event("pointermove", { clientX: 680, clientY: 600 });
    h.event("pointerup");
    assert.equal(h.current().to, view.to);
    assert.equal(h.current().to - h.current().from + 1, 37);
    assert.deepEqual(h.current().priceRange, priceRange);
    assert.equal(h.ends.length, 1);
  } finally {
    h.close();
  }
});

test("axis scaling works with a drawing tool selected; no-op clicks and right-clicks never save", () => {
  const h = harness(axes, { enabled: () => false, axesEnabled: () => true });
  try {
    h.event("pointerdown", { clientX: 950, button: 2 });
    assert.equal(h.controller.isActive(), false);
    h.event("pointerdown", { clientX: 950 });
    h.event("pointerup");
    assert.equal(h.ends.length, 0);
    h.event("pointerdown", { clientX: 950 });
    h.event("pointermove", { clientX: 950, clientY: 300 });
    h.event("pointerup");
    assert.equal(h.ends.length, 1);
    assert.ok(h.current().priceRange.max - h.current().priceRange.min > 40);
  } finally {
    h.close();
  }
});

test("axis cancellation reports rollback; double-click resets only its axis", () => {
  const h = harness(axes);
  try {
    h.event("pointerdown", { clientX: 950 });
    h.event("pointermove", { clientX: 950, clientY: 100 });
    h.flush();
    h.event("lostpointercapture");
    assert.equal(h.ends[0].cancelled, true);
    assert.equal(h.ends[0].initial.priceRange, null);
    assert.equal(h.captures.size, 0);
    h.event("dblclick", { clientX: 950 });
    h.event("dblclick", { clientY: 485 });
    h.event("dblclick", { clientX: 500 });
    h.event("dblclick", { clientX: 950, clientY: 485 });
    assert.deepEqual(h.resets, ["price", "time"]);
  } finally {
    h.close();
  }
});

test("disabled axes do not capture input or reset views", () => {
  const h = harness(axes, { enabled: () => false });
  try {
    assert.ok(!h.event("pointerdown", { clientX: 950 }).defaultPrevented);
    h.event("dblclick", { clientX: 950 });
    assert.equal(h.controller.isActive(), false);
    assert.deepEqual(h.resets, []);
  } finally {
    h.close();
  }
});

test("diagonal panning follows pixel deltas without whole-bar snapping or price rescaling", () => {
  const g = { ...view, L: 10, R: 1000, T: 10, B: 410, low: 80, high: 120 };
  assert.deepEqual(panChartPlane(g, 1.25, 5.5), {
    from: 49.875,
    to: 148.875,
    priceRange: { min: 80.55, max: 120.55 },
  });
  const shifted = panChartPlane(
    { ...g, priceRange: { min: 90, max: 110 } },
    0,
    -20,
  );
  assert.deepEqual(shifted.priceRange, { min: 89, max: 109 });
});

test("touches outside the price canvas and simple taps leave the view and page scrolling alone", () => {
  const h = harness();
  try {
    assert.ok(
      !h.event("pointerdown", { clientY: 550, pointerType: "touch" })
        .defaultPrevented,
    );
    assert.equal(h.controller.isActive(), false);
    h.event("pointerdown", { pointerType: "touch" });
    h.event("pointerup", { pointerType: "touch" });
    assert.equal(h.ends.length, 0);
    assert.equal(h.captures.size, 0);
    assert.equal(h.interactions.at(-1), false);
  } finally {
    h.close();
  }
});

test("touch drag, pinch and remaining-finger drag share one save with no transition jump", () => {
  const h = harness();
  try {
    h.event("pointerdown", { pointerType: "touch", clientX: 400 });
    h.event("pointermove", {
      pointerType: "touch",
      clientX: 450,
      clientY: 250,
    });
    // Join before the scheduled render: this pending frame must become the pinch base.
    h.event("pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 650,
      clientY: 250,
    });
    assert.deepEqual(h.current().priceRange, { min: 84, max: 124 });
    const before = structuredClone(h.current());
    h.event("pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 650,
      clientY: 250,
    });
    h.flush();
    assert.deepEqual(h.current(), before);
    h.event("pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 750,
      clientY: 300,
    });
    h.event("pointerup", { pointerId: 2, pointerType: "touch" });
    const after = structuredClone(h.current());
    h.event("pointermove", {
      pointerType: "touch",
      clientX: 450,
      clientY: 250,
    });
    h.flush();
    assert.deepEqual(h.current(), after);
    h.event("pointermove", {
      pointerType: "touch",
      clientX: 450,
      clientY: 275,
    });
    h.event("pointerup", { pointerType: "touch" });
    assert.ok(h.current().priceRange.min > after.priceRange.min);
    assert.equal(h.starts.length, 1);
    assert.equal(h.ends.length, 1);
    assert.equal(h.captures.size, 0);
  } finally {
    h.close();
  }
});

test("cancelled two-axis drag preserves its original price and time state for rollback", () => {
  const h = harness();
  try {
    h.event("pointerdown");
    h.event("pointermove", { clientX: 550, clientY: 250 });
    h.flush();
    h.event("pointercancel");
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].cancelled, true);
    assert.equal(h.ends[0].initial.from, view.from);
    assert.equal(h.ends[0].initial.priceRange, undefined);
    assert.equal(h.captures.size, 0);
  } finally {
    h.close();
  }
});
