import { icon } from "../../shared/ui.js";
import { esc } from "../../shared/format.js";
import { when } from "./shared.js";

export const sourceCollectionBusy = (collection) =>
  ["pending", "collecting"].includes(collection?.status);

export function sourcePanelMarkup({
  sources,
  coverage = [],
  collection = null,
  connectors = [],
}) {
  const busy = sourceCollectionBusy(collection);
  const status = busy
    ? sources.length
      ? "Refreshing"
      : "Collecting"
    : collection?.status === "retrying"
      ? "Retrying"
      : collection?.status === "partial"
        ? "Partial"
        : collection?.updatedAt
          ? `Updated ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(collection.updatedAt)}`
          : "";
  const connectorName = (id) =>
    connectors.find((c) => c.id === id)?.label || id;
  const row = (source) =>
    `<details class="source-row" data-source-id="${esc(source.id)}"><summary><span class="source-kind">${esc(source.kind)}</span><b>${esc(source.title)}</b><span aria-hidden="true">${icon("plus")}</span></summary><p class="small">${esc(source.content)}</p><div class="source-meta"><span>${esc(connectorName(source.connector))} · ${esc(when(source.published_at || source.publishedAt || source.fetched_at || source.fetchedAt))}</span>${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Open source ${icon("arrow")}</a>` : ""}${source.connector === "manual" ? `<button class="link" data-delete-source="${esc(source.id)}">Delete</button>` : ""}</div></details>`;
  const available = coverage.filter(
    (c) => c.status === "available" && c.count > 0,
  );
  return `<section class="panel source-panel" aria-label="Asset sources"><div class="section-line source-heading"><div><h3>Sources <span class="source-total">${sources.length || ""}</span></h3><span class="source-collection-state ${busy ? "is-refreshing" : ""}" role="status" ${collection?.updatedAt ? `title="${esc(when(collection.updatedAt))}"` : ""}>${esc(status)}</span></div><div class="source-actions"><button class="link" data-collect aria-label="Refresh asset sources" ${collection?.status === "collecting" ? "disabled" : ""}>Refresh ${icon("refresh")}</button><button class="link" data-add-source>${icon("plus")} Add text</button></div></div>${available.length ? `<div class="source-coverage" aria-label="Source providers">${available.map((c) => `<span title="${esc(c.label || connectorName(c.connector))}">${esc(c.connector.toUpperCase())}<b>${c.count}</b></span>`).join("")}</div>` : ""}${sources.length ? `<div class="source-list">${sources.slice(0, 12).map(row).join("")}</div>${sources.length > 12 ? `<details class="source-archive"><summary>More sources <span>${sources.length - 12}</span></summary><div class="source-list">${sources.slice(12).map(row).join("")}</div></details>` : ""}` : `<div class="source-empty" ${busy ? 'aria-busy="true"' : ""}>${busy ? "<i></i><i></i><i></i>" : "<span>No sources yet</span>"}</div>`}</section>`;
}

export function replaceSourcePanel(current, markup) {
  if (!current) return;
  const openIds = [...current.querySelectorAll("[data-source-id][open]")].map(
    (el) => el.dataset.sourceId,
  );
  const readingPositions = new Map(
    [...current.querySelectorAll("[data-source-id][open]")].map((el) => [
      el.dataset.sourceId,
      el.querySelector("p")?.scrollTop || 0,
    ]),
  );
  const archiveOpen = current.querySelector(".source-archive")?.open;
  const archiveScroll =
    current.querySelector(".source-archive > .source-list")?.scrollTop || 0;
  const template = document.createElement("template");
  template.innerHTML = markup;
  const next = template.content.firstElementChild;
  for (const id of openIds) {
    const detail = next.querySelector(`[data-source-id="${CSS.escape(id)}"]`);
    if (detail) detail.open = true;
  }
  if (archiveOpen && next.querySelector(".source-archive"))
    next.querySelector(".source-archive").open = true;
  const focused = current.contains(document.activeElement)
    ? document.activeElement
    : null;
  const focusedSource = focused?.closest("[data-source-id]")?.dataset.sourceId;
  const focusSelector = focused?.hasAttribute("data-collect")
    ? "[data-collect]"
    : focused?.hasAttribute("data-add-source")
      ? "[data-add-source]"
      : focusedSource
        ? `[data-source-id="${CSS.escape(focusedSource)}"] ${focused.matches("summary") ? "summary" : focused.matches("a") ? "a" : "button"}`
        : focused?.closest(".source-archive")
          ? ".source-archive > summary"
          : null;
  current.replaceWith(next);
  for (const [id, position] of readingPositions) {
    const paragraph = next.querySelector(
      `[data-source-id="${CSS.escape(id)}"] p`,
    );
    if (paragraph) paragraph.scrollTop = position;
  }
  const archive = next.querySelector(".source-archive > .source-list");
  if (archive) archive.scrollTop = archiveScroll;
  if (focusSelector)
    next.querySelector(focusSelector)?.focus({ preventScroll: true });
}
