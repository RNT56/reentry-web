import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mountReorder,
  reorderHandle,
  reorderedKeys,
} from "../src/shared/reorder.js";

class FakeNode {
  constructor(doc, tag = "div", classes = []) {
    this.ownerDocument = doc;
    this.tagName = tag;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.values = new Map();
    this.animations = [];
    this.classes = new Set(classes);
    this.isConnected = true;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientWidth = 220;
    this.clientHeight = 240;
    this.scrollWidth = 220;
    this.scrollHeight = 240;
    this.overflowX = "visible";
    this.overflowY = "visible";
    this.classList = {
      add: (...values) => values.forEach((v) => this.classes.add(v)),
      remove: (...values) => values.forEach((v) => this.classes.delete(v)),
      contains: (value) => this.classes.has(value),
      toggle: (value, force) => {
        const add = force ?? !this.classes.has(value);
        if (add) this.classes.add(value);
        else this.classes.delete(value);
      },
    };
    this.style = {
      setProperty: (key, value) => this.values.set(key, value),
      removeProperty: (key) => this.values.delete(key),
    };
  }
  append(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  insertBefore(child, reference) {
    if (child === reference) return child;
    if (child.parentElement)
      child.parentElement.children.splice(
        child.parentElement.children.indexOf(child),
        1,
      );
    const index = reference
      ? this.children.indexOf(reference)
      : this.children.length;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    child.parentElement = this;
    return child;
  }
  get nextSibling() {
    return (
      this.parentElement?.children[
        this.parentElement.children.indexOf(this) + 1
      ] || null
    );
  }
  remove() {
    this.parentElement?.children.splice(
      this.parentElement.children.indexOf(this),
      1,
    );
    this.parentElement = null;
    this.isConnected = false;
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }
  matches(selector) {
    return selector.split(",").some((part) => {
      part = part.trim();
      if (part.startsWith(".")) return this.classes.has(part.slice(1));
      if (part.startsWith("["))
        return this.attributes.has(part.slice(1, -1).split("=")[0]);
      return this.tagName === part;
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement)
      if (node.matches(selector)) return node;
    return null;
  }
  contains(target) {
    return (
      this === target || this.children.some((node) => node.contains(target))
    );
  }
  querySelectorAll(selector) {
    return this.children.flatMap((node) => [
      ...(node.matches(selector) ? [node] : []),
      ...node.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }
  removeEventListener(type) {
    this.listeners.delete(type);
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  scrollIntoView() {
    this.scrolledIntoView = true;
  }
  getBoundingClientRect() {
    const index = this.parentElement?.children.indexOf(this) || 0;
    let left = 0,
      top = 100,
      width = 220,
      height = 240;
    if (this.classes.has("item")) {
      height = 80;
      if (this.ownerDocument.axis === "x") {
        left = index * 220 - this.parentElement.scrollLeft;
        width = 200;
      } else top = 100 + index * 80 - this.parentElement.scrollTop;
      left += parseFloat(this.values.get("--reorder-x") || "0");
      top += parseFloat(this.values.get("--reorder-y") || "0");
    }
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }
  animate(frames, options) {
    const animation = {
      frames,
      options,
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
      finished: new Promise(() => {}),
    };
    this.animations.push(animation);
    return animation;
  }
  getAnimations() {
    return this.animations;
  }
  setPointerCapture(id) {
    this.capture = id;
  }
  hasPointerCapture(id) {
    return this.capture === id;
  }
  releasePointerCapture() {
    this.capture = null;
  }
}
function fixture({
  axis = "y",
  reduced = false,
  onReorder,
  disabled = () => false,
} = {}) {
  let frameId = 0,
    timerId = 0;
  const frames = new Map(),
    timers = new Map(),
    winListeners = new Map(),
    calls = [],
    errors = [];
  const doc = {
    axis,
    activeElement: null,
    listeners: new Map(),
    createElement: (tag) => new FakeNode(doc, tag),
    hasFocus: () => true,
    addEventListener(type, fn) {
      this.listeners.set(type, fn);
    },
    removeEventListener(type) {
      this.listeners.delete(type);
    },
    querySelector: () => null,
  };
  const win = {
    innerHeight: 800,
    innerWidth: 1000,
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: (node) => ({
      overflowX: node.overflowX,
      overflowY: node.overflowY,
    }),
    requestAnimationFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, fn) => winListeners.set(type, fn),
    removeEventListener: (type) => winListeners.delete(type),
  };
  doc.defaultView = win;
  doc.documentElement = new FakeNode(doc);
  doc.body = doc.documentElement.append(new FakeNode(doc));
  doc.scrollingElement = doc.body;
  doc.body.clientHeight = 800;
  doc.body.scrollHeight = 2400;
  const root = doc.body.append(new FakeNode(doc, "div", ["list"]));
  const group = ["a", "b", "c"].map((id) => {
    const item = root.append(new FakeNode(doc, "div", ["item"]));
    item.id = id;
    const activation = item.append(new FakeNode(doc, "button", ["activation"]));
    const handle = item.append(new FakeNode(doc, "button", ["reorder-handle"]));
    handle.setAttribute("data-reorder-handle", "");
    handle.setAttribute("aria-label", "Reorder " + id);
    const remove = item.append(new FakeNode(doc, "button", ["holding-remove"]));
    return { item, activation, handle, remove };
  });
  const controller = mountReorder(root, {
    itemSelector: ".item",
    key: (item) => item.id,
    activationSelector: ".activation",
    axis: () => doc.axis,
    onReorder: (order) => {
      calls.push(order);
      return onReorder?.(order);
    },
    onError: (error) => errors.push(error),
    disabled,
  });
  return {
    root,
    doc,
    win,
    group,
    calls,
    errors,
    controller,
    frames,
    winListeners,
    order: () => root.children.map((node) => node.id),
    announce: () => doc.body.children.at(-1).textContent,
    emit(where, type, options = {}) {
      const event = {
        target: group[0].handle,
        button: 0,
        pointerId: 1,
        isPrimary: true,
        pointerType: "mouse",
        clientX: 12,
        clientY: 120,
        detail: 1,
        preventDefault() {
          this.prevented = true;
        },
        stopImmediatePropagation() {
          this.stopped = true;
        },
        ...options,
      };
      where.listeners.get(type)?.(event);
      return event;
    },
    step(now = 1000) {
      const batch = [...frames.values()];
      frames.clear();
      for (const fn of batch) fn(now);
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("grip labels are escaped and pure reorder preserves keys without mutation", () => {
  assert.match(
    reorderHandle("Reorder <A&B>"),
    /aria-label="Reorder &lt;A&amp;B&gt;"/,
  );
  const original = ["a", "b", "c"];
  assert.deepEqual(reorderedKeys(original, 0, 2), ["b", "c", "a"]);
  assert.deepEqual(original, ["a", "b", "c"]);
  assert.deepEqual(reorderedKeys(original, -1, 2), original);
});

test("keyboard lift, move and drop retain focus and commit exactly once", async () => {
  const h = fixture();
  try {
    h.emit(h.root, "keydown", { key: " " });
    h.emit(h.root, "keydown", { key: "End" });
    assert.deepEqual(h.order(), ["b", "c", "a"]);
    assert.equal(h.calls.length, 0);
    assert.equal(h.doc.activeElement, h.group[0].handle);
    h.emit(h.root, "keydown", { key: "Enter" });
    assert.deepEqual(h.calls, [["b", "c", "a"]]);
    assert.match(h.announce(), /Placed a, position 3 of 3/);
    assert.equal(h.group[0].item.classes.has("reorder-is-dragging"), false);
    await settle();
  } finally {
    h.controller.destroy();
  }
});

test("Escape restores original siblings; unchanged drops never persist", () => {
  const h = fixture();
  try {
    h.emit(h.root, "keydown", { key: "Enter" });
    h.emit(h.root, "keydown", { key: "ArrowDown" });
    h.emit(h.root, "keydown", { key: "Escape" });
    assert.deepEqual(h.order(), ["a", "b", "c"]);
    assert.equal(h.calls.length, 0);
    h.emit(h.root, "keydown", { key: "Enter" });
    h.emit(h.root, "keydown", { key: "Enter" });
    assert.equal(h.calls.length, 0);
  } finally {
    h.controller.destroy();
  }
});

test("normal clicks, delete controls and touches outside the grip retain native behavior", () => {
  const h = fixture();
  try {
    h.emit(h.root, "pointerdown", { target: h.group[0].activation });
    h.emit(h.doc, "pointermove", {
      target: h.group[0].activation,
      clientY: 123,
    });
    h.emit(h.doc, "pointerup", { target: h.group[0].activation });
    assert.ok(
      !h.emit(h.root, "click", { target: h.group[0].activation }).prevented,
    );
    for (const options of [
      { target: h.group[0].remove },
      { target: h.group[0].activation, pointerType: "touch" },
    ]) {
      h.emit(h.root, "pointerdown", options);
      h.emit(h.doc, "pointermove", { ...options, clientY: 350 });
      h.emit(h.doc, "pointerup", options);
      assert.deepEqual(h.order(), ["a", "b", "c"]);
    }
    assert.equal(h.calls.length, 0);
  } finally {
    h.controller.destroy();
  }
});

test("desktop activation drag moves a live item, suppresses its synthetic click and preserves the next click", async () => {
  const h = fixture();
  try {
    h.emit(h.root, "pointerdown", { target: h.group[0].activation });
    assert.ok(
      h.emit(h.doc, "pointermove", {
        target: h.group[0].activation,
        clientY: 350,
      }).prevented,
    );
    assert.deepEqual(h.order(), ["b", "c", "a"]);
    assert.equal(h.root.capture, 1);
    h.emit(h.doc, "pointerup", { clientY: 350 });
    assert.equal(h.root.capture, null);
    assert.ok(
      h.emit(h.root, "click", { target: h.group[1].activation }).stopped,
    );
    await settle();
    h.emit(h.root, "pointerdown", { target: h.group[1].activation });
    h.emit(h.doc, "pointerup", { target: h.group[1].activation });
    assert.ok(
      !h.emit(h.root, "click", { target: h.group[1].activation }).stopped,
    );
    assert.deepEqual(h.calls, [["b", "c", "a"]]);
  } finally {
    h.controller.destroy();
  }
});

test("touch grip drag cancels cleanly on pointer cancellation or navigation", () => {
  const h = fixture();
  try {
    h.emit(h.root, "pointerdown", { pointerType: "touch" });
    h.emit(h.doc, "pointermove", { pointerType: "touch", clientY: 350 });
    h.emit(h.doc, "pointercancel", { pointerType: "touch" });
    assert.deepEqual(h.order(), ["a", "b", "c"]);
    assert.equal(h.root.capture, null);
    assert.equal(h.frames.size, 0);
    h.emit(h.root, "keydown", { key: "Enter" });
    h.emit(h.root, "keydown", { key: "End" });
    h.winListeners.get("popstate")();
    assert.deepEqual(h.order(), ["a", "b", "c"]);
    assert.equal(h.calls.length, 0);
  } finally {
    h.controller.destroy();
  }
});

test("horizontal keyboard order adapts to the current rail axis and reduced motion skips FLIP", () => {
  const h = fixture({ axis: "x", reduced: true });
  try {
    h.emit(h.root, "keydown", { key: "Enter" });
    h.emit(h.root, "keydown", { key: "ArrowRight" });
    assert.deepEqual(h.order(), ["b", "a", "c"]);
    assert.equal(h.group[1].item.animations.length, 0);
    h.controller.cancel();
    assert.deepEqual(h.order(), ["a", "b", "c"]);
  } finally {
    h.controller.destroy();
  }
});

test("edge scrolling is bounded to the rail before the viewport and cleanup cancels its frame", () => {
  const h = fixture();
  try {
    h.root.overflowY = "auto";
    h.root.scrollHeight = 600;
    h.emit(h.root, "pointerdown");
    h.emit(h.doc, "pointermove", { clientY: 330 });
    h.step();
    assert.ok(h.root.scrollTop > 0 && h.root.scrollTop <= 13);
    assert.equal(h.doc.body.scrollTop, 0);
    h.root.scrollTop = 359;
    h.step(1017);
    assert.equal(h.root.scrollTop, 360);
    h.controller.cancel();
    assert.equal(h.frames.size, 0);
  } finally {
    h.controller.destroy();
  }
});

test("async persistence errors are announced without independently reverting host order", async () => {
  const h = fixture({ onReorder: () => Promise.reject(Error("offline")) });
  try {
    h.emit(h.root, "keydown", { key: "Enter" });
    h.emit(h.root, "keydown", { key: "End" });
    h.emit(h.root, "keydown", { key: "Enter" });
    await settle();
    assert.deepEqual(h.order(), ["b", "c", "a"]);
    assert.equal(h.errors.length, 1);
    assert.match(h.announce(), /could not be saved/);
  } finally {
    h.controller.destroy();
  }
});

test("disabled interactions and destroy leave no global listeners, live region or frames", () => {
  const h = fixture({ disabled: () => true });
  h.emit(h.root, "keydown", { key: "Enter" });
  h.emit(h.root, "keydown", { key: "End" });
  assert.deepEqual(h.order(), ["a", "b", "c"]);
  h.controller.destroy();
  assert.equal(h.doc.listeners.size, 0);
  assert.equal(h.winListeners.size, 0);
  assert.equal(h.frames.size, 0);
  assert.equal(h.doc.body.children.length, 1);
  assert.equal(h.root.listeners.size, 0);
});

test("Escape cancels a pointer drag even when focus left the moved item", () => {
  const h = fixture();
  try {
    h.emit(h.root, "pointerdown");
    h.emit(h.doc, "pointermove", { clientY: 350 });
    h.doc.activeElement = h.doc.body;
    const event = h.emit(h.doc, "keydown", {
      target: h.doc.body,
      key: "Escape",
    });
    assert.ok(event.prevented && event.stopped);
    h.emit(h.doc, "pointerup", { clientY: 350 });
    assert.deepEqual(h.order(), ["a", "b", "c"]);
    assert.equal(h.calls.length, 0);
  } finally {
    h.controller.destroy();
  }
});

test("native image dragging is suppressed and sibling entrance animations stop before lift", () => {
  const h = fixture();
  try {
    const entrances = h.group.map(({ item }) => item.animate([], {}));
    h.emit(h.root, "pointerdown", { target: h.group[0].activation });
    assert.ok(
      h.emit(h.root, "dragstart", { target: h.group[0].activation }).prevented,
    );
    h.emit(h.doc, "pointermove", {
      target: h.group[0].activation,
      clientY: 350,
    });
    assert.ok(entrances.every((animation) => animation.cancelled));
  } finally {
    h.controller.destroy();
  }
});
