import { chartWorkspaceSync } from "./chart-sync.js";
import {
  mountChartGestures,
  zoomChartView,
  panChartPlane,
} from "./chart-gestures.js";
import { renderAssetPlot } from "./asset-plot.js";
import { savedChartViewport } from "../../domain/chart-viewport.js";
import { scalePriceRange } from "../../domain/chart-axis.js";
import { chartStateVersion } from "../../domain/chart-merge.js";
import { historyRanges } from "../../domain/market-history.js";
import { mountChartFullscreen } from "../../shared/chart-fullscreen.js";
import { esc } from "../../shared/format.js";
import { icon } from "../../shared/icons.js";
import { setAnimatedText } from "../../shared/motion.js";

export function mountAssetChart(
  root,
  {
    ownerId,
    symbol,
    surface = "price",
    label = symbol,
    load,
    readout = true,
    ranges = false,
    currencyControl = false,
    data: initialData = null,
    references = () => [],
    reserveReferences = false,
    xLabel,
    yLabel,
    onInspect,
    linearOnly = false,
    sampleLimit,
    extra,
    onCurrency,
    accessory = "",
  } = {},
) {
  if (!ownerId) throw Error("Chart account required.");
  const rangeOptions = typeof ranges === "object" ? ranges : historyRanges;
  const sync = chartWorkspaceSync(ownerId, symbol, surface),
    hidden = new Set();
  let state = sync.get(1).state,
    data = initialData,
    geometry = null,
    ready = false,
    busy = false,
    disposed = false,
    epoch = 0,
    frame = 0,
    before = null,
    release = null,
    undo = [],
    redo = [],
    error = "",
    hover = 0;
  root.classList.add("asset-chart");
  root.classList.toggle("has-reference-space", reserveReferences);
  root.innerHTML = `<div class="asset-chart-heading">${readout ? '<div class="asset-readout"><strong data-asset-price data-number>—</strong><span data-asset-change data-number></span></div>' : '<span class="asset-chart-title">' + esc(label) + "</span>"}<span class="asset-expand"></span></div>${accessory ? `<div class="asset-chart-accessory">${accessory}</div>` : ""}<div class="asset-plot ta-plot" tabindex="0" role="slider" aria-label="${esc(label)} chart. Drag in any direction to pan; pinch or scroll to zoom. Drag axes to scale; double-click to reset. Shift and arrows pan, plus and minus zoom, zero fits the view." aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><div class="asset-chart-empty loading-surface">Loading…</div></div><div class="asset-reference-legend"></div><div class="asset-chart-controls">${
    ranges
      ? `<div class="asset-ranges" role="group" aria-label="Chart time range">${Object.entries(
          rangeOptions,
        )
          .map(
            ([key, v]) =>
              `<button data-asset-range="${key}" aria-pressed="false">${v.label}</button>`,
          )
          .join("")}</div>`
      : ""
  }<div class="asset-navigation" role="group" aria-label="Chart navigation"><button data-asset-zoom="out" aria-label="Zoom chart out">${icon("minus")}</button><button data-asset-fit title="Reset both axes">Fit</button><button data-asset-zoom="in" aria-label="Zoom chart in">${icon("plus")}</button><button data-asset-log aria-pressed="false" ${linearOnly ? "hidden" : ""}>Log</button>${currencyControl ? '<button data-asset-currency aria-label="Switch chart currency">EUR</button>' : ""}</div><button class="asset-sync" data-asset-sync aria-live="polite" title="All chart changes saved">Saved</button></div><div class="asset-sync-review" hidden><button data-view-latest>Use latest view</button><button data-view-mine>Keep my view</button></div><div class="asset-chart-caption"><span data-asset-source></span><span data-asset-date></span></div>`;
  const plot = root.querySelector(".asset-plot"),
    status = root.querySelector("[data-asset-sync]");
  const live = () => !disposed && root.isConnected;
  const editable = () => live() && ready && !busy && !!geometry;
  const view = () =>
    geometry && data
      ? {
          ...geometry,
          from: geometry.start,
          to: geometry.end,
          length: data.points.length,
          priceRange: state.priceRange,
        }
      : null;
  const remember = () => {
    if (data?.currency) state.priceCurrency = data.currency;
    sync.update(1, state);
  };
  const apply = (next) => {
    state.viewport = savedChartViewport(
      data.points,
      next,
      surface === "buyback" ? { min: -1e6, max: 1e6 } : undefined,
    );
    if (Object.hasOwn(next, "priceRange")) state.priceRange = next.priceRange;
  };
  const checkpoint = () => {
    undo.push(structuredClone(state));
    if (undo.length > 30) undo.shift();
    redo = [];
  };
  function chrome() {
    if (!live()) return;
    const saved = sync.get(1),
      phase = !ready ? "loading" : busy ? "loading" : saved.phase;
    status.textContent = error
      ? "Retry"
      : phase === "conflict"
        ? "Review"
        : ["error", "retrying"].includes(phase)
          ? "Retry"
          : phase === "loading"
            ? "Loading…"
            : ["pending", "saving"].includes(phase)
              ? "Saving…"
              : saved.connection === "reconnecting"
                ? "Connecting…"
                : "Saved";
    status.dataset.phase = phase;
    status.title = error || saved.error || "Chart view saved to your account";
    root
      .querySelectorAll("[data-asset-range]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(state.range === b.dataset.assetRange),
        ),
      );
    root
      .querySelector("[data-asset-log]")
      .setAttribute("aria-pressed", String(state.scale === "log"));
    const currency = root.querySelector("[data-asset-currency]");
    if (currency) currency.textContent = state.currency;
    root
      .querySelectorAll(".asset-navigation button,.asset-ranges button")
      .forEach(
        (b) =>
          (b.disabled =
            !ready ||
            busy ||
            (!geometry &&
              !b.hasAttribute("data-asset-range") &&
              !b.hasAttribute("data-asset-currency") &&
              !b.hasAttribute("data-asset-log"))),
      );
  }
  function select(index, exploring = false) {
    if (!data?.points?.length) return;
    hover = Math.max(
      geometry?.visibleFrom || 0,
      Math.min(geometry?.visibleTo ?? data.points.length - 1, index),
    );
    const p = data.points[hover],
      first = data.points[geometry?.visibleFrom || 0].price,
      change = p.price - first;
    if (readout) {
      const number = (n) =>
        new Intl.NumberFormat("de-DE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: Math.abs(n) < 0.1 ? 8 : 2,
        }).format(n);
      setAnimatedText(
        root.querySelector("[data-asset-price]"),
        number(p.price),
      );
      setAnimatedText(
        root.querySelector("[data-asset-change]"),
        `${change >= 0 ? "+" : ""}${number(change)} · ${first ? ((100 * change) / first).toFixed(2) : "—"}%`,
      );
    }
    root.querySelector("[data-asset-date]").textContent = xLabel
      ? xLabel(p.time)
      : new Intl.DateTimeFormat("en-GB", {
          timeZone: data.timeZone || "UTC",
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(p.time * 1000);
    const inspection = onInspect?.({ index: hover, point: p, data, exploring });
    plot.setAttribute("aria-valuemax", String(data.points.length - 1));
    plot.setAttribute("aria-valuenow", String(hover));
    plot.setAttribute(
      "aria-valuetext",
      inspection ||
        `${p.price ?? "Unavailable"} ${data.currency || state.currency}`,
    );
    const cross = plot.querySelector(".asset-crosshair");
    if (cross && geometry) {
      cross.setAttribute("opacity", exploring ? "1" : "0");
      cross
        .querySelector(".asset-cross-v")
        .setAttribute("d", `M${geometry.x(hover)} ${geometry.T}V${geometry.B}`);
      cross
        .querySelector(".asset-cross-h")
        .setAttribute(
          "d",
          Number.isFinite(p.price)
            ? `M${geometry.L} ${geometry.y(p.price)}H${geometry.R}`
            : "",
        );
      cross.querySelector("circle").setAttribute("cx", geometry.x(hover));
      cross
        .querySelector("circle")
        .setAttribute(
          "cy",
          Number.isFinite(p.price) ? geometry.y(p.price) : geometry.T,
        );
      cross
        .querySelector("circle")
        .setAttribute("opacity", Number.isFinite(p.price) ? "1" : "0");
    }
  }
  function draw() {
    if (!live() || !data) return;
    const refs = references(data),
      result = renderAssetPlot(data, state, {
        width: Math.max(280, plot.clientWidth),
        height: Math.max(100, plot.clientHeight),
        references: refs,
        hidden,
        xLabel,
        yLabel,
        sampleLimit,
        extra: (g) => extra?.(g, data),
      });
    geometry = result.geometry;
    plot.innerHTML = result.html;
    plot.setAttribute("aria-busy", "false");
    const legend = root.querySelector(".asset-reference-legend");
    const html = refs
      .filter((r) => !r.noLegend)
      .map(
        (r) =>
          `<button data-asset-reference="${esc(r.id)}" aria-pressed="${!hidden.has(r.id)}" style="--level-color:${esc(r.color || "#b9f68b")}"><i></i>${esc(r.label)} <b>${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(r.price)} ${esc(data.currency || state.currency)}</b></button>`,
      )
      .join("");
    if (legend.innerHTML !== html) legend.innerHTML = html;
    root.querySelector("[data-asset-source]").textContent = [
      data.source,
      data.currency,
      data.conversionUnavailable ? "FX unavailable" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    select(geometry?.visibleTo ?? data.points.length - 1);
    chrome();
  }
  const gestures = mountChartGestures(plot, {
    getView: view,
    enabled: editable,
    onInteraction: (active) => {
      if (active && !release) release = sync.hold(1);
      else if (!active && release) {
        const done = release;
        release = null;
        done();
      }
    },
    onStart: () => (before = structuredClone(state)),
    onChange: (next) => {
      apply(next);
      draw();
    },
    onEnd: ({ cancelled }) => {
      if (!before) return;
      if (cancelled) state = before;
      else if (chartStateVersion(before) !== chartStateVersion(state)) {
        undo.push(before);
        if (undo.length > 30) undo.shift();
        redo = [];
        remember();
      }
      before = null;
      draw();
    },
    onResetAxis: (axis) => reset(axis),
  });
  function reset(axis = "both") {
    if (!editable()) return;
    checkpoint();
    if (axis !== "price") state.viewport = null;
    if (axis !== "time") state.priceRange = null;
    remember();
    draw();
  }
  function edit(next) {
    if (!editable()) return;
    gestures.finish();
    checkpoint();
    apply(next);
    remember();
    draw();
  }
  function resize() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (live()) {
        gestures.finish();
        draw();
      }
    });
  }
  const fullscreen = mountChartFullscreen(root, {
    native: true,
    label: () => label + " · " + (data?.currency || state.currency),
    buttonHost: root.querySelector(".asset-expand"),
    beforeOpen: () => gestures.finish(),
    onChange: resize,
  });
  const observer = new ResizeObserver(resize);
  observer.observe(plot);
  const point = (e) => {
    if (!geometry) return null;
    const box = plot.querySelector(".ta-canvas")?.getBoundingClientRect();
    if (!box) return null;
    const x = ((e.clientX - box.left) * geometry.W) / box.width,
      y = ((e.clientY - box.top) * geometry.H) / box.height;
    return x >= geometry.L &&
      x <= geometry.R &&
      y >= geometry.T &&
      y <= geometry.B
      ? geometry.at(x)
      : null;
  };
  plot.onpointerdown = (e) => {
    if (e.button === 0 && editable()) {
      const i = point(e);
      if (i != null) select(i, true);
    }
  };
  plot.onpointermove = (e) => {
    if (!gestures.isActive() && editable()) {
      const i = point(e);
      if (i != null) select(i, true);
    }
  };
  plot.onpointerleave = () => {
    if (!gestures.isActive()) select(geometry?.visibleTo ?? 0);
  };
  plot.onkeydown = (e) => {
    if (!editable()) return;
    if (e.key === "Escape") {
      gestures.cancel();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      gestures.finish();
      const source = e.shiftKey ? redo : undo,
        destination = e.shiftKey ? undo : redo;
      if (source.length) {
        destination.push(structuredClone(state));
        state = source.pop();
        remember();
        draw();
      }
      return;
    }
    if (
      e.shiftKey &&
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
    ) {
      e.preventDefault();
      edit(
        panChartPlane(
          view(),
          e.key === "ArrowRight" ? 32 : e.key === "ArrowLeft" ? -32 : 0,
          e.key === "ArrowDown" ? 32 : e.key === "ArrowUp" ? -32 : 0,
        ),
      );
    } else if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      edit({
        ...view(),
        priceRange: scalePriceRange(geometry, e.key === "ArrowUp" ? 0.65 : 1.5),
      });
    } else if (["+", "=", "-", "0"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "0") reset();
      else edit(zoomChartView(view(), e.key === "-" ? 1.5 : 0.65));
    } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      select(
        e.key === "Home"
          ? geometry.visibleFrom
          : e.key === "End"
            ? geometry.visibleTo
            : hover + (e.key === "ArrowRight" ? 1 : -1),
        true,
      );
    }
  };
  async function loadData(next = state, persist = false) {
    if (!load) return;
    gestures.finish();
    const generation = ++epoch,
      done = sync.hold(1);
    busy = true;
    error = "";
    chrome();
    plot.setAttribute("aria-busy", "true");
    try {
      const response = await load(next);
      if (!live() || generation !== epoch) return;
      data = response;
      state = {
        ...next,
        priceRange:
          response.currency !== next.priceCurrency ? null : next.priceRange,
      };
      if (persist) remember();
      draw();
    } catch (e) {
      if (live() && generation === epoch) {
        error = e.message || "Data unavailable";
        data = null;
        geometry = null;
        plot.innerHTML =
          '<div class="asset-chart-empty">Data unavailable</div>';
      }
    } finally {
      if (generation === epoch) {
        busy = false;
        chrome();
      }
      done();
    }
  }
  root.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute("data-asset-sync")) {
      if (sync.get(1).phase === "conflict")
        root.querySelector(".asset-sync-review").hidden =
          !root.querySelector(".asset-sync-review").hidden;
      else if (error) {
        if (!ready) void initialize();
        else void refreshView();
      } else void sync.retry(1);
      return;
    }
    if (
      b.hasAttribute("data-view-latest") ||
      b.hasAttribute("data-view-mine")
    ) {
      const mine = structuredClone(state);
      void sync
        .reset(1)
        .then(() => {
          if (!live()) return;
          state = b.hasAttribute("data-view-mine") ? mine : sync.get(1).state;
          if (b.hasAttribute("data-view-mine")) remember();
          root.querySelector(".asset-sync-review").hidden = true;
          void refreshView();
        })
        .catch((e) => {
          error = e.message;
          chrome();
        });
      return;
    }
    if (
      ready &&
      !busy &&
      (b.dataset.assetRange || b.hasAttribute("data-asset-currency"))
    ) {
      const next = {
        ...state,
        viewport: null,
        priceRange: null,
        range: b.dataset.assetRange || state.range,
        currency: b.hasAttribute("data-asset-currency")
          ? state.currency === "EUR"
            ? "USD"
            : "EUR"
          : state.currency,
      };
      void loadData(next, true);
      return;
    }
    if (ready && !busy && !geometry && b.hasAttribute("data-asset-log")) {
      checkpoint();
      state.scale = state.scale === "log" ? "linear" : "log";
      state.priceRange = null;
      remember();
      draw();
      return;
    }
    if (!editable()) return;
    gestures.finish();
    if (b.dataset.assetZoom)
      edit(zoomChartView(view(), b.dataset.assetZoom === "in" ? 0.65 : 1.5));
    else if (b.hasAttribute("data-asset-fit")) reset();
    else if (b.hasAttribute("data-asset-log")) {
      checkpoint();
      state.scale = state.scale === "log" ? "linear" : "log";
      state.priceRange = null;
      remember();
      draw();
    } else if (b.dataset.assetReference) {
      if (hidden.has(b.dataset.assetReference))
        hidden.delete(b.dataset.assetReference);
      else hidden.add(b.dataset.assetReference);
      draw();
    }
  };
  async function refreshView() {
    error = "";
    if (load) {
      await loadData();
      return;
    }
    if (data && onCurrency && data.currency !== state.currency) {
      busy = true;
      chrome();
      plot.setAttribute("aria-busy", "true");
      try {
        await onCurrency(state.currency);
      } catch (e) {
        if (live()) {
          error = e.message;
          geometry = null;
          plot.innerHTML =
            '<div class="asset-chart-empty">Data unavailable</div>';
        }
      } finally {
        if (live()) {
          busy = false;
          chrome();
        }
      }
    } else draw();
  }
  const unsubscribe = sync.subscribe((event) => {
    if (!live()) return;
    if (ready && event.type === "remote" && event.slot === 1) {
      const next = sync.get(1).state,
        changed =
          state.currency !== next.currency || state.range !== next.range;
      state = next;
      undo = [];
      redo = [];
      if (changed || (data && data.currency !== state.currency))
        void refreshView();
      else draw();
    }
    chrome();
  });
  async function initialize() {
    try {
      await sync.load();
      if (!live()) return;
      state = sync.get(1).state;
      ready = true;
      error = "";
      if (load) await loadData();
      else {
        if (
          data &&
          (state.currency !== data.currency ||
            state.priceCurrency !== data.currency)
        ) {
          if (["EUR", "USD"].includes(data.currency))
            state.currency = data.currency;
          state.priceRange = null;
          remember();
        }
        draw();
      }
    } catch (e) {
      if (live()) {
        error = e.message;
        chrome();
      }
    }
  }
  void initialize();
  return {
    refresh: refreshView,
    setData(next, { resetPrice = false } = {}) {
      gestures.finish();
      data = next;
      if (resetPrice) {
        state.priceRange = null;
        if (ready) remember();
      }
      if (
        ready &&
        next.currency &&
        (state.currency !== next.currency ||
          state.priceCurrency !== next.currency)
      ) {
        gestures.finish();
        if (["EUR", "USD"].includes(next.currency))
          state.currency = next.currency;
        state.priceRange = null;
        remember();
      }
      if (ready) draw();
    },
    redraw: draw,
    accessory: root.querySelector(".asset-chart-accessory"),
    destroy() {
      gestures.finish();
      void sync.flush(1);
      disposed = true;
      epoch++;
      observer.disconnect();
      cancelAnimationFrame(frame);
      unsubscribe();
      gestures.destroy();
      fullscreen.destroy();
      release?.();
    },
  };
}
