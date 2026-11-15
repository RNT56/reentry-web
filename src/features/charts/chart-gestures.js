import {
  axisDragFactor,
  chartAxisAt,
  scalePriceRange,
} from "../../domain/chart-axis.js";

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Viewports use inclusive observation indices, never fabricated time intervals. */
export function zoomChartView(view, factor, anchor = 0.5) {
  const { length, from, to } = view;
  if (!Number.isFinite(factor) || factor <= 0 || length < 2)
    return { from, to };
  const count = to - from + 1;
  const nextCount = clamp(
    Math.round(count * factor),
    Math.min(12, length),
    length,
  );
  const ratio = clamp(Number.isFinite(anchor) ? anchor : 0.5, 0, 1);
  const fixed = from + ratio * (count - 1);
  const start = clamp(
    Math.round(fixed - ratio * (nextCount - 1)),
    0,
    length - nextCount,
  );
  return { from: start, to: start + nextCount - 1 };
}

export function panChartView(view, deltaBars) {
  const { length, from, to } = view;
  if (!Number.isFinite(deltaBars) || length < 2) return { from, to };
  const start = clamp(
    Math.round(from + deltaBars),
    0,
    length - (to - from + 1),
  );
  return { from: start, to: start + to - from };
}

export const sameChartView = (a, b) => a?.from === b?.from && a?.to === b?.to;
const sameGestureView = (a, b) =>
  sameChartView(a, b) &&
  (a?.priceRange?.min ?? null) === (b?.priceRange?.min ?? null) &&
  (a?.priceRange?.max ?? null) === (b?.priceRange?.max ?? null);

/**
 * Gestures mutate no workspace state. A transaction begins only when its first
 * changed viewport is flushed, and ends once, so the host can retain one undo.
 * Keep touch-action: pan-y on the plot: vertical single-finger motion remains
 * page scrolling; horizontal drags and two-finger pinch belong to this chart.
 */
export function mountChartGestures(
  plot,
  {
    getView,
    enabled = () => true,
    axesEnabled = enabled,
    onResetAxis = () => {},
    onInteraction = () => {},
    onStart = () => {},
    onChange = () => {},
    onEnd = () => {},
  },
) {
  let gesture = null;
  let transaction = null;
  let pending = null;
  let frame = 0;
  let wheelTimer = 0;
  let disposed = false;
  const pointers = new Map();
  const effectiveView = () => ({ ...getView(), ...(pending || {}) });
  function coordinates(event) {
    const view = getView();
    const rect = plot.querySelector(".ta-canvas")?.getBoundingClientRect();
    if (!view || !rect || !rect.width || !rect.height) return null;
    const x = ((event.clientX - rect.left) * view.W) / rect.width;
    const y = ((event.clientY - rect.top) * view.H) / rect.height;
    return {
      x,
      y,
      axis: chartAxisAt({ x, y }, view),
      inside: x >= view.L && x <= view.R && y >= view.T && y <= view.B,
    };
  }
  function flush() {
    frame = 0;
    if (!pending || disposed) return;
    const next = pending;
    pending = null;
    if (!transaction || sameGestureView({ ...getView(), ...next }, getView()))
      return;
    if (!transaction.started) {
      transaction.started = true;
      onStart({ ...transaction.initial });
    }
    transaction.latest = { ...getView(), ...next };
    onChange(next);
  }
  function schedule(next) {
    if (
      !transaction ||
      sameGestureView({ ...effectiveView(), ...next }, effectiveView())
    )
      return;
    pending = next;
    if (!frame) frame = requestAnimationFrame(flush);
  }
  function begin() {
    if (!transaction) {
      const initial = effectiveView();
      transaction = { initial, latest: initial, started: false };
      onInteraction(true);
    }
  }
  function finish(cancelled = false) {
    clearTimeout(wheelTimer);
    wheelTimer = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!cancelled) flush();
    pending = null;
    const completed = transaction;
    transaction = null;
    gesture = null;
    plot.classList.remove(
      "is-panning",
      "is-pinching",
      "is-scaling-price",
      "is-scaling-time",
    );
    const captured = [...pointers.keys()];
    pointers.clear();
    for (const id of captured) {
      if (plot.hasPointerCapture?.(id)) plot.releasePointerCapture(id);
    }
    if (completed?.started)
      onEnd({
        cancelled,
        changed: !sameGestureView(completed.initial, completed.latest),
        initial: completed.initial,
        view: completed.latest,
      });
    onInteraction(false);
  }
  function capture(id) {
    try {
      plot.setPointerCapture(id);
    } catch {
      /* Pointer may already have ended. */
    }
  }
  function claim(event, kind) {
    event.preventDefault();
    event.stopImmediatePropagation();
    plot.classList.toggle("is-panning", kind === "pan");
    plot.classList.toggle("is-pinching", kind === "pinch");
    plot.classList.toggle("is-scaling-price", kind === "price");
    plot.classList.toggle("is-scaling-time", kind === "time");
  }
  function pair() {
    const [a, b] = [...pointers.values()];
    return {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      center: (a.x + b.x) / 2,
    };
  }
  function down(event) {
    if (disposed || (event.pointerType !== "touch" && event.button !== 0))
      return;
    const point = coordinates(event);
    if (point?.axis && axesEnabled()) {
      if (pointers.size) return;
      if (wheelTimer) finish();
      begin();
      pointers.set(event.pointerId, point);
      gesture = {
        kind: point.axis,
        base: effectiveView(),
        x: event.clientX,
        y: event.clientY,
      };
      capture(event.pointerId);
      plot.focus?.({ preventScroll: true });
      claim(event, point.axis);
      return;
    }
    if (!enabled() || gesture?.kind === "price" || gesture?.kind === "time")
      return;
    if (
      !pointers.size &&
      event.target.closest("[data-drawing],[data-ai-scenario]")
    )
      return;
    if (!point?.inside) return;
    if (wheelTimer) finish();
    if (event.pointerType !== "touch" && pointers.size) return;
    pointers.set(event.pointerId, {
      ...point,
      startX: point.x,
      startY: point.y,
      type: event.pointerType,
    });
    if (pointers.size === 1) {
      gesture = {
        kind: "candidate",
        id: event.pointerId,
        base: effectiveView(),
        x: point.x,
        y: point.y,
      };
      if (event.pointerType !== "touch") capture(event.pointerId);
      onInteraction(true);
    } else if (pointers.size === 2) {
      begin();
      const p = pair();
      gesture = { kind: "pinch", base: effectiveView(), ...p };
      for (const id of pointers.keys()) capture(id);
      claim(event, "pinch");
    }
  }
  function move(event) {
    const saved = pointers.get(event.pointerId);
    if (!saved || !gesture) return;
    const axis = gesture.kind === "price" || gesture.kind === "time";
    if (!(axis ? axesEnabled() : enabled())) {
      finish(true);
      return;
    }
    const point = coordinates(event);
    if (!point) return;
    pointers.set(event.pointerId, { ...saved, ...point });
    if (axis) {
      claim(event, gesture.kind);
      const base = gesture.base;
      if (gesture.kind === "time")
        schedule(
          zoomChartView(base, axisDragFactor(gesture.x - event.clientX), 1),
        );
      else {
        const priceRange = scalePriceRange(
          base,
          axisDragFactor(event.clientY - gesture.y),
        );
        if (priceRange) schedule({ from: base.from, to: base.to, priceRange });
      }
      return;
    }
    if (gesture.kind === "candidate") {
      const dx = point.x - gesture.x;
      const dy = point.y - gesture.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
      if (saved.type === "touch" && Math.abs(dy) > Math.abs(dx)) {
        // Let the browser own vertical scrolling; do not start an undo entry.
        finish();
        return;
      }
      gesture.kind = "pan";
      begin();
      capture(event.pointerId);
    }
    if (gesture.kind === "pan") {
      claim(event, "pan");
      const view = gesture.base;
      schedule(
        panChartView(
          view,
          (-(point.x - gesture.x) / (view.R - view.L)) * (view.to - view.from),
        ),
      );
    } else if (gesture.kind === "pinch") {
      claim(event, "pinch");
      const current = pair();
      const view = gesture.base;
      const anchor = clamp((gesture.center - view.L) / (view.R - view.L), 0, 1);
      const zoomed = zoomChartView(
        view,
        gesture.distance / current.distance,
        anchor,
      );
      // Translate the zoomed viewport with the pinch midpoint as well.
      schedule(
        panChartView(
          { ...view, ...zoomed },
          (-(current.center - gesture.center) / (view.R - view.L)) *
            (zoomed.to - zoomed.from),
        ),
      );
    }
  }
  function up(event) {
    if (!pointers.has(event.pointerId)) return;
    if (["pan", "pinch", "price", "time"].includes(gesture?.kind))
      claim(event, gesture.kind);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      flush();
    }
    pointers.delete(event.pointerId);
    if (plot.hasPointerCapture?.(event.pointerId))
      plot.releasePointerCapture(event.pointerId);
    if (pointers.size === 1 && gesture?.kind === "pinch") {
      const [id, point] = [...pointers][0];
      gesture = {
        kind: "pan",
        id,
        base: effectiveView(),
        x: point.x,
        y: point.y,
      };
      plot.classList.remove("is-pinching");
      plot.classList.add("is-panning");
    } else finish();
  }
  function cancel(event) {
    if (pointers.has(event.pointerId)) finish(true);
  }
  function resetAxis(event) {
    if (disposed || !axesEnabled() || event.button !== 0) return;
    const axis = coordinates(event)?.axis;
    if (!axis) return;
    claim(event, axis);
    finish();
    onResetAxis(axis);
  }
  function wheel(event) {
    if (disposed || !enabled() || gesture) return;
    const point = coordinates(event);
    if (!point?.inside) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    begin();
    const view = effectiveView();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const horizontal =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
    if (horizontal && !event.ctrlKey) {
      const delta = event.deltaX || event.deltaY;
      schedule(
        panChartView(
          view,
          ((delta * unit) / (view.R - view.L)) * (view.to - view.from),
        ),
      );
    } else {
      const factor = Math.exp(clamp(event.deltaY * unit, -400, 400) * 0.0025);
      schedule(
        zoomChartView(view, factor, (point.x - view.L) / (view.R - view.L)),
      );
    }
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => finish(), 180);
  }
  const handlers = {
    pointerdown: down,
    pointermove: move,
    pointerup: up,
    pointercancel: cancel,
    lostpointercapture: cancel,
    wheel,
    dblclick: resetAxis,
  };
  for (const [type, handler] of Object.entries(handlers))
    plot.addEventListener(type, handler, { capture: true, passive: false });
  return {
    isActive: () => !!transaction || !!gesture,
    finish: () => finish(),
    cancel: () => finish(true),
    destroy() {
      finish(true);
      disposed = true;
      for (const [type, handler] of Object.entries(handlers))
        plot.removeEventListener(type, handler, true);
    },
  };
}
