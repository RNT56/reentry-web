import { esc } from "./format.js";

export function reorderHandle(label = "Reorder item") {
  return `<button type="button" class="reorder-handle" data-reorder-handle aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">${[5, 10, 15].map((y) => `<circle cx="5" cy="${y}" r="1.15"/><circle cx="11" cy="${y}" r="1.15"/>`).join("")}</svg></button>`;
}

export const reorderedKeys = (keys, from, to) => {
  const next = [...keys];
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length
  )
    return next;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
};
const sameOrder = (a, b) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Reorders live siblings without clones or duplicate IDs. The host persists keys. */
export function mountReorder(
  root,
  {
    itemSelector,
    key,
    handleSelector = "[data-reorder-handle]",
    activationSelector = null,
    axis = "y",
    onReorder = () => {},
    onError = () => {},
    disabled = () => false,
  } = {},
) {
  const doc = root.ownerDocument,
    win = doc.defaultView;
  const media = win.matchMedia?.("(prefers-reduced-motion: reduce)");
  const animations = new Map();
  let candidate = null,
    active = null,
    disposed = false,
    pending = false;
  let frame = 0,
    previousFrame = 0,
    suppressedClick = null,
    suppressTimer = 0;
  const items = () => [...root.querySelectorAll(itemSelector)];
  const direction = () =>
    (typeof axis === "function" ? axis() : axis) === "x" ? "x" : "y";
  const allowed = () =>
    !disposed && root.isConnected && !pending && !disabled();
  const liveRegion = doc.createElement("span");
  liveRegion.className = "reorder-announcement";
  liveRegion.setAttribute("role", "status");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");
  doc.body.append(liveRegion);
  root.classList.add("reorder-group");
  function announce(value) {
    liveRegion.textContent = value;
  }
  function label(item) {
    const handle = item.querySelector(handleSelector);
    return (handle?.getAttribute("aria-label") || String(key(item))).replace(
      /^reorder\s+/i,
      "",
    );
  }
  function announcePosition(prefix = "") {
    if (!active) return;
    const group = items();
    announce(
      `${prefix}${label(active.item)}, position ${group.indexOf(active.item) + 1} of ${group.length}.`,
    );
  }
  function stopAnimation(item) {
    animations.get(item)?.cancel();
    animations.delete(item);
  }
  function flip(before, group) {
    if (media?.matches) return;
    for (const item of group) {
      if (item === active?.item || !item.animate) continue;
      const from = before.get(item),
        to = item.getBoundingClientRect();
      if (
        !from ||
        (Math.abs(from.left - to.left) < 0.5 &&
          Math.abs(from.top - to.top) < 0.5)
      )
        continue;
      const animation = item.animate(
        [
          {
            transform: `translate(${from.left - to.left}px,${from.top - to.top}px)`,
          },
          { transform: "translate(0,0)" },
        ],
        { duration: 170, easing: "cubic-bezier(.2,.75,.3,1)" },
      );
      animations.set(item, animation);
      animation.finished
        ?.then(() => {
          if (animations.get(item) === animation) animations.delete(item);
        })
        .catch(() => {});
    }
  }
  function move(to) {
    const group = items(),
      from = group.indexOf(active?.item);
    if (from < 0 || to === from || to < 0 || to >= group.length) return;
    const before = new Map(
      group.map((item) => [item, item.getBoundingClientRect()]),
    );
    for (const item of group) stopAnimation(item);
    const parent = active.item.parentElement;
    const reference = to > from ? group[to].nextSibling : group[to];
    parent.insertBefore(active.item, reference);
    flip(before, group);
    active.focus?.focus({ preventScroll: true });
    announcePosition();
  }
  function restore() {
    if (!active) return;
    const group = items(),
      current = new Map(group.map((item) => [String(key(item)), item]));
    // Preserve additions made by the host while restoring only original siblings.
    const ordered = active.original
      .map((id) => current.get(id))
      .filter(Boolean);
    if (
      !ordered.length ||
      ordered.some((item) => item.parentElement !== active.parent)
    )
      return;
    for (let index = ordered.length - 2; index >= 0; index--)
      active.parent.insertBefore(ordered[index], ordered[index + 1]);
  }
  function visual() {
    if (!active || active.keyboard) return;
    const item = active.item;
    item.style.removeProperty("--reorder-x");
    item.style.removeProperty("--reorder-y");
    const rect = item.getBoundingClientRect();
    const x =
      active.axis === "x" ? active.clientX - rect.left - active.offsetX : 0;
    const y =
      active.axis === "y" ? active.clientY - rect.top - active.offsetY : 0;
    item.style.setProperty("--reorder-x", `${Math.round(x)}px`);
    item.style.setProperty("--reorder-y", `${Math.round(y)}px`);
  }
  function reorderAtPointer() {
    if (!active || active.keyboard) return;
    const group = items(),
      from = group.indexOf(active.item),
      coordinate = active.axis === "x" ? active.clientX : active.clientY;
    if (from < 0) {
      cancel();
      return;
    }
    let to = from;
    for (let index = 0; index < group.length; index++) {
      if (index === from) continue;
      const rect = group[index].getBoundingClientRect();
      const midpoint =
        active.axis === "x"
          ? rect.left + rect.width / 2
          : rect.top + rect.height / 2;
      if (index < from && coordinate < midpoint) {
        to = index;
        break;
      }
      if (index > from && coordinate > midpoint) to = index;
    }
    if (to !== from) move(to);
    visual();
  }
  function scrollContainers() {
    const result = [],
      mode = active.axis;
    for (
      let node = root;
      node && node !== doc.documentElement;
      node = node.parentElement
    ) {
      const style = win.getComputedStyle(node),
        overflow = mode === "x" ? style.overflowX : style.overflowY;
      if (
        /(auto|scroll)/.test(overflow) &&
        (mode === "x"
          ? node.scrollWidth > node.clientWidth + 2
          : node.scrollHeight > node.clientHeight + 2)
      )
        result.push(node);
    }
    const viewport = doc.scrollingElement;
    if (viewport && !result.includes(viewport)) result.push(viewport);
    return result;
  }
  function autoScroll(elapsed) {
    if (!active || active.keyboard) return false;
    const horizontal = active.axis === "x",
      point = horizontal ? active.clientX : active.clientY;
    for (const node of scrollContainers()) {
      const viewport = node === doc.scrollingElement;
      const rect = viewport
        ? {
            left: 0,
            top: Math.max(
              0,
              doc.querySelector(".app-header")?.getBoundingClientRect()
                .bottom || 0,
            ),
            right: win.innerWidth,
            bottom: win.innerHeight,
          }
        : node.getBoundingClientRect();
      const low = horizontal ? rect.left : rect.top,
        high = horizontal ? rect.right : rect.bottom;
      const edge = Math.min(44, (high - low) / 4);
      let speed =
        point < low + edge
          ? -Math.min(1, (low + edge - point) / edge)
          : point > high - edge
            ? Math.min(1, (point - high + edge) / edge)
            : 0;
      if (!speed) continue;
      const property = horizontal ? "scrollLeft" : "scrollTop",
        before = node[property];
      const limit = horizontal
        ? node.scrollWidth - node.clientWidth
        : node.scrollHeight - node.clientHeight;
      node[property] = Math.max(
        0,
        Math.min(limit, before + (speed * 13 * elapsed) / 16.67),
      );
      if (node[property] !== before) return true;
    }
    return false;
  }
  function tick(now) {
    frame = 0;
    if (!active || active.keyboard || disposed) return;
    if (!allowed() || !active.item.isConnected) {
      cancel();
      return;
    }
    const elapsed = previousFrame ? Math.min(32, now - previousFrame) : 16.67;
    previousFrame = now;
    if (autoScroll(elapsed)) reorderAtPointer();
    frame = win.requestAnimationFrame(tick);
  }
  function begin(item, keyboard, event = null) {
    const group = items(),
      ids = group.map((element) => String(key(element)));
    if (
      group.length < 2 ||
      new Set(ids).size !== ids.length ||
      group.some((element) => element.parentElement !== item.parentElement)
    )
      return false;
    root.classList.add("reorder-is-active");
    // Surface entrances and FLIP must never compete for sibling transforms.
    for (const sibling of group) {
      for (const animation of sibling.getAnimations?.() || [])
        animation.cancel();
      stopAnimation(sibling);
    }
    const rect = item.getBoundingClientRect();
    active = {
      item,
      parent: item.parentElement,
      original: ids,
      keyboard,
      axis: direction(),
      pointerId: event?.pointerId,
      clientX: event?.clientX || 0,
      clientY: event?.clientY || 0,
      offsetX: event ? event.clientX - rect.left : 0,
      offsetY: event ? event.clientY - rect.top : 0,
      focus: item.querySelector(handleSelector),
    };
    active.focus?.focus({ preventScroll: true });
    item.classList.add("reorder-is-dragging");
    item.classList.toggle("reorder-is-keyboard", keyboard);
    active.focus?.setAttribute("aria-pressed", "true");
    root.classList.add("reorder-is-active");
    announcePosition("Lifted ");
    if (keyboard)
      announce(
        liveRegion.textContent +
          " Use arrow keys to move, Space to place, Escape to cancel.",
      );
    if (!keyboard) {
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        /* The pointer may have ended. */
      }
      previousFrame = 0;
      frame = win.requestAnimationFrame(tick);
    }
    return true;
  }
  function suppress(item) {
    suppressedClick = item;
    win.clearTimeout(suppressTimer);
    suppressTimer = win.setTimeout(() => {
      suppressedClick = null;
    }, 450);
  }
  function finish(commit) {
    candidate = null;
    if (!active) return;
    const completed = active;
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    if (!commit) restore();
    completed.item.style.removeProperty("--reorder-x");
    completed.item.style.removeProperty("--reorder-y");
    completed.item.classList.remove(
      "reorder-is-dragging",
      "reorder-is-keyboard",
    );
    completed.focus?.setAttribute("aria-pressed", "false");
    root.classList.remove("reorder-is-active");
    active = null;
    if (
      completed.pointerId !== undefined &&
      root.hasPointerCapture?.(completed.pointerId)
    )
      root.releasePointerCapture(completed.pointerId);
    if (root.isConnected && (!doc.hasFocus || doc.hasFocus()))
      completed.focus?.focus({ preventScroll: true });
    const order = items().map((item) => String(key(item))),
      changed = !sameOrder(order, completed.original);
    const index = order.indexOf(String(key(completed.item)));
    announce(
      `${commit ? "Placed" : "Cancelled"} ${label(completed.item)}, position ${index + 1} of ${order.length}.`,
    );
    if (!completed.keyboard) suppress(completed.item);
    if (commit && changed && !disposed) {
      pending = true;
      root.classList.add("reorder-is-saving");
      let result;
      try {
        result = onReorder(order);
      } catch (error) {
        result = Promise.reject(error);
      }
      Promise.resolve(result)
        .catch((error) => {
          if (!disposed) {
            announce("Order could not be saved.");
            onError(error);
          }
        })
        .finally(() => {
          pending = false;
          root.classList.remove("reorder-is-saving");
        });
    }
  }
  function cancel() {
    finish(false);
  }
  function down(event) {
    // A new press is a new intent; suppress only the synthetic post-drag click.
    suppressedClick = null;
    if (
      !allowed() ||
      active ||
      candidate ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return;
    const item = event.target.closest(itemSelector);
    if (!item || !root.contains(item)) return;
    const handle = event.target.closest(handleSelector);
    if (event.pointerType !== "mouse" && !handle) return;
    if (!handle) {
      if (
        event.target.closest(
          'input,textarea,select,a,[contenteditable="true"],[data-reorder-ignore],.holding-remove',
        )
      )
        return;
      const button = event.target.closest("button");
      if (
        button &&
        (!activationSelector || !button.matches(activationSelector))
      )
        return;
    }
    candidate = {
      item,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }
  function pointerMove(event) {
    if (candidate && event.pointerId === candidate.pointerId) {
      if (!allowed()) {
        candidate = null;
        return;
      }
      const distance = Math.hypot(
        event.clientX - candidate.clientX,
        event.clientY - candidate.clientY,
      );
      if (distance < 6) return;
      const start = candidate;
      candidate = null;
      if (!begin(start.item, false, { ...start, pointerId: event.pointerId }))
        return;
    }
    if (!active || active.keyboard || event.pointerId !== active.pointerId)
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    active.clientX = event.clientX;
    active.clientY = event.clientY;
    reorderAtPointer();
  }
  function pointerUp(event) {
    if (candidate?.pointerId === event.pointerId) candidate = null;
    if (active && !active.keyboard && event.pointerId === active.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(true);
    }
  }
  function pointerCancel(event) {
    if (
      candidate?.pointerId === event.pointerId ||
      active?.pointerId === event.pointerId
    )
      cancel();
  }
  function click(event) {
    if (event.target.closest(handleSelector)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (suppressedClick && event.detail !== 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressedClick = null;
    }
  }
  function escape(event) {
    if ((active || candidate) && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
  }
  function dragstart(event) {
    if ((candidate?.item || active?.item)?.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  function keyboard(event) {
    if (active && event.key === "Escape") {
      escape(event);
      return;
    }
    const handle = event.target.closest(handleSelector),
      item = handle?.closest(itemSelector);
    if (!item || !root.contains(item)) return;
    if (!active) {
      if (allowed() && [" ", "Enter"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        begin(item, true);
      }
      return;
    }
    if (!active.keyboard || active.item !== item) return;
    if (!allowed()) {
      cancel();
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      cancel();
      return;
    }
    if ([" ", "Enter"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(true);
      return;
    }
    const group = items(),
      index = group.indexOf(item);
    const forward = active.axis === "x" ? "ArrowRight" : "ArrowDown",
      backward = active.axis === "x" ? "ArrowLeft" : "ArrowUp";
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? group.length - 1
          : event.key === forward
            ? index + 1
            : event.key === backward
              ? index - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      event.stopImmediatePropagation();
      move(Math.max(0, Math.min(group.length - 1, next)));
      item.querySelector(handleSelector)?.focus({ preventScroll: true });
      item.scrollIntoView?.({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    }
  }
  const rootHandlers = {
    pointerdown: down,
    click,
    keydown: keyboard,
    dragstart,
  };
  const docHandlers = {
    keydown: escape,
    pointermove: pointerMove,
    pointerup: pointerUp,
    pointercancel: pointerCancel,
    lostpointercapture: pointerCancel,
  };
  for (const [name, handler] of Object.entries(rootHandlers))
    root.addEventListener(name, handler, { capture: true, passive: false });
  for (const [name, handler] of Object.entries(docHandlers))
    doc.addEventListener(name, handler, { capture: true, passive: false });
  const blur = () => cancel();
  win.addEventListener("blur", blur);
  win.addEventListener("hashchange", blur);
  win.addEventListener("popstate", blur);
  win.addEventListener("resize", blur);
  return {
    cancel,
    destroy() {
      if (disposed) return;
      cancel();
      disposed = true;
      if (suppressTimer) win.clearTimeout(suppressTimer);
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      for (const [name, handler] of Object.entries(rootHandlers))
        root.removeEventListener(name, handler, true);
      for (const [name, handler] of Object.entries(docHandlers))
        doc.removeEventListener(name, handler, true);
      win.removeEventListener("blur", blur);
      win.removeEventListener("hashchange", blur);
      win.removeEventListener("popstate", blur);
      win.removeEventListener("resize", blur);
      root.classList.remove(
        "reorder-group",
        "reorder-is-active",
        "reorder-is-saving",
      );
      liveRegion.remove();
    },
  };
}
