import {
  watchlistBar,
  editWatchlists,
  chooseWatchlists,
} from "../watchlists/controls.js";
import { request } from "../../shared/http.js";
import { mountChartFullscreen } from "../../shared/chart-fullscreen.js";
import { esc } from "../../shared/format.js";
import { mountReorder, reorderHandle } from "../../shared/reorder.js";
import {
  icon,
  modal,
  close,
  toast,
  monogram,
  bindLogos,
  associateLabels,
} from "../../shared/ui.js";
import { mountAnalysisChart } from "../charts/analysis-chart.js";
import { mountAIAnalysis } from "../charts/ai-analysis.js";
import { mountSourceMonitor, monitorMatches } from "./source-monitor.js";
import { editPrivateScenario } from "./scenario-editor.js";
import { mountStrategies } from "../strategies/workspace.js";
import { mountAdmin } from "../admin/workspace.js";
import { createStudio } from "./studio.js";
import {
  sourcePanelMarkup,
  replaceSourcePanel,
  sourceCollectionBusy,
} from "./source-panel.js";
import {
  when,
  empty,
  loading,
  download,
  action,
  sourceLinks,
  scenarioCards,
} from "./shared.js";
const researchOrderPool = new Map();
const researchOrderErrors = new Set();
function trackResearchOrder(ownerId, promise) {
  const pool = researchOrderPool.get(ownerId) || new Set();
  researchOrderPool.set(ownerId, pool);
  pool.add(promise);
  const done = () => {
    pool.delete(promise);
    if (!pool.size) researchOrderPool.delete(ownerId);
  };
  promise.then(done, done);
  return promise;
}
export async function flushResearchOrders(ownerId) {
  while (researchOrderPool.get(ownerId)?.size)
    await Promise.all([...researchOrderPool.get(ownerId)]);
  if (researchOrderErrors.has(ownerId))
    throw Error(
      "Research order is not synced. Open Research to retry before signing out.",
    );
}
export const intelligenceView = () =>
  '<section class="intelligence-page" id="intelligence"></section>';
export function mountIntelligence(root, { model, navigate }) {
  const memory =
    model.intelligence ||
    (model.intelligence = { tab: "research", symbol: null, jobId: null });
  let alive = true,
    info,
    assets = [],
    watchlists = [],
    jobs = [],
    sets = [],
    journal = [],
    sources = [],
    coverage = [],
    collection = null,
    sourcePoll,
    sourceRequest = null,
    sourceGeneration = 0,
    assetLoads = 0,
    nextSourceCheck = 0,
    job = null,
    chart = null,
    aiAnalysis = null,
    sourceMonitor = null,
    sourceSignals = null,
    sourceConnections = [],
    chartSymbol = null,
    studio = null,
    strategies = null,
    admin = null,
    poll,
    searchTimer,
    searchEpoch = 0,
    navigationEpoch = 0,
    loadGeneration = 0,
    assetListGeneration = 0,
    assetMutation = 0,
    orderRevision = 0,
    pendingOrder = null,
    orderSaving = false,
    orderReconciling = false,
    orderStatus = "",
    orderStatusTimer,
    membershipBusy = 0,
    reorder = null,
    scenarioFullscreens = [],
    orderDrain = null,
    orderUnsynced = false;
  const hiddenAssets = new Set(),
    removingAssets = new Set();
  const ownerId = model.currentUser.id || model.currentUser.username;
  root.innerHTML = loading();
  const assetsURL = () =>
    "/api/research/assets" +
    (memory.watchlistId === undefined
      ? ""
      : "?list=" + encodeURIComponent(memory.watchlistId || "all"));
  async function requestAssets() {
    try {
      return await request(assetsURL());
    } catch (error) {
      if (error.status !== 404 || !memory.watchlistId) throw error;
      memory.watchlistId = null;
      orderRevision = 0;
      return request("/api/research/assets?list=all");
    }
  }
  const active = () => assets.find((a) => a.symbol === memory.symbol);
  const live = () => alive && root.isConnected;
  const canLeave = () => {
    if (studio?.isDirty()) {
      toast("Save the article draft before leaving the studio.");
      return false;
    }
    return chart?.canLeave?.() !== false;
  };
  function destroyChildren(keepChart = false, keepScenario = null) {
    scenarioFullscreens.forEach((entry) => {
      if (entry !== keepScenario) entry.fullscreen.destroy();
    });
    scenarioFullscreens = keepScenario ? [keepScenario] : [];
    strategies?.destroy();
    strategies = null;
    admin?.destroy();
    admin = null;
    if (!keepChart) {
      sourceMonitor?.destroy();
      sourceMonitor = null;
      aiAnalysis?.destroy();
      aiAnalysis = null;
      chart?.destroy();
      chart = null;
      chartSymbol = null;
    }
    studio?.destroy();
    studio = null;
  }
  function assetChips() {
    return assets
      .map(
        (a) =>
          `<span class="research-asset-item ${a.symbol === memory.symbol ? "is-selected" : ""}" data-order-symbol="${esc(a.symbol)}">${assets.length > 1 ? reorderHandle("Reorder " + a.symbol) : ""}<button type="button" class="asset-chip ${a.symbol === memory.symbol ? "selected" : ""}" data-research-asset="${esc(a.symbol)}" aria-current="${a.symbol === memory.symbol ? "true" : "false"}" ${removingAssets.has(a.symbol) ? "disabled" : ""}>${monogram(a)}<span>${esc(a.symbol)}</span>${a.automatic ? '<i class="auto-dot"></i>' : ""}</button><button type="button" class="research-asset-remove" data-reorder-ignore data-remove-research="${esc(a.symbol)}" aria-label="Remove ${esc(a.symbol)} from ${memory.watchlistId ? "watchlist" : "research"}" title="Remove from ${memory.watchlistId ? "watchlist" : "research"}" ${removingAssets.has(a.symbol) ? 'disabled aria-busy="true"' : ""}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6"/></svg></button></span>`,
      )
      .join("");
  }
  function bindWatchlistSelect() {
    const select = root.querySelector("[data-watchlist-select]");
    if (select)
      select.onchange = () =>
        switchWatchlist(select.value === "all" ? null : select.value).catch(
          (e) => toast(e.message),
        );
  }
  function patchAssetChips(focusSymbol = null) {
    const bar = root.querySelector(".watchlist-bar");
    if (bar) {
      bar.outerHTML = watchlistBar(
        watchlists,
        memory.watchlistId,
        memory.symbol,
      );
      bindWatchlistSelect();
    }
    const rail = root.querySelector(".research-assets");
    if (!rail) return;
    reorder?.destroy();
    reorder = null;
    const scroll = rail.scrollLeft;
    rail.innerHTML = assetChips();
    rail.scrollLeft = scroll;
    bindLogos();
    mountAssetReorder();
    if (focusSymbol)
      rail
        .querySelector(`[data-research-asset="${CSS.escape(focusSymbol)}"]`)
        ?.focus({ preventScroll: true });
  }
  function orderFeedback(value = "") {
    orderStatus = value;
    const label = root.querySelector("[data-research-order-state]");
    if (label) label.textContent = value;
    const retry = root.querySelector("[data-research-order-retry]");
    if (retry) retry.hidden = !orderUnsynced;
  }
  function syncReorderHandles() {
    root
      .querySelectorAll(".research-assets [data-reorder-handle]")
      .forEach((handle) => {
        handle.disabled = !!(
          removingAssets.size ||
          membershipBusy ||
          orderReconciling ||
          orderUnsynced ||
          assets.length < 2
        );
      });
  }
  function adoptAssets(response, canonical = false) {
    if (memory.watchlistId !== response.selectedId) orderRevision = 0;
    memory.watchlistId = response.selectedId || null;
    watchlists = response.watchlists || watchlists;
    if (
      Number.isSafeInteger(response.orderRevision) &&
      response.orderRevision < orderRevision
    )
      return false;
    const incoming = response.assets.filter(
      (a) => memory.watchlistId || !hiddenAssets.has(a.symbol),
    );
    if (Number.isSafeInteger(response.orderRevision))
      orderRevision = Math.max(orderRevision, response.orderRevision);
    if (!canonical && (orderSaving || pendingOrder)) {
      const bySymbol = new Map(incoming.map((a) => [a.symbol, a]));
      assets = [
        ...assets.map((a) => bySymbol.get(a.symbol)).filter(Boolean),
        ...incoming.filter(
          (a) => !assets.some((current) => current.symbol === a.symbol),
        ),
      ];
    } else assets = incoming;
    if (!orderSaving && !pendingOrder) researchOrderErrors.delete(ownerId);
    return true;
  }
  function mountAssetReorder() {
    reorder?.destroy();
    reorder = null;
    const rail = root.querySelector(".research-assets");
    if (!rail || assets.length < 2) return;
    reorder = mountReorder(rail, {
      itemSelector: ".research-asset-item",
      key: (item) => item.dataset.orderSymbol,
      axis: "x",
      activationSelector: ".asset-chip",
      disabled: () =>
        !!(
          removingAssets.size ||
          membershipBusy ||
          orderReconciling ||
          orderUnsynced
        ),
      onReorder: (symbols) => {
        const bySymbol = new Map(assets.map((a) => [a.symbol, a]));
        if (
          symbols.length !== assets.length ||
          new Set(symbols).size !== assets.length ||
          symbols.some((symbol) => !bySymbol.has(symbol))
        ) {
          patchAssetChips();
          return;
        }
        assets = symbols.map((symbol) => bySymbol.get(symbol));
        assetMutation++;
        pendingOrder = [...symbols];
        clearTimeout(orderStatusTimer);
        orderFeedback("Saving…");
        if (!orderSaving)
          orderDrain = trackResearchOrder(ownerId, persistAssetOrder());
      },
    });
    syncReorderHandles();
  }
  async function persistAssetOrder() {
    if (orderSaving) return;
    orderSaving = true;
    try {
      while (
        pendingOrder &&
        (model.currentUser?.id || model.currentUser?.username) === ownerId
      ) {
        const wanted = pendingOrder;
        pendingOrder = null;
        const currentSymbols = new Set(assets.map((a) => a.symbol));
        const symbols = [
          ...wanted.filter((symbol) => currentSymbols.has(symbol)),
          ...assets
            .map((a) => a.symbol)
            .filter((symbol) => !wanted.includes(symbol)),
        ];
        const reply = await request("/api/research/order", "PUT", {
          symbols,
          revision: orderRevision,
          listId: memory.watchlistId || undefined,
        });
        orderRevision = Math.max(orderRevision, reply.revision);
      }
      if (
        live() &&
        (model.currentUser?.id || model.currentUser?.username) === ownerId
      ) {
        researchOrderErrors.delete(ownerId);
        orderFeedback("Saved");
        orderStatusTimer = setTimeout(() => {
          if (live()) orderFeedback();
        }, 1600);
      } else if (
        (model.currentUser?.id || model.currentUser?.username) === ownerId
      )
        window.dispatchEvent(
          new CustomEvent("reentry:research-order-saved", {
            detail: { ownerId },
          }),
        );
    } catch (error) {
      pendingOrder = null;
      orderReconciling = true;
      assetMutation++;
      if ((model.currentUser?.id || model.currentUser?.username) === ownerId) {
        let restored = false;
        try {
          restored = await readCanonicalOrder();
        } catch {
          /* Keep the failed order actionable until a canonical read succeeds. */
        }
        orderUnsynced = !restored;
        if (restored) researchOrderErrors.delete(ownerId);
        else researchOrderErrors.add(ownerId);
        if (live()) orderFeedback(restored ? "" : "Order not synced");
        if ((model.currentUser?.id || model.currentUser?.username) === ownerId)
          toast(
            restored
              ? error.status === 409
                ? "Research order changed elsewhere. Latest order restored."
                : error.message
              : "Research order is not synced.",
            restored ? {} : { actionLabel: "Retry", onAction: retryOrderSync },
          );
      }
    } finally {
      orderSaving = false;
      orderReconciling = false;
      if (live()) syncReorderHandles();
      else window.removeEventListener("beforeunload", warnOrderUnload);
    }
  }
  async function readCanonicalOrder() {
    if ((model.currentUser?.id || model.currentUser?.username) !== ownerId)
      return false;
    if (live()) return refreshAssetList({ canonical: true });
    const response = await requestAssets();
    if (
      (model.currentUser?.id || model.currentUser?.username) !== ownerId ||
      !Array.isArray(response.assets) ||
      !Number.isSafeInteger(response.orderRevision) ||
      response.orderRevision < orderRevision
    )
      return false;
    orderRevision = Math.max(orderRevision, response.orderRevision);
    window.dispatchEvent(
      new CustomEvent("reentry:research-order-saved", { detail: { ownerId } }),
    );
    return true;
  }
  async function retryOrderSync() {
    if (orderSaving || orderReconciling) return;
    orderReconciling = true;
    if (live()) {
      syncReorderHandles();
      orderFeedback("Syncing…");
    }
    try {
      if (!(await readCanonicalOrder()))
        throw Error("Research order is not synced. Retry when connected.");
      orderUnsynced = false;
      researchOrderErrors.delete(ownerId);
      if (live()) orderFeedback();
    } catch (error) {
      orderUnsynced = true;
      researchOrderErrors.add(ownerId);
      if (live()) orderFeedback("Order not synced");
      throw error;
    } finally {
      orderReconciling = false;
      if (live()) syncReorderHandles();
    }
  }
  const warnOrderUnload = (event) => {
    if (
      (model.currentUser?.id || model.currentUser?.username) === ownerId &&
      (orderSaving || pendingOrder || (live() && orderUnsynced))
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", warnOrderUnload);
  async function withMembershipChange(fn) {
    membershipBusy++;
    reorder?.cancel();
    if (live()) syncReorderHandles();
    try {
      await orderDrain;
      if ((model.currentUser?.id || model.currentUser?.username) !== ownerId)
        throw Error("Sign in to update this research list.");
      return await fn();
    } finally {
      membershipBusy--;
      if (live()) syncReorderHandles();
    }
  }
  function clearAssetSelection(symbol) {
    memory.symbol = symbol;
    memory.jobId =
      memory.aiJobId =
      memory.aiEventKey =
      memory.monitorJobId =
      memory.monitorChange =
      memory.focusSetId =
        null;
    coverage = [];
    sources = [];
    collection = null;
    job = null;
    sourceSignals = null;
    sourceConnections = [];
  }
  async function refreshAssetList({ canonical = false } = {}) {
    const generation = ++assetListGeneration,
      mutation = assetMutation;
    const response = await requestAssets();
    if (
      !live() ||
      generation !== assetListGeneration ||
      mutation !== assetMutation
    )
      return false;
    if (adoptAssets(response, canonical) === false) return false;
    if (
      !assets.some((a) => a.symbol === memory.symbol) &&
      assets.length &&
      ["research", "strategies", "scenarios"].includes(memory.tab)
    ) {
      const operation = ++navigationEpoch;
      clearAssetSelection(assets[0].symbol);
      await loadAsset();
      if (live() && operation === navigationEpoch) render();
    } else patchAssetChips();
    return true;
  }
  const onResearchAssetRestored = (event) => {
    if (!live() || event.detail?.ownerId !== ownerId) return;
    hiddenAssets.delete(event.detail.symbol);
    assetMutation++;
    membershipBusy++;
    reorder?.cancel();
    syncReorderHandles();
    refreshAssetList()
      .catch((e) => live() && toast(e.message))
      .finally(() => {
        membershipBusy--;
        if (live()) syncReorderHandles();
      });
  };
  window.addEventListener(
    "reentry:research-asset-restored",
    onResearchAssetRestored,
  );
  const onOrderSaved = (event) => {
    if (live() && event.detail?.ownerId === ownerId)
      refreshAssetList().catch(() => {});
  };
  window.addEventListener("reentry:research-order-saved", onOrderSaved);
  async function removeResearchAsset(symbol) {
    const removedFromList = memory.watchlistId;
    const removed = assets.find((a) => a.symbol === symbol);
    if (!removed || removingAssets.has(symbol)) return;
    const wasActive = memory.symbol === symbol;
    if (wasActive && !canLeave()) return;
    if (wasActive) navigationEpoch++;
    const oldIndex = assets.findIndex((a) => a.symbol === symbol);
    const hadFocus =
      root.querySelector(`[data-remove-research="${CSS.escape(symbol)}"]`) ===
      document.activeElement;
    removingAssets.add(symbol);
    membershipBusy++;
    assetMutation++;
    patchAssetChips();
    try {
      await orderDrain;
      if ((model.currentUser?.id || model.currentUser?.username) !== ownerId)
        return;
      await request(
        (memory.watchlistId
          ? "/api/watchlists/" + memory.watchlistId + "/assets/"
          : "/api/research/assets/") + encodeURIComponent(symbol),
        "DELETE",
      );
      if ((model.currentUser?.id || model.currentUser?.username) !== ownerId)
        return;
      if (!memory.watchlistId) hiddenAssets.add(symbol);
      assetMutation++;
      assets = assets.filter((a) => a.symbol !== symbol);
      removingAssets.delete(symbol);
      const nearest =
        assets[Math.min(oldIndex, assets.length - 1)]?.symbol || null;
      if (live()) {
        const focusStillAvailable =
          hadFocus &&
          (!root.contains(document.activeElement) ||
            document.activeElement === document.body);
        if (memory.symbol === symbol) {
          const operation = ++navigationEpoch;
          const assetPage = ["research", "strategies", "scenarios"].includes(
            memory.tab,
          );
          clearAssetSelection(nearest);
          if (!nearest && assetPage) memory.tab = "research";
          try {
            await loadAsset();
          } catch (e) {
            if (live()) toast(e.message);
          }
          if (live() && operation === navigationEpoch) {
            if (assetPage) {
              render();
              if (nearest) patchAssetChips(nearest);
              else
                root
                  .querySelector("#research-search")
                  ?.focus({ preventScroll: true });
            } else patchAssetChips();
          }
        } else patchAssetChips(focusStillAvailable ? nearest : null);
      }
      toast(
        symbol +
          (removedFromList
            ? " removed from watchlist"
            : " removed from research"),
        {
          actionLabel: "Undo",
          onAction: () =>
            withMembershipChange(async () => {
              await orderDrain;
              if (
                (model.currentUser?.id || model.currentUser?.username) !==
                ownerId
              )
                throw Error("Sign in to restore this asset.");
              if (!removedFromList && !hiddenAssets.has(symbol)) return;
              await request(
                "/api/research/assets/" + encodeURIComponent(symbol),
                "PUT",
                {
                  watchlistId: removedFromList || undefined,
                  name: removed.name,
                  assetType: removed.assetType,
                  isin: removed.isin,
                  automatic: false,
                  intervalHours: removed.interval_hours || 24,
                },
              );
              hiddenAssets.delete(symbol);
              window.dispatchEvent(
                new CustomEvent("reentry:research-asset-restored", {
                  detail: { ownerId, symbol },
                }),
              );
            }),
        },
      );
    } catch (e) {
      if (live()) {
        removingAssets.delete(symbol);
        patchAssetChips();
        toast(e.message);
      }
    } finally {
      if (live()) {
        try {
          if (await refreshAssetList({ canonical: orderUnsynced })) {
            orderUnsynced = false;
            if (!orderSaving) orderFeedback();
          }
        } catch {
          /* Retry the account's list on its next successful load. */
        }
      }
      membershipBusy--;
      if (live()) syncReorderHandles();
    }
  }
  async function load() {
    const generation = ++loadGeneration,
      mutation = assetMutation;
    const data = await Promise.all([
      request("/api/intelligence"),
      requestAssets(),
      request("/api/research/jobs"),
      request("/api/scenarios"),
      request("/api/public/journal"),
    ]);
    if (!live() || generation !== loadGeneration || mutation !== assetMutation)
      return;
    [info] = data;
    adoptAssets(data[1]);
    jobs = data[2].jobs.filter((j) =>
      ["research", "map-article"].includes(j.kind),
    );
    sets = data[3].sets;
    journal = data[4].articles;
    if (!assets.some((a) => a.symbol === memory.symbol))
      memory.symbol = assets[0]?.symbol || null;
    await loadAsset();
    if (live()) render();
  }
  async function loadAsset() {
    if (!active()) {
      sources = [];
      coverage = [];
      collection = null;
      job = null;
      return;
    }
    const selected = memory.symbol,
      generation = ++sourceGeneration;
    sourceRequest?.abort();
    assetLoads++;
    try {
      const [data, monitored] = await Promise.all([
        request(
          "/api/research/sources?" + new URLSearchParams({ symbol: selected }),
        ),
        request(
          "/api/source-monitor?" + new URLSearchParams({ symbol: selected }),
        ).catch(() => null),
      ]);
      const wanted =
        jobs.find((j) => j.id === memory.jobId && j.symbol === selected) ||
        jobs.find(
          (j) =>
            j.symbol === selected &&
            j.kind === "research" &&
            j.status === "completed",
        );
      const detail = wanted
        ? await request("/api/research/jobs/" + wanted.id)
        : null;
      if (
        !live() ||
        selected !== memory.symbol ||
        generation !== sourceGeneration
      )
        return;
      applySources(data);
      sourceSignals = monitored?.latest || null;
      sourceConnections = monitored?.signals || [];
      job = detail;
    } finally {
      assetLoads--;
    }
  }
  function applySources(data) {
    sources = data.sources || [];
    collection = data.collection || null;
    coverage = collection?.coverage || data.coverage || [];
    nextSourceCheck =
      Date.now() + (sourceCollectionBusy(collection) ? 5000 : 60000);
  }
  function sourcePanel() {
    return sourcePanelMarkup({
      sources,
      coverage,
      collection,
      connectors: info.connectors,
    });
  }
  async function refreshSources() {
    if (!live() || !active() || assetLoads || memory.tab !== "research") return;
    const selected = memory.symbol,
      generation = ++sourceGeneration;
    sourceRequest?.abort();
    const controller = new AbortController();
    sourceRequest = controller;
    try {
      const data = await request(
        "/api/research/sources?" + new URLSearchParams({ symbol: selected }),
        "GET",
        undefined,
        { signal: controller.signal },
      );
      if (
        !live() ||
        selected !== memory.symbol ||
        generation !== sourceGeneration ||
        memory.tab !== "research"
      )
        return;
      const previous = JSON.stringify({ sources, collection, coverage });
      applySources(data);
      if (previous !== JSON.stringify({ sources, collection, coverage })) {
        const metrics = root.querySelector("[data-research-metrics]");
        const markup = metricsPanel();
        if (metrics && metrics.innerHTML !== markup) metrics.innerHTML = markup;
        replaceSourcePanel(root.querySelector(".source-panel"), sourcePanel());
      }
    } finally {
      if (sourceRequest === controller) sourceRequest = null;
    }
  }
  function resultPanel() {
    if (!job) return "";
    if (!job.result)
      return empty(
        job.status === "failed"
          ? "This run paused."
          : job.status === "completed"
            ? "Research complete."
            : "Research in progress.",
        job.error || "Sources → model → evidence checks → private brief",
      );
    const r = job.result,
      counts = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
    r.sentiment.forEach((s) => counts[s.label]++);
    const total = r.sentiment.length;
    return `<section class="panel brief-panel"><div class="section-line"><div><span class="eyebrow">${job.kind === "map-article" ? "ARTICLE MAPPING" : "AI RESEARCH"} / PRIVATE</span><h2>${job.kind === "map-article" ? "Mapping" : "Brief"}</h2></div><span class="small">${esc(job.model)}<br>${esc(when(job.createdAt))}</span></div><p class="brief-summary">${esc(r.summary)}</p>${
      total
        ? `<div class="sentiment-block"><div class="section-line"><span class="eyebrow">SOURCE SENTIMENT</span><span class="small">${total} sources</span></div><div class="sentiment-bar" role="img" aria-label="${Object.entries(
            counts,
          )
            .map(([k, n]) => n + " " + k)
            .join(", ")}">${Object.entries(counts)
            .map(([k, n]) =>
              n
                ? `<span class="${k}" style="flex:${n}" title="${k}: ${n}"></span>`
                : "",
            )
            .join("")}</div><div class="sentiment-key">${Object.entries(counts)
            .map(
              ([k, n]) => `<span class="${k}"><i></i>${k} <b>${n}</b></span>`,
            )
            .join(
              "",
            )}</div><details><summary>Inspect sentiment evidence</summary>${r.sentiment.map((s) => `<p class="small"><b>${esc(s.label)}</b> · ${esc(s.rationale)} ${sourceLinks([s.sourceId], job.sources)}</p>`).join("")}</details></div>`
        : ""
    }<div class="claim-grid">${r.claims.map((c) => `<article class="claim"><span class="eyebrow">${c.kind === "fact" ? "REPORTED" : "INFERENCE"}</span><p>${esc(c.text)}</p>${sourceLinks(c.sourceIds, job.sources)}</article>`).join("")}</div>${r.eventMatches?.length ? `<div class="event-suggestions"><span class="eyebrow">POSSIBLE CONDITION MATCHES / REVIEW REQUIRED</span>${r.eventMatches.map((m, i) => `<div><p>${esc(m.rationale)}</p>${sourceLinks(m.sourceIds, job.sources)} <button class="secondary small-button" data-match="${i}">Review event ${icon("arrow")}</button></div>`).join("")}</div>` : ""}${job.kind === "map-article" && info.author ? `<div class="inline-notice">${r.scenarios.length} branches mapped to article passages.<button class="primary small-button" data-apply-map>Review in studio ${icon("arrow")}</button></div>` : r.scenarios.length ? `<button class="secondary" data-tab="scenarios">View ${r.scenarios.length} scenario branches ${icon("arrow")}</button>` : ""}<details class="brief-limitations"><summary>Sources · ${job.sources.length}</summary>${job.coverage.map((c) => `<p class="small">${esc(c.label)} · ${esc(c.status)} · ${c.count} sources</p>`).join("")}</details></section>`;
  }
  function metricsPanel() {
    const source = sources.find((s) => s.kind === "fundamentals");
    if (!source) return "";
    let metrics;
    try {
      metrics = JSON.parse(source.content).metrics;
    } catch {
      return "";
    }
    if (!metrics || !Object.keys(metrics).length) return "";
    const names = {
      Assets: "Total assets",
      CashAndCashEquivalentsAtCarryingValue: "Cash & equivalents",
      Revenues: "Revenue",
      NetIncomeLoss: "Net income",
    };
    return `<section class="fundamentals-strip" aria-label="Reported financial metrics">${Object.entries(
      metrics,
    )
      .filter(([key, m]) => names[key] && Number.isFinite(m.val))
      .map(
        ([key, m]) =>
          `<div><span class="eyebrow">${esc(names[key])}</span><strong>${esc(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(m.val))}</strong><small>${m.start ? esc(m.start) + " → " : "As of "}${esc(m.end)}<br>Filed ${esc(m.filed)} · ${esc(m.form)}</small></div>`,
      )
      .join(
        "",
      )}<span class="small">SEC-reported periods · not normalized TTM</span></section>`;
  }
  function research() {
    if (!active())
      return empty(
        "Select an asset",
        "",
        `<button class="primary" data-focus-search>Find an asset ${icon("arrow")}</button>`,
      );
    const a = active(),
      pending = jobs.find(
        (j) =>
          j.symbol === a.symbol && ["queued", "running"].includes(j.status),
      );
    return `<section class="research-command"><div class="row">${monogram(a)}<div><h2>${esc(a.name)}</h2><span class="small">${esc(a.symbol)}</span></div></div></section><div id="research-chart" class="research-chart"></div><section class="research-actions"><div class="research-controls"><label class="automation-control"><span>Auto brief</span><select id="research-schedule" aria-label="Automatic research frequency"><option value="0" ${!a.automatic ? "selected" : ""}>Off</option>${[
      [6, "Every 6 hours"],
      [24, "Daily"],
      [168, "Weekly"],
    ]
      .map(
        ([h, l]) =>
          `<option value="${h}" ${a.automatic && a.interval_hours === h ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select></label><button class="primary" data-run ${pending ? "disabled" : ""}>${icon("sparkles")}${pending ? (pending.status === "running" ? "Researching…" : "Queued…") : "Run research"}</button></div></section>${a.automatic ? `<div class="automation-note small">${info.preferences.enabled ? "Next automatic brief: " + esc(when(a.next_run)) : "Automation paused · enable AI in settings"}</div>` : ""}${pending ? `<div class="job-progress" role="status"><i></i><span>${pending.status === "running" ? "Researching…" : "Queued"}</span>${pending.status === "queued" ? `<button class="link" data-cancel-job="${esc(pending.id)}">Cancel</button>` : ""}</div>` : ""}<section id="source-monitor"></section><div data-research-metrics>${metricsPanel()}</div><div class="research-main ${job ? "has-brief" : ""}">${resultPanel()}${sourcePanel()}</div><details class="run-history"><summary>Research history · ${jobs.filter((j) => j.symbol === a.symbol).length}</summary>${jobs
      .filter((j) => j.symbol === a.symbol)
      .slice(0, 20)
      .map(
        (j) =>
          `<button class="run-row" data-job="${esc(j.id)}"><span>${esc(j.kind)}<small>${esc(when(j.created_at))}</small></span><span>${esc(j.status)} ${icon("arrow")}</span></button>`,
      )
      .join("")}</details>`;
  }
  function scenarios() {
    const visible = sets.filter(
      (s) => !memory.symbol || s.symbol === memory.symbol,
    );
    return visible.length
      ? `<div class="section-line"><div><span class="eyebrow"></span><h2>Scenarios</h2></div></div>${visible
          .map(
            (s) =>
              `<section class="panel live-scenario ${s.id === memory.focusSetId ? "is-focused" : ""}" data-scenario-set="${esc(s.id)}"><div class="scenario-set-meta"><span class="privacy-chip">${s.provenance?.kind === "published-article" ? "RNT · published edition " + s.provenance.revision : s.provenance?.kind === "public-fork" ? "Private copy of RNT · edition " + s.provenance.revision : s.provenance?.kind === "private-revision" ? "Private · your revision" : s.provenance?.kind === "ai-chart" ? "AI chart · daily closes" : s.provenance?.kind === "ai-research" ? "Private · AI proposal" : "Private · your scenario"}</span><div class="scenario-set-tools">${s.provenance?.kind !== "published-article" ? `<button class="link" data-revise-set="${esc(s.id)}">Revise privately ${icon("arrow")}</button>` : ""}<button class="link" data-check-set="${esc(s.id)}">Refresh price ${icon("refresh")}</button></div></div>${scenarioCards(s, true, { selectedKey: s.id === memory.focusSetId ? memory.aiEventKey : null })}<div class="scenario-foot"><span>Created ${esc(when(s.createdAt))}</span><span>${s.counts.prices} price samples · ${s.counts.events} verified events</span></div>${
                s.observations.some((o) => o.kind === "event" && o.verified)
                  ? `<details><summary>Verified events</summary>${s.observations
                      .filter((o) => o.kind === "event" && o.verified)
                      .map(
                        (o) =>
                          `<p class="small">${esc(o.source)} · ${esc(when(o.occurredAt))} <button class="link" data-retract="${esc(o.id)}" data-set="${esc(s.id)}">Retract verification</button></p>`,
                      )
                      .join("")}</details>`
                  : ""
              }</section>`,
          )
          .join("")}`
      : empty(
          "No scenarios",
          "",
          `<button class="secondary" data-tab="journal">Explore the journal ${icon("arrow")}</button>`,
        );
  }
  function mountScenarioFullscreens() {
    for (const panel of root.querySelectorAll(".live-scenario")) {
      const retained = scenarioFullscreens.find(
        (entry) => entry.panel === panel,
      );
      if (!panel.querySelector(":scope > .scenario-fs-canvas")) {
        const canvas = document.createElement("div"),
          layout = document.createElement("div"),
          metadata = panel.querySelector(".scenario-set-meta");
        canvas.className = "scenario-fs-canvas";
        layout.className = "scenario-fs-layout";
        for (const child of [...panel.children])
          if (
            child !== metadata &&
            !child.classList.contains("chart-fs-header")
          )
            layout.append(child);
        canvas.append(layout);
        panel.append(canvas);
      }
      panel.style.setProperty(
        "--scenario-fs-branches",
        String(Math.max(1, panel.querySelectorAll(".scenario-node").length)),
      );
      if (retained) {
        retained.fullscreen.refresh();
        continue;
      }
      const fullscreen = mountChartFullscreen(panel, {
        label: () => {
          const scenario = sets.find(
            (set) => set.id === panel.dataset.scenarioSet,
          );
          return `${scenario?.symbol || memory.symbol} · ${scenario?.title || "Scenarios"}`;
        },
        buttonHost: () => panel.querySelector(".scenario-set-tools"),
        native: true,
      });
      panel.addEventListener(
        "click",
        (event) => {
          if (event.target.closest("a[href]")) fullscreen.close();
        },
        true,
      );
      scenarioFullscreens.push({ panel, fullscreen });
    }
  }
  function journalView() {
    return `<div class="section-line"><div><span class="eyebrow">RNT</span><h2>Journal</h2></div><a class="link" href="/journal" target="_blank" rel="noopener">Open public journal ${icon("arrow")}</a></div>${journal.length ? `<div class="public-articles">${journal.map((a) => `<article class="journal-public-card"><span class="eyebrow">${esc(a.symbol)} / EDITION ${a.revision}</span><h2>${esc(a.title)}</h2><p>${esc(a.excerpt)}</p><div class="actions"><a class="link" href="/journal/${esc(a.slug)}" target="_blank" rel="noopener">Read article ${icon("arrow")}</a><button class="secondary small-button" data-fork="${esc(a.slug)}" data-revision="${a.revision}">Copy scenarios privately</button></div><small>${esc(when(a.publishedAt))} · RNT</small></article>`).join("")}</div>` : empty("No published articles", "")}`;
  }
  function render() {
    if (!live()) return;
    reorder?.destroy();
    reorder = null;
    const retainedScenario =
      memory.tab === "scenarios"
        ? scenarioFullscreens.find(
            (entry) =>
              entry.fullscreen.isActive() &&
              sets.some(
                (set) =>
                  set.id === entry.panel.dataset.scenarioSet &&
                  (!memory.symbol || set.symbol === memory.symbol),
              ),
          )
        : null;
    const scenarioViewport = retainedScenario
      ? {
          top:
            retainedScenario.panel.querySelector(".scenario-fs-canvas")
              ?.scrollTop || 0,
          left:
            retainedScenario.panel.querySelector(".scenario-fs-canvas")
              ?.scrollLeft || 0,
          details: [
            ...retainedScenario.panel.querySelectorAll(".scenario-node"),
          ].map((node) => ({
            key: node.dataset.scenarioKey,
            open: [...node.querySelectorAll("details")].map(
              (details) => details.open,
            ),
          })),
          eventsOpen: !!retainedScenario.panel.querySelector(
            ".scenario-fs-layout > details[open]",
          ),
        }
      : null;
    const retainedChart =
      memory.tab === "research" && chartSymbol === memory.symbol
        ? root.querySelector("#research-chart")
        : null;
    const retainedMonitor = retainedChart
      ? root.querySelector("#source-monitor")
      : null;
    const focusedChartField =
      retainedChart?.contains(document.activeElement) ||
      retainedMonitor?.contains(document.activeElement)
        ? document.activeElement
        : null;
    destroyChildren(!!retainedChart, retainedScenario);
    root.innerHTML = `<header class="workbench-heading"><h1>${memory.tab === "studio" ? "Studio" : memory.tab === "admin" ? "Owner" : memory.tab === "journal" ? "Journal" : "Research"}</h1><button class="link" data-ai-settings>Models ${icon("arrow")}</button></header><div class="research-dock"><nav class="intelligence-tabs" aria-label="Intelligence navigation">${[
      ["research", "Overview"],
      ["strategies", "Strategies"],
      ["scenarios", "Scenarios"],
      ["journal", "Journal"],
      ...(info.author
        ? [
            ["studio", "Studio"],
            ["admin", "Owner"],
          ]
        : []),
    ]
      .map(
        ([id, label]) =>
          `<button data-tab="${id}" aria-current="${memory.tab === id ? "page" : "false"}">${label}</button>`,
      )
      .join(
        "",
      )}</nav></div>${["journal", "studio", "admin"].includes(memory.tab) ? "" : watchlistBar(watchlists, memory.watchlistId, memory.symbol)}<div class="research-asset-bar" ${["journal", "studio", "admin"].includes(memory.tab) ? "hidden" : ""}><div class="research-assets">${assetChips()}</div><span class="research-order-state"><span data-research-order-state role="status">${esc(orderStatus)}</span><button type="button" data-research-order-retry ${!orderUnsynced ? "hidden" : ""}>Retry</button></span><div class="research-search"><input id="research-search" type="search" autocomplete="off" placeholder="Find an asset" aria-label="Search assets to research"><div id="research-search-results" class="research-search-results" role="list"></div></div></div><div id="intelligence-content">${memory.tab === "research" ? research() : memory.tab === "scenarios" ? scenarios() : memory.tab === "journal" ? journalView() : memory.tab === "strategies" ? (active() ? '<div id="strategy-workspace"></div>' : empty("Select an asset", "", `<button class="link" data-focus-search>Find asset ${icon("arrow")}</button>`)) : memory.tab === "admin" && info.author ? '<div id="owner-workspace"></div>' : '<div id="author-studio"></div>'}</div><div class="intelligence-footer"><button class="link" data-export-research>Export my research ${icon("download")}</button></div>`;
    bindWatchlistSelect();
    if (memory.tab === "strategies" && active())
      strategies = mountStrategies(root.querySelector("#strategy-workspace"), {
        symbol: memory.symbol,
        currency: "EUR",
        ownerId: model.currentUser.id || model.currentUser.username,
      });
    if (memory.tab === "admin" && info.author)
      admin = mountAdmin(root.querySelector("#owner-workspace"), {
        navigate,
        onStudio: () => {
          memory.tab = "studio";
          render();
        },
      });
    if (memory.tab === "research" && active()) {
      if (retainedChart) {
        root.querySelector("#research-chart").replaceWith(retainedChart);
        chart.refreshFullscreen?.();
        focusedChartField?.focus({ preventScroll: true });
      } else {
        chart = mountAnalysisChart(
          root.querySelector("#research-chart"),
          active(),
          {
            ownerId: model.currentUser.id || model.currentUser.username,
            onContextChange: () => aiAnalysis?.updateContext(),
            onAISelect: (eventKey) => aiAnalysis?.setSelection(eventKey),
            onAITree: () => aiAnalysis?.openScenario(),
          },
        );
        chartSymbol = memory.symbol;
        const aiRoot = document.createElement("section");
        aiRoot.className = "ai-analysis";
        const aiBody = document.createElement("aside");
        aiBody.className = "ai-analysis-detail";
        aiBody.hidden = true;
        aiBody.setAttribute("aria-label", "AI chart evidence and scenarios");
        root.querySelector(".ta-toolbar").after(aiRoot);
        root.querySelector("#research-chart").append(aiBody);
        aiAnalysis = mountAIAnalysis(aiRoot, {
          asset: active(),
          bodyRoot: aiBody,
          getChartContext: () =>
            chart?.getContext() || { range: "1y", currency: "EUR" },
          onLayer: (layer) => chart?.setAILayer(layer),
          initialJobId: memory.aiJobId,
          initialEventKey: memory.aiEventKey,
          onSettings: () => navigate("settings"),
          onComplete: () => {
            if (live())
              root
                .querySelector(".ta-heading")
                ?.scrollIntoView({ block: "start", behavior: "smooth" });
          },
          onScenario: async ({ setId, eventKey, jobId }) => {
            const selectedSymbol = memory.symbol,
              operation = ++navigationEpoch;
            try {
              const [response, selectedSet] = await Promise.all([
                request("/api/scenarios"),
                request("/api/scenarios/" + encodeURIComponent(setId)),
              ]);
              if (
                !live() ||
                operation !== navigationEpoch ||
                memory.tab !== "research" ||
                memory.symbol !== selectedSymbol
              )
                return;
              sets = [
                selectedSet,
                ...response.sets.filter((s) => s.id !== setId),
              ];
              memory.focusSetId = setId;
              memory.aiEventKey = eventKey;
              memory.aiJobId = jobId;
              memory.tab = "scenarios";
              render();
              root
                .querySelector(`[data-scenario-set="${CSS.escape(setId)}"]`)
                ?.scrollIntoView({ block: "start", behavior: "smooth" });
            } catch (e) {
              toast(e.message);
            }
          },
        });
      }
    }
    if (memory.tab === "research" && active()) {
      if (retainedMonitor)
        root.querySelector("#source-monitor").replaceWith(retainedMonitor);
      else {
        const monitoredSymbol = memory.symbol;
        sourceMonitor = mountSourceMonitor(
          root.querySelector("#source-monitor"),
          {
            asset: active(),
            initialJobId: memory.monitorJobId,
            initialChange: memory.monitorChange ?? null,
            onSettings: () => navigate("settings"),
            onTree: openSourceTree,
            onVerify: async ({
              setId,
              eventKey,
              suggestion,
              sources: evidenceSources,
            }) => {
              const operation = ++navigationEpoch;
              try {
                const selectedSet = await request(
                  "/api/scenarios/" + encodeURIComponent(setId),
                );
                if (
                  !live() ||
                  operation !== navigationEpoch ||
                  memory.symbol !== monitoredSymbol
                )
                  return;
                sets = [selectedSet, ...sets.filter((s) => s.id !== setId)];
                await verify(setId, eventKey, suggestion, evidenceSources);
              } catch (e) {
                if (live()) toast(e.message);
              }
            },
            onSignals: (connections) => {
              if (live() && memory.symbol === monitoredSymbol)
                sourceConnections = connections;
            },
            onUpdate: (detail) => {
              if (
                !live() ||
                memory.symbol !== monitoredSymbol ||
                detail?.status !== "completed"
              )
                return;
              if (
                !sourceSignals ||
                sourceSignals.symbol !== monitoredSymbol ||
                detail.createdAt >= sourceSignals.createdAt
              )
                sourceSignals = detail;
            },
          },
        );
      }
      focusedChartField?.focus({ preventScroll: true });
    }
    if (memory.tab === "scenarios") {
      if (retainedScenario) {
        const replacement = root.querySelector(
          `[data-scenario-set="${CSS.escape(retainedScenario.panel.dataset.scenarioSet)}"]`,
        );
        retainedScenario.panel.classList.toggle(
          "is-focused",
          replacement.classList.contains("is-focused"),
        );
        retainedScenario.panel.replaceChildren(...replacement.childNodes);
        replacement.replaceWith(retainedScenario.panel);
      }
      attachSourceSignals();
      mountScenarioFullscreens();
      if (retainedScenario && scenarioViewport) {
        const panel = retainedScenario.panel,
          canvas = panel.querySelector(".scenario-fs-canvas");
        for (const saved of scenarioViewport.details) {
          const node = panel.querySelector(
            `[data-scenario-key="${CSS.escape(saved.key)}"]`,
          );
          node?.querySelectorAll("details").forEach((details, index) => {
            details.open = saved.open[index] || false;
          });
        }
        const events = panel.querySelector(".scenario-fs-layout > details");
        if (events) events.open = scenarioViewport.eventsOpen;
        canvas.scrollTop = scenarioViewport.top;
        canvas.scrollLeft = scenarioViewport.left;
      }
    }
    if (memory.tab === "studio" && info.author)
      studio = createStudio({
        root: root.querySelector("#author-studio"),
        onMapped: async (id) => {
          memory.jobId = id;
          memory.tab = "research";
          const detail = await request("/api/research/jobs/" + id);
          memory.symbol = detail.symbol;
          await load();
        },
        refreshJournal: async () => {
          journal = (await request("/api/public/journal")).articles;
        },
      });
    associateLabels(root);
    bindLogos();
    mountAssetReorder();
    const tabs = root.querySelector(".intelligence-tabs"),
      selectedTab = tabs.querySelector('[aria-current="page"]');
    if (selectedTab)
      tabs.scrollLeft = Math.max(
        0,
        selectedTab.offsetLeft - tabs.offsetLeft - 16,
      );
    const input = root.querySelector("#research-search");
    if (input)
      input.oninput = () => {
        clearTimeout(searchTimer);
        const epoch = ++searchEpoch,
          q = input.value.trim();
        const list = root.querySelector("#research-search-results");
        if (q.length < 2) {
          list.innerHTML = "";
          return;
        }
        searchTimer = setTimeout(async () => {
          try {
            const r = await request(
              "/api/search?" + new URLSearchParams({ q }),
            );
            if (!live() || epoch !== searchEpoch || !list.isConnected) return;
            list.innerHTML =
              r.results
                .slice(0, 8)
                .map(
                  (a) =>
                    `<button data-add-asset="${esc(a.symbol)}" data-name="${esc(a.name)}" data-asset-type="${esc(a.assetType || "EQUITY")}" data-isin="${esc(a.isin || "")}">${monogram(a)}<span><b>${esc(a.symbol)}</b><small>${esc(a.name)}</small></span></button>`,
                )
                .join("") || '<p class="small">No matching assets.</p>';
            bindLogos();
          } catch (e) {
            if (list.isConnected) list.textContent = e.message;
          }
        }, 250);
      };
    const schedule = root.querySelector("#research-schedule");
    if (schedule)
      schedule.onchange = () =>
        action(schedule, async () => {
          const a = active(),
            hours = Number(schedule.value);
          await request(
            "/api/research/assets/" + encodeURIComponent(a.symbol),
            "PUT",
            { name: a.name, automatic: hours > 0, intervalHours: hours || 24 },
          );
          await load();
          toast(
            hours
              ? "Automatic research scheduled."
              : "Automatic research paused.",
          );
        });
  }
  async function openSourceTree({ setId, eventKey }) {
    const selectedSymbol = memory.symbol,
      operation = ++navigationEpoch;
    try {
      const selectedSet = await request(
        "/api/scenarios/" + encodeURIComponent(setId),
      );
      if (
        !live() ||
        operation !== navigationEpoch ||
        memory.symbol !== selectedSymbol
      )
        return;
      sets = [selectedSet, ...sets.filter((s) => s.id !== setId)];
      memory.focusSetId = setId;
      memory.aiEventKey = eventKey;
      memory.aiJobId = null;
      memory.tab = "scenarios";
      render();
      root
        .querySelector(`[data-scenario-set="${CSS.escape(setId)}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (e) {
      if (live()) toast(e.message);
    }
  }
  function attachSourceSignals() {
    const connections = sourceConnections.length
      ? sourceConnections
      : sourceSignals?.symbol === memory.symbol
        ? monitorMatches(sourceSignals).map((match) => ({
            ...match,
            jobId: sourceSignals.id,
            createdAt: sourceSignals.createdAt,
            title: sourceSignals.result?.changes?.[match.changeIndex]?.title,
          }))
        : [];
    for (const match of connections) {
      const node = root.querySelector(
        `[data-scenario-set="${CSS.escape(match.setId)}"] [data-scenario-key="${CSS.escape(match.eventKey)}"]`,
      );
      if (!node || !match.title) continue;
      let container = node.querySelector(".sm-branch-signals");
      if (!container) {
        container = document.createElement("div");
        container.className = "sm-branch-signals";
        node.append(container);
      }
      const row = document.createElement("div");
      row.className = "sm-branch-signal signal-" + match.signal;
      row.innerHTML = `<i></i><button data-monitor-open="${esc(match.jobId)}" data-monitor-change="${match.changeIndex}" title="${esc(when(match.createdAt))}"><small>AI · ${esc({ supports: "Supports", challenges: "Challenges", invalidates: "Invalidates", context: "Context" }[match.signal])}${match.createdAt ? " · " + esc(new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(match.createdAt)) : ""}</small>${esc(match.title)}</button>`;
      if (container.querySelectorAll(":scope > .sm-branch-signal").length < 2)
        container.append(row);
      else {
        let history = container.querySelector(".sm-branch-history");
        if (!history) {
          history = document.createElement("details");
          history.className = "sm-branch-history";
          history.innerHTML = "<summary></summary><div></div>";
          container.append(history);
        }
        history.querySelector("div").append(row);
        history.querySelector("summary").textContent =
          "Earlier signals · " +
          history.querySelectorAll(".sm-branch-signal").length;
      }
    }
  }
  async function verify(
    setId,
    eventKey,
    suggestion = null,
    evidenceSources = job?.sources || [],
  ) {
    const set = sets.find((s) => s.id === setId);
    if (!set) throw Error("Scenario not found. Refresh the workspace.");
    const branch = set.branches.find(
        (b) =>
          eventKey === b.eventKey || eventKey === b.eventKey + "-invalidated",
      ),
      evidence = suggestion
        ? evidenceSources.find(
            (s) => suggestion.sourceIds.includes(s.id) && s.url,
          )
        : null;
    if (!branch)
      throw Error("This branch is unavailable. Refresh the workspace.");
    modal(
      `<span class="eyebrow">HUMAN VERIFICATION / ${esc(set.symbol)}</span><h2>${eventKey.endsWith("-invalidated") ? "Invalidate this branch" : "Verify this condition"}</h2><p class="sub">${esc(eventKey.endsWith("-invalidated") ? branch.invalidation : branch.condition)}</p>${suggestion ? `<p class="inline-notice">${esc(suggestion.rationale)}</p>` : ""}<form id="verify-event"><div class="field"><label for="event-title">What confirms it?</label><input id="event-title" name="title" maxlength="300" value="${esc(evidence?.title || "")}" required></div><div class="field"><label for="event-url">Evidence link · HTTPS</label><input id="event-url" name="url" type="url" maxlength="2000" value="${esc(evidence?.url || "")}" required></div><div class="field"><label for="event-when">When did it happen? · your local time</label><input id="event-when" name="occurred" type="datetime-local" required></div><label class="consent-line"><input name="verified" type="checkbox" required> I checked this evidence against the exact condition.</label><button class="primary">Record verified event</button></form>`,
    );
    document.querySelector("#verify-event").onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      action(
        f.querySelector('button[type="submit"],button:not([type])'),
        async () => {
          await request("/api/scenarios/" + setId + "/events", "POST", {
            eventKey,
            title: f.elements.namedItem("title").value,
            url: f.elements.namedItem("url").value,
            occurredAt: new Date(
              f.elements.namedItem("occurred").value,
            ).getTime(),
            verified: f.elements.namedItem("verified").checked,
          });
          close();
          sets = (await request("/api/scenarios")).sets;
          render();
          toast("Event verified and recorded.");
        },
      );
    };
  }
  async function switchWatchlist(id) {
    if (!canLeave()) {
      render();
      return;
    }
    await withMembershipChange(async () => {
      await request("/api/watchlists/selection", "PUT", { id }, { ownerId });
      if (!live()) return;
      navigationEpoch++;
      assetMutation++;
      orderRevision = 0;
      memory.watchlistId = id;
      clearAssetSelection(null);
      await load();
    });
  }
  root.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (
      b.hasAttribute("data-watchlist-create") ||
      b.hasAttribute("data-watchlist-manage")
    ) {
      editWatchlists({
        selectedId: memory.watchlistId,
        create: b.hasAttribute("data-watchlist-create"),
        onChange: switchWatchlist,
        ownerId,
      }).catch((e) => toast(e.message));
      return;
    }
    if (b.hasAttribute("data-watchlist-assign")) {
      if (active())
        chooseWatchlists(active(), {
          ownerId,
          onChange: async () => {
            await load();
          },
        }).catch((e) => toast(e.message));
      return;
    }
    if (b.dataset.tab) {
      if (!canLeave()) return;
      navigationEpoch++;
      const wasScrolled = window.scrollY > root.offsetTop;
      memory.tab = b.dataset.tab;
      render();
      if (wasScrolled)
        root
          .querySelector("#intelligence-content")
          .scrollIntoView({ block: "start", behavior: "instant" });
    }
    if (b.hasAttribute("data-ai-settings")) {
      if (canLeave()) {
        navigate("settings");
        document
          .querySelector("#ai-settings")
          ?.scrollIntoView({ block: "start" });
      }
    }
    if (b.hasAttribute("data-focus-search"))
      root.querySelector("#research-search").focus();
    if (b.hasAttribute("data-research-order-retry")) {
      retryOrderSync().catch((error) => toast(error.message));
      return;
    }
    if (b.dataset.removeResearch) {
      removeResearchAsset(b.dataset.removeResearch);
      return;
    }
    if (b.dataset.addAsset)
      action(b, () =>
        withMembershipChange(async () => {
          const operation = ++navigationEpoch;
          await orderDrain;
          if (!live() || operation !== navigationEpoch) return;
          await request(
            "/api/research/assets/" + encodeURIComponent(b.dataset.addAsset),
            "PUT",
            {
              watchlistId: memory.watchlistId || undefined,
              name: b.dataset.name,
              assetType: b.dataset.assetType,
              isin: b.dataset.isin,
              automatic: !!assets.find((a) => a.symbol === b.dataset.addAsset)
                ?.automatic,
              intervalHours:
                assets.find((a) => a.symbol === b.dataset.addAsset)
                  ?.interval_hours || 24,
            },
          );
          hiddenAssets.delete(b.dataset.addAsset);
          assetMutation++;
          if (!live() || operation !== navigationEpoch) return;
          memory.symbol = b.dataset.addAsset;
          memory.jobId = null;
          memory.aiJobId = null;
          memory.aiEventKey = null;
          memory.monitorJobId = null;
          memory.monitorChange = null;
          await load();
        }),
      );
    if (b.dataset.researchAsset)
      action(b, async () => {
        navigationEpoch++;
        memory.symbol = b.dataset.researchAsset;
        memory.jobId = null;
        memory.aiJobId = null;
        memory.aiEventKey = null;
        memory.monitorJobId = null;
        memory.monitorChange = null;
        coverage = [];
        await loadAsset();
        render();
      });
    if (b.hasAttribute("data-collect"))
      action(b, async () => {
        if (assetLoads) return;
        const selected = memory.symbol,
          operation = navigationEpoch;
        await request(
          "/api/research/collect",
          "POST",
          { symbol: selected },
          { timeout: 45000 },
        );
        if (
          !live() ||
          memory.symbol !== selected ||
          operation !== navigationEpoch ||
          memory.tab !== "research"
        )
          return;
        await refreshSources();
      });
    if (b.hasAttribute("data-run"))
      action(b, async () => {
        const r = await request("/api/research/jobs", "POST", {
          symbol: memory.symbol,
          requestKey: crypto.randomUUID(),
        });
        memory.jobId = r.id;
        await load();
        toast("Research queued.");
      });
    if (b.dataset.job)
      action(b, async () => {
        memory.jobId = b.dataset.job;
        job = await request("/api/research/jobs/" + b.dataset.job);
        render();
      });
    if (b.dataset.cancelJob)
      action(b, async () => {
        await request("/api/research/jobs/" + b.dataset.cancelJob, "DELETE");
        await load();
      });
    if (b.hasAttribute("data-add-source")) {
      modal(
        '<span class="eyebrow">PRIVATE EVIDENCE</span><h2>Add a source.</h2><form id="add-research-source"><div class="field"><label for="source-title">Title</label><input id="source-title" name="title" maxlength="300" required></div><div class="field"><label for="source-url">Source link · optional</label><input id="source-url" name="url" type="url" placeholder="https://…" maxlength="2000"></div><div class="field"><label for="source-content">Source text / your notes</label><textarea id="source-content" name="content" maxlength="15000" rows="8" required></textarea></div><button class="primary">Save private source</button></form>',
      );
      document.querySelector("#add-research-source").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        action(
          f.querySelector('button[type="submit"],button:not([type])'),
          async () => {
            await request("/api/research/sources", "POST", {
              symbol: memory.symbol,
              title: f.elements.namedItem("title").value,
              url: f.elements.namedItem("url").value,
              content: f.elements.namedItem("content").value,
            });
            close();
            await loadAsset();
            render();
          },
        );
      };
    }
    if (b.dataset.deleteSource)
      action(b, async () => {
        await request(
          "/api/research/sources/" + b.dataset.deleteSource,
          "DELETE",
        );
        await loadAsset();
        render();
      });
    if (b.dataset.reviseSet)
      editPrivateScenario(
        sets.find((s) => s.id === b.dataset.reviseSet),
        async () => {
          sets = (await request("/api/scenarios")).sets;
          render();
          toast("Private revision saved.");
        },
      );
    if (b.dataset.aiChart)
      action(b, () =>
        withMembershipChange(async () => {
          const selectedSymbol = b.dataset.aiSymbol,
            operation = ++navigationEpoch;
          if (!assets.some((a) => a.symbol === selectedSymbol)) {
            await orderDrain;
            if (!live() || operation !== navigationEpoch) return;
            await request(
              "/api/research/assets/" + encodeURIComponent(selectedSymbol),
              "PUT",
              {
                name: selectedSymbol,
                automatic: false,
                intervalHours: 24,
              },
            );
            hiddenAssets.delete(selectedSymbol);
            assetMutation++;
            const response = await requestAssets();
            if (!live() || operation !== navigationEpoch) return;
            adoptAssets(response);
          }
          if (!live() || operation !== navigationEpoch) return;
          memory.symbol = selectedSymbol;
          memory.aiJobId = b.dataset.aiChart;
          memory.aiEventKey = b.dataset.eventKey || null;
          memory.jobId = null;
          await loadAsset();
          if (!live() || operation !== navigationEpoch) return;
          memory.tab = "research";
          render();
          root
            .querySelector("#research-chart")
            ?.scrollIntoView({ block: "start", behavior: "smooth" });
        }),
      );
    if (b.dataset.monitorOpen) {
      navigationEpoch++;
      memory.monitorJobId = b.dataset.monitorOpen;
      memory.monitorChange = Number(b.dataset.monitorChange);
      memory.tab = "research";
      render();
      root
        .querySelector("#source-monitor")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    if (b.dataset.checkSet)
      action(b, async () => {
        await request(
          "/api/scenarios/" + b.dataset.checkSet + "/check",
          "POST",
          {},
        );
        sets = (await request("/api/scenarios")).sets;
        render();
      });
    if (b.dataset.verify)
      verify(b.dataset.verify, b.dataset.key).catch((e) => toast(e.message));
    if (b.dataset.match !== undefined) {
      const m = job.result.eventMatches[Number(b.dataset.match)];
      verify(m.setId, m.eventKey, m).catch((e) => toast(e.message));
    }
    if (b.dataset.retract)
      action(b, async () => {
        await request(
          "/api/scenarios/" + b.dataset.set + "/events/" + b.dataset.retract,
          "DELETE",
        );
        sets = (await request("/api/scenarios")).sets;
        render();
      });
    if (b.dataset.fork)
      action(b, async () => {
        await request(
          "/api/public/journal/" + b.dataset.fork + "/fork",
          "POST",
          { revision: Number(b.dataset.revision) },
        );
        memory.tab = "scenarios";
        memory.symbol = null;
        sets = (await request("/api/scenarios")).sets;
        render();
        toast("Independent private scenario copy created.");
      });
    if (b.hasAttribute("data-apply-map"))
      action(b, async () => {
        const mapped = job;
        memory.tab = "studio";
        render();
        await studio.apply(mapped);
      });
    if (b.hasAttribute("data-export-research"))
      action(b, async () =>
        download(
          await request("/api/research/export"),
          "reentry-private-research.json",
        ),
      );
    if (b.hasAttribute("data-retry-intelligence"))
      load().catch((e) => toast(e.message));
  };
  load().catch((e) => {
    if (live())
      root.innerHTML = empty(
        "Research is temporarily unavailable.",
        e.message,
        '<button class="secondary" data-retry-intelligence>Retry</button>',
      );
  });
  sourcePoll = setInterval(async () => {
    if (
      !live() ||
      document.hidden ||
      memory.tab !== "research" ||
      !active() ||
      sourceRequest ||
      assetLoads ||
      Date.now() < nextSourceCheck
    )
      return;
    nextSourceCheck = Date.now() + 60000;
    try {
      await refreshSources();
    } catch {
      /* Retain cached evidence until the next check. */
    }
  }, 5000);
  poll = setInterval(async () => {
    if (
      !live() ||
      document.hidden ||
      memory.tab !== "research" ||
      !jobs.some((j) => ["queued", "running"].includes(j.status))
    )
      return;
    try {
      const previous = JSON.stringify(jobs);
      jobs = (await request("/api/research/jobs")).jobs.filter((j) =>
        ["research", "map-article"].includes(j.kind),
      );
      if (
        previous !== JSON.stringify(jobs) &&
        !root.querySelector("#research-search")?.value
      ) {
        await loadAsset();
        if (memory.tab === "research" && live()) {
          info = await request("/api/intelligence");
          sets = (await request("/api/scenarios")).sets;
          render();
        }
      }
    } catch {
      /* A failed poll leaves the last known state visible. */
    }
  }, 5000);
  return {
    canLeave,
    async flushPendingOrder() {
      await orderDrain;
      return !orderSaving && !pendingOrder && !orderUnsynced;
    },
    destroy() {
      alive = false;
      reorder?.destroy();
      reorder = null;
      clearTimeout(orderStatusTimer);
      window.removeEventListener("reentry:research-order-saved", onOrderSaved);
      if (!orderSaving && !pendingOrder)
        window.removeEventListener("beforeunload", warnOrderUnload);
      clearInterval(poll);
      clearInterval(sourcePoll);
      sourceGeneration++;
      loadGeneration++;
      assetListGeneration++;
      window.removeEventListener(
        "reentry:research-asset-restored",
        onResearchAssetRestored,
      );
      sourceRequest?.abort();
      clearTimeout(searchTimer);
      destroyChildren();
      root.onclick = null;
    },
  };
}
