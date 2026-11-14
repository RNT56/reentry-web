import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { modal, close, toast, icon } from "../../shared/ui.js";
import { setAnimatedText, revealChart } from "../../shared/motion.js";
import { fetchPriceHistory } from "./price-chart.js";
import { historyRanges } from "../../domain/market-history.js";
import {
  defaultChartWorkspaceState,
  MAX_CHART_DRAWINGS,
  validateChartWorkspaceState,
} from "../../domain/chart-workspace.js";
import { convertDrawingCurrency } from "../../domain/chart-currency.js";
import { technicalIndicators } from "../../domain/technical-analysis.js";
import { aiOverlayDrawings, renderAIOverlays } from "./ai-overlays.js";
import {
  chartGeometry,
  renderAnalysisPlot,
  renderDrawings,
  chartNumber,
  indicatorLabels,
  toolLabels,
  palette,
} from "./analysis-render.js";

const drafts = new Map();
const instances = new Map();
const pendingSaves = new Map();
const clone = (value) => structuredClone(value);
const versionOf = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const symbols = {
  inspect: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="4"/>',
  trend:
    '<path d="m4 18 16-12"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="6" r="2"/>',
  horizontal: '<path d="M3 12h18"/><circle cx="8" cy="12" r="2"/>',
  fib: '<path d="M3 4h18M3 10h18M3 15h18M3 20h18M5 4v16"/>',
  measure: '<path d="M4 5v15h16M8 16 20 4M15 4h5v5M8 11v5h5"/>',
  note: '<path d="M4 4h16v12H9l-5 4V4ZM8 8h8M8 12h5"/>',
};
const toolIcon = (id) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[id]}</svg>`;
const localDate = (time) => {
  const d = new Date(time * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
let unloadInstalled = false,
  activeOwner = null;
export function setChartWorkspaceOwner(ownerId) {
  activeOwner =
    ownerId === null || ownerId === undefined ? null : String(ownerId);
}
export function mountAnalysisChart(
  root,
  asset,
  {
    ownerId = "session",
    onContextChange = () => {},
    onAISelect = () => {},
    onAITree = () => {},
  } = {},
) {
  const owner = String(ownerId),
    key = owner + ":" + asset.symbol,
    instance = Symbol(key);
  instances.set(key, instance);
  root.analysisChartInstance = instance;
  let memo = drafts.get(key),
    state = clone(memo?.state || defaultChartWorkspaceState()),
    slot = memo?.slot || 1,
    slots = Array.from({ length: 3 }, (_, i) => ({
      slot: i + 1,
      revision: 0,
      state: null,
    })),
    dirty = !!memo?.dirty,
    ready = false,
    disposed = false,
    busy = false,
    saving = false,
    managing = false,
    baseRevision = memo?.revision ?? 0,
    conflict = false,
    data = null,
    indicators = null,
    geometry = null,
    selected = null,
    tool = "inspect",
    pendingAnchor = null,
    drag = null,
    hoverIndex = 0,
    fetchGeneration = 0,
    storageGeneration = 0,
    resizeFrame = 0;
  let undo = [],
    redo = [],
    aiLayer = null,
    aiVersion = "null",
    contextVersion = "";
  const chartContext = () => ({
    range: data?.range || state.range,
    currency: data?.currency || state.currency,
  });
  if (!unloadInstalled) {
    unloadInstalled = true;
    addEventListener("beforeunload", (e) => {
      if (
        activeOwner !== null &&
        [...drafts.values()].some((d) => d.ownerId === activeOwner && d.dirty)
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }
  const live = () =>
    !disposed &&
    root.isConnected &&
    instances.get(key) === instance &&
    root.analysisChartInstance === instance;
  const editable = () => live() && ready && !busy && !saving && !managing;
  const remember = () => {
    if (disposed || instances.get(key) !== instance) return;
    drafts.set(key, {
      ownerId: owner,
      state: clone(state),
      slot,
      dirty,
      revision: baseRevision,
      instance,
    });
    if (drafts.size > 40) {
      const oldest = [...drafts].find(([k, v]) => k !== key && !v.dirty);
      if (oldest) drafts.delete(oldest[0]);
    }
  };
  const status = (message, error = false) => {
    if (!live()) return;
    const el = root.querySelector("[data-ta-status]");
    el.textContent = message;
    el.classList.toggle("is-error", error);
  };
  function mark() {
    dirty = true;
    remember();
    updateChrome();
  }
  function reconcileDirty() {
    const baseline =
      slots[slot - 1].state || defaultChartWorkspaceState("Analysis " + slot);
    dirty = versionOf(state) !== versionOf(baseline);
    remember();
  }
  function checkpoint() {
    undo.push(clone(state));
    if (undo.length > 30) undo.shift();
    redo = [];
  }
  root.classList.add("analysis-chart");
  root.innerHTML = `<div class="ta-workspaces"><div class="ta-slots" role="group" aria-label="Your saved analyses">${[1, 2, 3].map((n) => `<button type="button" data-ta-slot="${n}" aria-label="Analysis slot ${n}" aria-pressed="${n === slot}"><span>0${n}</span><b>Analysis ${n}</b></button>`).join("")}</div><div class="ta-save"><span data-ta-status role="status">Loading…</span><button class="icon-button" data-ta-manage aria-label="Manage saved analysis">${icon("sliders")}</button></div></div><div class="ta-heading"><div class="ta-readout"><input class="ta-name" value="${esc(state.name)}" maxlength="40" aria-label="Analysis name"><div class="ta-price" data-number>—</div><div class="ta-change" data-number>—</div></div><div class="ta-ranges" role="group" aria-label="Chart time range">${Object.entries(
    historyRanges,
  )
    .map(
      ([id, r]) =>
        `<button type="button" data-ta-range="${id}" aria-pressed="${state.range === id}">${r.label}</button>`,
    )
    .join(
      "",
    )}</div></div><div class="ta-toolbar"><div class="ta-tools" role="toolbar" aria-label="Drawing tools">${Object.keys(
    toolLabels,
  )
    .map(
      (id) =>
        `<button type="button" data-ta-tool="${id}" title="${toolLabels[id]}" aria-label="${toolLabels[id]}" aria-pressed="${id === tool}">${toolIcon(id)}</button>`,
    )
    .join(
      "",
    )}<span class="ta-tool-divider"></span><button type="button" data-ta-undo aria-label="Undo chart change" title="Undo" disabled>↶</button><button type="button" data-ta-redo aria-label="Redo chart change" title="Redo" disabled>↷</button></div><div class="ta-display"><button data-ta-currency>${state.currency}</button><button data-ta-type aria-label="Toggle candles">Line</button><button data-ta-scale aria-pressed="${state.scale === "log"}">Log</button><details class="ta-indicator-menu"><summary>Indicators ${icon("plus")}</summary><div>${Object.entries(
    indicatorLabels,
  )
    .map(
      ([id, label]) =>
        `<label><input type="checkbox" data-ta-indicator="${id}" ${state.indicators.includes(id) ? "checked" : ""}><span style="--indicator:${palette[id] || "#a9c4aa"}">${label}</span></label>`,
    )
    .join(
      "",
    )}</div></details><button class="secondary" data-ta-save disabled>Save</button></div></div><div class="ta-active-row"><span data-ta-guide>Inspect</span><div data-ta-selected></div><div class="ta-zoom"><button data-ta-pan="-1" aria-label="Pan chart left">‹</button><button data-ta-zoom="0.65" aria-label="Zoom in">+</button><button data-ta-zoom="1.5" aria-label="Zoom out">−</button><button data-ta-fit aria-label="Fit all observations">Fit</button><button data-ta-pan="1" aria-label="Pan chart right">›</button></div></div><div class="ta-ohlc" aria-label="Selected candle values"><span data-ta-time>—</span><span data-ta-ohlc></span></div><div class="ta-plot" tabindex="0" role="slider" aria-label="Explore ${esc(asset.symbol)}. Arrow keys inspect; Enter places a drawing anchor." aria-valuemin="0" aria-valuemax="1" aria-valuenow="0" aria-busy="true"><div class="ta-loading" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></div><div class="ta-caption"><span data-ta-source>Market history</span><span data-ta-count>0 / ${MAX_CHART_DRAWINGS} drawings</span></div><div class="ta-message" role="status"></div>`;
  const plot = root.querySelector(".ta-plot");
  const aiRail = document.createElement("div");
  aiRail.className = "ta-ai-rail";
  aiRail.setAttribute("role", "group");
  aiRail.setAttribute("aria-label", "AI chart scenario focus");
  root.querySelector(".ta-toolbar").append(aiRail);
  function updateAIRail() {
    const layer =
      aiLayer?.visible && aiLayer.currency === data?.currency ? aiLayer : null;
    const html = layer
      ? `<span>AI</span><div><button data-ta-ai-scenario="" aria-pressed="${!layer.selectedKey}">All levels</button>${(layer.scenarios || []).map((b) => `<button data-ta-ai-scenario="${esc(b.eventKey)}" aria-pressed="${layer.selectedKey === b.eventKey}">${esc(b.title)}</button>`).join("")}</div>${layer.setId ? '<button class="ta-ai-tree" data-ta-ai-tree aria-label="Open AI scenario tree">Tree ↗</button>' : ""}`
      : "";
    if (aiRail.innerHTML === html) return;
    const focused = aiRail.contains(document.activeElement)
      ? document.activeElement.dataset.taAiScenario
      : undefined;
    aiRail.innerHTML = html;
    if (focused !== undefined)
      aiRail
        .querySelector(`[data-ta-ai-scenario="${CSS.escape(focused)}"]`)
        ?.focus({ preventScroll: true });
  }
  function updateChrome() {
    if (!live()) return;
    const locked = !ready || busy || saving || managing;
    root.querySelector(".ta-name").disabled = locked;
    root
      .querySelectorAll(
        "[data-ta-range],[data-ta-tool],[data-ta-indicator],[data-ta-currency],[data-ta-type],[data-ta-scale],[data-ta-pan],[data-ta-zoom],[data-ta-fit]",
      )
      .forEach((control) => (control.disabled = locked));
    root.querySelectorAll("[data-ta-slot]").forEach((b) => {
      const n = Number(b.dataset.taSlot),
        saved = slots[n - 1];
      b.setAttribute("aria-pressed", String(n === slot));
      b.querySelector("b").textContent =
        n === slot
          ? state.name || "Analysis " + n
          : saved.state?.name || "New analysis";
      b.classList.toggle("has-save", !!saved.state);
      b.disabled = locked;
    });
    root.querySelector("[data-ta-save]").disabled =
      locked ||
      conflict ||
      !state.name.trim() ||
      (!dirty && !!slots[slot - 1].state);
    root.querySelector("[data-ta-save]").textContent = saving
      ? "Saving…"
      : "Save";
    root.querySelector("[data-ta-manage]").disabled = locked;
    root.querySelector("[data-ta-manage]").title = conflict
      ? "Reload the saved analysis to resolve this conflict"
      : "Manage saved analysis";
    root.querySelector("[data-ta-currency]").textContent = state.currency;
    root.querySelector("[data-ta-type]").textContent =
      state.chartType === "candle" ? "Candles" : "Line";
    root
      .querySelector("[data-ta-scale]")
      .setAttribute("aria-pressed", String(state.scale === "log"));
    root
      .querySelectorAll("[data-ta-range]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(state.range === b.dataset.taRange),
        ),
      );
    root
      .querySelectorAll("[data-ta-indicator]")
      .forEach(
        (b) => (b.checked = state.indicators.includes(b.dataset.taIndicator)),
      );
    root.querySelector("[data-ta-undo]").disabled = locked || !undo.length;
    root.querySelector("[data-ta-redo]").disabled = locked || !redo.length;
    root.querySelector("[data-ta-count]").textContent =
      state.drawings.length + " / " + MAX_CHART_DRAWINGS + " drawings";
    const selectedDrawing = state.drawings.find((d) => d.id === selected);
    root.querySelector("[data-ta-selected]").innerHTML = selectedDrawing
      ? `<span>${toolLabels[selectedDrawing.type]}</span><button data-ta-edit>Edit</button><button data-ta-delete aria-label="Delete selected drawing">${icon("close")}</button>`
      : "";
    root
      .querySelectorAll("[data-ta-tool]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(tool === b.dataset.taTool)),
      );
    plot.classList.toggle("is-drawing", tool !== "inspect");
    root.querySelector("[data-ta-guide]").textContent =
      tool === "inspect"
        ? "Inspect"
        : toolLabels[tool] +
          (pendingAnchor ? " · End point" : " · Start point");
    root
      .querySelectorAll("[data-ta-edit],[data-ta-delete]")
      .forEach((b) => (b.disabled = locked));
    if (!saving)
      status(
        !ready
          ? "Loading…"
          : managing
            ? "Updating…"
            : conflict
              ? "Changed elsewhere · reload in Manage"
              : !state.name.trim()
                ? "Name this analysis"
                : dirty
                  ? "Unsaved"
                  : slots[slot - 1]?.state
                    ? "Saved"
                    : "Private · " + slot + "/3",
        conflict,
      );
    const context = chartContext(),
      nextContext = JSON.stringify(context);
    if (contextVersion !== nextContext) {
      contextVersion = nextContext;
      onContextChange(context);
    }
    updateAIRail();
  }
  function message(value = "") {
    if (live()) root.querySelector(".ta-message").textContent = value;
  }
  function draw(reveal = false) {
    if (!data || !live()) return;
    const width = plot.clientWidth;
    const activeAI =
      aiLayer?.visible && aiLayer.currency === data.currency ? aiLayer : null;
    // AI geometry is a transient display layer, never part of a personal workspace.
    const displayed = activeAI
      ? {
          ...state,
          drawings: [...state.drawings, ...aiOverlayDrawings(activeAI)],
        }
      : state;
    geometry = chartGeometry(data, displayed, indicators, width);
    const result = renderAnalysisPlot(
      data,
      state,
      indicators,
      geometry,
      selected,
      renderAIOverlays(activeAI, geometry),
    );
    plot.innerHTML = result.html;
    plot.setAttribute("aria-busy", "false");
    plot.classList.remove("is-loading");
    plot.setAttribute("aria-valuemax", String(data.points.length - 1));
    if (state.chartType === "candle" && !result.candleAvailable)
      message("Candles unavailable · showing closes");
    else message();
    root.querySelector("[data-ta-source]").textContent =
      data.source +
      " · " +
      state.currency +
      " · " +
      data.points.length +
      " bars";
    selectPoint(data.points.length - 1, false);
    if (reveal) revealChart(plot.querySelector(".ta-price-line"));
    updateChrome();
  }
  function selectPoint(index, exploring = true) {
    if (!data || !geometry) return;
    hoverIndex = Math.max(geometry.from, Math.min(geometry.to, index));
    const p = data.points[hoverIndex],
      first = data.points[geometry.from].price,
      change = p.price - first;
    setAnimatedText(root.querySelector(".ta-price"), chartNumber(p.price));
    setAnimatedText(
      root.querySelector(".ta-change"),
      `${change >= 0 ? "+" : ""}${chartNumber(change)} · ${change >= 0 ? "+" : ""}${((change / first) * 100).toFixed(2)}%`,
    );
    root.querySelector(".ta-change").classList.toggle("is-down", change < 0);
    root.querySelector("[data-ta-time]").textContent = new Intl.DateTimeFormat(
      "en-GB",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
        ...(["1d", "1wk"].includes(state.range)
          ? { hour: "2-digit", minute: "2-digit" }
          : {}),
        timeZone: data.timeZone || "UTC",
      },
    ).format(p.time * 1000);
    root.querySelector("[data-ta-ohlc]").textContent = Number.isFinite(p.open)
      ? `O ${chartNumber(p.open)}  H ${chartNumber(p.high)}  L ${chartNumber(p.low)}  C ${chartNumber(p.close)}`
      : "";
    const cross = plot.querySelector(".ta-crosshair");
    if (cross) {
      cross.setAttribute("opacity", exploring ? "1" : "0");
      cross
        .querySelector(".ta-cross-v")
        .setAttribute(
          "d",
          `M${geometry.x(hoverIndex)} ${geometry.T}V${geometry.B}`,
        );
      cross
        .querySelector(".ta-cross-h")
        .setAttribute(
          "d",
          `M${geometry.L} ${geometry.y(p.price)}H${geometry.R}`,
        );
      const dot = cross.querySelector("circle");
      dot.setAttribute("cx", geometry.x(hoverIndex));
      dot.setAttribute("cy", geometry.y(p.price));
    }
    plot.setAttribute("aria-valuenow", String(hoverIndex));
    plot.setAttribute(
      "aria-valuetext",
      chartNumber(p.price) +
        " " +
        state.currency +
        ", " +
        root.querySelector("[data-ta-time]").textContent,
    );
  }
  async function loadHistory({ rollback = null } = {}) {
    const generation = ++fetchGeneration;
    if (!data) {
      geometry = null;
      setAnimatedText(root.querySelector(".ta-price"), "—", { animate: false });
      setAnimatedText(root.querySelector(".ta-change"), "—", {
        animate: false,
      });
      root.querySelector("[data-ta-time]").textContent = "—";
      root.querySelector("[data-ta-ohlc]").textContent = "";
      root.querySelector("[data-ta-source]").textContent = "Market history";
    }
    const retainedData = data,
      retainedIndicators = indicators;
    const retained = data
      ? {
          range: data.range,
          currency: data.currency,
          viewport:
            geometry &&
            (geometry.from !== 0 || geometry.to !== data.points.length - 1)
              ? {
                  from: data.points[geometry.from].time,
                  to: data.points[geometry.to].time,
                }
              : null,
        }
      : null;
    busy = true;
    updateChrome();
    plot.classList.add("is-loading");
    plot.setAttribute("aria-busy", "true");
    try {
      const result = await fetchPriceHistory(
        asset.symbol,
        state.range,
        state.currency,
      );
      if (!live() || generation !== fetchGeneration) return false;
      if (result.currency !== state.currency)
        throw Error(state.currency + " history unavailable.");
      if (result.points.length < 2) throw Error("Not enough observations.");
      data = result;
      indicators = technicalIndicators(data.points);
      busy = false;
      draw(true);
      return true;
    } catch (e) {
      if (!live() || generation !== fetchGeneration) return false;
      busy = false;
      plot.setAttribute("aria-busy", "false");
      plot.classList.remove("is-loading");
      if (retained) {
        data = retainedData;
        indicators = retainedIndicators;
        if (rollback) state = clone(rollback);
        else Object.assign(state, retained);
        root.querySelector(".ta-name").value = state.name;
        reconcileDirty();
        draw();
      }
      if (!data)
        plot.innerHTML = `<div class="ta-load-error"><span>${esc(e.message)}</span><button class="secondary" data-ta-retry>Retry</button></div>`;
      else message(e.message + " · previous chart retained");
      updateChrome();
      return false;
    }
  }
  async function save() {
    if (!editable() || conflict || !state.name.trim()) return false;
    state.name = state.name.trim();
    root.querySelector(".ta-name").value = state.name;
    const savedSlot = slot,
      version = versionOf(state),
      snapshot = clone(state),
      revision = baseRevision;
    try {
      validateChartWorkspaceState(snapshot);
    } catch (e) {
      status(e.message, true);
      return false;
    }
    saving = true;
    updateChrome();
    status("Saving…");
    try {
      const pending = request(
        "/api/chart-workspaces/" +
          encodeURIComponent(asset.symbol) +
          "/" +
          savedSlot,
        "PUT",
        { revision, state: snapshot },
      );
      pendingSaves.set(key, pending);
      const result = await pending.finally(() => {
        if (pendingSaves.get(key) === pending) pendingSaves.delete(key);
      });
      if (!live()) {
        const stored = drafts.get(key);
        if (!instances.has(key) && stored?.instance === instance) {
          stored.revision = result.revision;
          if (versionOf(stored.state) === version) stored.dirty = false;
        }
        return false;
      }
      slots[savedSlot - 1] = result;
      if (slot === savedSlot) {
        baseRevision = result.revision;
        if (versionOf(state) === version) dirty = false;
      }
      remember();
      saving = false;
      if (live()) updateChrome();
      return slot === savedSlot && !dirty;
    } catch (e) {
      if (!live()) return false;
      saving = false;
      if (e.status === 409) conflict = true;
      remember();
      updateChrome();
      status(e.message, true);
      return false;
    }
  }
  async function switchSlot(next) {
    if (next === slot || !editable()) return;
    if (dirty && !(await save())) return;
    if (!live() || dirty) return;
    slot = next;
    baseRevision = slots[slot - 1].revision;
    state = clone(
      slots[slot - 1].state || defaultChartWorkspaceState("Analysis " + slot),
    );
    dirty = false;
    conflict = false;
    undo = [];
    redo = [];
    selected = null;
    pendingAnchor = null;
    tool = "inspect";
    data = null;
    root.querySelector(".ta-name").value = state.name;
    plot.innerHTML =
      '<div class="ta-loading" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>';
    remember();
    updateChrome();
    await loadHistory();
  }
  async function changeCurrency() {
    if (!editable() || !data) return;
    const previous = clone(state),
      source = data,
      previousIndicators = indicators,
      previousDirty = dirty,
      previousUndo = [...undo],
      previousRedo = [...redo],
      nextCurrency = state.currency === "EUR" ? "USD" : "EUR",
      generation = ++fetchGeneration;
    busy = true;
    updateChrome();
    plot.classList.add("is-loading");
    plot.setAttribute("aria-busy", "true");
    try {
      const result = await fetchPriceHistory(
        asset.symbol,
        previous.range,
        nextCurrency,
      );
      if (!live() || generation !== fetchGeneration) return;
      if (result.currency !== nextCurrency || result.points.length < 2)
        throw Error(nextCurrency + " history unavailable.");
      let sourcePoints = source.points,
        targetPoints = result.points;
      if (previous.drawings.length && previous.range !== "5y") {
        const first = Math.max(sourcePoints[0].time, targetPoints[0].time),
          last = Math.min(sourcePoints.at(-1).time, targetPoints.at(-1).time);
        if (
          previous.drawings.some((d) =>
            d.anchors.some((a) => a.time < first || a.time > last),
          )
        ) {
          const [extendedSource, extendedTarget] = await Promise.all([
            fetchPriceHistory(asset.symbol, "5y", previous.currency),
            fetchPriceHistory(asset.symbol, "5y", nextCurrency),
          ]);
          if (!live() || generation !== fetchGeneration) return;
          if (
            extendedSource.currency !== previous.currency ||
            extendedTarget.currency !== nextCurrency
          )
            throw Error("Historical currency conversion unavailable.");
          sourcePoints = extendedSource.points;
          targetPoints = extendedTarget.points;
        }
      }
      const drawings = convertDrawingCurrency(
        previous.drawings,
        sourcePoints,
        targetPoints,
      );
      const next = validateChartWorkspaceState({
        ...previous,
        currency: nextCurrency,
        drawings,
      });
      if (!live() || generation !== fetchGeneration) return;
      checkpoint();
      state = next;
      pendingAnchor = null;
      selected = null;
      tool = "inspect";
      data = result;
      indicators = technicalIndicators(result.points);
      busy = false;
      mark();
      draw(true);
    } catch (e) {
      if (!live() || generation !== fetchGeneration) return;
      state = previous;
      data = source;
      indicators = previousIndicators;
      dirty = previousDirty;
      undo = previousUndo;
      redo = previousRedo;
      remember();
      busy = false;
      plot.classList.remove("is-loading");
      plot.setAttribute("aria-busy", "false");
      updateChrome();
      message(e.message + " · " + previous.currency + " retained");
    }
  }
  function preciseEditor(drawing) {
    if (!editable() || !drawing) return;
    const editSlot = slot;
    const d = clone(drawing),
      two = d.anchors.length === 2,
      displayedPrices = d.anchors.map((a) =>
        a.price.toLocaleString("en-US", {
          useGrouping: false,
          maximumSignificantDigits: 8,
        }),
      ),
      displayedTimes = d.anchors.map((a) => localDate(a.time));
    modal(
      `<h2>${toolLabels[d.type]}</h2><form id="ta-drawing-form"><div class="field"><label>Label</label><input name="text" maxlength="120" value="${esc(d.text || "")}" ${d.type === "note" ? "required" : ""}></div>${d.anchors.map((a, i) => `<div class="form-row"><div class="field"><label>${two ? (i ? "End" : "Start") : "Anchor"} date</label><input type="datetime-local" name="time${i}" value="${displayedTimes[i]}" min="${localDate(0)}" max="${localDate(4102444800)}" required></div><div class="field"><label>Price · ${state.currency}</label><input name="price${i}" type="number" inputmode="decimal" min="0.0000000001" max="1000000000000" step="any" value="${displayedPrices[i]}" required></div></div>`).join("")}<div class="field"><label>Color</label><select name="color">${[
        ["#a4dec0", "Mint"],
        ["#d5b97a", "Gold"],
        ["#8ab9d9", "Blue"],
        ["#c5a1e3", "Lavender"],
        ["#e3a295", "Coral"],
      ]
        .map(
          ([v, l]) =>
            `<option value="${v}" ${v === (d.color || "#a4dec0") ? "selected" : ""}>${l}</option>`,
        )
        .join(
          "",
        )}</select></div><div class="error" role="alert" id="ta-edit-error"></div><div class="actions"><button class="primary">Apply</button></div></form>`,
    );
    document.querySelector("#ta-drawing-form").onsubmit = (e) => {
      e.preventDefault();
      if (!editable() || slot !== editSlot) return;
      const f = new FormData(e.target),
        anchors = d.anchors.map((original, i) => ({
          time:
            String(f.get("time" + i)) === displayedTimes[i]
              ? original.time
              : new Date(String(f.get("time" + i))).getTime() / 1000,
          price:
            String(f.get("price" + i)) === displayedPrices[i]
              ? original.price
              : Number(f.get("price" + i)),
        }));
      const nextDrawing = {
        ...d,
        anchors,
        text: String(f.get("text") || ""),
        color: String(f.get("color")),
      };
      try {
        validateChartWorkspaceState({
          ...state,
          name: state.name.trim() || "Analysis " + slot,
          drawings: state.drawings.map((x) =>
            x.id === d.id ? nextDrawing : x,
          ),
        });
      } catch (error) {
        document.querySelector("#ta-edit-error").textContent = error.message;
        return;
      }
      checkpoint();
      state.drawings = state.drawings.map((x) =>
        x.id === d.id ? nextDrawing : x,
      );
      mark();
      draw();
      close();
    };
  }
  function addAnchor(anchor) {
    if (!editable()) return;
    if (state.drawings.length >= MAX_CHART_DRAWINGS) {
      message("40 drawings reached. Remove one to continue.");
      return;
    }
    if (tool === "inspect") return;
    if (["horizontal", "note"].includes(tool) || pendingAnchor) {
      checkpoint();
      const d = {
        id: crypto.randomUUID(),
        type: tool,
        anchors: pendingAnchor ? [pendingAnchor, anchor] : [anchor],
        color: "#a4dec0",
      };
      if (tool === "note") d.text = "Note";
      state.drawings.push(d);
      selected = d.id;
      pendingAnchor = null;
      tool = "inspect";
      mark();
      draw();
      if (d.type === "note") preciseEditor(d);
    } else {
      pendingAnchor = anchor;
      updateChrome();
    }
  }
  function locate(e) {
    const r = plot.querySelector(".ta-canvas")?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: ((e.clientX - r.left) / r.width) * geometry.W,
      y: ((e.clientY - r.top) / r.height) * geometry.H,
    };
  }
  plot.onpointerdown = (e) => {
    if (!editable() || !geometry || e.button !== 0) return;
    const aiTarget = e.target.closest("[data-ai-scenario]");
    if (tool === "inspect" && aiTarget) {
      e.preventDefault();
      onAISelect(aiTarget.dataset.aiScenario);
      return;
    }
    const point = locate(e);
    if (!point || point.y > geometry.B) return;
    const target = e.target.closest("[data-drawing]");
    if (tool === "inspect" && target) {
      selected = target.dataset.drawing;
      if (e.target.hasAttribute("data-anchor")) {
        drag = {
          id: selected,
          index: Number(e.target.dataset.anchor),
          before: clone(state),
        };
        plot.setPointerCapture(e.pointerId);
      }
      draw();
      return;
    }
    if (tool !== "inspect") {
      e.preventDefault();
      addAnchor(geometry.anchor(point.x, point.y));
    } else {
      selected = null;
      updateChrome();
      selectPoint(geometry.at(point.x));
    }
  };
  plot.onpointermove = (e) => {
    if (!editable() || !geometry) return;
    const p = locate(e);
    if (!p || p.y > geometry.B) return;
    if (drag) {
      const drawing = state.drawings.find((d) => d.id === drag.id);
      drawing.anchors[drag.index] = geometry.anchor(p.x, p.y);
      plot.querySelector(".ta-drawings").innerHTML = renderDrawings(
        state.drawings,
        geometry,
        selected,
      );
      return;
    }
    selectPoint(geometry.at(p.x));
    if (pendingAnchor) {
      plot.querySelector(".ta-preview").innerHTML = renderDrawings(
        [
          {
            id: "preview",
            type: tool,
            anchors: [pendingAnchor, geometry.anchor(p.x, p.y)],
            color: "#a4dec0",
          },
        ],
        geometry,
        null,
        true,
      );
    }
  };
  function finishDrag() {
    if (!drag || !editable()) return;
    undo.push(drag.before);
    if (undo.length > 30) undo.shift();
    redo = [];
    drag = null;
    mark();
    draw();
  }
  plot.onpointerup = finishDrag;
  plot.onpointercancel = () => {
    if (drag) {
      state = drag.before;
      drag = null;
      draw();
    }
  };
  plot.onpointerleave = () => {
    if (!drag && !pendingAnchor && data)
      selectPoint(data.points.length - 1, false);
  };
  plot.onkeydown = (e) => {
    if (!data || !editable()) return;
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      selectPoint(
        e.key === "Home"
          ? geometry.from
          : e.key === "End"
            ? geometry.to
            : hoverIndex + (e.key === "ArrowRight" ? 1 : -1),
      );
    } else if (e.key === "Enter" && tool !== "inspect") {
      e.preventDefault();
      addAnchor({
        time: data.points[hoverIndex].time,
        price: data.points[hoverIndex].price,
      });
    } else if (e.key === "Escape") {
      if (drag) {
        state = drag.before;
        drag = null;
      }
      pendingAnchor = null;
      tool = "inspect";
      selected = null;
      draw();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      checkpoint();
      state.drawings = state.drawings.filter((d) => d.id !== selected);
      selected = null;
      mark();
      draw();
    }
  };
  root.querySelector(".ta-name").oninput = (e) => {
    if (!editable()) {
      e.target.value = state.name;
      return;
    }
    state.name = e.target.value;
    mark();
  };
  root.onchange = (e) => {
    if (e.target.dataset.taIndicator) {
      if (!editable()) {
        e.target.checked = state.indicators.includes(
          e.target.dataset.taIndicator,
        );
        return;
      }
      checkpoint();
      const id = e.target.dataset.taIndicator;
      state.indicators = e.target.checked
        ? [...state.indicators, id]
        : state.indicators.filter((x) => x !== id);
      mark();
      draw();
    }
  };
  function zoom(factor, pan = 0) {
    if (!geometry || !editable()) return;
    const length = data.points.length,
      count = Math.min(
        length,
        Math.max(12, Math.round((geometry.to - geometry.from + 1) * factor)),
      ),
      center =
        (geometry.from + geometry.to) / 2 +
        pan * (geometry.to - geometry.from) * 0.35;
    let a = Math.max(
        0,
        Math.min(length - count, Math.round(center - count / 2)),
      ),
      b = a + count - 1;
    checkpoint();
    state.viewport =
      count >= length
        ? null
        : { from: data.points[a].time, to: data.points[b].time };
    mark();
    draw();
  }
  function manage() {
    if (!editable()) return;
    const managedSlot = slot,
      managedRevision = baseRevision,
      managedVersion = versionOf(state);
    async function applyAction(action, actionControl) {
      if (
        !editable() ||
        slot !== managedSlot ||
        versionOf(state) !== managedVersion
      )
        return;
      managing = true;
      updateChrome();
      document
        .querySelectorAll("#ta-reload,#ta-remove,#ta-confirm-clear")
        .forEach((b) => (b.disabled = true));
      try {
        const result =
          action === "clear"
            ? await request(
                "/api/chart-workspaces/" +
                  encodeURIComponent(asset.symbol) +
                  "/" +
                  managedSlot,
                "DELETE",
                { revision: managedRevision },
              )
            : await request(
                "/api/chart-workspaces?symbol=" +
                  encodeURIComponent(asset.symbol),
              );
        if (!live()) return;
        if (action === "clear") slots[managedSlot - 1] = result;
        else slots = result.slots;
        if (slot !== managedSlot || versionOf(state) !== managedVersion) {
          if (slot === managedSlot) baseRevision = slots[slot - 1].revision;
          remember();
          return;
        }
        state = clone(
          slots[managedSlot - 1].state ||
            defaultChartWorkspaceState("Analysis " + managedSlot),
        );
        baseRevision = slots[managedSlot - 1].revision;
        dirty = false;
        conflict = false;
        undo = [];
        redo = [];
        selected = null;
        pendingAnchor = null;
        drag = null;
        tool = "inspect";
        data = null;
        geometry = null;
        root.querySelector(".ta-name").value = state.name;
        plot.innerHTML =
          '<div class="ta-loading" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>';
        remember();
        if (actionControl?.isConnected) close();
        managing = false;
        await loadHistory();
      } catch (e) {
        if (!live()) return;
        if (e.status === 409 && slot === managedSlot) conflict = true;
        toast(e.message);
      } finally {
        if (live()) {
          managing = false;
          updateChrome();
          document
            .querySelectorAll("#ta-reload,#ta-remove,#ta-confirm-clear")
            .forEach((b) => (b.disabled = false));
        }
      }
    }
    modal(
      `<h2>${esc(state.name || "Analysis " + slot)}</h2><div class="actions"><button class="secondary" id="ta-reload">Reload saved</button><button class="danger" id="ta-remove" ${!slots[managedSlot - 1].state ? "disabled" : ""}>Clear slot ${managedSlot}</button></div>`,
    );
    document.querySelector("#ta-reload").onclick = (event) =>
      applyAction("reload", event.currentTarget);
    document.querySelector("#ta-remove").onclick = () => {
      if (!editable() || slot !== managedSlot) return;
      const drawingCount = slots[managedSlot - 1].state?.drawings.length || 0;
      modal(
        `<h2>Clear analysis ${managedSlot}?</h2><p class="sub">${drawingCount} saved ${drawingCount === 1 ? "drawing" : "drawings"}</p><div class="actions"><button class="secondary" id="ta-cancel-clear">Keep analysis</button><button class="danger" id="ta-confirm-clear">Clear analysis</button></div>`,
      );
      document.querySelector("#ta-cancel-clear").onclick = close;
      document.querySelector("#ta-confirm-clear").onclick = (event) =>
        applyAction("clear", event.currentTarget);
    };
  }
  root.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute("data-ta-ai-scenario")) {
      onAISelect(b.dataset.taAiScenario || null);
      return;
    }
    if (b.hasAttribute("data-ta-ai-tree")) {
      onAITree();
      return;
    }
    if (b.dataset.taSlot) {
      await switchSlot(Number(b.dataset.taSlot));
      return;
    }
    if (b.hasAttribute("data-ta-save")) {
      await save();
      return;
    }
    if (b.hasAttribute("data-ta-manage")) {
      manage();
      return;
    }
    if (b.hasAttribute("data-ta-storage-retry")) {
      await loadWorkspaces();
      return;
    }
    if (b.hasAttribute("data-ta-retry")) {
      await loadHistory();
      return;
    }
    if (!data || !editable()) return;
    if (b.dataset.taTool) {
      tool = b.dataset.taTool;
      pendingAnchor = null;
      selected = null;
      draw();
      return;
    }
    if (b.hasAttribute("data-ta-edit")) {
      preciseEditor(state.drawings.find((d) => d.id === selected));
      return;
    }
    if (b.hasAttribute("data-ta-delete")) {
      checkpoint();
      state.drawings = state.drawings.filter((d) => d.id !== selected);
      selected = null;
      mark();
      draw();
      return;
    }
    if (b.hasAttribute("data-ta-undo") && undo.length) {
      const previous = clone(state),
        previousUndo = [...undo],
        previousRedo = [...redo];
      redo.push(clone(state));
      state = undo.pop();
      pendingAnchor = null;
      selected = null;
      root.querySelector(".ta-name").value = state.name;
      reconcileDirty();
      updateChrome();
      if (data.range !== state.range || data.currency !== state.currency) {
        if (!(await loadHistory({ rollback: previous })) && live()) {
          undo = previousUndo;
          redo = previousRedo;
          updateChrome();
        }
      } else draw();
      return;
    }
    if (b.hasAttribute("data-ta-redo") && redo.length) {
      const previous = clone(state),
        previousUndo = [...undo],
        previousRedo = [...redo];
      undo.push(clone(state));
      state = redo.pop();
      pendingAnchor = null;
      selected = null;
      root.querySelector(".ta-name").value = state.name;
      reconcileDirty();
      updateChrome();
      if (data.range !== state.range || data.currency !== state.currency) {
        if (!(await loadHistory({ rollback: previous })) && live()) {
          undo = previousUndo;
          redo = previousRedo;
          updateChrome();
        }
      } else draw();
      return;
    }
    if (b.dataset.taZoom) {
      zoom(Number(b.dataset.taZoom));
      return;
    }
    if (b.dataset.taPan) {
      zoom(1, Number(b.dataset.taPan));
      return;
    }
    if (b.hasAttribute("data-ta-fit")) {
      checkpoint();
      state.viewport = null;
      mark();
      draw();
      return;
    }
    if (b.hasAttribute("data-ta-currency")) {
      await changeCurrency();
      return;
    }
    const previous = clone(state),
      previousUndo = [...undo],
      previousRedo = [...redo];
    checkpoint();
    if (b.dataset.taRange) {
      state.range = b.dataset.taRange;
      state.viewport = null;
      pendingAnchor = null;
      selected = null;
      tool = "inspect";
      mark();
      if (!(await loadHistory({ rollback: previous })) && live()) {
        undo = previousUndo;
        redo = previousRedo;
        updateChrome();
      }
    } else if (b.hasAttribute("data-ta-type")) {
      state.chartType = state.chartType === "line" ? "candle" : "line";
      mark();
      draw();
    } else if (b.hasAttribute("data-ta-scale")) {
      state.scale = state.scale === "linear" ? "log" : "linear";
      mark();
      draw();
    } else undo.pop();
  };
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (live() && data && !busy) draw();
    });
  });
  resize.observe(plot);
  async function loadWorkspaces() {
    if (!live()) return;
    const generation = ++storageGeneration;
    ready = false;
    updateChrome();
    plot.setAttribute("aria-busy", "true");
    try {
      const pending = pendingSaves.get(key);
      if (pending) await pending.catch(() => {});
      if (!live() || generation !== storageGeneration) return;
      const result = await request(
        "/api/chart-workspaces?symbol=" + encodeURIComponent(asset.symbol),
      );
      if (!live() || generation !== storageGeneration) return;
      slots = result.slots;
      ready = true;
      if (dirty) {
        const remote = slots[slot - 1];
        const same =
          remote.state && versionOf(remote.state) === versionOf(state);
        conflict = baseRevision !== remote.revision && !same;
        if (same) dirty = false;
        if (!conflict) baseRevision = remote.revision;
      } else {
        const first = slots.find((s) => s.state);
        slot = memo?.slot || first?.slot || 1;
        state = clone(
          slots[slot - 1].state ||
            defaultChartWorkspaceState("Analysis " + slot),
        );
        baseRevision = slots[slot - 1].revision;
        conflict = false;
      }
      root.querySelector(".ta-name").value = state.name;
      remember();
      updateChrome();
      await loadHistory();
    } catch (e) {
      if (!live() || generation !== storageGeneration) return;
      ready = false;
      updateChrome();
      status(e.message, true);
      plot.innerHTML =
        '<div class="ta-load-error"><span>Saved analyses unavailable</span><button class="secondary" data-ta-storage-retry>Retry</button></div>';
      plot.setAttribute("aria-busy", "false");
    }
  }
  updateChrome();
  loadWorkspaces();
  return {
    getContext: chartContext,
    setAILayer(layer) {
      if (!live()) return;
      const nextVersion = versionOf(layer);
      if (aiVersion === nextVersion) return;
      aiVersion = nextVersion;
      aiLayer = layer ? clone(layer) : null;
      if (data && !busy) draw();
    },
    isDirty: () => dirty,
    canLeave: () => true,
    destroy() {
      remember();
      disposed = true;
      if (instances.get(key) === instance) instances.delete(key);
      storageGeneration++;
      fetchGeneration++;
      resize.disconnect();
      cancelAnimationFrame(resizeFrame);
      if (root.analysisChartInstance === instance) {
        root.analysisChartInstance = null;
        root.onclick = null;
        root.onchange = null;
      }
    },
  };
}
