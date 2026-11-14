import { test } from "node:test";
import assert from "node:assert/strict";
import { createViewportState, mountViewport } from "../src/shared/viewport.js";

const portrait = {
  width: 390,
  height: 844,
  visibleWidth: 390,
  visibleHeight: 844,
  scale: 1,
  editing: false,
  touch: true,
  hasVisualViewport: true,
};

test("keyboard detection survives Safari focus transfer and closes after viewport recovery", () => {
  const measure = createViewportState();
  assert.equal(measure(portrait).keyboard, false);
  assert.equal(
    measure({ ...portrait, editing: true, visibleHeight: 500 }).keyboard,
    true,
  );
  assert.equal(measure({ ...portrait, visibleHeight: 500 }).keyboard, true);
  assert.equal(measure({ ...portrait, visibleHeight: 780 }).keyboard, false);
  assert.equal(measure(portrait).keyboard, false);
});

test("pinch zoom and browser toolbars do not hide navigation as a keyboard", () => {
  const measure = createViewportState();
  measure(portrait);
  assert.equal(
    measure({ ...portrait, editing: true, visibleHeight: 760 }).keyboard,
    false,
  );
  const zoom = measure({
    ...portrait,
    editing: true,
    visibleHeight: 422,
    visibleWidth: 195,
    scale: 2,
    top: 60,
    left: 25,
  });
  assert.equal(zoom.keyboard, false);
  assert.equal(zoom.width, 195);
  assert.equal(zoom.top, 60);
  assert.equal(zoom.left, 25);
  assert.equal(zoom.inset, 0);
  assert.equal(measure({ ...portrait, editing: true }).keyboard, false);
});

test("iPad keyboards are detected regardless of desktop-class viewport width", () => {
  const measure = createViewportState();
  const ipad = {
    ...portrait,
    width: 1024,
    height: 1366,
    visibleWidth: 1024,
    visibleHeight: 1366,
  };
  measure(ipad);
  assert.equal(
    measure({ ...ipad, editing: true, visibleHeight: 900 }).keyboard,
    true,
  );
  assert.equal(measure({ ...ipad, editing: true }).keyboard, false);
});

test("hardware keyboards and desktops retain navigation without an occluded viewport", () => {
  const measure = createViewportState();
  measure(portrait);
  assert.equal(measure({ ...portrait, editing: true }).keyboard, false);
  assert.equal(
    measure({ ...portrait, editing: true, touch: false, visibleHeight: 400 })
      .keyboard,
    false,
  );
  assert.equal(
    measure({
      ...portrait,
      editing: true,
      hasVisualViewport: false,
      visibleHeight: 400,
    }).keyboard,
    false,
  );
});

test("rotation discards portrait baseline and supports the shorter landscape keyboard", () => {
  const measure = createViewportState();
  measure(portrait);
  measure({ ...portrait, editing: true, visibleHeight: 500 });
  const landscape = {
    ...portrait,
    width: 844,
    height: 390,
    visibleWidth: 844,
    visibleHeight: 390,
    editing: true,
  };
  assert.equal(measure(landscape).keyboard, false);
  const open = measure({ ...landscape, visibleHeight: 235, top: 20 });
  assert.equal(open.keyboard, true);
  assert.equal(open.inset, 135);
  assert.equal(measure({ ...landscape, editing: false }).keyboard, false);
});

test("a viewport which resizes both layout and visual dimensions retains its focus baseline", () => {
  const measure = createViewportState();
  measure(portrait);
  assert.equal(
    measure({ ...portrait, editing: true, height: 500, visibleHeight: 500 })
      .keyboard,
    true,
  );
  assert.equal(
    measure({ ...portrait, editing: false, height: 500, visibleHeight: 500 })
      .keyboard,
    true,
  );
  assert.equal(measure(portrait).keyboard, false);
});

test("staggered Safari rotation dimensions cannot leave keyboard chrome hidden", () => {
  const measure = createViewportState();
  measure(portrait);
  measure({ ...portrait, editing: true, visibleHeight: 500 });
  const intermediate = {
    ...portrait,
    width: 844,
    height: 844,
    visibleWidth: 844,
    visibleHeight: 235,
    editing: true,
  };
  assert.equal(measure(intermediate).inset, 155);
  assert.equal(measure(intermediate).inset, 155);
  const settled = measure({
    ...intermediate,
    height: 390,
    visibleHeight: 390,
    editing: false,
  });
  assert.equal(settled.keyboard, false);
  assert.equal(settled.inset, 0);
});

test("a wide split-screen resize eventually uses its actual height", () => {
  let time = 0;
  const measure = createViewportState({ now: () => time });
  measure(portrait);
  const wide = { ...portrait, width: 844, visibleWidth: 844 };
  assert.equal(measure(wide).keyboard, false);
  time = 1300;
  measure(wide);
  assert.equal(
    measure({ ...wide, editing: true, visibleHeight: 500 }).keyboard,
    true,
  );
});

function environment() {
  const listeners = new Map(),
    frames = new Map(),
    styles = new Map(),
    classes = new Set();
  let id = 0;
  const eventTarget = (name) => ({
    addEventListener(type, handler) {
      listeners.set(`${name}:${type}`, handler);
    },
    removeEventListener(type) {
      listeners.delete(`${name}:${type}`);
    },
  });
  const html = {
    style: {
      getPropertyValue: (name) => styles.get(name) || "",
      getPropertyPriority: () => "",
      setProperty: (name, value) => styles.set(name, value),
      removeProperty: (name) => styles.delete(name),
    },
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  const viewport = {
    ...eventTarget("viewport"),
    width: 390,
    height: 844,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
  };
  const win = {
    ...eventTarget("window"),
    innerWidth: 390,
    innerHeight: 844,
    visualViewport: viewport,
    navigator: { maxTouchPoints: 5 },
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame(callback) {
      frames.set(++id, callback);
      return id;
    },
    cancelAnimationFrame(key) {
      frames.delete(key);
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
      disconnect() {}
    },
  };
  const doc = {
    ...eventTarget("document"),
    documentElement: html,
    defaultView: win,
    activeElement: null,
  };
  const root = { ownerDocument: doc, querySelector: () => null };
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((fn) => fn());
  };
  return {
    root,
    doc,
    win,
    viewport,
    listeners,
    frames,
    styles,
    classes,
    flush,
  };
}

test("auth publishes visible viewport bounds, coalesces events and restores ownership on destroy", () => {
  const env = environment();
  env.styles.set("--visual-viewport-height", "100dvh");
  const controller = mountViewport(env.root);
  env.flush();
  assert.equal(env.styles.get("--visual-viewport-height"), "844px");
  env.doc.activeElement = { matches: () => true };
  env.viewport.height = 480;
  env.viewport.offsetTop = 35;
  env.listeners.get("document:focusin")();
  env.listeners.get("viewport:resize")();
  env.listeners.get("viewport:scroll")();
  assert.equal(env.frames.size, 1);
  env.flush();
  assert.equal(env.styles.get("--visual-viewport-height"), "480px");
  assert.equal(env.styles.get("--visual-viewport-top"), "35px");
  assert.equal(env.classes.has("keyboard-open"), true);
  controller.refresh();
  controller.destroy();
  assert.equal(env.listeners.size, 0);
  assert.equal(env.frames.size, 0);
  assert.equal(env.styles.get("--visual-viewport-height"), "100dvh");
  assert.equal(env.styles.has("--visual-viewport-top"), false);
  assert.equal(env.classes.has("keyboard-open"), false);
  controller.refresh();
  assert.equal(env.frames.size, 0);
});
