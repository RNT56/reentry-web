import { exploreView } from "../features/explore/view.js";
import { navigation } from "./router.js";
import { esc } from "../shared/format.js";
import { icon, logo } from "../shared/ui.js";
import { portfolioView } from "../features/portfolio/view.js";
export function workspaceView(model, services) {
  const { activity, settings, sync } = services;
  const { saveProblem, pendingSave, saving } = sync;
  return `<div class="shell"><header class="app-header"><button class="brand" data-page="portfolio" aria-label="Reentry home">${logo()}<span>reentry</span></button><nav class="nav" aria-label="Main navigation">${navigation
    .map(
      ({ id, label: t }) =>
        `<button data-page="${id}" class="${model.page === id ? "active" : ""}" ${model.page === id ? 'aria-current="page"' : ""}>${t}${id === "activity" && model.state.sales.filter((s) => s.status === "waiting").length ? `<span class="nav-count">${model.state.sales.filter((s) => s.status === "waiting").length}</span>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="header-right"><button class="account-username" data-page="settings">${icon("lock")} ${esc(model.currentUser.username)}</button><button class="primary small-button" id="add">${icon("plus")}<span>Add holding</span></button></div></header><main>${model.page === "portfolio" ? portfolioView(model, services) : model.page === "explore" ? exploreView() : `<div class="page-title"><span class="eyebrow">YOUR WORKSPACE</span><h1>${model.page === "activity" ? "Buybacks." : "Settings."}</h1></div>${model.page === "activity" ? activity() : settings()}`}<footer class="foot"><span><i class="status-dot"></i><button class="link" id="sync-status">${saveProblem ? "Not saved · retry" : pendingSave || saving ? "Saving…" : "Synced"}</button></span><a class="logo-credit" href="https://parqet.com/api" target="_blank" rel="noopener">Logos provided by Parqet</a><span>Estimated tax <span class="foot-divider">/</span> <button class="link" id="method">Calculation notes ${icon("arrow")}</button></span></footer></main></div>`;
}
