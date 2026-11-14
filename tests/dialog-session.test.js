import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireScrollLock } from "../src/shared/scroll-lock.js";
import {
  beginDialogSession,
  finishDialogSession,
  dialogFocusTarget,
} from "../src/shared/dialog-session.js";

function element() {
  const values = new Map(),
    classes = new Set();
  return {
    style: {
      getPropertyValue: (name) => values.get(name)?.value || "",
      getPropertyPriority: (name) => values.get(name)?.priority || "",
      setProperty: (name, value, priority = "") =>
        values.set(name, { value, priority }),
      removeProperty: (name) => values.delete(name),
    },
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
}
function fixture() {
  const calls = [],
    doc = { body: element(), documentElement: element() };
  doc.defaultView = {
    scrollX: 12,
    scrollY: 620,
    scrollTo: (position) => calls.push(position),
    matchMedia: () => ({ matches: false }),
  };
  const opener = {
    isConnected: true,
    closest: () => null,
    focus: (options) => calls.push({ focus: options }),
  };
  doc.activeElement = opener;
  const listeners = new Map(),
    fields = new Map();
  const dialog = {
    ownerDocument: doc,
    open: false,
    querySelector: (selector) => fields.get(selector) || null,
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  return {
    doc,
    dialog,
    calls,
    opener,
    fields,
    closeEvent: () => listeners.get("close")?.(),
  };
}

test("nested dialog and chart locks preserve original page until last release", () => {
  const { doc, calls } = fixture();
  doc.body.style.setProperty("position", "relative", "important");
  doc.body.style.setProperty("width", "80%");
  doc.documentElement.style.setProperty("overflow", "clip");
  const chart = acquireScrollLock(doc),
    modal = acquireScrollLock(doc);
  assert.equal(doc.body.style.getPropertyValue("position"), "fixed");
  assert.equal(doc.body.style.getPropertyValue("top"), "-620px");
  chart();
  chart();
  assert.equal(doc.body.style.getPropertyValue("position"), "fixed");
  assert.equal(calls.length, 0);
  modal();
  modal();
  assert.equal(doc.body.style.getPropertyValue("position"), "relative");
  assert.equal(doc.body.style.getPropertyPriority("position"), "important");
  assert.equal(doc.body.style.getPropertyValue("width"), "80%");
  assert.equal(doc.body.style.getPropertyValue("top"), "");
  assert.equal(doc.documentElement.style.getPropertyValue("overflow"), "clip");
  assert.deepEqual(calls, [{ left: 12, top: 620, behavior: "instant" }]);
});

test("replacing open modal keeps lock and original opener until final close", () => {
  const f = fixture();
  beginDialogSession(f.dialog);
  f.dialog.open = true;
  f.doc.activeElement = { isConnected: false };
  beginDialogSession(f.dialog);
  assert.equal(f.calls.length, 0);
  f.dialog.open = false;
  f.closeEvent();
  assert.equal(f.doc.documentElement.classList.contains("dialog-open"), false);
  assert.deepEqual(f.calls, [
    { left: 12, top: 620, behavior: "instant" },
    { focus: { preventScroll: true } },
  ]);
  finishDialogSession(f.dialog);
  assert.equal(f.calls.length, 2);
});

test("queued close event cannot unlock a newly opened replacement dialog", () => {
  const f = fixture();
  beginDialogSession(f.dialog);
  finishDialogSession(f.dialog);
  f.calls.length = 0;
  beginDialogSession(f.dialog);
  f.dialog.open = true;
  f.closeEvent();
  assert.equal(f.doc.body.style.getPropertyValue("position"), "fixed");
  assert.equal(f.doc.documentElement.classList.contains("dialog-open"), true);
  assert.deepEqual(f.calls, []);
  f.dialog.open = false;
  f.closeEvent();
  assert.equal(f.doc.body.style.getPropertyValue("position"), "");
});

test("touch dialogs avoid keyboard focus but honor explicit autofocus", () => {
  const f = fixture(),
    close = {},
    field = {},
    explicit = {};
  f.doc.defaultView.matchMedia = () => ({ matches: true });
  f.fields.set(".close", close);
  f.fields.set(
    "input:not([type=hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled])",
    field,
  );
  assert.equal(dialogFocusTarget(f.dialog), close);
  f.fields.set("[autofocus]:not([disabled])", explicit);
  assert.equal(dialogFocusTarget(f.dialog), explicit);
});

test("desktop dialogs focus first editable field; detached opener is not focused", () => {
  const f = fixture(),
    field = {};
  f.fields.set(
    "input:not([type=hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled])",
    field,
  );
  assert.equal(dialogFocusTarget(f.dialog), field);
  f.opener.isConnected = false;
  beginDialogSession(f.dialog);
  finishDialogSession(f.dialog);
  assert.deepEqual(f.calls, [{ left: 12, top: 620, behavior: "instant" }]);
});
