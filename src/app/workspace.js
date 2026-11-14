import { installMotion, setAnimatedText } from "../shared/motion.js";
import { mountViewport } from "../shared/viewport.js";
import { mountIntelligence } from "../features/intelligence/workspace.js";
import { mountMacro } from "../features/macro/workspace.js";
import { mountAISettings } from "../features/intelligence/settings.js";
import { createSaveQueue } from "../shared/save-queue.js";
import { parseRoute, routeURL } from "./router.js";
import { createWorkspaceModel } from "./model.js";
import { workspaceView } from "./view.js";
import { emptyPortfolio } from "../domain/portfolio.js";
import { qty, basis } from "../domain/portfolio.js";
import { validatePortfolio as validate } from "../domain/portfolio-validation.js";
import { $, esc, today, money } from "../shared/format.js";
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
import { setChartWorkspaceOwner } from "../features/charts/analysis-chart.js";
import { createPlanner } from "../features/planner/controller.js";
import { createPurchases } from "../features/portfolio/purchases.js";
import { createActivity } from "../features/activity/controller.js";
import { createSettings } from "../features/settings/controller.js";
export function startWorkspace() {
  mountViewport($("#app"));
  installMotion();
  const model = createWorkspaceModel();
  const current = () =>
    model.state.holdings.find((h) => h.id === model.selected) ||
    model.state.holdings[0];
  const { update, getResult } = createPlanner(model, {
    current,
    getChart: () => priceChart,
    record: (...a) => record(...a),
  });
  const { purchase, manage, demo, removeHolding } = createPurchases(model, {
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
  let priceChart = null,
    intelligence = null,
    aiSettings = null,
    macro = null;
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
    if (intelligence && !intelligence.canLeave()) {
      history.replaceState(null, "", routeURL(model.page, model.selected));
      return;
    }
    const previousPage = model.page;
    const route = parseRoute(location.hash);
    model.page = route.page;
    if (route.selected !== null) model.selected = route.selected;
    render();
    if (previousPage !== model.page)
      window.scrollTo({ top: 0, behavior: "instant" });
  });
  function navigate(page, selected = model.selected) {
    if (intelligence && !intelligence.canLeave()) return;
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
    model.intelligence = null;
    model.currentUser = user;
    setChartWorkspaceOwner(user.id || user.username);
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
      setChartWorkspaceOwner(null);
      showAuth(signedIn);
      toast(e.message);
    }
  }
  async function boot() {
    try {
      const r = await request("/api/auth/me");
      if (r.user) await signedIn(r.user);
      else {
        setChartWorkspaceOwner(null);
        showAuth(signedIn, r.registration);
      }
    } catch (e) {
      $("#app").innerHTML =
        '<main class="auth-shell"><section class="auth-card"><h1>Connection paused.</h1><p class="sub">' +
        esc(e.message) +
        '</p><button class="primary" id="retry-start">Retry</button></section></main>';
      $("#retry-start").onclick = boot;
    }
  }
  async function logout(all) {
    if (intelligence && !intelligence.canLeave()) return;
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
      setChartWorkspaceOwner(null);
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
    macro?.destroy();
    macro = null;
    intelligence?.destroy();
    intelligence = null;
    aiSettings?.destroy();
    aiSettings = null;
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
    document.querySelectorAll("[data-remove-holding]").forEach((button) => {
      button.onclick = () => removeHolding(button.dataset.removeHolding);
    });
    ["add", "add-second", "empty-add"].forEach((id) => {
      if ($("#" + id))
        $("#" + id).onclick = () => {
          if (!intelligence || intelligence.canLeave()) purchase();
        };
    });
    if ($("#demo")) $("#demo").onclick = demo;
    if ($("#refresh")) $("#refresh").onclick = refresh;
    if ($("#manage")) $("#manage").onclick = manage;
    if ($("#method")) $("#method").onclick = method;
    if ($("#sync-status")) $("#sync-status").onclick = resolveSync;
    if ($("#sellqty")) {
      ["sellqty", "sellprice", "sf", "bf", "allowance", "losses"].forEach(
        (id) => {
          $("#" + id).oninput = () => {
            if (id === "sellprice") $("#sellprice").dataset.userEdited = "true";
            update();
          };
        },
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
        $("#sellprice").dataset.userEdited = "true";
        $("#sellprice").value = quoteInput(h);
        update();
      };
      update();
    }
    if (model.page === "explore")
      intelligence = mountIntelligence($("#intelligence"), { model, navigate });
    if (model.page === "markets") macro = mountMacro($("#macro-workspace"));
    if (model.page === "settings") {
      bindSettings();
      aiSettings = mountAISettings($("#ai-settings"));
    }
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
  let quoteSignature = "";
  function quoteBusy() {
    const button = $("#refresh");
    if (button) {
      button.disabled = model.busy;
      button.classList.toggle("spinning", model.busy);
      button.setAttribute("aria-busy", String(model.busy));
    }
  }
  // Quotes update retained readouts instead of replacing the active workspace and inputs.
  function refreshReadouts() {
    if (model.page !== "portfolio" || !$("[data-portfolio-value]")) return;
    const holdings = model.state.holdings;
    const totalBasis = holdings.reduce((sum, h) => sum + basis(h), 0);
    const valued = holdings.filter((h) =>
      Number.isFinite(model.quotes[h.symbol]?.price),
    );
    const full = holdings.length > 0 && valued.length === holdings.length;
    const totalValue = valued.reduce(
      (sum, h) => sum + model.quotes[h.symbol].price * qty(h),
      0,
    );
    setAnimatedText(
      $("[data-portfolio-value]"),
      full ? money(totalValue) : "—",
    );
    setAnimatedText($("[data-portfolio-invested]"), money(totalBasis));
    const unrealized = $("[data-portfolio-unrealized]");
    setAnimatedText(unrealized, full ? money(totalValue - totalBasis) : "—");
    unrealized?.classList.toggle("positive", full && totalValue >= totalBasis);
    unrealized?.classList.toggle("negative", full && totalValue < totalBasis);
    setAnimatedText(
      $("[data-portfolio-return]"),
      full && totalBasis
        ? `${totalValue >= totalBasis ? "+" : ""}${((totalValue / totalBasis - 1) * 100).toFixed(2)}% return`
        : "Before tax",
    );
    setAnimatedText(
      $("[data-portfolio-status]"),
      holdings.some((h) => h.demo)
        ? "Includes demo data"
        : full
          ? "Latest available prices"
          : holdings.length
            ? "Waiting for quotes"
            : "Start with your first holding",
      { animate: false },
    );
    for (const button of document.querySelectorAll("[data-holding]")) {
      const holding = holdings.find((h) => h.id === button.dataset.holding);
      const quote = holding && model.quotes[holding.symbol];
      setAnimatedText(
        button.querySelector(".holding-values b"),
        quote?.price ? money(quote.price) : "—",
      );
    }
    const h = current(),
      quote = h && model.quotes[h.symbol];
    if (!h || !$("#sellprice")) return;
    const priceInput = $("#sellprice");
    const quoteAvailable = Number.isFinite(quote?.price);
    if (
      quoteAvailable &&
      priceInput.value === "" &&
      !priceInput.dataset.userEdited
    ) {
      priceInput.value = quoteInput(h);
    }
    const useQuote = $("#usequote");
    if (useQuote) useQuote.disabled = !quoteAvailable;
    const label = $(".quote-line > span");
    if (label) {
      label.title = quoteLabel(h).replace(/&[^;]+;/g, " ");
      label.textContent = h.demo
        ? "Demo price"
        : quoteAvailable
          ? `${quote.exchange || "Quote"}${quote.converted ? " · " + quote.originalCurrency + "→EUR" : ""} · ${new Date(quote.time * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`
          : "Manual price";
    }
    const error = $(".quote-error");
    if (error) error.textContent = quote?.error || "";
    // Refresh overlays independently; an edited sale price stays the user's price.
    const signature = [
      h.id,
      quote?.time,
      quote?.price,
      quote?.error,
      model.busy,
    ].join(":");
    if (signature !== quoteSignature) {
      quoteSignature = signature;
      update();
    }
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
    quoteBusy();
    refreshReadouts();
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
            if (valid()) {
              model.quotes[symbol] = data;
              refreshReadouts();
            }
          } catch (error) {
            if (valid())
              model.quotes[symbol] = {
                ...model.quotes[symbol],
                error: error.message,
              };
            if (valid()) refreshReadouts();
          }
        }
      }),
    );
    if (epoch !== refreshEpoch) return;
    model.busy = false;
    quoteBusy();
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
    if (valid()) refreshReadouts();
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
