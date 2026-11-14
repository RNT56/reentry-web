/* Content stays visible without JavaScript. Motion is a short-lived enhancement,
   never layout state: no permanent opacity, transforms, or scroll listeners. */
export const surfaceMotionSelector = [
  ".portfolio-total",
  ".overview-secondary > div",
  ".holding-shell",
  ".planner .panel-head",
  ".sale-price-field",
  ".position-context",
  ".ceiling",
  ".settlement",
  ".result-empty",
  ".history-item",
  ".welcome h1",
  ".welcome-actions",
  ".page-title h1",
  ".workbench-heading h1",
  ".brief-summary",
  ".sentiment-block",
  ".claim",
  ".source-panel > .section-line",
  ".source-row",
  ".fundamentals-strip > div",
  ".run-row",
  ".research-empty",
  ".scenario-root",
  ".scenario-node",
  ".strategy-score",
  ".strategy-metrics > div",
  ".strategy-lenses > section",
  ".strategy-method",
  ".journal-public-card",
  ".studio-item",
  ".article-heading-fields",
  ".macro-heading h1",
  ".macro-focus",
  ".macro-row",
  ".settings-card",
  ".ai-budget",
  ".ai-connections",
  ".ai-controls",
  ".owner-heading",
  ".owner-census > div",
  ".owner-section",
  ".journal-cover-meta",
  ".journal-cover-signature",
  ".journal-story-meta",
  ".journal-story-rule",
  ".journal-entry-row",
  ".journal-prose > p",
  ".journal-prose > h2",
  ".journal-section-heading",
  ".journal-scenario",
  ".journal-source-list > a",
  ".journal-return",
  "[data-surface-reveal]",
].join(",");
const excluded =
  '.chart-fullscreen,.reorder-is-active,.reorder-is-dragging,nav,.app-header,.research-dock,.mobile-target-dock,.loading-surface,[aria-busy="true"],[hidden],[data-motion-static],.ta-plot,.ta-toolbar,.ta-active-row,.ta-tool-drawer,.price-history,.strategy-curve,.structure-chart,.macro-chart,.ai-analysis,.ai-analysis-detail,.select-menu,[role="dialog"]';
const staticDescendants =
  ".ta-plot,.price-history,.strategy-curve,.structure-chart,.macro-chart,.mobile-target-dock,thead,[data-motion-static]";
const installed = new WeakMap();
const noop = { destroy() {}, refresh() {} };
const elementNode = (node) =>
  node?.nodeType === 1 && typeof node.matches === "function";

function identity(element) {
  const parts = [];
  for (
    let node = element;
    node?.nodeType === 1 && parts.length < 7;
    node = node.parentElement
  ) {
    if (node.id) {
      parts.unshift("#" + node.id);
      break;
    }
    const classes = String(node.className || "")
      .split(/\s+/)
      .filter(
        (name) =>
          name && !/^(is-|selected$|on$|positive$|negative$)/.test(name),
      )
      .slice(0, 3)
      .join(".");
    const stable =
      ["data-holding", "data-scenario-key", "data-edit-article", "href"]
        .map((key) => node.getAttribute(key))
        .find(Boolean) ||
      (node.matches(".holding-shell")
        ? node.querySelector("[data-holding]")?.getAttribute("data-holding")
        : null);
    const position = node.parentElement
      ? [...node.parentElement.children].indexOf(node)
      : 0;
    parts.unshift(`${node.tagName}.${classes}:${stable || position}`);
  }
  return parts.join("/");
}

export function installSurfaceMotion(root = document) {
  if (installed.has(root)) return installed.get(root);
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const win = doc?.defaultView;
  if (!win?.IntersectionObserver || !win.MutationObserver || !win.matchMedia)
    return noop;
  const boundary = root.nodeType === 9 ? doc.body : root;
  if (!boundary) return noop;
  const preference = win.matchMedia("(prefers-reduced-motion: reduce)");
  const states = new Map(),
    seen = new Set(),
    changed = new Set();
  let frame = 0,
    suspended = false,
    disposed = false,
    context = "";
  const time = () => win.performance?.now() ?? Date.now();
  const inside = (element) =>
    element.isConnected && (root.nodeType === 9 || root.contains(element));
  function cancel(state) {
    state.animation?.cancel();
    state.animation = null;
  }
  function eligible(element) {
    if (!elementNode(element) || !inside(element) || element.closest(excluded))
      return false;
    if (
      element.namespaceURI === "http://www.w3.org/2000/svg" ||
      element.querySelector(staticDescendants)
    )
      return false;
    // Never transform a sticky surface or an ancestor which establishes its frame.
    const style = win.getComputedStyle(element);
    return (
      !["sticky", "fixed"].includes(style.position) &&
      style.display !== "contents"
    );
  }
  function animate(element, state, entering, delay = 0) {
    if (
      preference.matches ||
      !element.animate ||
      element.contains(doc.activeElement) ||
      !eligible(element)
    )
      return;
    cancel(state);
    const reading = element.matches(".journal-prose > p,.journal-prose > h2");
    const distance = reading ? 5 : 8;
    const frames = entering
      ? [
          {
            opacity: reading ? 0.72 : 0.58,
            transform: `translateY(${distance}px)`,
          },
          { opacity: 1, transform: "translateY(0)" },
        ]
      : [{ opacity: 1 }, { opacity: 0.72 }];
    try {
      const animation = element.animate(frames, {
        duration: entering ? (state.entered ? 300 : 430) : 140,
        delay: entering ? delay : 0,
        easing: entering ? "cubic-bezier(.16,.72,.24,1)" : "ease-out",
        // No fill: offscreen exits and aborted animations always restore real ink.
      });
      state.animation = animation;
      animation.finished
        ?.then(() => {
          if (state.animation === animation) state.animation = null;
        })
        .catch(() => {});
    } catch {
      /* Older engines retain the fully visible, static surface. */
    }
  }
  const intersection = new win.IntersectionObserver(
    (entries) => {
      let stagger = 0;
      const now = time();
      for (const entry of entries) {
        const state = states.get(entry.target);
        if (!state || !inside(entry.target)) continue;
        const firstObservation = !state.observed;
        state.observed = true;
        if (entry.isIntersecting) {
          if (!state.visible && !(firstObservation && state.suppressInitial)) {
            if (!state.entered || now - state.lastEntry > 650) {
              animate(entry.target, state, true, Math.min(stagger++, 5) * 32);
              state.lastEntry = now;
            }
          }
          state.entered = true;
          state.visible = true;
          seen.add(state.key);
          if (seen.size > 1000) seen.delete(seen.values().next().value);
        } else {
          const rect = entry.boundingClientRect;
          const height = win.innerHeight || doc.documentElement.clientHeight;
          // An exit may soften only after the complete surface left the reading area.
          if (state.visible && (rect.bottom <= 0 || rect.top >= height))
            animate(entry.target, state, false);
          state.visible = false;
        }
      }
    },
    { threshold: [0, 0.06], rootMargin: "0px 0px -20px 0px" },
  );
  function register(element) {
    if (states.has(element) || !eligible(element)) return;
    // Child content already travels with its selected card; never double-animate it.
    if (element.parentElement?.closest(surfaceMotionSelector)) return;
    const key = context + "|" + identity(element);
    states.set(element, {
      key,
      entered: false,
      observed: false,
      visible: false,
      suppressInitial: seen.has(key),
      lastEntry: -Infinity,
      animation: null,
    });
    intersection.observe(element);
  }
  function scan(node) {
    if (
      !elementNode(node) ||
      node.namespaceURI === "http://www.w3.org/2000/svg" ||
      node.closest(excluded)
    )
      return;
    if (node.matches(surfaceMotionSelector)) register(node);
    for (const element of node.querySelectorAll(surfaceMotionSelector))
      register(element);
  }
  function flush() {
    frame = 0;
    if (disposed || suspended) return;
    const nextContext = `${win.location?.pathname || ""}${win.location?.hash || ""}|${doc.querySelector('.intelligence-tabs [aria-current="page"]')?.getAttribute("data-tab") || ""}|${doc.querySelector(".asset-chip.selected")?.getAttribute("data-research-asset") || ""}`;
    if (context !== nextContext) {
      context = nextContext;
      seen.clear();
    }
    for (const [element, state] of states) {
      if (!inside(element)) {
        cancel(state);
        intersection.unobserve(element);
        states.delete(element);
      }
    }
    for (const node of changed) if (inside(node)) scan(node);
    changed.clear();
  }
  function schedule() {
    if (!disposed && !suspended && !frame)
      frame = win.requestAnimationFrame(flush);
  }
  function queue(node = boundary) {
    if (disposed || suspended) return;
    changed.add(node);
    schedule();
  }
  const mutations = new win.MutationObserver((records) => {
    let removed = false;
    for (const record of records) {
      if (record.target?.closest?.(excluded)) continue;
      removed ||= [...record.removedNodes].some(elementNode);
      for (const node of record.addedNodes)
        if (elementNode(node)) changed.add(node);
    }
    if (changed.size || removed) schedule();
  });
  function focus(event) {
    for (
      let node = event.target;
      node && node !== boundary.parentElement;
      node = node.parentElement
    ) {
      const state = states.get(node);
      if (state) {
        cancel(state);
        state.entered = true;
        state.visible = true;
        state.lastEntry = time();
        seen.add(state.key);
      }
    }
  }
  function preferenceChanged() {
    if (preference.matches) for (const state of states.values()) cancel(state);
  }
  function suspend() {
    suspended = true;
    mutations.disconnect();
    intersection.disconnect();
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    changed.clear();
    for (const state of states.values()) cancel(state);
    states.clear();
  }
  function resume() {
    if (disposed) return;
    suspended = false;
    mutations.observe(boundary, { childList: true, subtree: true });
    queue();
  }
  const controller = {
    refresh: queue,
    destroy() {
      if (disposed) return;
      suspend();
      disposed = true;
      boundary.removeEventListener("focusin", focus, true);
      preference.removeEventListener?.("change", preferenceChanged);
      win.removeEventListener("pagehide", suspend);
      win.removeEventListener("pageshow", resume);
      installed.delete(root);
      doc.documentElement.removeAttribute("data-surface-motion");
    },
  };
  installed.set(root, controller);
  doc.documentElement.setAttribute("data-surface-motion", "active");
  boundary.addEventListener("focusin", focus, true);
  preference.addEventListener?.("change", preferenceChanged);
  win.addEventListener("pagehide", suspend);
  win.addEventListener("pageshow", resume);
  resume();
  return controller;
}
