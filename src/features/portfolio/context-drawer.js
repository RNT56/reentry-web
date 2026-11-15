import { openSlideOver } from "../../shared/slide-over.js";
import { esc } from "../../shared/format.js";
import { icon, monogram, bindLogos } from "../../shared/ui.js";
import {
  contextSections,
  contextDestination,
  createContextReader,
} from "./context-reader.js";
import {
  contextLoading,
  contextList,
  contextListItems,
  journalEntry,
  researchEntry,
  scenarioEntry,
  capitolEntry,
  disclosureItems,
} from "./context-views.js";

export function openAssetContextDrawer({
  asset,
  section,
  entry = "",
  onClose,
}) {
  const reader = createContextReader(asset.symbol),
    views = new Map(),
    tabs = new Map();
  let alive = true,
    epoch = 0,
    route,
    current = null,
    loadingMore = false;
  const surface = openSlideOver({
    markup: `<header class="asset-drawer-header"><div class="drawer-asset">${monogram(asset)}<div><h2 id="asset-drawer-title">${esc(asset.symbol)}<span>In focus</span></h2><span>${esc(asset.name || asset.symbol)}</span></div></div><div class="drawer-header-actions"><a data-drawer-full target="_blank" rel="noopener noreferrer" aria-label="Open full page in a new tab">${icon("arrow")}</a><button data-drawer-close aria-label="Close asset preview">${icon("close")}</button></div></header><nav class="asset-drawer-tabs" role="tablist" aria-label="Asset context">${Object.entries(
      contextSections,
    )
      .map(
        ([key, label]) =>
          `<button id="drawer-tab-${key}" role="tab" data-drawer-section="${key}" aria-selected="false" aria-controls="asset-drawer-body" tabindex="-1">${label}</button>`,
      )
      .join(
        "",
      )}</nav><div class="drawer-reading-track" aria-hidden="true"><i></i></div><div id="asset-drawer-body" class="asset-drawer-body" role="tabpanel" tabindex="0"></div>`,
    onClose: () => {
      alive = false;
      epoch++;
      reader.destroy();
      views.clear();
      onClose?.();
    },
  });
  const { dialog } = surface,
    body = dialog.querySelector(".asset-drawer-body");
  const key = (r) =>
    `${r.section}:${r.entry || "list"}:${r.section === "capitol" ? r.days : ""}`;
  const progress = () => {
    const distance = body.scrollHeight - body.clientHeight;
    dialog.style.setProperty(
      "--drawer-progress",
      String(
        distance > 0 ? Math.max(0, Math.min(1, body.scrollTop / distance)) : 0,
      ),
    );
  };
  body.addEventListener("scroll", progress, { passive: true });
  const photos = () => {
    bindLogos();
    for (const img of body.querySelectorAll(".political-avatar img")) {
      img.onerror = () => img.remove();
      if (img.complete && !img.naturalWidth) img.remove();
    }
    for (const anchor of body.querySelectorAll("a[href]")) {
      if (
        anchor.hasAttribute("data-drawer-entry") ||
        anchor.getAttribute("href").startsWith("#")
      )
        continue;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
  };
  function show(record) {
    current = record;
    body.replaceChildren(record.node);
    body.setAttribute("aria-busy", "false");
    body.scrollTop = record.scroll;
    photos();
    progress();
  }
  async function go(next, { refresh = false } = {}) {
    if (!alive) return;
    const focusContent = body.contains(document.activeElement);
    const restoreContentFocus = () => {
      if (
        focusContent &&
        (document.activeElement === document.body ||
          document.activeElement === body)
      )
        body.focus({ preventScroll: true });
    };
    if (current) current.scroll = body.scrollTop;
    route = { entry: "", days: 90, ...next };
    tabs.set(route.section, { ...route });
    const navigation = ++epoch;
    reader.cancel();
    loadingMore = false;
    for (const button of dialog.querySelectorAll("[role=tab]")) {
      const selected = button.dataset.drawerSection === route.section;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    body.setAttribute("aria-labelledby", "drawer-tab-" + route.section);
    const full = dialog.querySelector("[data-drawer-full]");
    full.href = contextDestination(asset.symbol, route.section, route.entry);
    full.setAttribute(
      "aria-label",
      `Open ${contextSections[route.section]} in a new tab`,
    );
    if (!refresh && views.has(key(route))) {
      show(views.get(key(route)));
      restoreContentFocus();
      return;
    }
    current = null;
    body.setAttribute("aria-busy", "true");
    body.innerHTML = contextLoading(!!route.entry);
    body.scrollTop = 0;
    progress();
    const destination = { ...route };
    try {
      const data = await reader.load(destination);
      if (!alive || navigation !== epoch || !data) return;
      const node = document.createElement("section");
      node.className = "drawer-page";
      node.innerHTML =
        destination.section === "capitol"
          ? capitolEntry(data, destination.days)
          : !destination.entry
            ? contextList(asset.symbol, destination.section, data)
            : destination.section === "journal"
              ? journalEntry(data)
              : destination.section === "research"
                ? researchEntry(data)
                : scenarioEntry(data);
      const record = { node, data, scroll: 0 };
      views.set(key(destination), record);
      if (views.size > 24) views.delete(views.keys().next().value);
      show(record);
      restoreContentFocus();
    } catch (error) {
      if (!alive || navigation !== epoch) return;
      body.setAttribute("aria-busy", "false");
      body.innerHTML = `<div class="drawer-empty" role="alert"><h3>Couldn’t load this ${destination.entry ? "entry" : "view"}</h3><p>${esc(error.message)}</p><div><button data-drawer-retry>Retry ${icon("refresh")}</button>${destination.entry ? "<button data-drawer-list>All entries</button>" : ""}</div></div>`;
    }
  }
  async function more() {
    if (!current || loadingMore || current.data.nextOffset === null) return;
    const record = current,
      destination = { ...route },
      navigation = epoch;
    const button = body.querySelector("[data-drawer-more]");
    loadingMore = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    body.querySelector(".drawer-page-error")?.remove();
    try {
      const data = await reader.load({
        ...destination,
        offset: record.data.nextOffset,
        version: record.data.version,
      });
      if (!alive || navigation !== epoch || !data) return;
      const field = destination.section === "capitol" ? "rows" : "items";
      const id = (v) => v.id || v.slug;
      const known = new Set(record.data[field].map(id));
      const added = data[field].filter((v) => !known.has(id(v)));
      body
        .querySelector("[data-drawer-entries]")
        .insertAdjacentHTML(
          "beforeend",
          destination.section === "capitol"
            ? disclosureItems(added)
            : contextListItems(asset.symbol, destination.section, added),
        );
      record.data = { ...data, [field]: [...record.data[field], ...added] };
      button.hidden = data.nextOffset === null;
      photos();
      progress();
    } catch (error) {
      if (!alive || navigation !== epoch) return;
      if (error.status === 409) {
        await go(destination, { refresh: true });
        return;
      }
      button.insertAdjacentHTML(
        "beforebegin",
        `<p class="drawer-page-error" role="alert">${esc(error.message)}</p>`,
      );
    } finally {
      // The cached view may have been detached while this request was pending.
      // Restore its button as well, so returning to that tab can retry pagination.
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (alive && navigation === epoch) loadingMore = false;
    }
  }
  dialog.addEventListener("click", (event) => {
    const control = event.target.closest("button,a");
    if (!control || !dialog.contains(control)) return;
    if (control.dataset.drawerSection) {
      const section = control.dataset.drawerSection;
      if (route?.section !== section) void go(tabs.get(section) || { section });
    } else if (control.dataset.drawerEntry) {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button
      )
        return;
      event.preventDefault();
      void go({ section: route.section, entry: control.dataset.drawerEntry });
    } else if (control.hasAttribute("data-drawer-list")) {
      void go({ section: route.section });
    } else if (control.hasAttribute("data-drawer-retry"))
      void go(route, { refresh: true });
    else if (control.hasAttribute("data-drawer-more")) void more();
    else if (
      control.hasAttribute("data-drawer-days") &&
      Number(control.dataset.drawerDays) !== route.days
    )
      void go({ section: "capitol", days: Number(control.dataset.drawerDays) });
    else if (control.getAttribute("href")?.startsWith("#")) {
      event.preventDefault();
      const id = control.getAttribute("href").slice(1);
      body.querySelector("#" + CSS.escape(id))?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  });
  dialog
    .querySelector("[role=tablist]")
    .addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const buttons = [...dialog.querySelectorAll("[role=tab]")];
      const index = buttons.indexOf(event.target);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next].focus({ preventScroll: true });
      buttons[next].click();
    });
  void go({ section, entry });
  return surface;
}
