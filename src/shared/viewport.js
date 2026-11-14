const editingSelector =
  'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=hidden]):not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled]),[contenteditable="true"]';
const properties = [
  "--visual-viewport-height",
  "--visual-viewport-width",
  "--visual-viewport-top",
  "--visual-viewport-left",
  "--keyboard-inset-height",
];
const positive = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? value : fallback;
const offset = (value) => (Number.isFinite(value) ? Math.max(0, value) : 0);

/** Keyboard state uses an unzoomed baseline, never a pinch-reduced viewport. */
export function createViewportState({ now = Date.now } = {}) {
  let width = 0,
    baseline = 0,
    keyboard = false,
    rotation = null;
  return (measurement) => {
    const layoutWidth = positive(measurement.width, 1),
      layoutHeight = positive(measurement.height, 1),
      visibleWidth = positive(measurement.visibleWidth, layoutWidth),
      visibleHeight = positive(measurement.visibleHeight, layoutHeight),
      top = offset(measurement.top),
      left = offset(measurement.left),
      zoomed = Math.abs(positive(measurement.scale, 1) - 1) > 0.02;
    const rotated = Math.abs(layoutWidth - width) > 40;
    if (rotated) {
      // Safari may publish the new landscape width before replacing the old
      // portrait height. Do not turn that intermediate height into a permanent
      // keyboard baseline. The old width bounds the new landscape height.
      rotation =
        width && layoutWidth > width * 1.2 && layoutHeight > width * 1.25
          ? { ceiling: width, expires: now() + 1200 }
          : null;
    }
    if (
      rotation &&
      (layoutHeight <= rotation.ceiling + 40 || now() > rotation.expires)
    )
      rotation = null;
    const baselineHeight = rotation
      ? Math.min(layoutHeight, rotation.ceiling)
      : layoutHeight;
    if (!baseline || rotated) {
      width = layoutWidth;
      baseline = baselineHeight;
      keyboard = false;
    }
    if (!zoomed) {
      // During focus transfer Safari can briefly report body as active. Keep
      // the pre-keyboard baseline until the visual viewport actually recovers.
      if (!keyboard && !measurement.editing) baseline = baselineHeight;
      else baseline = Math.max(baseline, baselineHeight);
      const threshold = Math.max(80, Math.min(140, baseline * 0.18)),
        gap = baseline - visibleHeight;
      keyboard = !!(
        measurement.touch &&
        measurement.hasVisualViewport &&
        (measurement.editing || keyboard) &&
        gap > threshold * (keyboard ? 0.65 : 1)
      );
    }
    // Pinch zoom must not masquerade as an on-screen keyboard or reset the
    // baseline. An already visible keyboard retains its state while zooming.
    return {
      width: visibleWidth,
      height: visibleHeight,
      top,
      left,
      keyboard,
      inset: keyboard ? Math.max(0, baseline - visibleHeight - top) : 0,
    };
  };
}

/** Publish the visible viewport for auth, overlays and the authenticated shell. */
export function mountViewport(root) {
  const doc = root.ownerDocument || document,
    win = doc.defaultView || window,
    html = doc.documentElement,
    viewport = win.visualViewport,
    measure = createViewportState();
  const previousStyles = properties.map((name) => [
    name,
    html.style.getPropertyValue(name),
    html.style.getPropertyPriority(name),
  ]);
  const previousKeyboard = html.classList.contains("keyboard-open");
  let frame = 0,
    holdings = null,
    alive = true;
  function set(name, value) {
    const next = `${Math.round(value * 100) / 100}px`;
    if (html.style.getPropertyValue(name) !== next)
      html.style.setProperty(name, next);
  }
  function update() {
    frame = 0;
    if (!alive) return;
    const focused = doc.activeElement,
      editing = !!focused?.matches(editingSelector),
      visible = measure({
        width: win.innerWidth,
        height: win.innerHeight,
        visibleWidth: viewport?.width,
        visibleHeight: viewport?.height,
        top: viewport?.offsetTop,
        left: viewport?.offsetLeft,
        scale: viewport?.scale,
        hasVisualViewport: !!viewport,
        editing,
        touch:
          win.matchMedia("(any-pointer: coarse)").matches ||
          (win.navigator?.maxTouchPoints || 0) > 0,
      });
    set("--visual-viewport-height", visible.height);
    set("--visual-viewport-width", visible.width);
    set("--visual-viewport-top", visible.top);
    set("--visual-viewport-left", visible.left);
    set("--keyboard-inset-height", visible.inset);
    html.classList.toggle("keyboard-open", visible.keyboard);
    const shell = root.querySelector(".shell");
    if (!shell) return;
    const headerHeight = shell.querySelector(".app-header")?.offsetHeight || 64,
      plannerRect = shell.querySelector(".planner")?.getBoundingClientRect(),
      targetRect = shell.querySelector(".ceiling")?.getBoundingClientRect(),
      inPlanner =
        plannerRect &&
        plannerRect.top < visible.top + headerHeight + 40 &&
        plannerRect.bottom > visible.top + headerHeight + 180,
      targetVisible =
        targetRect &&
        targetRect.top >= visible.top + headerHeight + 8 &&
        targetRect.bottom <= visible.top + visible.height - 94;
    shell.classList.toggle(
      "dock-visible",
      !!inPlanner && !targetVisible && !visible.keyboard,
    );
    const nextHoldings = shell.querySelector(".holdings-list");
    if (nextHoldings && nextHoldings !== holdings) {
      holdings = nextHoldings;
      const selected = holdings.querySelector(".selected");
      if (selected && !editing && !visible.keyboard) {
        const listRect = holdings.getBoundingClientRect(),
          selectedRect = selected.getBoundingClientRect();
        if (win.matchMedia("(min-width: 851px)").matches) {
          if (selectedRect.bottom > listRect.bottom)
            holdings.scrollTop += selectedRect.bottom - listRect.bottom + 8;
          else if (selectedRect.top < listRect.top)
            holdings.scrollTop += selectedRect.top - listRect.top - 8;
        } else if (selectedRect.right > listRect.right) {
          holdings.scrollLeft += selectedRect.right - listRect.right + 8;
        } else if (selectedRect.left < listRect.left) {
          holdings.scrollLeft += selectedRect.left - listRect.left - 8;
        }
      }
    }
  }
  function schedule() {
    if (alive && !frame) frame = win.requestAnimationFrame(update);
  }
  const observer = new win.MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  win.addEventListener("scroll", schedule, { passive: true });
  win.addEventListener("resize", schedule, { passive: true });
  win.addEventListener("pageshow", schedule);
  viewport?.addEventListener("resize", schedule, { passive: true });
  viewport?.addEventListener("scroll", schedule, { passive: true });
  doc.addEventListener("focusin", schedule);
  doc.addEventListener("focusout", schedule);
  schedule();
  return {
    refresh: schedule,
    destroy() {
      alive = false;
      observer.disconnect();
      win.cancelAnimationFrame(frame);
      win.removeEventListener("scroll", schedule);
      win.removeEventListener("resize", schedule);
      win.removeEventListener("pageshow", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      doc.removeEventListener("focusin", schedule);
      doc.removeEventListener("focusout", schedule);
      html.classList.toggle("keyboard-open", previousKeyboard);
      for (const [name, value, priority] of previousStyles) {
        if (value) html.style.setProperty(name, value, priority);
        else html.style.removeProperty(name);
      }
    },
  };
}
