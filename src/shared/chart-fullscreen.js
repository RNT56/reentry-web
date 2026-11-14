/* A chart keeps its DOM, delegation, drawings and saved state while expanded. */
const activeCharts = new WeakMap();
const nativeRequests = new WeakMap();
const controls = new WeakMap();
const focusSelector =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const safePortals = "#modal,#toast,[data-fullscreen-portal]";
const expandIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg>';
const closeIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
const attributes = ["popover", "role", "aria-modal", "aria-label", "tabindex"];
const viewportProperties = [
  "--chart-fs-vw",
  "--chart-fs-vh",
  "--chart-fs-top",
  "--chart-fs-left",
];
function rememberStyles(element, names) {
  return names.map((name) => [
    name,
    element.style.getPropertyValue(name),
    element.style.getPropertyPriority(name),
  ]);
}
function restoreStyles(element, previous) {
  for (const [name, value, priority] of previous) {
    if (value) element.style.setProperty(name, value, priority);
    else element.style.removeProperty(name);
  }
}
const popoverOpen = (element) => {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
};
export function closeChartFullscreen(root) {
  controls.get(root)?.close();
}
export function isChartFullscreen(root) {
  return !!controls.get(root)?.isActive();
}

export function mountChartFullscreen(
  root,
  {
    label = "Chart",
    buttonHost = root,
    onChange = () => {},
    beforeOpen = () => {},
    native = false,
  } = {},
) {
  controls.get(root)?.destroy();
  const doc = root.ownerDocument,
    win = doc.defaultView,
    html = doc.documentElement;
  const viewport = win.visualViewport;
  let active = false,
    disposed = false,
    frame = 0,
    generation = 0;
  let snapshot = null,
    mode = null,
    savedFocus = null,
    scroll = null,
    request = null,
    nativeOwned = false;
  let toastSnapshot = null;
  let inertNodes = new Map(),
    ancestorStyles = [],
    scrollStyles = [];
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "chart-fs-button";
  button.innerHTML = expandIcon;
  const header = doc.createElement("header");
  header.className = "chart-fs-header";
  header.hidden = true;
  const title = doc.createElement("span");
  title.className = "chart-fs-title";
  const exit = doc.createElement("button");
  exit.type = "button";
  exit.className = "chart-fs-exit";
  exit.innerHTML = closeIcon;
  exit.setAttribute("aria-label", "Exit chart fullscreen");
  exit.title = "Exit fullscreen";
  header.append(title, exit);
  const text = () => String(typeof label === "function" ? label() : label);
  const modalOpen = () =>
    !!doc.querySelector(
      'dialog[open],[role="dialog"][aria-modal="true"]:not(.chart-fullscreen)',
    );
  const nestedPopover = () => {
    try {
      return !!root.querySelector("[popover]:popover-open");
    } catch {
      return false;
    }
  };
  function updateViewport() {
    if (!active) return;
    root.style.setProperty(
      "--chart-fs-vw",
      `${viewport?.width || win.innerWidth}px`,
    );
    root.style.setProperty(
      "--chart-fs-vh",
      `${viewport?.height || win.innerHeight}px`,
    );
    root.style.setProperty("--chart-fs-top", `${viewport?.offsetTop || 0}px`);
    root.style.setProperty("--chart-fs-left", `${viewport?.offsetLeft || 0}px`);
  }
  function restoreInert() {
    for (const [element, previous] of inertNodes) {
      if (previous === null) element.removeAttribute("inert");
      else element.setAttribute("inert", previous);
    }
    inertNodes.clear();
  }
  function inertOutside() {
    // Preserve every original attribute, including intentionally inert branches.
    const portals = [...doc.querySelectorAll(safePortals)];
    for (const [element, previous] of inertNodes) {
      if (
        element === root ||
        element.contains(root) ||
        portals.some((portal) => element === portal || element.contains(portal))
      ) {
        if (previous === null) element.removeAttribute("inert");
        else element.setAttribute("inert", previous);
        inertNodes.delete(element);
      }
    }
    function visit(parent) {
      for (const child of parent.children) {
        if (child === root || portals.includes(child)) continue;
        if (
          child.contains(root) ||
          portals.some((portal) => child.contains(portal))
        )
          visit(child);
        else if (!inertNodes.has(child)) {
          inertNodes.set(child, child.getAttribute("inert"));
          child.setAttribute("inert", "");
        }
      }
    }
    visit(doc.body);
  }
  function unlock() {
    for (const [element, styles] of scrollStyles)
      restoreStyles(element, styles);
    scrollStyles = [];
    for (const [element, styles] of ancestorStyles)
      restoreStyles(element, styles);
    ancestorStyles = [];
    if (scroll)
      win.scrollTo({ left: scroll.x, top: scroll.y, behavior: "instant" });
    scroll = null;
  }
  function lock() {
    scroll = { x: win.scrollX || 0, y: win.scrollY || 0 };
    scrollStyles = [
      [html, rememberStyles(html, ["overflow", "scroll-behavior"])],
      [
        doc.body,
        rememberStyles(doc.body, [
          "position",
          "top",
          "left",
          "width",
          "overflow",
        ]),
      ],
    ];
    html.style.setProperty("overflow", "hidden");
    html.style.setProperty("scroll-behavior", "auto");
    doc.body.style.setProperty("position", "fixed");
    doc.body.style.setProperty("top", `${-scroll.y}px`);
    doc.body.style.setProperty("left", `${-scroll.x}px`);
    doc.body.style.setProperty("width", "100%");
    doc.body.style.setProperty("overflow", "hidden");
  }
  function fallbackAncestors() {
    // Old engines lack top-layer popovers. Remove only ancestor containment and
    // stacking for this session rather than reparenting a delegated chart.
    const properties = [
      "transform",
      "filter",
      "backdrop-filter",
      "perspective",
      "contain",
      "will-change",
      "clip-path",
      "isolation",
      "opacity",
      "mix-blend-mode",
      "z-index",
      "position",
    ];
    for (
      let ancestor = root.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (ancestorStyles.some(([element]) => element === ancestor)) continue;
      const viewportAncestor = ancestor === doc.body || ancestor === html;
      const changed = viewportAncestor
        ? properties.filter((name) => name !== "position")
        : properties;
      ancestorStyles.push([ancestor, rememberStyles(ancestor, changed)]);
      for (const name of [
        "transform",
        "filter",
        "backdrop-filter",
        "perspective",
        "contain",
        "clip-path",
      ])
        ancestor.style.setProperty(name, "none", "important");
      ancestor.style.setProperty("will-change", "auto", "important");
      ancestor.style.setProperty("isolation", "auto", "important");
      ancestor.style.setProperty("opacity", "1", "important");
      ancestor.style.setProperty("mix-blend-mode", "normal", "important");
      ancestor.style.setProperty("z-index", "auto", "important");
      if (!viewportAncestor)
        ancestor.style.setProperty("position", "static", "important");
    }
  }
  function ensureToast(restack = false) {
    const toast = doc.getElementById?.("toast");
    if (!active || !toast || !toast.showPopover) return;
    if (!toast.classList.contains("show")) {
      if (toastSnapshot && popoverOpen(toast)) {
        try {
          toast.hidePopover();
        } catch {
          /* Already closed. */
        }
      }
      return;
    }
    if (!toastSnapshot)
      toastSnapshot = {
        element: toast,
        attribute: toast.getAttribute("popover"),
        open: popoverOpen(toast),
      };
    if (toast.getAttribute("popover") !== "manual")
      toast.setAttribute("popover", "manual");
    try {
      if (restack && popoverOpen(toast)) toast.hidePopover();
      if (!popoverOpen(toast)) toast.showPopover();
    } catch {
      /* Older toast implementations retain normal fixed positioning. */
    }
  }
  function restoreToast() {
    if (!toastSnapshot) return;
    const { element, attribute, open } = toastSnapshot;
    try {
      if (popoverOpen(element)) element.hidePopover();
    } catch {
      /* Detached toast. */
    }
    if (attribute === null) element.removeAttribute("popover");
    else element.setAttribute("popover", attribute);
    if (open) {
      try {
        element.showPopover();
      } catch {
        /* Its original caller may have gone. */
      }
    }
    toastSnapshot = null;
  }
  function ensurePopover() {
    if (
      !active ||
      mode !== "popover" ||
      !root.isConnected ||
      popoverOpen(root) ||
      modalOpen()
    )
      return;
    try {
      root.showPopover();
      return true;
    } catch {
      /* A retained chart may be between DOM parents until the next frame. */
    }
  }
  function refresh() {
    if (disposed) return;
    if (!root.contains(header)) root.prepend(header);
    const host = typeof buttonHost === "function" ? buttonHost() : buttonHost;
    if (host && !host.contains(button)) host.append(button);
    const name = text();
    if (title.textContent !== name) title.textContent = name;
    button.setAttribute(
      "aria-label",
      active ? `Exit ${name} fullscreen` : `Expand ${name}`,
    );
    button.setAttribute("aria-expanded", String(active));
    button.title = active ? "Exit fullscreen" : "Expand chart";
    header.hidden = !active;
    if (active) {
      root.setAttribute("aria-label", name);
      if (mode === "fallback") fallbackAncestors();
      updateViewport();
      inertOutside();
      ensureToast(ensurePopover());
    }
  }
  function reconcile() {
    frame = 0;
    if (!active || disposed) return;
    if (!root.isConnected) {
      close();
      return;
    }
    refresh();
  }
  function schedule() {
    if (active && !disposed && !frame)
      frame = win.requestAnimationFrame(reconcile);
  }
  function exitOwnedNative(token = request) {
    if (
      !token ||
      nativeRequests.get(doc) !== token ||
      doc.fullscreenElement !== html
    )
      return;
    // Never exit a pre-existing or another chart's fullscreen session.
    try {
      Promise.resolve(doc.exitFullscreen())
        .catch(() => {})
        .finally(() => {
          if (
            nativeRequests.get(doc) === token &&
            token.owner === controller &&
            !token.pending
          )
            nativeRequests.delete(doc);
        });
    } catch {
      /* App fullscreen still closes cleanly. */
    }
  }
  function bindNative(token, version) {
    request = token;
    token.owner = controller;
    token.complete = () => {
      if (nativeRequests.get(doc) !== token) return;
      if (disposed || !active || generation !== version) {
        exitOwnedNative(token);
        if (doc.fullscreenElement !== html) nativeRequests.delete(doc);
        return;
      }
      nativeOwned = doc.fullscreenElement === html;
      // HTML fullscreen hides existing popovers; restore the chart above it.
      refresh();
      schedule();
    };
    token.fail = () => {
      if (nativeRequests.get(doc) === token) nativeRequests.delete(doc);
      if (request === token) request = null;
      if (active && generation === version) refresh();
    };
  }
  function tryNative(version) {
    if (!native) return;
    const existing = nativeRequests.get(doc);
    if (existing?.pending) {
      // Browsers do not cancel an in-flight request. Transfer its completion to
      // the newest chart instead of issuing a competing request and orphaning it.
      bindNative(existing, version);
      return;
    }
    if (
      doc.fullscreenElement ||
      !html.requestFullscreen ||
      doc.fullscreenEnabled === false
    )
      return;
    const token = { pending: true };
    nativeRequests.set(doc, token);
    bindNative(token, version);
    let pending;
    try {
      pending = html.requestFullscreen({ navigationUI: "hide" });
    } catch {
      token.pending = false;
      token.fail();
      return;
    }
    Promise.resolve(pending)
      .then(() => {
        token.pending = false;
        token.complete();
      })
      .catch(() => {
        token.pending = false;
        token.fail();
      });
  }
  function open() {
    if (active || disposed || !root.isConnected || beforeOpen() === false)
      return false;
    const previous = activeCharts.get(doc);
    if (previous && previous !== controller) previous.close();
    savedFocus = doc.activeElement;
    snapshot = {
      attributes: attributes.map((name) => [name, root.getAttribute(name)]),
      styles: rememberStyles(root, viewportProperties),
      popoverOpen: popoverOpen(root),
    };
    active = true;
    generation++;
    nativeOwned = false;
    activeCharts.set(doc, controller);
    for (const animation of root.getAnimations?.({ subtree: true }) || []) {
      const frames = animation.effect?.getKeyframes?.() || [];
      if (frames.some((item) => item.transform && item.transform !== "none"))
        animation.cancel();
    }
    root.classList.add("chart-fullscreen");
    html.classList.add("chart-fullscreen-open");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("tabindex", "-1");
    lock();
    mode = "fallback";
    if (
      typeof root.showPopover === "function" &&
      typeof root.hidePopover === "function"
    ) {
      try {
        if (popoverOpen(root)) root.hidePopover();
        root.setAttribute("popover", "manual");
        root.showPopover();
        mode = "popover";
      } catch {
        const original = snapshot.attributes.find(
          ([name]) => name === "popover",
        )[1];
        if (original === null) root.removeAttribute("popover");
        else root.setAttribute("popover", original);
      }
    }
    root.classList.add(
      mode === "popover" ? "chart-fs-popover" : "chart-fs-fallback",
    );
    if (mode === "fallback") fallbackAncestors();
    refresh();
    exit.focus({ preventScroll: true });
    onChange(true);
    if (active && !disposed) {
      refresh();
      tryNative(generation);
    }
    return true;
  }
  function close() {
    if (!active) return;
    active = false;
    generation++;
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    if (activeCharts.get(doc) === controller) activeCharts.delete(doc);
    if (mode === "popover") {
      try {
        if (popoverOpen(root)) root.hidePopover();
      } catch {
        /* A detached popover is already hidden. */
      }
    }
    root.classList.remove(
      "chart-fullscreen",
      "chart-fs-popover",
      "chart-fs-fallback",
    );
    html.classList.remove("chart-fullscreen-open");
    if (snapshot) {
      for (const [name, value] of snapshot.attributes) {
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
      restoreStyles(root, snapshot.styles);
    }
    restoreInert();
    restoreToast();
    unlock();
    header.hidden = true;
    if (
      snapshot?.popoverOpen &&
      root.isConnected &&
      root.hasAttribute("popover")
    ) {
      try {
        root.showPopover();
      } catch {
        /* Preserve the original attribute even if its former invoker vanished. */
      }
    }
    snapshot = null;
    mode = null;
    if (nativeOwned || request) exitOwnedNative();
    nativeOwned = false;
    if (
      savedFocus?.isConnected &&
      !savedFocus.closest?.("[inert]") &&
      !modalOpen()
    )
      savedFocus.focus?.({ preventScroll: true });
    savedFocus = null;
    refresh();
    onChange(false);
    refresh();
  }
  function fullscreenChanged() {
    if (!active) return;
    // Another pending request can also hide this chart's manual popover.
    schedule();
    if (
      request &&
      nativeRequests.get(doc) === request &&
      doc.fullscreenElement === html
    ) {
      nativeOwned = true;
      schedule();
    } else if (nativeOwned && doc.fullscreenElement !== html) {
      nativeOwned = false;
      // Escape belongs to an open tool dialog or picker before the chart.
      if (!modalOpen() && !nestedPopover()) close();
      else schedule();
    }
  }
  function keydown(event) {
    if (!active || modalOpen()) return;
    if (event.key === "Escape") {
      if (nestedPopover()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const toast = doc.getElementById?.("toast");
    const containers = [root];
    if (toast?.classList.contains("show") && !root.contains(toast))
      containers.push(toast);
    const targets = containers
      .flatMap((container) => [...container.querySelectorAll(focusSelector)])
      .filter(
        (element) =>
          !element.closest('[hidden],[inert],[aria-hidden="true"]') &&
          element.getClientRects().length &&
          !element.matches(":disabled"),
      );
    const first = targets[0] || exit,
      last = targets.at(-1) || exit;
    if (
      event.shiftKey &&
      (doc.activeElement === first || !targets.includes(doc.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (doc.activeElement === last || !targets.includes(doc.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }
  function focusin(event) {
    if (
      !active ||
      modalOpen() ||
      root.contains(event.target) ||
      event.target.closest?.(safePortals)
    )
      return;
    exit.focus({ preventScroll: true });
  }
  function toggle(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return active ? close() : open();
  }
  const navigation = () => close();
  const modalClosed = () => {
    if (active) schedule();
  };
  const observer = win.MutationObserver
    ? new win.MutationObserver((records) => {
        if (!active) return;
        const host =
          typeof buttonHost === "function" ? buttonHost() : buttonHost;
        if (
          !root.isConnected ||
          !root.contains(header) ||
          (host && !host.contains(button))
        ) {
          schedule();
          return;
        }
        for (const record of records) {
          if (
            !root.contains(record.target) &&
            !record.target.closest?.(safePortals)
          ) {
            schedule();
            break;
          }
        }
      })
    : null;
  observer?.observe(doc.body, { childList: true, subtree: true });
  const toast = doc.getElementById?.("toast");
  const toastObserver =
    toast && win.MutationObserver ? new win.MutationObserver(schedule) : null;
  toastObserver?.observe(toast, {
    attributes: true,
    attributeFilter: ["class"],
  });
  button.addEventListener("click", toggle);
  exit.addEventListener("click", toggle);
  root.addEventListener("toggle", schedule);
  doc.addEventListener("keydown", keydown, true);
  doc.addEventListener("focusin", focusin, true);
  doc.addEventListener("fullscreenchange", fullscreenChanged);
  doc.addEventListener("close", modalClosed, true);
  win.addEventListener("resize", schedule);
  win.addEventListener("orientationchange", schedule);
  win.addEventListener("hashchange", navigation);
  win.addEventListener("popstate", navigation);
  win.addEventListener("pagehide", navigation);
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  const controller = {
    button,
    open,
    close,
    toggle,
    refresh,
    isActive: () => active,
    destroy() {
      if (disposed) return;
      close();
      disposed = true;
      generation++;
      observer?.disconnect();
      toastObserver?.disconnect();
      if (frame) win.cancelAnimationFrame(frame);
      button.removeEventListener("click", toggle);
      exit.removeEventListener("click", toggle);
      root.removeEventListener("toggle", schedule);
      doc.removeEventListener("keydown", keydown, true);
      doc.removeEventListener("focusin", focusin, true);
      doc.removeEventListener("fullscreenchange", fullscreenChanged);
      doc.removeEventListener("close", modalClosed, true);
      win.removeEventListener("resize", schedule);
      win.removeEventListener("orientationchange", schedule);
      win.removeEventListener("hashchange", navigation);
      win.removeEventListener("popstate", navigation);
      win.removeEventListener("pagehide", navigation);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      button.remove();
      header.remove();
      controls.delete(root);
    },
  };
  controls.set(root, controller);
  refresh();
  return controller;
}
