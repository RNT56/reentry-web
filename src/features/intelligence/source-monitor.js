import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { icon } from "../../shared/ui.js";
import { usd, when, sourceLinks } from "./shared.js";

const active = (job) => ["queued", "running"].includes(job?.status);
const maxUSD = (value) => usd(Math.ceil((value || 0) / 10000) * 10000);
const signalLabels = {
  supports: "Supports",
  challenges: "Challenges",
  invalidates: "Invalidates",
  context: "Context",
};
const modelName = (value = "") =>
  ({
    "gemini-4-hydrogen": "Hydrogen",
    "gemini-4-argon": "Argon",
    "gemini-4-carbon": "Carbon",
    "claude-sonnet-5-5": "Sonnet 5.5",
    "claude-opus-5-5": "Opus 5.5",
    "claude-fable-5-2": "Fable 5.2",
    "claude-haiku-5-5": "Haiku 5.5",
  })[value] || value;
const detailSources = (detail) =>
  detail?.snapshot?.sources || detail?.sources || [];
const previousSources = (detail) => {
  const previous = detail?.snapshot?.previous || detail?.previous;
  return Array.isArray(previous) ? previous : previous?.sources || [];
};
export const monitorMatches = (detail) =>
  (detail?.result?.matches || [])
    .map((match, index) => ({ ...match, index }))
    .filter((m) => !(detail?.review?.dismissedMatches || []).includes(m.index));

function evidenceMarkup(ids, sources) {
  return (ids || [])
    .map((id) => sources.find((s) => s.id === id))
    .filter(Boolean)
    .map(
      (s) =>
        `<article class="sm-evidence-source"><div><b>${esc(s.title || "Source")}</b>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(s.title || "source")}">${icon("arrow")}</a>` : ""}</div><span>${esc(s.connector || s.kind || "Evidence")}${s.published_at || s.publishedAt ? " · " + esc(when(s.published_at || s.publishedAt)) : ""}</span>${s.content ? `<p>${esc(s.content)}</p>` : ""}</article>`,
    )
    .join("");
}

/** Private source deltas; every model dispatch requires a quoted cap or an opted-in watch. */
export function mountSourceMonitor(
  root,
  {
    asset,
    onTree = () => {},
    onVerify = () => {},
    onSettings = () => {},
    onUpdate = () => {},
    onSignals = () => {},
    initialJobId = null,
    initialChange = null,
  } = {},
) {
  let alive = true,
    loaded = false,
    busy = false,
    info = null,
    detail = null,
    jobs = [],
    selectedId = initialJobId,
    followLatest = !initialJobId,
    pendingLatest = null,
    compose = false,
    configure = false,
    selectedTrees = [],
    allTrees = true,
    selectionDirty = false,
    quote = null,
    requestKey = null,
    unknown = false,
    error = "",
    pollTimer,
    quoteTimer,
    generation = 0,
    detailGeneration = 0,
    lastMarkup = "",
    pendingRunId = null;
  const controller = new AbortController(),
    opened = new Set();
  if (initialChange !== null) opened.add("change:" + initialChange);
  root.classList.add("source-monitor");
  root.setAttribute("aria-label", "Private source intelligence");
  const live = () => alive && root.isConnected;
  const req = (path, method, body) =>
    request(path, method, body, { signal: controller.signal });
  const config = () => info?.configuration || {};
  const settings = () => info?.settings || {};
  const budget = () => quote?.budget || {};
  const money = () => budget().totals || config().spending || {};
  const available = () =>
    budget().available ??
    config().available ??
    Math.max(
      0,
      (config().monthlyLimit || 0) - (money().spent || 0) - (money().held || 0),
    );
  const trees = () => info?.trees || [];
  const current = () => jobs.find((j) => j.id === selectedId) || detail;
  const ready = () => !!config().ready;
  const scopeIds = () => (allTrees ? [] : selectedTrees);
  const matches = () => monitorMatches(detail);
  const changes = () => detail?.result?.changes || [];
  const notice = (message = "") => {
    error = message;
    if (live()) render();
  };
  const invalidate = () => {
    quote = null;
    requestKey = null;
    clearTimeout(quoteTimer);
  };
  const treeName = (id) =>
    trees().find((t) => t.id === id)?.title ||
    detail?.snapshot?.watched?.find((t) => t.id === id)?.title ||
    "Private scenario";
  const branchFor = (match) =>
    (
      detail?.snapshot?.watched?.find((t) => t.id === match.setId)?.branches ||
      trees().find((t) => t.id === match.setId)?.branches ||
      []
    ).find((b) => b.eventKey === match.eventKey);
  const setupLabel = () =>
    !config().connected
      ? "Connect your key"
      : config().paused
        ? "AI paused"
        : !config().enabled
          ? "Enable AI"
          : !config().pricesValid
            ? "Pricing update required"
            : "AI settings";

  function render() {
    if (!live()) return;
    for (const node of root.querySelectorAll("details[data-sm-detail]")) {
      if (node.open) opened.add(node.dataset.smDetail);
      else opened.delete(node.dataset.smDetail);
    }
    const job = current(),
      latest = detail?.status === "completed",
      running = jobs.find(active),
      p = config(),
      displayedModel = compose ? quote || p : latest ? detail : p;
    const read = !!(detail?.readAt || detail?.review?.readAt),
      unreviewed = latest && !read;
    const status = running
      ? running.status === "queued"
        ? "Queued"
        : "Reading sources"
      : info?.pendingSourceCount
        ? `${info.pendingSourceCount} new ${info.pendingSourceCount === 1 ? "source" : "sources"}`
        : settings().lastSuccessAt
          ? `Checked ${when(settings().lastSuccessAt)}`
          : "";
    const watch = settings().enabled;
    const blockedReason = watch
      ? p.paused
        ? "AI is paused by the owner."
        : !p.workerEnabled || !p.vaultAvailable
          ? "Source AI is unavailable on this server."
          : !p.connected
            ? "Connect your own provider key in settings."
            : !p.enabled
              ? "Enable AI in settings."
              : !p.pricesValid
                ? "Model pricing requires an operator update."
                : settings().blockedReason
      : null;
    const blockedLabel = /budget|spending/i.test(blockedReason || "")
      ? "Budget reached"
      : /key|credential/i.test(blockedReason || "")
        ? "Reconnect key"
        : /tree|scenario/i.test(blockedReason || "")
          ? "Review trees"
          : "Watch paused";
    const blocked = blockedReason
      ? `<button class="link sm-watch-blocked" data-sm-blocked title="${esc(blockedReason)}" aria-label="${esc(blockedLabel + ": " + blockedReason)}">${blockedLabel}</button>`
      : "";
    const runCost =
      detail?.ledger?.state === "uncertain"
        ? `${usd(detail.ledger.reserved)} held · unconfirmed`
        : detail?.ledger?.cost !== null && detail?.ledger?.cost !== undefined
          ? `${usd(detail.ledger.cost)} recorded`
          : "";
    const history =
      jobs.length > 1 || (selectedId && !jobs.some((j) => j.id === selectedId))
        ? `<label class="sm-history"><span>History</span><select data-sm-history aria-label="Source analysis history" ${busy ? "disabled" : ""}>${jobs.map((j) => `<option value="${esc(j.id)}" ${j.id === selectedId ? "selected" : ""}>${esc(when(j.createdAt))} · ${esc(j.status === "completed" ? `${j.changeCount ?? "—"} ${j.changeCount === 1 ? "change" : "changes"}` : j.status)}</option>`).join("")}</select></label>`
        : "";
    const controls = configure
      ? `<div class="sm-configuration"><div class="sm-config-heading"><span>Private trees</span><span>${allTrees ? "All private trees" : selectedTrees.length + " selected"}</span></div>${
          trees().length
            ? `<label class="sm-all-trees"><input type="checkbox" data-sm-all ${allTrees ? "checked" : ""} ${busy || unknown ? "disabled" : ""}><span>All private trees</span></label><div class="sm-tree-picker">${trees()
                .map(
                  (t) =>
                    `<label><input type="checkbox" data-sm-tree="${esc(t.id)}" ${selectedTrees.includes(t.id) ? "checked" : ""} ${busy || unknown ? "disabled" : ""}><span>${esc(t.title)}<small>${t.branches?.length || 0} branches</small></span></label>`,
                )
                .join("")}</div>`
            : '<span class="sm-muted">Add a private scenario tree to map events.</span>'
        }<div class="sm-config-footer"><span>New evidence · every ${settings().intervalHours || 6}h<br>Max ${maxUSD(config().runLimit)} / run · ${usd(config().monthlyLimit)} / month</span><button class="sm-small" data-sm-save-settings ${!loaded || busy || unknown ? "disabled" : ""}>Save trees</button></div>${settings().blockedReason ? `<p class="sm-state-note">${esc(settings().blockedReason)}</p>` : ""}</div>`
      : "";
    const composeMarkup = compose
      ? `<div class="sm-compose"><div class="sm-budget"><span>Available <b data-number>${usd(available())}</b><small>/ ${usd(budget().monthlyLimit ?? p.monthlyLimit)}</small></span><span>${quote ? "Max hold" : "Per run"}<b data-number>${maxUSD(quote?.maxCost ?? p.runLimit)}</b></span></div>${ready() ? (quote ? `<div class="sm-approval"><span>${quote.snapshot?.comparisonReset ? "Fresh tree review" : (quote.snapshot?.newSourceCount ?? quote.snapshot?.sourceCount ?? "—") + " new " + ((quote.snapshot?.newSourceCount ?? quote.snapshot?.sourceCount) === 1 ? "source" : "sources")} · ${quote.snapshot?.treeCount ?? selectedTrees.length} ${(quote.snapshot?.treeCount ?? selectedTrees.length) === 1 ? "tree" : "trees"}</span><button class="sm-primary" data-sm-confirm ${busy || (!unknown && quote.expiresAt <= Date.now()) || !!running ? "disabled" : ""}>${busy ? "Queuing…" : unknown ? "Retry request" : "Analyze changes"}${icon("arrow")}</button></div>` : `<button class="sm-primary" data-sm-estimate ${busy || !!running || unknown ? "disabled" : ""}>${busy ? "Preparing evidence…" : running ? "Analysis in progress" : "Prepare analysis"}${icon("arrow")}</button>`) : `<button class="sm-connect" data-sm-settings>${esc(setupLabel())}${icon("arrow")}</button>`}</div>`
      : "";
    const changeMarkup =
      latest && changes().length
        ? `<div class="sm-feed">${changes()
            .map((change, index) => {
              const relevant = matches().filter((m) => m.changeIndex === index);
              const sourceIds = [
                ...new Set([
                  ...(change.sourceIds || []),
                  ...relevant.flatMap((m) => m.sourceIds || []),
                ]),
              ];
              return `<details class="sm-change importance-${esc(change.significance)}" data-sm-detail="change:${index}"><summary><span class="sm-significance" aria-label="${esc(change.significance)} significance"></span><span class="sm-change-title"><b>${esc(change.title)}</b><span>${change.kind === "fact" ? "Reported" : "Inference"}${relevant.length ? ` · ${relevant.length} tree ${relevant.length === 1 ? "signal" : "signals"}` : ""}</span></span>${icon("plus")}</summary><div class="sm-change-body"><p>${esc(change.detail)}</p>${relevant.length ? `<div class="sm-match-list">${relevant.map((m) => `<div class="sm-match signal-${esc(m.signal)}"><div><span class="sm-signal">AI · ${esc(signalLabels[m.signal])}</span><button class="link" data-sm-tree-open="${m.index}">${esc(branchFor(m)?.title || treeName(m.setId))}${icon("arrow")}</button></div><p>${esc(m.rationale)}</p><div class="sm-match-cites">${sourceLinks(m.sourceIds, detailSources(detail))}</div><div class="sm-match-actions">${["supports", "invalidates"].includes(m.signal) && !branchFor(m)?.chartCondition && trees().find((t) => t.id === m.setId)?.provenance?.kind !== "ai-chart" ? `<button class="sm-small" data-sm-verify="${m.index}">Review event${icon("arrow")}</button>` : ""}<button class="link" data-sm-dismiss="${m.index}">Dismiss</button></div></div>`).join("")}</div>` : ""}<details class="sm-evidence" data-sm-detail="evidence:${index}"><summary>Evidence <span>${sourceIds.length}</span></summary>${evidenceMarkup(sourceIds, detailSources(detail))}</details>${change.previousSourceIds?.length ? `<details class="sm-evidence sm-previous" data-sm-detail="previous:${index}"><summary>Previous evidence <span>${change.previousSourceIds.length}</span></summary>${evidenceMarkup(change.previousSourceIds, previousSources(detail))}</details>` : ""}</div></details>`;
            })
            .join("")}</div>`
        : latest
          ? `<div class="sm-no-change"><span>No material change</span>${detail.result?.summary ? `<p>${esc(detail.result.summary)}</p>` : ""}</div>`
          : active(job)
            ? `<div class="sm-processing" role="status"><span class="sm-progress-line"></span><span>${job.status === "queued" ? "Queued" : "Comparing evidence and private conditions"}</span>${job.status === "queued" ? '<button class="link" data-sm-cancel>Cancel</button>' : ""}<button class="link" data-sm-refresh>Refresh</button></div>`
            : job?.status === "failed" || job?.status === "cancelled"
              ? `<div class="sm-error"><span>${job.status === "cancelled" ? "Cancelled" : "Analysis paused"}</span><p>${esc(detail?.error || job.error || "")}</p>${runCost ? `<small data-number>${esc(runCost)}</small>` : ""}</div>`
              : "";
    const markup = `<header class="sm-heading"><div><span class="sm-heading-mark" aria-hidden="true">${icon("layers")}</span><h3>What changed</h3>${unreviewed ? '<i class="sm-unread" aria-label="Unread changes"></i>' : ""}<span class="sm-count">${latest ? changes().length : ""}</span></div><div class="sm-heading-actions"><button class="sm-watch-settings" data-sm-config ${!loaded ? "disabled" : ""} aria-label="Configure watched trees" aria-expanded="${configure}">${icon("sliders")}</button><label class="sm-watch"><span>Watch sources</span><input data-sm-watch type="checkbox" ${watch ? "checked" : ""} ${!loaded || busy || unknown || (!watch && !ready()) ? "disabled" : ""}></label><button class="sm-analyze" data-sm-compose ${!loaded || busy ? "disabled" : ""}>${compose ? "Close" : "Analyze"}${icon(compose ? "close" : "arrow")}</button></div></header><div class="sm-state"><span>${blocked}${blocked ? "" : quote && compose ? "" : esc(status)}${pendingLatest?.id && pendingLatest.id !== selectedId ? '<button class="link sm-new-latest" data-sm-latest>New changes ↗</button>' : ""}</span><span>${displayedModel.model ? `${displayedModel.provider === "anthropic" ? "Claude" : "Gemini"} · ${esc(modelName(displayedModel.model))}` : ""}</span></div>${controls}${composeMarkup}${history}${changeMarkup}${latest ? `<footer class="sm-footer"><span>${esc(when(detail.finishedAt || detail.createdAt))}${runCost ? ` · ${esc(runCost)}` : ""}</span>${!read ? '<button class="link" data-sm-read>Mark read</button>' : '<span class="sm-read-state">Read</span>'}</footer>` : ""}${error ? `<div class="sm-error-notice" role="status"><span>${esc(error)}</span><button class="link" data-sm-refresh>Refresh</button></div>` : ""}${!loaded ? '<div class="sm-load" role="status" aria-label="Loading source intelligence"></div>' : ""}`;
    if (markup === lastMarkup) return;
    const focused = root.contains(document.activeElement)
      ? document.activeElement
      : null;
    const selector = focused?.matches("select")
      ? "[data-sm-history]"
      : focused?.dataset.smTree
        ? `[data-sm-tree="${CSS.escape(focused.dataset.smTree)}"]`
        : null;
    const scroll = root.querySelector(".sm-tree-picker")?.scrollTop || 0;
    root.innerHTML = markup;
    lastMarkup = markup;
    for (const key of opened)
      root
        .querySelector(`[data-sm-detail="${CSS.escape(key)}"]`)
        ?.setAttribute("open", "");
    const picker = root.querySelector(".sm-tree-picker");
    if (picker) picker.scrollTop = scroll;
    if (selector) root.querySelector(selector)?.focus({ preventScroll: true });
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!live()) return;
    pollTimer = setTimeout(
      async () => {
        if (!live()) return;
        if (!document.hidden) {
          await load(false);
        }
        schedulePoll();
      },
      jobs.some(active) ? 5000 : 60000,
    );
  }
  async function selectJob(id, { silent = false } = {}) {
    const epoch = ++detailGeneration;
    if (!silent) {
      selectedId = id;
      opened.clear();
      detail = null;
    }
    try {
      const value = await req(
        "/api/source-monitor/jobs/" + encodeURIComponent(id),
      );
      if (!live() || epoch !== detailGeneration || id !== selectedId) return;
      if (value.symbol !== asset.symbol)
        throw Error("Choose an analysis for " + asset.symbol + ".");
      detail = value;
      if (!jobs.some((j) => j.id === id)) jobs.push(value);
      onUpdate(value);
      render();
    } catch (e) {
      if (live() && epoch === detailGeneration) notice(e.message);
    }
  }
  async function load(initial = true) {
    const epoch = ++generation;
    try {
      const value = await req(
        "/api/source-monitor?" + new URLSearchParams({ symbol: asset.symbol }),
      );
      if (!live() || epoch !== generation) return;
      info = value;
      onSignals(structuredClone(value.signals || []));
      loaded = true;
      error = "";
      jobs = value.jobs || [];
      if (!selectionDirty) {
        allTrees = !value.settings?.setIds?.length;
        selectedTrees = allTrees
          ? trees().map((t) => t.id)
          : [...value.settings.setIds];
      }
      if (value.latest) {
        onUpdate(value.latest);
        if (value.latest.id !== selectedId && detail?.status === "completed") {
          const reading =
            opened.size || root.querySelector("details[data-sm-detail][open]");
          if (followLatest && !reading) {
            selectedId = value.latest.id;
            detail = value.latest;
            opened.clear();
            pendingLatest = null;
          } else pendingLatest = value.latest;
        }
      }
      if (!selectedId)
        selectedId =
          value.latest?.id || jobs.find(active)?.id || jobs[0]?.id || null;
      if (selectedId && value.latest?.id === selectedId) {
        detail = value.latest;
        onUpdate(detail);
      } else if (selectedId && (!detail || active(detail) || initial))
        await selectJob(selectedId, { silent: true });
      if (!live() || epoch !== generation) return;
      if (detail?.id === selectedId && !jobs.some((j) => j.id === selectedId))
        jobs.push(detail);
      if (pendingRunId && !jobs.some((j) => j.id === pendingRunId && active(j)))
        pendingRunId = null;
      render();
      schedulePoll();
    } catch (e) {
      if (live() && epoch === generation) {
        loaded = true;
        notice(e.message);
        schedulePoll();
      }
    }
  }
  async function saveSettings(enabled = settings().enabled) {
    if (!loaded || busy || unknown) return;
    busy = true;
    render();
    try {
      await req(
        "/api/source-monitor/" + encodeURIComponent(asset.symbol),
        "PUT",
        { enabled: !!enabled, setIds: scopeIds() },
      );
      selectionDirty = false;
      invalidate();
      await load();
    } catch (e) {
      if (live()) notice(e.message);
    } finally {
      if (live()) {
        busy = false;
        render();
      }
    }
  }
  async function prepare() {
    if (busy || unknown || !ready()) return;
    busy = true;
    invalidate();
    error = "";
    render();
    try {
      quote = await req("/api/source-monitor/estimate", "POST", {
        symbol: asset.symbol,
        setIds: scopeIds(),
      });
      if (!live()) return;
      requestKey = crypto.randomUUID();
      quoteTimer = setTimeout(
        () => {
          if (!live() || unknown) return;
          invalidate();
          notice("Estimate expired · prepare again");
        },
        Math.max(0, quote.expiresAt - Date.now()),
      );
    } catch (e) {
      if (live()) notice(e.message);
    } finally {
      if (live()) {
        busy = false;
        render();
      }
    }
  }
  async function run() {
    if (busy || !quote || !requestKey) return;
    const known = new Set(jobs.map((j) => j.id)),
      hash = quote.snapshot?.hash;
    busy = true;
    error = "";
    render();
    try {
      const value = await req("/api/source-monitor", "POST", {
        quoteId: quote.quoteId,
        requestKey,
      });
      if (!live()) return;
      unknown = false;
      invalidate();
      compose = false;
      followLatest = true;
      pendingLatest = null;
      selectedId = value.id;
      pendingRunId = value.id;
      detail = null;
      opened.clear();
      await load();
    } catch (e) {
      if (!live()) return;
      if (!e.status || e.status >= 500) {
        unknown = true;
        await load(false);
        if (!live()) return;
        const recovered =
          hash && jobs.find((j) => !known.has(j.id) && j.snapshotHash === hash);
        if (recovered) {
          unknown = false;
          invalidate();
          compose = false;
          selectedId = recovered.id;
          detail = null;
          await selectJob(recovered.id);
        }
        notice(
          recovered
            ? "Request recovered"
            : "Request unconfirmed · retry uses the same request",
        );
      } else {
        if (e.status !== 429) {
          unknown = false;
          invalidate();
        }
        notice(e.message);
      }
    } finally {
      if (live()) {
        busy = false;
        render();
      }
    }
  }
  async function review(body) {
    if (!detail || busy) return;
    busy = true;
    render();
    try {
      const value = await req(
        "/api/source-monitor/jobs/" + encodeURIComponent(detail.id) + "/review",
        "PATCH",
        body,
      );
      if (!live()) return;
      detail.review = value.review || value;
      if (body.read) detail.readAt = detail.review.readAt || Date.now();
      onUpdate(detail);
      render();
      await load(false);
    } catch (e) {
      if (live()) notice(e.message);
    } finally {
      if (live()) {
        busy = false;
        render();
      }
    }
  }
  root.onclick = (event) => {
    event.stopPropagation();
    const b = event.target.closest("button");
    if (!b || !root.contains(b) || b.disabled) return;
    if (b.hasAttribute("data-sm-compose")) {
      compose = !compose;
      if (!compose && !unknown) invalidate();
      render();
      if (compose && ready() && !quote && !jobs.some(active) && !unknown)
        prepare();
    } else if (
      b.hasAttribute("data-sm-config") ||
      b.hasAttribute("data-sm-blocked")
    ) {
      configure = b.hasAttribute("data-sm-blocked") || !configure;
      render();
    } else if (b.hasAttribute("data-sm-settings")) onSettings();
    else if (b.hasAttribute("data-sm-estimate")) prepare();
    else if (b.hasAttribute("data-sm-confirm")) run();
    else if (b.hasAttribute("data-sm-latest") && pendingLatest) {
      followLatest = true;
      const id = pendingLatest.id;
      pendingLatest = null;
      selectJob(id);
    } else if (b.hasAttribute("data-sm-refresh")) {
      load();
    } else if (b.hasAttribute("data-sm-save-settings")) saveSettings();
    else if (b.hasAttribute("data-sm-read")) review({ read: true });
    else if (b.dataset.smDismiss !== undefined)
      review({
        dismissedMatches: [
          ...(detail?.review?.dismissedMatches || []),
          Number(b.dataset.smDismiss),
        ],
      });
    else if (b.dataset.smTreeOpen !== undefined) {
      const m = matches().find((x) => x.index === Number(b.dataset.smTreeOpen));
      if (m) onTree({ setId: m.setId, eventKey: m.eventKey, jobId: detail.id });
    } else if (b.dataset.smVerify !== undefined) {
      const m = matches().find((x) => x.index === Number(b.dataset.smVerify));
      if (m)
        onVerify({
          setId: m.setId,
          eventKey:
            m.signal === "invalidates"
              ? m.eventKey + "-invalidated"
              : m.eventKey,
          suggestion: m,
          sources: detailSources(detail),
        });
    } else if (b.hasAttribute("data-sm-cancel") && selectedId) {
      busy = true;
      render();
      req("/api/research/jobs/" + encodeURIComponent(selectedId), "DELETE")
        .then(() => live() && load())
        .catch((e) => live() && notice(e.message))
        .finally(() => {
          if (live()) {
            busy = false;
            render();
          }
        });
    }
  };
  root.onchange = (event) => {
    event.stopPropagation();
    const el = event.target;
    if (el.matches("[data-sm-watch]")) saveSettings(el.checked);
    else if (el.matches("[data-sm-history]")) {
      followLatest = false;
      selectJob(el.value);
    } else if (el.matches("[data-sm-all]")) {
      if (busy || unknown) return;
      allTrees = el.checked;
      selectedTrees = allTrees
        ? trees().map((t) => t.id)
        : trees()
            .slice(0, 1)
            .map((t) => t.id);
      selectionDirty = true;
      invalidate();
      render();
    } else if (el.dataset.smTree) {
      if (busy || unknown) return;
      if (allTrees && selectedTrees.length > 12) {
        el.checked = selectedTrees.includes(el.dataset.smTree);
        notice("Choose a custom selection of up to 12 trees.");
        return;
      }
      if (!el.checked && selectedTrees.length === 1) {
        el.checked = true;
        notice("Keep one tree selected, or choose All private trees.");
        return;
      }
      if (el.checked && selectedTrees.length >= 12) {
        el.checked = selectedTrees.includes(el.dataset.smTree);
        notice("Choose up to 12 private trees.");
        return;
      }
      allTrees = false;
      selectionDirty = true;
      selectedTrees = el.checked
        ? [...new Set([...selectedTrees, el.dataset.smTree])]
        : selectedTrees.filter((id) => id !== el.dataset.smTree);
      invalidate();
      render();
    }
  };
  load();
  return {
    refresh() {
      return load();
    },
    selectJob(id, changeIndex = null) {
      selectedId = id;
      if (changeIndex !== null) opened.add("change:" + changeIndex);
      return selectJob(id, { silent: true });
    },
    destroy() {
      alive = false;
      generation++;
      detailGeneration++;
      controller.abort();
      clearTimeout(pollTimer);
      clearTimeout(quoteTimer);
      root.onclick = null;
      root.onchange = null;
    },
  };
}
