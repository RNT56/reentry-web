import { mountExplore } from "../features/explore/view.js";
import { createSaveQueue } from "../shared/save-queue.js";
import { parseRoute, routeURL } from "./router.js";
import { createWorkspaceModel } from "./model.js";
import { workspaceView } from "./view.js";
import { emptyPortfolio } from "../domain/portfolio.js";
import { qty } from "../domain/portfolio.js";
import { validatePortfolio as validate } from "../domain/portfolio-validation.js";
import { $, esc, today } from "../shared/format.js";
import {
  modal,
  close,
  toast,
  associateLabels,
  bindLogos,
} from "../shared/ui.js";
import { request } from "../shared/http.js";
import { showAuth, openPasskeys } from "../features/identity/session.js";
import { mountPriceChart } from "../features/charts/price-chart.js";
import { createPlanner } from "../features/planner/controller.js";
import { createPurchases } from "../features/portfolio/purchases.js";
import { createActivity } from "../features/activity/controller.js";
import { createSettings } from "../features/settings/controller.js";
export function startWorkspace() {
  const model = createWorkspaceModel();
  const current = () =>
    model.state.holdings.find((h) => h.id === model.selected) ||
    model.state.holdings[0];
  const { update, getResult } = createPlanner(model, {
    current,
    getChart: () => priceChart,
    record: (...a) => record(...a),
  });
  const { purchase, manage, demo } = createPurchases(model, {
    save,
    render,
    refresh,
    navigate,
    current,
  });
  const { record, rebuy, activity } = createActivity(model, {
    save,
    render,
    current,
    getResult,
    navigate,
  });
  const { settings, bindSettings, method } = createSettings(model, {
    save,
    render,
    logout,
  });
  let priceChart = null;
  const queue = createSaveQueue({
    write: (state, revision) =>
      request("/api/portfolio", "PUT", { state, revision }),
    onChange(status) {
      syncLabel(
        status.saveProblem
          ? status.saveProblem.status === 409
            ? "Conflict · tap to resolve"
            : "Not saved · retry"
          : status.saving || status.pendingSave
            ? "Saving…"
            : "Synced",
      );
    },
  });
  const flushSave = () => queue.flush();
  window.addEventListener("beforeunload", (e) => {
    if (queue.status.pendingSave || queue.status.saving) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("online", () => queue.flush());
  window.addEventListener("hashchange", () => {
    if (!model.currentUser) return;
    const previousPage = model.page;
    const route = parseRoute(location.hash);
    model.page = route.page;
    if (route.selected !== null) model.selected = route.selected;
    render();
    if (previousPage !== model.page)
      window.scrollTo({ top: 0, behavior: "instant" });
  });
  function navigate(page, selected = model.selected) {
    const pageChanged = model.page !== page;
    model.page = page;
    model.selected = selected;
    const url = routeURL(page, selected);
    if (location.hash !== url) history.pushState(null, "", url);
    render();
    if (pageChanged) window.scrollTo({ top: 0, behavior: "instant" });
  }
  function syncLabel(text) {
    const b = $("#sync-status");
    if (b) {
      b.textContent = text;
      b.classList.toggle("sync-error", !!queue.status.saveProblem);
    }
  }
  async function signedIn(user, newAccount = false) {
    refreshEpoch++;
    model.busy = false;
    model.currentUser = user;
    try {
      const p = await request("/api/portfolio");
      model.state = validate(p.state);
      queue.reset(p.revision);
      model.scenario = {};
      model.quotes = {};
      model.selected = null;
      model.percent = 5;
      Object.assign(model, parseRoute(location.hash));
      render();
      if (model.state.holdings.length) refresh();
      if (newAccount) openPasskeys({ modal, close, toast });
    } catch (e) {
      model.currentUser = null;
      showAuth(signedIn);
      toast(e.message);
    }
  }
  async function boot() {
    try {
      const r = await request("/api/auth/me");
      if (r.user) await signedIn(r.user);
      else showAuth(signedIn, r.registration);
    } catch (e) {
      $("#app").innerHTML =
        '<main class="auth-shell"><section class="auth-card"><h1>Connection paused.</h1><p class="sub">' +
        esc(e.message) +
        '</p><button class="primary" id="retry-start">Retry</button></section></main>';
      $("#retry-start").onclick = boot;
    }
  }
  async function logout(all) {
    await flushSave();
    if (queue.status.pendingSave || queue.status.saving) {
      toast("Save or export your changes before signing out.");
      return;
    }
    try {
      await request("/api/auth/" + (all ? "logout-all" : "logout"), "POST", {});
      refreshEpoch++;
      model.busy = false;
      model.currentUser = null;
      model.state = emptyPortfolio();
      model.quotes = {};
      model.scenario = {};
      close();
      await boot();
    } catch (e) {
      toast(e.message);
    }
  }
  function resolveSync() {
    if (queue.status.saveProblem?.status === 401) {
      modal(
        `<h2>Sign in again</h2><p class="sub">Your session ended. Export your unsaved edits, then sign in and import them.</p><div class="actions"><button class="secondary" id="session-export">Export edits</button><button class="primary" id="session-login">Sign in</button></div>`,
      );
      $("#session-export").onclick = exportState;
      $("#session-login").onclick = () => {
        queue.reset(queue.status.revision);
        close();
        boot();
      };
      return;
    }
    if (queue.status.saveProblem?.status === 409) {
      modal(
        `<h2>Changes on another device</h2><p class="sub">Export your current edits before loading the newer portfolio.</p><div class="actions"><button class="secondary" id="conflict-export">Export edits</button><button class="primary" id="conflict-reload">Load latest</button></div>`,
      );
      $("#conflict-export").onclick = exportState;
      $("#conflict-reload").onclick = async () => {
        queue.reset(queue.status.revision);
        close();
        await signedIn(model.currentUser);
      };
    } else flushSave();
  }
  function exportState() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(model.state, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "reentry-backup-" + today() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function save() {
    validate(model.state);
    queue.enqueue(model.state);
  }
  function render() {
    try {
      renderWorkspace();
    } catch {
      priceChart?.destroy();
      priceChart = null;
      $("#app").innerHTML =
        '<main class="auth-shell"><section class="auth-card"><h1>This view paused.</h1><p class="sub">Your portfolio has not been replaced. Retry the view, return to your portfolio, or export your current data.</p><div class="actions"><button class="primary" id="retry-view">Retry</button><button class="secondary" id="home-view">Portfolio</button><button class="secondary" id="export-view">Export data</button></div></section></main>';
      $("#retry-view").onclick = render;
      $("#home-view").onclick = () => {
        navigate("portfolio");
      };
      $("#export-view").onclick = exportState;
    }
  }
  function renderWorkspace() {
    const previousSelected = model.selected;
    if (model.page === "portfolio") model.selected = current()?.id || null;
    if (
      model.currentUser &&
      model.page === "portfolio" &&
      model.selected !== previousSelected &&
      parseRoute(location.hash).selected === previousSelected
    )
      history.replaceState(null, "", routeURL(model.page, model.selected));
    priceChart?.destroy();
    priceChart = null;
    if (!model.currentUser) return;
    for (const h of model.state.holdings)
      if (h.demo && !model.quotes[h.symbol])
        model.quotes[h.symbol] = { price: 150, time: Date.now() / 1000 };
    $("#app").innerHTML = workspaceView(model, {
      current,
      quoteInput,
      quoteLabel,
      activity,
      settings,
      sync: queue.status,
    });
    const h = current();
    if (model.page === "portfolio" && h)
      priceChart = mountPriceChart($("#price-history"), h);
    associateLabels($("#app"));
    bindLogos();
    document.querySelectorAll("[data-page]").forEach(
      (b) =>
        (b.onclick = () => {
          navigate(b.dataset.page);
        }),
    );
    document.querySelectorAll("[data-holding]").forEach(
      (b) =>
        (b.onclick = () => {
          navigate("portfolio", b.dataset.holding);
        }),
    );
    ["add", "add-second", "empty-add"].forEach((id) => {
      if ($("#" + id)) $("#" + id).onclick = () => purchase();
    });
    if ($("#demo")) $("#demo").onclick = demo;
    if ($("#refresh")) $("#refresh").onclick = refresh;
    if ($("#manage")) $("#manage").onclick = manage;
    if ($("#method")) $("#method").onclick = method;
    if ($("#sync-status")) $("#sync-status").onclick = resolveSync;
    if ($("#sellqty")) {
      ["sellqty", "sellprice", "sf", "bf", "allowance", "losses"].forEach(
        (id) => ($("#" + id).oninput = update),
      );
      $("#slider").oninput = () => {
        $("#sellqty").value = Number(
          ((qty(h) * Number($("#slider").value)) / 100).toFixed(8),
        );
        update();
      };
      document.querySelectorAll("[data-portion]").forEach(
        (b) =>
          (b.onclick = () => {
            $("#sellqty").value = Number(
              ((qty(h) * Number(b.dataset.portion)) / 100).toFixed(8),
            );
            update();
          }),
      );
      $("#usequote").onclick = () => {
        $("#sellprice").value = quoteInput(h);
        update();
      };
      update();
    }
    if (model.page === "explore") mountExplore($("#explore"));
    if (model.page === "settings") bindSettings();
    if (model.page === "activity")
      document
        .querySelectorAll("[data-rebuy]")
        .forEach((b) => (b.onclick = () => rebuy(b.dataset.rebuy)));
  }
  function quoteInput(h) {
    const p = model.quotes[h.symbol]?.price;
    return p ? Number(p.toFixed(h.assetType === "CRYPTOCURRENCY" ? 8 : 2)) : "";
  }
  function quoteLabel(h) {
    const q = model.quotes[h.symbol];
    if (h.demo) return "Illustrative demo prices · not market data";
    if (q?.error) return esc(q.error);
    if (!q) return "Quote not loaded · enter a EUR price";
    return `${esc(q.source || "Yahoo Finance")} · ${esc(q.exchange || "")} · ${esc(new Date(q.time * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }))}`;
  }
  let refreshEpoch = 0;
  async function refresh() {
    if (model.busy) return;
    const user = model.currentUser,
      portfolio = model.state,
      epoch = ++refreshEpoch;
    const valid = () =>
      model.currentUser === user &&
      model.state === portfolio &&
      epoch === refreshEpoch;
    model.busy = true;
    render();
    const symbols = [
      ...new Set(
        portfolio.holdings.filter((h) => !h.demo).map((h) => h.symbol),
      ),
    ];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, symbols.length) }, async () => {
        while (next < symbols.length) {
          const symbol = symbols[next++];
          if (!valid()) return;
          try {
            const data = await request(
              "/api/quote?symbol=" + encodeURIComponent(symbol),
            );
            if (valid()) model.quotes[symbol] = data;
          } catch (error) {
            if (valid())
              model.quotes[symbol] = {
                ...model.quotes[symbol],
                error: error.message,
              };
          }
        }
      }),
    );
    if (epoch !== refreshEpoch) return;
    model.busy = false;
    if (
      model.currentUser === user &&
      (model.state !== portfolio ||
        model.state.holdings.some(
          (h) => !h.demo && !symbols.includes(h.symbol),
        ))
    ) {
      await refresh();
      return;
    }
    if (
      valid() &&
      model.page === "portfolio" &&
      !document.querySelector("#modal").open
    )
      render();
  }

  boot();
  setInterval(() => {
    if (
      model.currentUser &&
      !document.hidden &&
      model.page === "portfolio" &&
      !$("#modal").open &&
      model.state.holdings.length
    )
      refresh();
  }, 300000);
}
