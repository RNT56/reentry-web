import { intelligenceView } from "../features/intelligence/workspace.js";
import { navigation } from "./router.js";
import { esc } from "../shared/format.js";
import { icon, logo } from "../shared/ui.js";
import { portfolioView } from "../features/portfolio/view.js";
export function workspaceView(model, services) {
  const { activity, settings, sync } = services;
  const { saveProblem, pendingSave, saving } = sync;
  return `<div class="shell" data-view="${model.page}"><header class="app-header"><button class="brand" data-page="portfolio" aria-label="Reentry home">${logo()}<span>reentry</span></button><nav class="nav" aria-label="Main navigation">${navigation
    .map(
      ({ id, label: t }) =>
        `<button data-page="${id}" class="${model.page === id ? "active" : ""}" ${model.page === id ? 'aria-current="page"' : ""}>${t}${id === "activity" && model.state.sales.filter((s) => s.status === "waiting").length ? `<span class="nav-count">${model.state.sales.filter((s) => s.status === "waiting").length}</span>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="header-right"><button class="account-username" data-page="settings" aria-label="Account settings">${icon("sliders")} ${esc(model.currentUser.username)}</button><button class="primary small-button" id="add" aria-label="Add holding">${icon("plus")}<span>Add holding</span></button></div></header><main id="workspace-content" class="workspace-main">${model.page === "portfolio" ? portfolioView(model, services) : model.page === "explore" ? intelligenceView() : model.page === "politics" ? '<section id="capitol-workspace" class="capitol-workspace"></section>' : model.page === "markets" ? '<section id="macro-workspace" class="macro-workspace"></section>' : `<div class="page-title"><h1>${model.page === "activity" ? "Buybacks." : "Settings."}</h1></div>${model.page === "activity" ? activity() : settings() + '<section id="ai-settings" class="ai-settings"></section>'}`}<footer class="foot"><span><button class="link" id="sync-status">${saveProblem ? "Not saved · retry" : pendingSave || saving ? "Saving…" : ""}</button></span><a class="logo-credit" href="https://parqet.com/api" target="_blank" rel="noopener">Logos provided by Parqet</a></footer></main></div>`;
}
