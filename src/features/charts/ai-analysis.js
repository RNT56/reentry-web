import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { icon } from "../../shared/ui.js";
import { usd, when } from "../intelligence/shared.js";

const activeStatus = (status) => status === "queued" || status === "running";
const rangeLabels = { "1mo": "1 month", "3mo": "3 months", "1y": "1 year" };
const formatPrice = (value) =>
  new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: Math.abs(value) < 1 ? 6 : 2,
  }).format(value);
const providerLabel = (value) => (value === "anthropic" ? "Claude" : "Gemini");
// A displayed maximum rounds up to a cent; it must never understate approval.
const maxUSD = (value) => usd(Math.ceil((value || 0) / 10000) * 10000);
const chartGlyph = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20V12M10 20V8M16 20V4" stroke="currentColor" stroke-width="1.3" opacity=".4"/><path d="m3 14 6-3 5 2 7-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A separate, read-only AI layer. Personal chart state never enters a request. */
export function mountAIAnalysis(
  root,
  {
    asset,
    bodyRoot = null,
    getChartContext = () => ({ currency: "EUR", range: "1y" }),
    onLayer = () => {},
    onScenario = () => {},
    onSettings = () => {},
    onComplete = () => {},
    initialJobId = null,
    initialEventKey = null,
  } = {},
) {
  let alive = true,
    loaded = false,
    listError = "",
    notice = "",
    info = null,
    jobs = [],
    detail = null,
    chosenId = initialJobId,
    selectedKey = initialEventKey,
    visibility = !!initialJobId,
    hidden = new Set(),
    open = false,
    resultsOpen = !!initialJobId,
    busy = false,
    quote = null,
    quoteTimer,
    pollTimer,
    polling = false,
    generation = 0,
    detailGeneration = 0,
    pollCount = 0,
    range = "1y",
    currency = "EUR",
    runKey = null,
    requestedRunId = null,
    submissionUnknown = false;
  const aborter = new AbortController();
  const live = () => alive && root.isConnected;
  const context = () => getChartContext() || {};
  const firstContext = context();
  range = Object.hasOwn(rangeLabels, firstContext.range)
    ? firstContext.range
    : "1y";
  currency = firstContext.currency === "USD" ? "USD" : "EUR";
  root.classList.add("ai-chart-analysis");
  root.setAttribute("aria-label", "AI chart analysis");
  root.innerHTML = `<div class="aic-heading"><div class="aic-title">${chartGlyph}<h3>AI chart</h3><span class="aic-model" data-aic-model></span></div><div class="aic-heading-actions"><button class="aic-results-toggle" data-aic-results aria-label="Show AI analysis" aria-expanded="false" hidden>View</button><button class="aic-visibility" data-aic-visibility aria-label="Show AI overlays" aria-pressed="true" hidden>${icon("layers")}</button><button class="aic-launch" data-aic-open disabled>Analyze ${icon("arrow")}</button></div></div><div data-aic-body></div><div class="aic-notice" data-aic-notice role="status"></div>`;

  const body = root.querySelector("[data-aic-body]"),
    noticeNode = root.querySelector("[data-aic-notice]");
  if (bodyRoot) {
    bodyRoot.append(body, noticeNode);
    bodyRoot.hidden = true;
  }
  function syncBodyVisibility() {
    if (bodyRoot)
      bodyRoot.hidden = !body.innerHTML.trim() && !noticeNode.textContent;
  }
  function revealDetails() {
    if (
      !bodyRoot ||
      bodyRoot.hidden ||
      !matchMedia("(max-width: 1100px)").matches
    )
      return;
    bodyRoot.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  const req = (path, method, body) =>
    request(path, method, body, { signal: aborter.signal });
  const prefs = () => info?.configuration || {};
  const totals = () => quote?.budget?.totals || prefs().spending || {};
  const available = () =>
    Math.max(
      0,
      (quote?.budget?.monthlyLimit ?? prefs().monthlyLimit ?? 0) -
        (totals().spent || 0) -
        (totals().held || 0),
    );
  const result = () => (detail?.status === "completed" ? detail.result : null);
  const overlays = () => result()?.overlays || [];
  const branches = () => result()?.scenarios || [];
  const compatible = () =>
    !detail ||
    (detail.chart?.currency ||
      detail.snapshot?.currency ||
      detail.result?.currency ||
      detail.currency ||
      currency) === context().currency;
  const configured = () => !!prefs().ready;
  const modelLabel = (id = "") =>
    ({
      "gemini-4-hydrogen": "Hydrogen",
      "gemini-4-carbon": "Carbon",
      "gemini-4-argon": "Argon",
      "claude-sonnet-5-5": "Sonnet 5.5",
      "claude-opus-5-5": "Opus 5.5",
      "claude-fable-5-2": "Fable 5.2",
      "claude-haiku-5-5": "Haiku 5.5",
    })[id] || id;
  const modelName = () => modelLabel(prefs().model);
  const setupLabel = () => {
    const p = prefs();
    return p.paused
      ? "AI paused"
      : !p.workerEnabled
        ? "AI unavailable"
        : !p.pricesValid
          ? "Pricing update required"
          : !p.connected
            ? "Connect your key"
            : !p.enabled
              ? "Enable AI"
              : "AI settings";
  };
  const snapshot = () => detail?.chart || detail?.snapshot || {};
  const snapshotCurrency = () =>
    snapshot().currency ||
    detail?.result?.currency ||
    detail?.currency ||
    currency;

  function emit() {
    if (!live()) return;
    const r = result();
    if (!r || !visibility || !compatible()) {
      onLayer(null);
      return;
    }
    onLayer({
      jobId: detail.id,
      setId: r.setId || null,
      currency: snapshotCurrency(),
      range: snapshot().range || detail.range || range,
      overlays: overlays()
        .filter((o) => !hidden.has(o.id))
        .map((o) => structuredClone(o)),
      selectedKey,
      scenarios: branches().map((b) => structuredClone(b)),
      snapshot: structuredClone(snapshot()),
      visible: true,
    });
  }
  function setNotice(value = "", error = false) {
    notice = value;
    if (!live()) return;
    noticeNode.textContent = notice;
    noticeNode.classList.toggle("is-error", error);
    syncBodyVisibility();
  }
  function invalidateQuote() {
    quote = null;
    runKey = null;
    clearTimeout(quoteTimer);
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (
      !live() ||
      !jobs.some((j) => activeStatus(j.status)) ||
      pollCount >= 120
    )
      return;
    pollTimer = setTimeout(poll, 5000);
  }
  async function poll() {
    if (!live() || polling) return;
    polling = true;
    pollCount++;
    try {
      await load(false);
    } finally {
      polling = false;
      schedulePoll();
    }
  }
  function render() {
    if (!live()) return;
    const r = result(),
      current =
        jobs.find((j) => j.id === chosenId) ||
        (detail?.id === chosenId ? detail : null),
      p = prefs();
    const launch = root.querySelector("[data-aic-open]");
    launch.disabled = !loaded || busy;
    launch.setAttribute("aria-expanded", String(open));
    launch.setAttribute(
      "aria-label",
      open ? "Close AI composer" : r ? "New analysis" : "Analyze",
    );
    launch.title = open ? "Close AI composer" : r ? "New analysis" : "Analyze";
    launch.innerHTML = `${open ? "Close" : r ? "New analysis" : "Analyze"} ${icon(open ? "close" : "arrow")}`;
    root.querySelector("[data-aic-model]").textContent = info
      ? `${providerLabel(p.provider)} · ${modelName()}`
      : "";
    const resultsButton = root.querySelector("[data-aic-results]");
    resultsButton.hidden = !r;
    resultsButton.textContent = resultsOpen ? "Hide" : "View";
    resultsButton.setAttribute(
      "aria-label",
      resultsOpen ? "Hide AI analysis" : "Show AI analysis",
    );
    resultsButton.setAttribute("aria-expanded", String(resultsOpen));
    const visibleButton = root.querySelector("[data-aic-visibility]");
    visibleButton.hidden = !r;
    visibleButton.disabled = !compatible();
    visibleButton.setAttribute(
      "aria-pressed",
      String(visibility && compatible()),
    );
    visibleButton.setAttribute(
      "aria-label",
      visibility && compatible() ? "Hide AI overlays" : "Show AI overlays",
    );
    const active = jobs.find((j) => activeStatus(j.status));
    const jobChoices = jobs.length
      ? `<div class="aic-history"><label><span>AI runs</span><select aria-label="AI chart run" data-aic-run ${busy ? "disabled" : ""}>${jobs.map((j) => `<option value="${esc(j.id)}" ${j.id === chosenId ? "selected" : ""}>${esc(when(j.createdAt || j.created_at))} · ${esc(j.status === "completed" ? j.modelLabel || modelLabel(j.model) || "Complete" : j.status)}</option>`).join("")}</select></label>${current && activeStatus(current.status) ? `<span class="aic-job-state" role="status"><i></i>${current.status === "queued" ? "Queued" : "Reading chart"}</span>${current.status === "queued" ? '<button class="link" data-aic-cancel>Cancel</button>' : ""}<button class="aic-refresh" data-aic-refresh aria-label="Refresh AI analysis status">${icon("refresh")}</button>` : ""}</div>`
      : "";
    const preview = open
      ? `<div class="aic-compose"><div class="aic-compose-controls"><div class="aic-periods" role="group" aria-label="AI analysis history">${Object.entries(
          rangeLabels,
        )
          .map(
            ([id, label]) =>
              `<button data-aic-range="${id}" aria-label="Analyze ${label}" aria-pressed="${id === range}" ${busy || submissionUnknown ? "disabled" : ""}>${id === "1mo" ? "1M" : id === "3mo" ? "3M" : "1Y"}</button>`,
          )
          .join(
            "",
          )}</div><button class="aic-currency" data-aic-currency aria-label="AI analysis currency ${currency}" ${busy || submissionUnknown ? "disabled" : ""}>${currency}</button><button class="aic-settings link" data-aic-settings>Models ${icon("arrow")}</button></div>${configured() ? `<div class="aic-run-budget"><div><span>Available</span><b data-number>${usd(available())}</b><small>/ ${usd(quote?.budget?.monthlyLimit ?? p.monthlyLimit)}</small></div><div><span>${quote ? "Max hold" : "Per run"}</span><b data-number>${maxUSD(quote?.reserved ?? quote?.maxCost ?? p.runLimit)}</b></div></div>${quote ? `<div class="aic-quote"><span>${Number(quote.bars ?? quote.chart?.bars ?? quote.snapshot?.barCount ?? 0) || "—"} bars · ${esc(currency)} · ${esc(modelName())}</span><button class="aic-primary" data-aic-confirm ${busy || (!submissionUnknown && quote.expiresAt && Date.now() >= quote.expiresAt) || quote.allowed === false ? "disabled" : ""}>${busy ? "Queuing…" : submissionUnknown ? "Retry request" : "Run analysis"} ${icon("arrow")}</button></div>` : `<button class="aic-primary aic-estimate" data-aic-estimate ${busy || !!active ? "disabled" : ""}>${busy ? "Preparing chart…" : active ? "Analysis in progress" : "Prepare analysis"} ${icon("arrow")}</button>`}` : `<button class="aic-connect" data-aic-settings>${esc(setupLabel())} ${icon("arrow")}</button>`}</div>`
      : "";
    let content = "";
    if (r) {
      const chart = snapshot(),
        ledger = detail.ledger || {};
      const cost = ledger.cost ?? detail.cost;
      const barCount = Array.isArray(chart.bars)
        ? chart.bars.length
        : chart.bars || chart.barCount;
      const date = chart.lastTime
        ? chart.lastTime * (chart.lastTime < 1e12 ? 1000 : 1)
        : chart.lastAt;
      content = `<div class="aic-result"><div class="aic-result-heading"><span class="aic-origin">AI / ${esc(detail.modelLabel || modelLabel(detail.model) || modelName())}</span><span class="aic-cost" data-number>${cost === undefined || cost === null ? (ledger.state === "uncertain" ? "Usage unconfirmed" : "") : usd(cost)}</span></div><p class="aic-summary">${esc(r.summary)}</p>${!compatible() ? `<div class="aic-currency-mismatch">${esc(snapshotCurrency())} analysis <span>Chart · ${esc(context().currency || "—")}</span></div>` : ""}<div class="aic-overlays" role="group" aria-label="AI overlay visibility">${overlays()
        .map(
          (o, i) =>
            `<button data-aic-overlay="${esc(o.id)}" aria-pressed="${!hidden.has(o.id)}" title="${esc(o.rationale || o.label)}"><i style="--aic-line:${["#8cd8de", "#a6bdf3", "#b5a4e1", "#75b9a7"][i % 4]}"></i>${esc(o.label || o.type)}</button>`,
        )
        .join("")}</div>${
        branches().length
          ? `<div class="aic-branches" role="group" aria-label="AI chart scenarios">${branches()
              .map(
                (b, i) =>
                  `<button data-aic-branch="${esc(b.eventKey)}" aria-pressed="${selectedKey === b.eventKey}" style="--aic-branch:${["#8cd8de", "#a6bdf3", "#b5a4e1", "#75b9a7"][i % 4]}"><span class="aic-branch-head"><i></i>${esc(b.title)}${icon("chevron")}</span><b>${formatPrice(b.low)}<span>—</span>${formatPrice(b.high)}<small>${esc(b.currency)}</small></b><span class="aic-condition">${esc(b.condition || "")}</span></button>`,
              )
              .join("")}</div>`
          : ""
      }<div class="aic-result-footer"><span>${esc(chart.source || "Market history")}${barCount ? ` · ${barCount} bars` : ""}${date ? ` · ${esc(new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }))}` : ""}</span>${r.setId ? `<button class="link" data-aic-tree>Open tree ${icon("arrow")}</button>` : ""}</div>${
        overlays().length
          ? `<details class="aic-evidence"><summary>Chart evidence ${icon("plus")}</summary><div>${overlays()
              .map(
                (o) =>
                  `<article><h4>${esc(o.label || o.type)}</h4><p>${esc(o.rationale || "")}</p>${o.anchors?.length ? `<span>${o.anchors.map((a) => `${new Date(a.time * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · ${formatPrice(a.price)} ${esc(snapshotCurrency())}`).join(" → ")}</span>` : ""}</article>`,
              )
              .join("")}</div></details>`
          : ""
      }</div>`;
    } else if (
      current?.status === "failed" ||
      current?.status === "cancelled"
    ) {
      const ledger = detail?.ledger || current.ledger;
      const charge =
        ledger?.state === "uncertain"
          ? `${usd(ledger.reserved)} held · usage unconfirmed`
          : ledger?.cost !== null && ledger?.cost !== undefined
            ? `${usd(ledger.cost)} recorded`
            : "";
      content = `<div class="aic-run-error"><span>${current.status === "cancelled" ? "Cancelled" : "Analysis paused"}</span><p>${esc(detail?.error || current.error || "")}</p>${charge ? `<span class="aic-failed-cost" data-number>${esc(charge)}</span>` : ""}<button class="link" data-aic-open>New analysis ${icon("arrow")}</button></div>`;
    } else if (current && activeStatus(current.status)) {
      content = `<div class="aic-processing" role="status"><div class="aic-scan" aria-hidden="true"><svg viewBox="0 0 400 60" preserveAspectRatio="none"><path d="M0 49 17 45 30 48 46 28 62 34 78 30 91 37 109 16 124 22 139 19 155 33 173 29 188 40 207 24 224 26 241 12 260 19 278 11 296 20 317 8 333 14 352 5 370 11 387 7 400 2"/></svg><i></i></div><span>${current.status === "queued" ? "Waiting for your analysis slot" : "Mapping structure and scenarios"}</span></div>`;
    } else if (!loaded) content = "";
    if (listError)
      content = `<div class="aic-run-error"><p>${esc(listError)}</p><button class="link" data-aic-retry>Retry</button></div>`;
    body.innerHTML =
      (open || resultsOpen || !!active ? jobChoices : "") +
      preview +
      (r && !resultsOpen && !listError ? "" : content);
    body.classList.toggle("is-collapsed", !open && !resultsOpen && !active);
    syncBodyVisibility();
    if (pollCount >= 120 && active)
      setNotice("Still processing · refresh status", false);
    emit();
  }

  async function selectJob(id, { silent = false } = {}) {
    const epoch = ++detailGeneration;
    if (!silent) {
      chosenId = id;
      detail = null;
      selectedKey = null;
      hidden = new Set();
      onLayer(null);
    }
    if (!id) {
      render();
      return;
    }
    try {
      const value = await req("/api/chart-analysis/" + encodeURIComponent(id));
      if (!live() || epoch !== detailGeneration || chosenId !== id) return;
      if (value.symbol !== asset.symbol) {
        setNotice("Choose an analysis for " + asset.symbol + ".", true);
        return;
      }
      detail = value;
      if (
        selectedKey &&
        !(value.result?.scenarios || []).some((b) => b.eventKey === selectedKey)
      )
        selectedKey = null;
      const index = jobs.findIndex((j) => j.id === id);
      if (index < 0) jobs.push(value);
      else
        jobs[index] = {
          ...jobs[index],
          status: value.status,
          error: value.error,
        };
      render();
      if (value.id === requestedRunId && !activeStatus(value.status)) {
        requestedRunId = null;
        if (value.status === "completed")
          onComplete({ jobId: value.id, setId: value.result?.setId || null });
      }
    } catch (e) {
      if (live() && epoch === detailGeneration) setNotice(e.message, true);
    }
  }
  async function load(initial = true) {
    const epoch = ++generation;
    try {
      const value = await req(
        "/api/chart-analysis?" + new URLSearchParams({ symbol: asset.symbol }),
      );
      if (!live() || epoch !== generation) return;
      const previous = jobs.find((j) => j.id === chosenId);
      info = value;
      jobs = value.jobs || value.analyses || [];
      loaded = true;
      listError = "";
      if (!chosenId)
        chosenId =
          jobs.find((j) => activeStatus(j.status))?.id ||
          jobs.find((j) => j.status === "completed")?.id ||
          jobs[0]?.id ||
          null;
      if (detail?.id === chosenId && !jobs.some((j) => j.id === chosenId))
        jobs.push(detail);
      const chosen = jobs.find((j) => j.id === chosenId);
      if (
        chosenId &&
        (initial ||
          !detail ||
          chosen?.status !== previous?.status ||
          activeStatus(chosen?.status))
      )
        await selectJob(chosenId, { silent: true });
      if (!live() || epoch !== generation) return;
      render();
      const requested = jobs.find((j) => j.id === requestedRunId);
      if (requested && !activeStatus(requested.status)) {
        requestedRunId = null;
        if (requested.status === "completed")
          onComplete({ jobId: requested.id, setId: requested.setId || null });
      }
      schedulePoll();
    } catch (e) {
      if (!live() || epoch !== generation) return;
      loaded = true;
      if (!initial && jobs.some((j) => activeStatus(j.status)))
        setNotice("Status unavailable · refresh to reconnect", true);
      else {
        listError = e.message;
        render();
      }
    }
  }
  async function estimate() {
    if (busy || submissionUnknown || !configured()) return;
    busy = true;
    setNotice();
    invalidateQuote();
    render();
    try {
      const value = await req("/api/chart-analysis/estimate", "POST", {
        symbol: asset.symbol,
        range,
        currency,
      });
      if (!live()) return;
      quote = value;
      runKey = crypto.randomUUID();
      if (quote.expiresAt)
        quoteTimer = setTimeout(
          () => {
            if (!live()) return;
            if (submissionUnknown) {
              setNotice(
                "Request unconfirmed · retry uses the same request",
                true,
              );
              return;
            }
            invalidateQuote();
            setNotice("Estimate expired · prepare again");
            render();
          },
          Math.max(0, quote.expiresAt - Date.now()),
        );
    } catch (e) {
      if (live()) setNotice(e.message, true);
    } finally {
      if (live()) {
        busy = false;
        render();
      }
    }
  }
  async function run() {
    if (busy || !quote || !runKey) return;
    busy = true;
    setNotice();
    render();
    const knownJobs = new Set(jobs.map((j) => j.id)),
      submittedHash = quote.snapshot?.hash;
    try {
      const value = await req("/api/chart-analysis", "POST", {
        requestKey: runKey,
        quoteId: quote.quoteId,
      });
      if (!live()) return;
      submissionUnknown = false;
      invalidateQuote();
      open = false;
      chosenId = value.id;
      requestedRunId = value.id;
      detail = null;
      hidden = new Set();
      selectedKey = null;
      resultsOpen = true;
      visibility = true;
      pollCount = 0;
      await load();
    } catch (e) {
      if (!live()) return;
      if (!e.status || e.status >= 500) {
        submissionUnknown = true;
        // A lost response may hide a successfully queued job. Read status only;
        // never send another provider-backed request automatically.
        await load(false);
        if (!live()) return;
        const recovered =
          submittedHash &&
          jobs.find(
            (j) => !knownJobs.has(j.id) && j.snapshotHash === submittedHash,
          );
        const active = recovered || jobs.find((j) => activeStatus(j.status));
        if (active) {
          open = false;
          chosenId = active.id;
          detail = null;
          resultsOpen = true;
          if (recovered) {
            visibility = true;
            selectedKey = null;
            hidden = new Set();
            requestedRunId = recovered.id;
            submissionUnknown = false;
            invalidateQuote();
          }
          await selectJob(active.id, { silent: true });
          schedulePoll();
        }
        setNotice(
          recovered
            ? "Request recovered"
            : "Request unconfirmed · refresh status or retry the same request",
          !recovered,
        );
      } else {
        if (e.status !== 429) {
          submissionUnknown = false;
          invalidateQuote();
        }
        setNotice(e.message, true);
      }
    } finally {
      if (live()) {
        busy = false;
        render();
      }
    }
  }
  function openScenario() {
    if (!live() || !result()?.setId) return;
    onScenario({
      setId: result().setId,
      eventKey: selectedKey,
      jobId: detail.id,
    });
  }
  const handleClick = (event) => {
    event.stopPropagation();
    const button = event.target.closest("button");
    if (
      !button ||
      (!root.contains(button) && !body.contains(button)) ||
      button.disabled
    )
      return;
    if (button.hasAttribute("data-aic-open")) {
      open = !open;
      if (!open && !submissionUnknown) invalidateQuote();
      render();
      if (open) revealDetails();
    } else if (button.hasAttribute("data-aic-results")) {
      resultsOpen = !resultsOpen;
      if (resultsOpen) visibility = true;
      render();
      if (resultsOpen) revealDetails();
    } else if (button.hasAttribute("data-aic-settings")) onSettings();
    else if (button.dataset.aicRange) {
      range = button.dataset.aicRange;
      invalidateQuote();
      render();
    } else if (button.hasAttribute("data-aic-currency")) {
      currency = currency === "EUR" ? "USD" : "EUR";
      invalidateQuote();
      render();
    } else if (button.hasAttribute("data-aic-estimate")) estimate();
    else if (button.hasAttribute("data-aic-confirm")) run();
    else if (
      button.hasAttribute("data-aic-retry") ||
      button.hasAttribute("data-aic-refresh")
    ) {
      pollCount = 0;
      load();
    } else if (button.hasAttribute("data-aic-visibility")) {
      visibility = !visibility;
      render();
    } else if (button.dataset.aicOverlay) {
      const id = button.dataset.aicOverlay;
      if (hidden.has(id)) hidden.delete(id);
      else hidden.add(id);
      render();
    } else if (button.dataset.aicBranch) {
      selectedKey =
        selectedKey === button.dataset.aicBranch
          ? null
          : button.dataset.aicBranch;
      render();
    } else if (button.hasAttribute("data-aic-tree")) openScenario();
    else if (button.hasAttribute("data-aic-cancel") && chosenId && !busy) {
      busy = true;
      render();
      req("/api/research/jobs/" + encodeURIComponent(chosenId), "DELETE")
        .then(() => {
          if (live()) return load();
        })
        .catch((e) => {
          if (live()) setNotice(e.message, true);
        })
        .finally(() => {
          if (live()) {
            busy = false;
            render();
          }
        });
    }
  };
  const handleChange = (event) => {
    event.stopPropagation();
    if (event.target.matches("[data-aic-run]")) selectJob(event.target.value);
  };
  root.onclick = handleClick;
  body.onclick = handleClick;
  root.onchange = handleChange;
  body.onchange = handleChange;
  load();
  return {
    async selectJob(id, key = null) {
      selectedKey = key;
      resultsOpen = true;
      chosenId = id;
      detail = null;
      hidden = new Set();
      visibility = true;
      onLayer(null);
      await selectJob(id, { silent: true });
    },
    updateContext() {
      if (live()) render();
    },
    setSelection(key) {
      selectedKey = key;
      if (live()) render();
    },
    openScenario,
    refresh() {
      pollCount = 0;
      return load();
    },
    destroy() {
      alive = false;
      generation++;
      detailGeneration++;
      clearTimeout(pollTimer);
      clearTimeout(quoteTimer);
      aborter.abort();
      root.onclick = null;
      root.onchange = null;
      body.onclick = null;
      body.onchange = null;
      onLayer(null);
    },
  };
}
