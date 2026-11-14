import test from "node:test";
import assert from "node:assert/strict";
import { setAnimatedText, revealChart } from "../src/shared/motion.js";
function field(value = "1,00 €") {
  const calls = [];
  const element = {
    textContent: value,
    isConnected: true,
    closest: () => null,
    animate(frames, options) {
      calls.push({ textAtAnimation: this.textContent, frames, options });
      return { cancel() {} };
    },
  };
  return { element, calls };
}
test("number motion commits the latest formatted value before animation starts", () => {
  const { element, calls } = field();
  setAnimatedText(element, "2.538,64 €");
  assert.equal(element.textContent, "2.538,64 €");
  assert.equal(calls[0].textAtAnimation, "2.538,64 €");
  assert.ok(calls[0].options.duration <= 200);
  setAnimatedText(element, "7,12 €");
  assert.equal(element.textContent, "7,12 €");
  assert.equal(
    calls.length,
    1,
    "rapid chart scrubbing does not restart an animation for each sample",
  );
});
test("unchanged, loading and explicitly static values do not animate", () => {
  const unchanged = field();
  setAnimatedText(unchanged.element, unchanged.element.textContent);
  assert.equal(unchanged.calls.length, 0);
  const loading = field();
  loading.element.closest = () => ({});
  setAnimatedText(loading.element, "5,00 €");
  assert.equal(loading.element.textContent, "5,00 €");
  assert.equal(loading.calls.length, 0);
  const staticField = field();
  setAnimatedText(staticField.element, "6,00 €", { animate: false });
  assert.equal(staticField.calls.length, 0);
});
test("reduced motion keeps financial text current and suppresses chart reveal", () => {
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const { element, calls } = field();
    setAnimatedText(element, "123,45 €");
    revealChart(element);
    assert.equal(element.textContent, "123,45 €");
    assert.equal(calls.length, 0);
  } finally {
    if (previous) globalThis.matchMedia = previous;
    else delete globalThis.matchMedia;
  }
});
