import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectMenuPlacement,
  revealSelectOption,
} from "../src/shared/controls.js";

const screen = { left: 0, top: 0, width: 390, height: 844 };
const anchor = { left: 18, right: 372, top: 350, bottom: 398, width: 354 };
function inside(menu, viewport, safe = {}) {
  assert.ok(menu.left >= viewport.left + 8 + (safe.left || 0));
  assert.ok(menu.top >= viewport.top + 8 + (safe.top || 0));
  assert.ok(
    menu.left + menu.width <=
      viewport.left + viewport.width - 8 - (safe.right || 0),
  );
  assert.ok(
    menu.top + menu.height <=
      viewport.top + viewport.height - 8 - (safe.bottom || 0),
  );
}
test("select menus stay within portrait and notched landscape visible viewports", () => {
  const portrait = selectMenuPlacement(anchor, screen, 650, { bottom: 34 });
  inside(portrait, screen, { bottom: 34 });
  assert.equal(portrait.visible, true);
  const landscape = { left: 0, top: 0, width: 844, height: 390 };
  const edgeAnchor = {
    left: 730,
    right: 830,
    top: 240,
    bottom: 284,
    width: 100,
  };
  const safe = { left: 47, right: 47, bottom: 21 };
  inside(
    selectMenuPlacement(edgeAnchor, landscape, 500, safe),
    landscape,
    safe,
  );
});
test("keyboard pan offsets and very small visible areas never force an 80px overflow", () => {
  const keyboard = { left: 10, top: 240, width: 320, height: 110 };
  const near = { left: 20, right: 300, top: 270, bottom: 314, width: 280 };
  const menu = selectMenuPlacement(near, keyboard, 500);
  inside(menu, keyboard);
  assert.equal(menu.visible, true);
  const tiny = { left: 0, top: 100, width: 320, height: 60 };
  const tinyAnchor = {
    left: 20,
    right: 300,
    top: 112,
    bottom: 148,
    width: 280,
  };
  const tinyMenu = selectMenuPlacement(tinyAnchor, tiny, 500);
  inside(tinyMenu, tiny);
  assert.ok(tinyMenu.height <= 44);
});
test("an anchor obscured by the keyboard closes its floating menu", () => {
  const keyboard = { left: 0, top: 0, width: 390, height: 300 };
  assert.equal(selectMenuPlacement(anchor, keyboard, 500).visible, false);
});
test("revealing an active option only scrolls its own panel", () => {
  const panel = {
    scrollTop: 120,
    clientTop: 1,
    clientHeight: 150,
    getBoundingClientRect: () => ({ top: 100, bottom: 252 }),
  };
  const row = (top, bottom) => ({
    getBoundingClientRect: () => ({ top, bottom }),
    scrollIntoView: () =>
      assert.fail("Must not scroll page or dialog ancestors"),
  });
  revealSelectOption(panel, row(220, 264));
  assert.equal(panel.scrollTop, 133);
  revealSelectOption(panel, row(75, 119));
  assert.equal(panel.scrollTop, 107);
  revealSelectOption(panel, row(120, 164));
  assert.equal(panel.scrollTop, 107);
});
