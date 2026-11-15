import { test } from "node:test";
import assert from "node:assert/strict";
import {
  installSurfaceMotion,
  surfaceMotionSelector,
} from "../src/shared/surface-motion.js";

class Surface {
  constructor(
    className = "",
    {
      selected = false,
      excluded = false,
      position = "static",
      chart = false,
    } = {},
  ) {
    this.nodeType = 1;
    this.tagName = "DIV";
    this.className = className;
    this.selected = selected;
    this.excluded = excluded;
    this.position = position;
    this.chart = chart;
    this.isConnected = true;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.animations = [];
    this.listeners = new Map();
    this.scans = 0;
  }
  append(child) {
    this.children.push(child);
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    return child;
  }
  matches(selector) {
    if (selector === surfaceMotionSelector) return this.selected;
    return (
      selector.startsWith(".journal-prose") && this.className === "passage"
    );
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector === surfaceMotionSelector ? node.selected : node.excluded)
        return node;
    }
    return null;
  }
  querySelector(selector) {
    return selector.includes(".ta-plot") && this.chart ? {} : null;
  }
  querySelectorAll(selector) {
    this.scans++;
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  contains(target) {
    return (
      this === target || this.children.some((child) => child.contains(target))
    );
  }
  getAttribute(key) {
    return this.attributes.get(key) || null;
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
  removeAttribute(key) {
    this.attributes.delete(key);
  }
  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }
  removeEventListener(type) {
    this.listeners.delete(type);
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
}
function fixture({ reduced = false } = {}) {
  const frames = new Map(),
    listeners = new Map();
  let next = 0,
    at = 1000,
    io,
    mo;
  const preference = {
    matches: reduced,
    addEventListener(_name, callback) {
      this.callback = callback;
    },
    removeEventListener() {
      this.callback = null;
    },
  };
  const win = {
    innerHeight: 800,
    location: { pathname: "/", hash: "#/explore" },
    performance: { now: () => at },
    getComputedStyle: (element) => ({
      position: element.position,
      display: "block",
    }),
    matchMedia: () => preference,
    requestAnimationFrame: (callback) => {
      const id = ++next;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    IntersectionObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.elements = new Set();
        io = this;
      }
      observe(element) {
        this.elements.add(element);
      }
      unobserve(element) {
        this.elements.delete(element);
      }
      disconnect() {
        this.elements.clear();
        this.disconnected = true;
      }
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        mo = this;
      }
      observe() {
        this.disconnected = false;
      }
      disconnect() {
        this.disconnected = true;
      }
    },
  };
  const html = new Surface(),
    body = new Surface();
  const doc = {
    nodeType: 9,
    defaultView: win,
    documentElement: html,
    body,
    querySelector: () => null,
    activeElement: null,
  };
  html.ownerDocument = doc;
  body.ownerDocument = doc;
  html.append(body);
  const surfaces = [
    body.append(new Surface("claim", { selected: true })),
    body.append(new Surface("source-row", { selected: true })),
  ];
  const controller = installSurfaceMotion(doc);
  return {
    doc,
    body,
    html,
    win,
    surfaces,
    controller,
    preference,
    frames,
    listeners,
    get io() {
      return io;
    },
    get mo() {
      return mo;
    },
    flush() {
      const batch = [...frames.values()];
      frames.clear();
      for (const fn of batch) fn();
    },
    enter(elements = surfaces) {
      io.callback(
        elements.map((target) => ({
          target,
          isIntersecting: true,
          boundingClientRect: { top: 200, bottom: 350 },
        })),
      );
    },
    leave(element, rect = { top: -200, bottom: -20 }) {
      io.callback([
        { target: element, isIntersecting: false, boundingClientRect: rect },
      ]);
    },
    advance(ms = 1000) {
      at += ms;
    },
    replace(old, replacement) {
      const index = body.children.indexOf(old);
      old.isConnected = false;
      body.children[index] = replacement;
      replacement.parentElement = body;
      replacement.ownerDocument = doc;
      mo.callback([
        { target: body, addedNodes: [replacement], removedNodes: [old] },
      ]);
    },
  };
}

test("asset query changes do not replay already-visible surfaces, but page navigation does", () => {
  const h = fixture();
  try {
    h.win.location.hash = "#/portfolio?asset=first";
    h.flush();
    h.enter();
    const next = new Surface("claim", { selected: true });
    h.win.location.hash = "#/portfolio?asset=second";
    h.replace(h.surfaces[0], next);
    h.flush();
    h.enter([next]);
    assert.equal(next.animations.length, 0);
    const another = new Surface("claim", { selected: true });
    h.win.location.hash = "#/explore";
    h.replace(next, another);
    h.flush();
    h.enter([another]);
    assert.equal(another.animations.length, 1);
  } finally {
    h.controller.destroy();
  }
});

test("content entry uses bounded stagger with no persistent hidden or transformed state", () => {
  const h = fixture();
  try {
    h.flush();
    h.enter();
    assert.equal(h.io.elements.size, 2);
    assert.equal(h.surfaces[0].animations.length, 1);
    assert.equal(h.surfaces[1].animations[0].options.delay, 32);
    for (const node of h.surfaces) {
      const animation = node.animations[0];
      assert.ok(animation.frames.every((frame) => frame.opacity > 0));
      assert.equal(animation.options.fill, undefined);
      assert.ok(animation.options.duration <= 450);
      assert.equal(node.getAttribute("style"), null);
    }
    assert.equal(installSurfaceMotion(h.doc), h.controller);
  } finally {
    h.controller.destroy();
  }
});

test("only completely offscreen content gets a soft exit and later re-entry", () => {
  const h = fixture();
  try {
    h.flush();
    h.enter([h.surfaces[0]]);
    h.leave(h.surfaces[0], { top: 780, bottom: 900 });
    assert.equal(h.surfaces[0].animations.length, 1);
    h.advance();
    h.enter([h.surfaces[0]]);
    h.leave(h.surfaces[0]);
    assert.equal(h.surfaces[0].animations.at(-1).options.duration, 140);
    assert.equal(h.surfaces[0].animations.at(-1).frames.at(-1).opacity, 0.72);
    h.advance();
    h.enter([h.surfaces[0]]);
    assert.equal(h.surfaces[0].animations.at(-1).options.duration, 300);
  } finally {
    h.controller.destroy();
  }
});

test("reduced motion skips entry and live preference changes cancel running effects", () => {
  const h = fixture({ reduced: true });
  try {
    h.flush();
    h.enter();
    assert.equal(h.surfaces[0].animations.length, 0);
    h.preference.matches = false;
    h.leave(h.surfaces[0]);
    h.advance();
    h.enter([h.surfaces[0]]);
    const animation = h.surfaces[0].animations.at(-1);
    assert.ok(animation);
    h.preference.matches = true;
    h.preference.callback();
    assert.equal(animation.cancelled, true);
  } finally {
    h.controller.destroy();
  }
});

test("keyboard focus immediately restores full surface ink and blocks later fading", () => {
  const h = fixture();
  try {
    h.flush();
    h.enter();
    const node = h.surfaces[0],
      button = node.append(new Surface("button"));
    h.doc.activeElement = button;
    h.body.listeners.get("focusin")({ target: button });
    assert.equal(node.animations[0].cancelled, true);
    h.leave(node);
    h.advance();
    h.enter([node]);
    assert.equal(node.animations.length, 1);
  } finally {
    h.controller.destroy();
  }
});

test("poll replacements retain visual identity; text quotes and chart redraws do not rescan content", () => {
  const h = fixture();
  try {
    h.flush();
    h.enter();
    const replacement = new Surface("source-row", { selected: true });
    h.replace(h.surfaces[1], replacement);
    h.flush();
    h.enter([replacement]);
    assert.equal(replacement.animations.length, 0);
    assert.equal(h.io.elements.has(h.surfaces[1]), false);
    assert.equal(h.surfaces[1].animations[0].cancelled, true);
    const scans = h.body.scans;
    h.mo.callback([
      {
        target: replacement,
        addedNodes: [{ nodeType: 3 }],
        removedNodes: [{ nodeType: 3 }],
      },
    ]);
    const plot = new Surface("ta-plot", { excluded: true });
    h.mo.callback([
      {
        target: plot,
        addedNodes: [new Surface("svg")],
        removedNodes: [new Surface("svg")],
      },
    ]);
    assert.equal(h.frames.size, 0);
    assert.equal(h.body.scans, scans);
    const appended = h.body.append(new Surface("claim", { selected: true }));
    h.mo.callback([
      { target: h.body, addedNodes: [appended], removedNodes: [] },
    ]);
    h.flush();
    h.enter([appended]);
    assert.equal(appended.animations.length, 1);
    assert.equal(h.body.scans, scans);
  } finally {
    h.controller.destroy();
  }
});

test("sticky surfaces, chart ancestors, hidden/loading content and nested surfaces are excluded", () => {
  const h = fixture();
  try {
    const sticky = h.body.append(
      new Surface("owner-section", { selected: true, position: "sticky" }),
    );
    const chart = h.body.append(
      new Surface("owner-section", { selected: true, chart: true }),
    );
    const loading = h.body.append(
      new Surface("claim", { selected: true, excluded: true }),
    );
    const nested = h.surfaces[0].append(
      new Surface("claim", { selected: true }),
    );
    h.flush();
    for (const node of [sticky, chart, loading, nested])
      assert.equal(h.io.elements.has(node), false);
    assert.equal(h.io.elements.size, 2);
  } finally {
    h.controller.destroy();
  }
});

test("page suspension and destroy release observers, pending frames and animations", () => {
  const h = fixture();
  h.flush();
  h.enter();
  h.listeners.get("pagehide")();
  assert.equal(h.mo.disconnected, true);
  assert.equal(h.io.elements.size, 0);
  assert.equal(h.surfaces[0].animations[0].cancelled, true);
  h.listeners.get("pageshow")();
  h.flush();
  assert.equal(h.io.elements.size, 2);
  h.controller.refresh();
  assert.equal(h.frames.size, 1);
  h.controller.destroy();
  assert.equal(h.frames.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.body.listeners.size, 0);
  assert.equal(h.html.getAttribute("data-surface-motion"), null);
});
