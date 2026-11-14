import { loadingSurface } from "../../shared/motion.js";
import { esc } from "../../shared/format.js";
import { toast } from "../../shared/ui.js";
export const usd = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n > 0 && n < 10000 ? 4 : 2,
  }).format((n || 0) / 1000000);
export const when = (n) =>
  n
    ? new Date(n).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export const empty = (title, body, action = "") =>
  `<div class="research-empty"><h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ""}${action}</div>`;
export const loading = (kind) => loadingSurface(kind);
export const labels = {
  watching: "Watching",
  triggered: "Condition verified",
  observed: "Range observed",
  invalidated: "Invalidated",
  review: "Horizon elapsed",
};
export function download(data, name, type = "application/json") {
  const url = URL.createObjectURL(
      new Blob(
        [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
        { type },
      ),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function action(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  const form = button.closest("form"),
    wasInert = form?.inert;
  if (form) form.inert = true;
  button.setAttribute("aria-busy", "true");
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
    if (form) form.inert = wasInert;
    button.removeAttribute("aria-busy");
  }
}
export function sourceLinks(ids, sources) {
  return ids
    .map((id) => sources.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) =>
      s.url
        ? `<a class="source-cite" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">${esc(s.connector || s.kind)} ↗</a>`
        : `<span class="source-cite">${esc(s.title)}</span>`,
    )
    .join(" ");
}
export function scenarioCards(set, interactive = true) {
  return `<div class="scenario-root"><span class="root-dot"></span><span>${esc(set.symbol)}</span><b>${esc(set.title)}</b></div><div class="scenario-branches ${set.branches.length > 3 ? "many-branches" : ""}" style="--branches:${Math.min(3, set.branches.length)}">${set.branches
    .map(
      (b, i) =>
        `<article class="scenario-node ${["upside", "base", "downside"][i % 3]}"><span class="node-status state-${esc(b.status.status)}"><i></i>${esc(labels[b.status.status])}${b.status.invalidatedAfterOutcome ? " · later invalidated" : ""}</span><h3>${esc(b.title)}</h3><div class="node-range">${b.low.toLocaleString()}<span>–</span>${b.high.toLocaleString()}<small>${esc(b.currency)}</small></div><p>${esc(b.condition)}</p><span class="node-footer">${b.horizonDays} days · conditional</span>${interactive ? `<div class="scenario-actions"><button class="link" data-verify="${esc(set.id)}" data-key="${esc(b.eventKey)}">Verify event ↗</button><button class="link muted" data-verify="${esc(set.id)}" data-key="${esc(b.eventKey)}-invalidated">Invalidate</button></div>` : ""}<details><summary>Passage & evidence</summary>${b.passage ? `<blockquote>${esc(b.passage)}</blockquote>` : ""}<p class="small">Invalidation: ${esc(b.invalidation || "Not specified")}</p>${
          set.observations
            .filter((o) => b.status.evidence.includes(o.id))
            .map(
              (o) =>
                `<p class="small"><a href="${esc(o.url || "#")}" target="_blank" rel="noopener noreferrer">${esc(o.source)}</a> · ${esc(when(o.occurredAt))}${o.kind === "price" ? ` · ${o.value.toLocaleString()} ${esc(o.currency)}` : ""}</p>`,
            )
            .join("") || '<p class="small">No qualifying evidence yet.</p>'
        }</details></article>`,
    )
    .join("")}</div>`;
}
