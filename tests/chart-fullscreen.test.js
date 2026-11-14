import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireScrollLock } from "../src/shared/scroll-lock.js";
import {
  mountChartFullscreen,
  closeChartFullscreen,
  isChartFullscreen,
} from "../src/shared/chart-fullscreen.js";

class Node {
  constructor(doc, tag = "div", id = "") {
    this.ownerDocument = doc;
    this.tagName = tag;
    this.id = id;
    this.children = [];
    this.parentElement = null;
    this.attrs = new Map();
    this.styles = new Map();
    this.listeners = new Map();
    this.className = "";
    this.isConnected = true;
    this._popover = false;
    this.showCount = 0;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => {
        this.className = [
          ...new Set([
            ...this.className.split(/\s+/).filter(Boolean),
            ...names,
          ]),
        ].join(" ");
      },
      remove: (...names) => {
        this.className = this.className
          .split(/\s+/)
          .filter((name) => !names.includes(name))
          .join(" ");
      },
    };
    this.style = {
      getPropertyValue: (name) => this.styles.get(name)?.[0] || "",
      getPropertyPriority: (name) => this.styles.get(name)?.[1] || "",
      setProperty: (name, value, priority = "") =>
        this.styles.set(name, [value, priority]),
      removeProperty: (name) => this.styles.delete(name),
    };
  }
  set hidden(value) {
    if (value) this.attrs.set("hidden", "");
    else this.attrs.delete("hidden");
  }
  get hidden() {
    return this.attrs.has("hidden");
  }
  set textContent(value) {
    this._text = value;
    this.textWrites = (this.textWrites || 0) + 1;
  }
  get textContent() {
    return this._text || "";
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      this.children.push(node);
      node.parentElement = this;
      node.isConnected = true;
    }
  }
  prepend(node) {
    node.remove();
    this.children.unshift(node);
    node.parentElement = this;
    node.isConnected = true;
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(
        (node) => node !== this,
      );
    this.parentElement = null;
  }
  contains(target) {
    return (
      this === target || this.children.some((node) => node.contains(target))
    );
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  hasAttribute(name) {
    return this.attrs.has(name);
  }
  removeAttribute(name) {
    this.attrs.delete(name);
  }
  matches(selector) {
    if (selector === ":popover-open") return this._popover;
    if (selector === ":disabled") return this.hasAttribute("disabled");
    return selector.split(",").some((part) => {
      part = part.trim();
      if (part.startsWith("#")) return this.id === part.slice(1);
      if (part.startsWith(".")) return this.classList.contains(part.slice(1));
      if (part.startsWith("[")) {
        const [, name, value] =
          part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]/) || [];
        return (
          name &&
          this.hasAttribute(name) &&
          (value === undefined || this.getAttribute(name) === value)
        );
      }
      return false;
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement)
      if (node.matches(selector)) return node;
    return null;
  }
  all() {
    return this.children.flatMap((node) => [node, ...node.all()]);
  }
  querySelectorAll(selector) {
    if (selector.startsWith("button:not("))
      return this.all().filter(
        (node) =>
          ["button", "input", "select", "textarea"].includes(node.tagName) ||
          node.hasAttribute("tabindex"),
      );
    return this.all().filter((node) => node.matches(selector));
  }
  querySelector(selector) {
    if (selector === "[popover]:popover-open")
      return this.all().find((node) => node._popover) || null;
    return this.querySelectorAll(selector)[0] || null;
  }
  getClientRects() {
    return this.closest('[hidden],[inert],[aria-hidden="true"]') ||
      (this.classList.contains("chart-fs-button") &&
        this.closest(".chart-fullscreen"))
      ? []
      : [{}];
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  showPopover() {
    this._popover = true;
    this.showCount++;
  }
  hidePopover() {
    this._popover = false;
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
    if (!this.listeners.get(type)?.size) this.listeners.delete(type);
  }
}
function fixture({
  popover = true,
  nativeMode = "none",
  native = false,
  beforeOpen,
  onChange,
} = {}) {
  const frames = new Map(),
    observers = [];
  let frame = 0,
    resolveNative;
  const doc = {
    listeners: new Map(),
    fullscreenElement: null,
    fullscreenEnabled: true,
    createElement: (tag) => new Node(doc, tag),
    addEventListener: Node.prototype.addEventListener,
    removeEventListener: Node.prototype.removeEventListener,
  };
  const win = {
    listeners: new Map(),
    scrollX: 37,
    scrollY: 420,
    innerWidth: 1200,
    innerHeight: 800,
    requestAnimationFrame: (callback) => {
      frames.set(++frame, callback);
      return frame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener: Node.prototype.addEventListener,
    removeEventListener: Node.prototype.removeEventListener,
    scrollTo(value) {
      this.scrollX = value.left;
      this.scrollY = value.top;
      this.lastScroll = value;
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  };
  win.visualViewport = {
    width: 390,
    height: 744,
    offsetTop: 12,
    offsetLeft: 0,
    listeners: new Map(),
    addEventListener: Node.prototype.addEventListener,
    removeEventListener: Node.prototype.removeEventListener,
  };
  doc.defaultView = win;
  doc.documentElement = new Node(doc, "html");
  doc.body = new Node(doc, "body");
  doc.documentElement.append(doc.body);
  doc.querySelectorAll = (selector) => doc.body.querySelectorAll(selector);
  const app = new Node(doc, "main", "app"),
    nav = new Node(doc, "nav"),
    wrapper = new Node(doc),
    root = new Node(doc, "section", "chart"),
    other = new Node(doc),
    modal = new Node(doc, "dialog", "modal"),
    toast = new Node(doc, "div", "toast");
  doc.body.append(app, modal, toast);
  app.append(nav, wrapper, other);
  wrapper.append(root);
  const originalFocus = new Node(doc, "button");
  nav.append(originalFocus);
  originalFocus.focus();
  let host = new Node(doc, "span");
  const field = new Node(doc, "input");
  root.append(host, field);
  if (!popover) {
    root.showPopover = undefined;
    root.hidePopover = undefined;
  }
  doc.querySelector = (selector) =>
    selector.startsWith("dialog[open]")
      ? modal.hasAttribute("open")
        ? modal
        : null
      : doc.body.querySelector(selector);
  doc.getElementById = (id) =>
    doc.body.all().find((node) => node.id === id) || null;
  function emit(target, type, options = {}) {
    const event = {
      target: field,
      key: "",
      preventDefault() {
        this.prevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...options,
    };
    for (const handler of [...(target.listeners.get(type) || [])]) {
      handler(event);
      if (event.stopped) break;
    }
    return event;
  }
  doc.nativeRequests = 0;
  doc.nativeExits = 0;
  if (nativeMode !== "none")
    doc.documentElement.requestFullscreen = () => {
      doc.nativeRequests++;
      if (nativeMode === "reject") return Promise.reject(Error("denied"));
      if (nativeMode === "deferred")
        return new Promise((resolve) => {
          resolveNative = () => {
            for (const node of doc.body.all()) node._popover = false;
            doc.fullscreenElement = doc.documentElement;
            emit(doc, "fullscreenchange");
            resolve();
          };
        });
      for (const node of doc.body.all()) node._popover = false;
      doc.fullscreenElement = doc.documentElement;
      emit(doc, "fullscreenchange");
      return Promise.resolve();
    };
  doc.exitFullscreen = () => {
    doc.nativeExits++;
    doc.fullscreenElement = null;
    emit(doc, "fullscreenchange");
    return Promise.resolve();
  };
  const transitions = [];
  let name = "INTC · Analysis";
  const controller = mountChartFullscreen(root, {
    label: () => name,
    buttonHost: () => host,
    native,
    beforeOpen,
    onChange: (value) => {
      transitions.push({ value, active: isChartFullscreen(root) });
      onChange?.(value);
    },
  });
  return {
    doc,
    win,
    app,
    nav,
    wrapper,
    root,
    other,
    modal,
    toast,
    field,
    originalFocus,
    controller,
    transitions,
    frames,
    observers,
    emit,
    get host() {
      return host;
    },
    header: () => root.querySelector(".chart-fs-header"),
    exit: () => root.querySelector(".chart-fs-exit"),
    step() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    },
    resolveNative: () => resolveNative?.(),
    repaint(value = "NVDA · Analysis") {
      name = value;
      for (const child of [...root.children]) child.remove();
      host = new Node(doc, "span");
      root.append(host, field);
      controller.refresh();
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("closing a chart beneath an open modal keeps the page frozen until the modal closes", () => {
  const h = fixture();
  let releaseModal;
  try {
    h.controller.open();
    releaseModal = acquireScrollLock(h.doc);
    h.modal.setAttribute("open", "");
    h.controller.close();
    assert.equal(h.doc.body.style.getPropertyValue("position"), "fixed");
    assert.equal(h.doc.body.style.getPropertyValue("top"), "-420px");
    assert.equal(h.win.lastScroll, undefined);
    h.modal.removeAttribute("open");
    releaseModal();
    assert.equal(h.doc.body.style.getPropertyValue("position"), "");
    assert.deepEqual(h.win.lastScroll, {
      left: 37,
      top: 420,
      behavior: "instant",
    });
  } finally {
    releaseModal?.();
    h.controller.destroy();
  }
});

test("keyboard viewport resizing updates the same expanded chart without restoring page scroll", () => {
  const h = fixture();
  try {
    h.controller.open();
    h.win.visualViewport.height = 320;
    h.win.visualViewport.offsetTop = 88;
    h.emit(h.win.visualViewport, "resize");
    h.emit(h.win.visualViewport, "scroll");
    h.step();
    assert.equal(h.controller.isActive(), true);
    assert.equal(h.root.contains(h.field), true);
    assert.equal(h.root.style.getPropertyValue("--chart-fs-vh"), "320px");
    assert.equal(h.root.style.getPropertyValue("--chart-fs-top"), "88px");
    assert.equal(h.win.lastScroll, undefined);
    h.win.visualViewport.height = 744;
    h.win.visualViewport.offsetTop = 0;
    h.emit(h.win.visualViewport, "resize");
    h.step();
    assert.equal(h.root.style.getPropertyValue("--chart-fs-vh"), "744px");
    assert.equal(h.transitions.length, 1);
  } finally {
    h.controller.destroy();
  }
});

test("fullscreen preserves the chart DOM, original attributes, inert state, focus and scroll", () => {
  const h = fixture();
  try {
    h.root.setAttribute("role", "region");
    h.root.setAttribute("aria-label", "Original chart");
    h.other.setAttribute("inert", "existing");
    h.root.style.setProperty("--chart-fs-vh", "88px", "important");
    const parent = h.root.parentElement;
    assert.equal(h.controller.open(), true);
    assert.equal(h.root.parentElement, parent);
    assert.equal(h.root.contains(h.field), true);
    assert.equal(h.root.getAttribute("popover"), "manual");
    assert.ok(h.root._popover);
    assert.equal(h.nav.hasAttribute("inert"), true);
    assert.equal(h.modal.hasAttribute("inert"), false);
    assert.equal(h.toast.hasAttribute("inert"), false);
    assert.equal(h.root.getAttribute("role"), "dialog");
    assert.equal(h.root.style.getPropertyValue("--chart-fs-vh"), "744px");
    assert.equal(h.doc.activeElement, h.exit());
    h.controller.close();
    assert.equal(h.root.getAttribute("popover"), null);
    assert.equal(h.root.getAttribute("role"), "region");
    assert.equal(h.root.getAttribute("aria-label"), "Original chart");
    assert.equal(h.root.style.getPropertyValue("--chart-fs-vh"), "88px");
    assert.equal(
      h.root.style.getPropertyPriority("--chart-fs-vh"),
      "important",
    );
    assert.equal(h.nav.hasAttribute("inert"), false);
    assert.equal(h.other.getAttribute("inert"), "existing");
    assert.equal(h.doc.activeElement, h.originalFocus);
    assert.deepEqual(h.win.lastScroll, {
      left: 37,
      top: 420,
      behavior: "instant",
    });
    assert.deepEqual(h.transitions, [
      { value: true, active: true },
      { value: false, active: false },
    ]);
  } finally {
    h.controller.destroy();
  }
});

test("fallback clears ancestor containing blocks temporarily and restores exact inline styles", () => {
  const h = fixture({ popover: false });
  try {
    h.wrapper.style.setProperty("transform", "translateY(8px)", "important");
    h.wrapper.style.setProperty("position", "sticky");
    h.controller.open();
    assert.ok(h.root.classList.contains("chart-fs-fallback"));
    assert.equal(h.wrapper.style.getPropertyValue("transform"), "none");
    h.controller.close();
    assert.equal(
      h.wrapper.style.getPropertyValue("transform"),
      "translateY(8px)",
    );
    assert.equal(h.wrapper.style.getPropertyPriority("transform"), "important");
    assert.equal(h.wrapper.style.getPropertyValue("position"), "sticky");
    assert.equal(h.app.style.getPropertyValue("position"), "");
  } finally {
    h.controller.destroy();
  }
});

test("Escape defers to tool dialogs and nested pickers; Tab stays inside the expanded chart", () => {
  const h = fixture();
  try {
    h.controller.open();
    h.modal.setAttribute("open", "");
    assert.ok(!h.emit(h.doc, "keydown", { key: "Escape" }).prevented);
    assert.ok(h.controller.isActive());
    h.modal.removeAttribute("open");
    const picker = new Node(h.doc);
    picker.setAttribute("popover", "manual");
    picker._popover = true;
    h.root.append(picker);
    assert.ok(!h.emit(h.doc, "keydown", { key: "Escape" }).prevented);
    assert.ok(h.controller.isActive());
    picker._popover = false;
    h.exit().focus();
    assert.ok(
      h.emit(h.doc, "keydown", { key: "Tab", shiftKey: true }).prevented,
    );
    assert.equal(h.doc.activeElement, h.field);
    h.emit(h.doc, "keydown", { key: "Escape" });
    assert.equal(h.controller.isActive(), false);
  } finally {
    h.controller.destroy();
  }
});

test("denied native fullscreen leaves the app layer usable without an error", async () => {
  const h = fixture({ native: true, nativeMode: "reject" });
  try {
    h.controller.open();
    await settle();
    assert.equal(h.doc.nativeRequests, 1);
    assert.ok(h.controller.isActive() && h.root._popover);
    assert.equal(h.doc.nativeExits, 0);
  } finally {
    h.controller.destroy();
  }
});

test("native transition restores the popover and native Escape restores the page", async () => {
  const h = fixture({ native: true, nativeMode: "success" });
  try {
    h.controller.open();
    await settle();
    h.step();
    assert.ok(h.root._popover);
    h.doc.fullscreenElement = null;
    h.emit(h.doc, "fullscreenchange");
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.nav.hasAttribute("inert"), false);
  } finally {
    h.controller.destroy();
  }
});

test("a late native promise cannot reopen a closed chart and exits only its own session", async () => {
  const h = fixture({ native: true, nativeMode: "deferred" });
  try {
    h.controller.open();
    h.controller.close();
    h.resolveNative();
    await settle();
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.doc.nativeExits, 1);
    assert.equal(h.doc.fullscreenElement, null);
    assert.equal(h.root.getAttribute("popover"), null);
  } finally {
    h.controller.destroy();
  }
});

test("pre-existing native fullscreen is never requested again or exited", async () => {
  const h = fixture({ native: true, nativeMode: "success" });
  try {
    h.doc.fullscreenElement = h.doc.documentElement;
    h.controller.open();
    h.controller.close();
    await settle();
    assert.equal(h.doc.nativeRequests, 0);
    assert.equal(h.doc.nativeExits, 0);
    assert.equal(h.doc.fullscreenElement, h.doc.documentElement);
  } finally {
    h.controller.destroy();
  }
});

test("retained charts survive transient detach and refresh restores header, host button and label after repaint", () => {
  const h = fixture();
  try {
    h.controller.open();
    const header = h.header();
    h.root.isConnected = false;
    h.root._popover = false;
    h.observers[0].callback([{ target: h.wrapper }]);
    h.root.isConnected = true;
    h.controller.refresh();
    h.step();
    assert.ok(h.controller.isActive() && h.root._popover);
    assert.equal(h.header(), header);
    h.repaint();
    assert.equal(h.header(), header);
    assert.equal(h.host.contains(h.controller.button), true);
    assert.equal(h.root.getAttribute("aria-label"), "NVDA · Analysis");
    const title = h.root.querySelector(".chart-fs-title"),
      writes = title.textWrites;
    h.controller.refresh();
    assert.equal(title.textWrites, writes);
    assert.equal(h.root.contains(h.field), true);
  } finally {
    h.controller.destroy();
  }
});

test("permanent removal closes and releases page guards after one frame", () => {
  const h = fixture();
  try {
    h.controller.open();
    h.root.isConnected = false;
    h.observers[0].callback([{ target: h.wrapper }]);
    assert.ok(h.controller.isActive());
    h.step();
    assert.equal(h.controller.isActive(), false);
    assert.equal(h.nav.hasAttribute("inert"), false);
  } finally {
    h.controller.destroy();
  }
});

test("toasts can appear above a top-layer chart and recover their original attributes", () => {
  const h = fixture();
  try {
    h.controller.open();
    h.toast.classList.add("show");
    h.observers[1].callback([]);
    h.step();
    assert.ok(h.toast._popover);
    assert.equal(h.toast.getAttribute("popover"), "manual");
    h.controller.close();
    assert.equal(h.toast.getAttribute("popover"), null);
    assert.equal(h.toast._popover, false);
    assert.ok(h.toast.classList.contains("show"));
  } finally {
    h.controller.destroy();
  }
});

test("only one chart is active; navigation and destroy restore guards and listeners", () => {
  const h = fixture();
  const second = new Node(h.doc);
  h.wrapper.append(second);
  const other = mountChartFullscreen(second, { label: "Second" });
  try {
    h.controller.open();
    other.open();
    assert.equal(h.controller.isActive(), false);
    assert.equal(other.isActive(), true);
    closeChartFullscreen(second);
    assert.equal(isChartFullscreen(second), false);
    h.controller.open();
    h.emit(h.win, "hashchange");
    assert.equal(h.controller.isActive(), false);
    h.controller.open();
    h.controller.destroy();
    other.destroy();
    assert.equal(h.doc.listeners.size, 0);
    assert.equal(h.win.listeners.size, 0);
    assert.equal(h.win.visualViewport.listeners.size, 0);
    assert.ok(h.observers.every((observer) => observer.disconnected));
    assert.equal(h.frames.size, 0);
    assert.equal(h.root.querySelector(".chart-fs-header"), null);
  } finally {
    h.controller.destroy();
    other.destroy();
  }
});

test("beforeOpen may cancel without changing layout or focus", () => {
  const h = fixture({ beforeOpen: () => false });
  try {
    assert.equal(h.controller.open(), false);
    assert.equal(h.root.getAttribute("popover"), null);
    assert.equal(h.doc.activeElement, h.originalFocus);
    assert.equal(h.doc.body.style.getPropertyValue("position"), "");
  } finally {
    h.controller.destroy();
  }
});

test("switching charts shares an in-flight native request so a second denial cannot orphan fullscreen", async () => {
  const h = fixture({ native: true, nativeMode: "deferred" });
  const secondRoot = new Node(h.doc);
  h.wrapper.append(secondRoot);
  const second = mountChartFullscreen(secondRoot, {
    label: "Second",
    native: true,
  });
  try {
    h.controller.open();
    h.controller.close();
    // A competing request would be denied on affected browsers. It must not run.
    h.doc.documentElement.requestFullscreen = () => {
      h.doc.nativeRequests++;
      return Promise.reject(Error("second request denied"));
    };
    second.open();
    assert.equal(h.doc.nativeRequests, 1);
    h.resolveNative();
    await settle();
    h.step();
    assert.ok(second.isActive());
    assert.equal(h.doc.fullscreenElement, h.doc.documentElement);
    second.close();
    await settle();
    assert.equal(h.doc.fullscreenElement, null);
    assert.equal(h.doc.nativeExits, 1);
  } finally {
    h.controller.destroy();
    second.destroy();
  }
});

test("notification actions participate in the chart focus loop", () => {
  const h = fixture();
  try {
    const action = new Node(h.doc, "button");
    h.toast.append(action);
    h.toast.classList.add("show");
    h.controller.open();
    action.focus();
    assert.ok(h.emit(h.doc, "keydown", { key: "Tab" }).prevented);
    assert.equal(h.doc.activeElement, h.exit());
    h.exit().focus();
    h.emit(h.doc, "keydown", { key: "Tab", shiftKey: true });
    assert.equal(h.doc.activeElement, action);
  } finally {
    h.controller.destroy();
  }
});

test("an app-only successor recovers when an older native request briefly hides its popover", async () => {
  const h = fixture({ native: true, nativeMode: "deferred" });
  const secondRoot = new Node(h.doc);
  h.wrapper.append(secondRoot);
  const second = mountChartFullscreen(secondRoot, { label: "App only" });
  try {
    h.controller.open();
    h.controller.close();
    second.open();
    h.resolveNative();
    await settle();
    h.step();
    assert.ok(second.isActive() && secondRoot._popover);
    assert.equal(h.doc.fullscreenElement, null);
  } finally {
    h.controller.destroy();
    second.destroy();
  }
});
