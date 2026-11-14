/* Nested top-layer surfaces share one page freeze and restore it once. */
const locks = new WeakMap();
const remember = (element, names) =>
  names.map((name) => [
    name,
    element.style.getPropertyValue(name),
    element.style.getPropertyPriority(name),
  ]);
function restore(element, snapshot) {
  for (const [name, value, priority] of snapshot) {
    if (value) element.style.setProperty(name, value, priority);
    else element.style.removeProperty(name);
  }
}
export function acquireScrollLock(doc) {
  let state = locks.get(doc);
  if (!state) {
    const win = doc.defaultView,
      html = doc.documentElement,
      body = doc.body;
    state = {
      count: 0,
      win,
      x: win.scrollX || 0,
      y: win.scrollY || 0,
      html: remember(html, ["overflow", "scrollbar-gutter"]),
      body: remember(body, ["position", "top", "left", "width", "overflow"]),
    };
    locks.set(doc, state);
    html.style.setProperty("overflow", "hidden");
    html.style.setProperty("scrollbar-gutter", "stable");
    body.style.setProperty("position", "fixed");
    body.style.setProperty("top", `${-state.y}px`);
    body.style.setProperty("left", `${-state.x}px`);
    body.style.setProperty("width", "100%");
    body.style.setProperty("overflow", "hidden");
  }
  state.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--state.count) return;
    locks.delete(doc);
    restore(doc.body, state.body);
    restore(doc.documentElement, state.html);
    state.win.scrollTo({ left: state.x, top: state.y, behavior: "instant" });
  };
}
