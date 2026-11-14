import { esc } from "../../shared/format.js";
import { fibonacciLevels } from "../../domain/technical-analysis.js";
import { chartNumber } from "./analysis-render.js";

const color = "#86c8df";
const positive = (n) => Number.isFinite(n) && n > 0 && n <= 1e12;
const anchor = (a) =>
  a && Number.isFinite(a.time) && a.time >= 0 && positive(a.price);
const safeText = (value, length = 240) =>
  typeof value === "string" ? value.slice(0, length) : "";
function overlaysFor(layer) {
  if (!layer?.visible || !Array.isArray(layer.overlays)) return [];
  return layer.overlays
    .slice(0, 8)
    .filter(
      (o) =>
        o &&
        typeof o.id === "string" &&
        o.id.length > 0 &&
        ["horizontal", "trend", "fib"].includes(o.type) &&
        Array.isArray(o.anchors) &&
        o.anchors.length === (o.type === "horizontal" ? 1 : 2) &&
        o.anchors.every(anchor),
    );
}
function keysFor(overlay) {
  return Array.isArray(overlay.scenarioKeys)
    ? overlay.scenarioKeys
        .filter((key) => typeof key === "string" && key.length <= 100)
        .slice(0, 4)
    : [];
}
function selectedScenario(layer) {
  if (!layer?.visible || !layer.selectedKey || !Array.isArray(layer.scenarios))
    return null;
  return (
    layer.scenarios.find(
      (s) =>
        s.eventKey === layer.selectedKey &&
        positive(s.low) &&
        positive(s.high) &&
        s.low <= s.high,
    ) || null
  );
}

/** Fresh geometry inputs only. These must never be persisted as user drawings. */
export function aiOverlayDrawings(layer) {
  const drawings = overlaysFor(layer).map((overlay) => ({
    id: "ai-" + safeText(overlay.id, 64),
    type: overlay.type,
    anchors: overlay.anchors.map(({ time, price }) => ({ time, price })),
  }));
  const scenario = selectedScenario(layer);
  if (scenario) {
    const time = drawings[0]?.anchors[0]?.time ?? 0;
    const prices = [scenario.low, scenario.high];
    if (positive(scenario.chartCondition?.price))
      prices.push(scenario.chartCondition.price);
    for (const [i, price] of prices.entries())
      drawings.push({
        id: "ai-target-" + i,
        type: "horizontal",
        anchors: [{ time, price }],
      });
  }
  return drawings;
}

/** Read-only layer. Clicks select a linked scenario; handles never edit it. */
export function renderAIOverlays(layer, g) {
  if (!layer?.visible || !g || ![g.L, g.R, g.T, g.B].every(Number.isFinite))
    return "";
  const overlays = overlaysFor(layer),
    selected = safeText(layer.selectedKey, 100),
    scenario = selectedScenario(layer),
    occupied = [],
    stroke = `stroke="${color}" stroke-width="1.5" stroke-dasharray="5 5" fill="none" vector-effect="non-scaling-stroke"`;
  const compactLabel = (text) => {
    const max = Math.max(12, Math.min(36, Math.floor((g.R - g.L - 20) / 6)));
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  };
  const label = (text, idealY, extra = "") => {
    const min = g.T + 13,
      max = Math.max(min, g.B - 5),
      base = Math.max(min, Math.min(max, idealY));
    for (let offset = 0; offset <= max - min + 14; offset += 14) {
      const candidates = offset ? [base + offset, base - offset] : [base];
      const available = candidates.find(
        (candidate) =>
          candidate >= min &&
          candidate <= max &&
          occupied.every((previous) => Math.abs(previous - candidate) >= 13),
      );
      if (available !== undefined) {
        const y = available;
        occupied.push(y);
        return `<text x="${g.L + 7}" y="${y}" fill="${color}" class="ta-ai-label" ${extra}><title>${esc(text)}</title>${esc(compactLabel(text))}</text>`;
      }
    }
    return "";
  };
  let html = "";
  if (scenario) {
    const highY = g.y(scenario.high),
      lowY = g.y(scenario.low);
    if ([highY, lowY].every(Number.isFinite)) {
      const top = Math.max(g.T, Math.min(g.B, highY)),
        bottom = Math.max(g.T, Math.min(g.B, lowY));
      html += `<g class="ta-ai-target" data-ai-scenario="${esc(scenario.eventKey)}"><title>${esc("AI · " + safeText(scenario.title))}</title><rect x="${g.L}" y="${Math.min(top, bottom)}" width="${g.R - g.L}" height="${Math.max(1, Math.abs(bottom - top))}" fill="${color}" fill-opacity=".065" pointer-events="none"/><path d="M${g.L} ${highY}H${g.R}M${g.L} ${lowY}H${g.R}" ${stroke} opacity=".55"/>${label(`AI target · ${chartNumber(scenario.low)}–${chartNumber(scenario.high)}`, highY - 5)}`;
      const trigger = scenario.chartCondition;
      if (
        positive(trigger?.price) &&
        ["above", "below"].includes(trigger.direction)
      ) {
        const y = g.y(trigger.price);
        if (Number.isFinite(y))
          html += `<path d="M${g.L} ${y}H${g.R}" ${stroke}/>${label(`AI close ${trigger.direction === "above" ? ">" : "<"} ${chartNumber(trigger.price)}`, y - 5)}`;
      }
      html += "</g>";
    }
  }
  for (const overlay of overlays) {
    const [a, b] = overlay.anchors,
      ax = g.timeX(a.time),
      ay = g.y(a.price),
      bx = b ? g.timeX(b.time) : ax,
      by = b ? g.y(b.price) : ay;
    if (![ax, ay, bx, by].every(Number.isFinite)) continue;
    if (
      overlay.type !== "horizontal" &&
      (Math.max(ax, bx) < g.L || Math.min(ax, bx) > g.R)
    )
      continue;
    const keys = keysFor(overlay),
      linked = selected && keys.includes(selected),
      scenarioKey = linked ? selected : keys[0],
      opacity = selected ? (linked ? 1 : 0.2) : 0.8,
      attributes = `data-ai-overlay="${esc(safeText(overlay.id, 100))}"${scenarioKey ? ` data-ai-scenario="${esc(scenarioKey)}"` : ""}`,
      title = "AI · " + safeText(overlay.label || overlay.text || overlay.type),
      rationale = safeText(overlay.rationale, 600);
    let content;
    if (overlay.type === "horizontal")
      content = `<path d="M${g.L} ${ay}H${g.R}" ${stroke}/><path d="M${g.L} ${ay}H${g.R}" class="ta-ai-hit" stroke="transparent" stroke-width="16" fill="none" pointer-events="stroke"/>`;
    else if (overlay.type === "trend")
      content = `<path d="M${ax} ${ay}L${bx} ${by}" ${stroke}/><path d="M${ax} ${ay}L${bx} ${by}" class="ta-ai-hit" stroke="transparent" stroke-width="16" fill="none" pointer-events="stroke"/>`;
    else
      content = fibonacciLevels(a, b)
        .map(({ price, ratio }) => {
          const y = g.y(price);
          return Number.isFinite(y)
            ? `<path d="M${Math.max(g.L, Math.min(ax, bx))} ${y}H${g.R}" ${stroke} opacity="${ratio === 0.618 ? 1 : 0.45}"/>`
            : "";
        })
        .join("");
    content += overlay.anchors
      .map(
        (point) =>
          `<circle cx="${g.timeX(point.time)}" cy="${g.y(point.price)}" r="2.5" fill="${color}" pointer-events="none"/>`,
      )
      .join("");
    if (!selected || linked)
      content += label(
        title +
          (overlay.type === "horizontal" ? " · " + chartNumber(a.price) : ""),
        Math.min(ay, by) - 6,
      );
    html += `<g class="ta-ai-overlay${linked ? " is-selected" : ""}" ${attributes} opacity="${opacity}"><title>${esc(title)}${rationale ? " · " + esc(rationale) : ""}</title>${content}</g>`;
  }
  return html;
}
