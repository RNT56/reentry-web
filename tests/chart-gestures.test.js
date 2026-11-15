import { test } from "node:test";
import assert from "node:assert/strict";
import {
  zoomChartView,
  panChartView,
  mountChartGestures,
} from "../src/features/charts/chart-gestures.js";

const view = { length: 251, from: 50, to: 149 };

test("zoom keeps the pointed observation anchored within rounding precision", () => {
  for (const anchor of [0, 0.2, 0.5, 0.8, 1]) {
    const result = zoomChartView(view, 0.6, anchor);
    assert.equal(result.to - result.from + 1, 60);
    assert.ok(
      Math.abs(result.from + anchor * 59 - (view.from + anchor * 99)) <= 0.5,
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
  assert.deepEqual(panChartView(view, -1000), { from: 0, to: 99 });
  assert.deepEqual(panChartView(view, 1000), { from: 151, to: 250 });
  assert.deepEqual(panChartView({ length: 251, from: 0, to: 250 }, 15), {
    from: 0,
    to: 250,
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
    assert.ok(current.from >= 0 && current.to < current.length);
    assert.ok(current.to - current.from + 1 >= 12);
    assert.ok(Number.isInteger(current.from) && Number.isInteger(current.to));
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
    assert.deepEqual(h.changes[0], { from: 30, to: 129 });
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

test("vertical touch motion preserves page scrolling and creates no chart transaction", () => {
  const h = harness();
  try {
    h.event("pointerdown", { pointerType: "touch" });
    const event = h.event("pointermove", {
      pointerType: "touch",
      clientX: 502,
      clientY: 230,
    });
    assert.ok(!event.defaultPrevented);
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.starts.length, 0);
    assert.equal(h.ends.length, 0);
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
