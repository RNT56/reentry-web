import { historyBrowserMarkup } from "./history-browser.js";
import { esc } from "../../shared/format.js";
import { icon } from "../../shared/ui.js";
import {
  chartNumber,
  indicatorLabels,
  toolLabels,
  palette,
} from "./analysis-render.js";

const symbols = {
  inspect: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="4"/>',
  trend:
    '<path d="m4 18 16-12"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="6" r="2"/>',
  horizontal: '<path d="M3 12h18"/><circle cx="8" cy="12" r="2"/>',
  fib: '<path d="M3 4h18M3 10h18M3 15h18M3 20h18M5 4v16"/>',
  measure: '<path d="M4 5v15h16M8 16 20 4M15 4h5v5M8 11v5h5"/>',
  note: '<path d="M4 4h16v12H9l-5 4V4ZM8 8h8M8 12h5"/>',
  tools:
    '<path d="m4 18 10-10 4 4-10 10M14 8l3-3a2.8 2.8 0 0 1 4 4l-3 3M3 4h7M3 8h4"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
};
export const chartControlIcon = (id) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${symbols[id]}</svg>`;

export function chartControlsMarkup(state, drawerId) {
  return `<div class="ta-toolbar">
    <div class="ta-control-bar">
      <button type="button" class="ta-tools-toggle" data-ta-tools-toggle aria-expanded="false" aria-controls="${esc(drawerId)}" title="Drawing tools and indicators">${chartControlIcon("tools")}<span>Tools</span>${chartControlIcon("chevron")}</button>
      <div class="ta-view-tools ta-zoom" role="group" aria-label="Chart zoom">
        <button type="button" data-ta-zoom="1.5" aria-label="Zoom chart out" title="Zoom chart out">${chartControlIcon("minus")}</button>
        <button type="button" data-ta-fit aria-label="Fit all chart observations" title="Reset chart zoom">Fit</button>
        <button type="button" data-ta-zoom="0.65" aria-label="Zoom chart in" title="Zoom chart in">${chartControlIcon("plus")}</button>
      </div>
      ${historyBrowserMarkup}
      <div class="ta-display-compact">
        <button type="button" data-ta-type aria-label="Candlestick chart" aria-pressed="false">Candles</button>
        <button type="button" data-ta-currency aria-label="Switch chart currency">${state.currency}</button>
        <span class="ta-sync" data-phase="loading"><span class="ta-sync-mark" aria-hidden="true">${icon("check")}</span><span data-ta-status role="status" aria-live="polite">Loading…</span><button type="button" class="ta-sync-retry" data-ta-sync-retry aria-label="Retry chart autosave" hidden>${icon("refresh")}</button></span>
      </div>
    </div>
    <div class="ta-tool-drawer" id="${esc(drawerId)}" hidden>
      <div class="ta-tools" role="toolbar" aria-label="Drawing tools">${Object.keys(
        toolLabels,
      )
        .map(
          (id) =>
            `<button type="button" data-ta-tool="${id}" title="${toolLabels[id]}" aria-label="${toolLabels[id]}" aria-pressed="${id === "inspect"}">${chartControlIcon(id)}<span>${toolLabels[id]}</span></button>`,
        )
        .join("")}</div>
      <div class="ta-drawer-options">
        <div class="ta-history-tools" role="group" aria-label="Chart edit history"><button type="button" data-ta-undo aria-label="Undo chart change" title="Undo" disabled>${icon("undo")}</button><button type="button" data-ta-redo aria-label="Redo chart change" title="Redo" disabled>${icon("redo")}</button></div>
        <div class="ta-display"><button type="button" data-ta-scale aria-pressed="${state.scale === "log"}">Log</button><details class="ta-indicator-menu"><summary>Indicators ${icon("plus")}</summary><div>${Object.entries(
          indicatorLabels,
        )
          .map(
            ([id, label]) =>
              `<label><input type="checkbox" aria-label="${label}" data-ta-indicator="${id}" ${state.indicators.includes(id) ? "checked" : ""}><span style="--indicator:${palette[id] || "#a9c4aa"}">${label}</span></label>`,
          )
          .join("")}</div></details></div>
      </div>
      <details class="ta-drawing-library"><summary>Drawings <span data-ta-library-count>0</span>${chartControlIcon("chevron")}</summary><div data-ta-drawings role="list" aria-label="Your chart drawings"></div></details>
    </div>
  </div>`;
}

export function drawingListMarkup(drawings, selected, currency, locked) {
  if (!drawings.length)
    return '<div class="ta-drawings-empty">No drawings</div>';
  return drawings
    .map((drawing, index) => {
      const label = drawing.text || toolLabels[drawing.type];
      return `<div class="ta-drawing-item" role="listitem"><button type="button" data-ta-select-drawing="${esc(drawing.id)}" aria-pressed="${drawing.id === selected}" aria-label="Select ${esc(label)}, drawing ${index + 1}" ${locked ? "disabled" : ""}><i style="background:${esc(drawing.color || "#a4dec0")}"></i><span><b>${esc(label)}</b><small>${chartNumber(drawing.anchors[0].price)} ${esc(currency)}</small></span></button><button type="button" data-ta-delete-drawing="${esc(drawing.id)}" aria-label="Delete ${esc(label)}, drawing ${index + 1}" title="Delete drawing" ${locked ? "disabled" : ""}>${chartControlIcon("trash")}</button></div>`;
    })
    .join("");
}
