import { mountPoliticalPerformance } from "./performance-chart.js";
import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { icon } from "../../shared/ui.js";
const money = (n, signed = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(n);
const exact = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const day = (v) =>
  new Date(v + "T12:00:00Z").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const count = (n) => Number(n).toLocaleString();
const percent = (n) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(n) + "%";
export function returnView(r, variant = "mid", { detailsOnly = false } = {}) {
  if (!r) return "";
  const v = r.variants[variant],
    c = r.coverage,
    salary = r.salary?.total,
    max = Math.max(Math.abs(v.gain), salary || 0, 1),
    negative = v.gain < 0,
    descriptions = {
      low: "Lower amount bands",
      mid: "Amount-band midpoints",
      high: "Upper amount bands",
    };
  const assumptions = `<details class="return-method" data-estimate-detail="method"><summary><span>Model & coverage <b>${count(c.purchases)} purchases · ${count(c.assets)} assets</b></span>${icon("chevron")}</summary><div class="return-method-body"><dl><div><dt>Record</dt><dd>${count(c.total)} disclosures</dd></div><div><dt>Priced trades</dt><dd>${count(c.modeled)}</dd></div><div><dt>Matched sales</dt><dd>${count(v.matchedSales)}</dd></div><div><dt>Unmatched sale value · estimate</dt><dd>${money(v.unmatchedSales)}</dd></div><div><dt>Owners</dt><dd>${esc(c.owners.join(" · ") || "—")}</dd></div><div><dt>Price dates</dt><dd>${c.priceFrom ? day(c.priceFrom) + (c.priceThrough !== c.priceFrom ? " – " + day(c.priceThrough) : "") : "Unavailable"}</dd></div></dl>${c.reasons.length ? `<div class="return-exclusions">${c.reasons.map((x) => `<span>${esc(x.label)}<b>${count(x.count)}</b></span>`).join("")}</div>` : ""}<p>FIFO estimate from the available record since 2012, not actual career earnings. ${esc(descriptions[variant])} set the assumed dollars for each trade. Lower and upper settings are sensitivity scenarios, not confidence bounds.</p><p>Daily split-adjusted closes, before dividends, taxes and fees. Non-trading dates use the next available close within four days (${c.shiftedDates} trades). Prices are valued at the latest close within seven days of the cutoff. Historical ticker changes and delisted assets may be missing.</p><p>Lots are separated by reported owner, with accounts pooled within each owner. Same-day sales run before purchases. A declared full sale closes all reconstructed lots; other sales use the selected amount assumption. Unmatched sales have no assumed profit. Options and incomplete price / amount chains are excluded. Remaining holdings are modeled, not verified.</p>${r.salary ? `<p>Salary benchmark: ${exact(r.salary.annual)} per year × ${count(r.salary.days)} days ÷ 365.2425, over the same modeled period. The ${r.salary.year} ${esc(r.salary.role)} rate is held constant; this is not historical pay received. Household investment estimates can include spouse and dependent trades; salary is for the officeholder only.</p><a href="${esc(r.salary.source)}" target="_blank" rel="noopener noreferrer">Salary source ${icon("arrow")}</a>` : ""}${r.performance ? `<p>Performance shows cumulative dollar gains, rebased to zero at the start of the selected period. Existing modeled holdings carry into shorter periods. S&P 500 and MSCI World use their USD price indexes: the same dollars are invested on each modeled purchase date, and the same fraction of each matched lot is sold on its sale date. Gains remain uninvested after sale. This retrospective comparison uses transaction dates, not the later public disclosure dates. Missing daily valuations appear as gaps.</p>${r.performance.benchmarks.map((b) => `<a href="${esc(b.source)}" target="_blank" rel="noopener noreferrer">${esc(b.label)} · USD price index ${icon("arrow")}</a>`).join("")}` : ""}${r.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ${icon("arrow")}</a>`).join("")}</div></details>`;
  if (!r.available)
    return `<div class="return-empty"><span>${icon("layers")}</span><h3>Not enough priced purchases</h3><p>${count(c.excluded)} disclosures excluded</p></div>${assumptions}`;
  const contributions = `    <details class="return-assets" data-estimate-detail="assets"><summary><span>Record contributions <b>${count(v.assets.length)}</b></span>${icon("chevron")}</summary><div class="return-asset-scroll"><div class="return-asset-head"><span>Asset</span><span>Modeled buys</span><span>Gain · estimate</span></div>${v.assets.map((a) => `<button data-ticker="${esc(a.symbol)}"><span>${esc(a.symbol)} ${icon("arrow")}</span><span title="${esc(exact(a.purchases))}">${money(a.purchases)}</span><b class="${a.gain < 0 ? "is-loss" : ""}" title="${esc(exact(a.gain))}">${money(a.gain, true)}</b></button>`).join("")}</div></details>`;
  if (detailsOnly) return contributions + assumptions;
  // Both bars use one linear dollar scale. A real zero origin makes a loss
  // visually different from a smaller positive return, including on mobile.
  const zero = negative ? 50 : 0,
    span = negative ? 50 : 100,
    gainWidth = (Math.abs(v.gain) / max) * span,
    salaryWidth = ((salary || 0) / max) * span;
  return `<div class="return-readout"><div><span>Investment gain · estimate</span><strong data-number class="${negative ? "is-loss" : ""}" title="${esc(exact(v.gain))}">${money(v.gain, true)}</strong><small>${percent(v.gainOnBuys)} <span>gain / modeled purchases</span></small></div><div class="return-period"><span>${day(r.from)}</span><i></i><span>${day(r.through)}</span><small>USD · ${esc(descriptions[variant])}</small></div></div>
    <div class="return-comparison" role="img" aria-label="Estimated investment gain ${esc(exact(v.gain))}; salary benchmark over the same period ${salary === undefined ? "unavailable" : esc(exact(salary))}">
      <div class="return-bar-label"><span>Investment <em>estimate</em></span><b data-number>${money(v.gain, true)}</b></div><div class="return-track" style="--zero:${zero}%"><i class="return-gain ${negative ? "is-loss" : ""}" style="left:${negative ? zero - gainWidth : zero}%;width:${gainWidth}%"></i></div>
      <div class="return-bar-label"><span>Salary benchmark <em>same period</em></span><b>${salary === undefined ? "Unavailable" : money(salary)}</b></div><div class="return-track" style="--zero:${zero}%"><i class="return-salary" style="left:${zero}%;width:${salaryWidth}%"></i></div>
    </div><div class="return-breakdown"><div><span>Matched sales · estimate</span><b data-number>${money(v.realized, true)}</b></div><div><span>Remaining holdings · estimate</span><b data-number>${money(v.open, true)}</b></div><div><span>${negative ? "Loss" : "Gain"} / salary benchmark</span><b data-number>${salary > 0 ? (Math.abs(v.gain) / salary).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "×" : "—"}</b></div></div>
    ${contributions}${assumptions}`;
}
export function mountReturnEstimate(root, member, { ownerId }) {
  let performanceChart = null;
  let alive = true,
    timer,
    controller,
    result = null,
    variant = "mid",
    lastStamp,
    revision = "",
    loading = false;
  root.innerHTML = `<header class="return-heading"><div><span class="eyebrow">DISCLOSED TRADES → HISTORICAL PRICES</span><h2>Investment return <span>Estimate</span></h2></div><div class="return-assumptions" role="group" aria-label="Disclosed transaction amount assumption">${[
    ["low", "Lower"],
    ["mid", "Midpoint"],
    ["high", "Upper"],
  ]
    .map(
      ([id, label]) =>
        `<button data-return-variant="${id}" aria-pressed="${id === variant}" disabled>${label}</button>`,
    )
    .join(
      "",
    )}</div></header><div class="return-performance-host" hidden></div><div class="return-body"><div class="return-placeholder" aria-hidden="true"><i></i><i></i><i></i></div></div><footer class="return-footer"><span data-return-status role="status">Preparing estimate</span><span>Daily closes · USD</span></footer>`;
  function render() {
    root.querySelector(".return-heading .eyebrow").textContent =
      `${count(result.coverage.purchases)} PRICED PURCHASES · ${count(result.coverage.assets)} ASSETS`;
    const body = root.querySelector(".return-body"),
      open = [...body.querySelectorAll("details[open]")].map(
        (d) => d.dataset.estimateDetail,
      );
    const hasPerformance = Boolean(result.performance?.dates?.length);
    root.classList.toggle("has-performance", hasPerformance);
    const host = root.querySelector(".return-performance-host");
    host.hidden = !hasPerformance;
    if (hasPerformance) {
      if (performanceChart)
        performanceChart.update(result.performance, variant);
      else
        performanceChart = mountPoliticalPerformance(host, member, {
          ownerId,
          performance: result.performance,
          variant,
        });
    } else {
      performanceChart?.destroy();
      performanceChart = null;
    }
    body.innerHTML = returnView(result, variant, {
      detailsOnly: hasPerformance,
    });
    open.forEach((id) =>
      body
        .querySelector(`[data-estimate-detail="${id}"]`)
        ?.setAttribute("open", ""),
    );
    root.querySelectorAll("[data-return-variant]").forEach((b) => {
      b.disabled = !result?.available;
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.returnVariant === variant),
      );
    });
  }
  root.onclick = (e) => {
    const button = e.target.closest("[data-return-variant]");
    if (!button) return;
    e.stopPropagation();
    variant = button.dataset.returnVariant;
    render();
  };
  async function load() {
    if (!alive || loading || document.hidden) return;
    clearTimeout(timer);
    loading = true;
    controller = new AbortController();
    let wait = 60000;
    try {
      const data = await request(
        "/api/politics/returns?member=" +
          encodeURIComponent(member.id) +
          (revision ? "&revision=" + encodeURIComponent(revision) : ""),
        "GET",
        undefined,
        { signal: controller.signal, ownerId },
      );
      if (!alive) return;
      if (
        data.result &&
        (data.revision
          ? data.revision !== revision
          : data.result.computedAt !== lastStamp)
      ) {
        result = data.result;
        lastStamp = result.computedAt;
        revision = data.revision || "";
        render();
      }
      const busy = ["queued", "calculating", "busy"].includes(data.status);
      root.querySelector("[data-return-status]").textContent = busy
        ? data.status === "busy"
          ? "Waiting for estimate slot"
          : data.status === "queued"
            ? "Estimate queued"
            : `Pricing assets${data.progress?.total ? ` · ${data.progress.done} / ${data.progress.total}` : ""}`
        : result
          ? `${data.status === "stale" ? "Cached estimate" : data.status === "partial" ? "Partial estimate" : "Updated"} · ${new Date(result.computedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
          : "Prices temporarily unavailable";
      if (!result && !busy)
        root.querySelector(".return-body").innerHTML =
          '<div class="return-empty"><h3>Prices temporarily unavailable</h3><p>The estimate will retry automatically.</p></div>';
      wait = busy
        ? data.status === "busy"
          ? 15000
          : 2500
        : Math.max(
            60000,
            (data.nextCheckAt || Date.now() + 3600000) - Date.now(),
          );
    } catch (e) {
      if (alive && e.name !== "AbortError") {
        root.querySelector("[data-return-status]").textContent =
          "Estimate temporarily offline";
        if (!result)
          root.querySelector(".return-body").innerHTML =
            '<div class="return-empty"><h3>Estimate unavailable</h3><button class="link" data-return-retry>Retry</button></div>';
        const retry = root.querySelector("[data-return-retry]");
        if (retry) retry.onclick = () => load();
      }
    } finally {
      loading = false;
      if (alive) timer = setTimeout(load, Math.min(wait, 2147483647));
    }
  }
  const resume = () => {
    if (!document.hidden) load();
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  load();
  return {
    destroy() {
      performanceChart?.destroy();
      alive = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      root.onclick = null;
    },
  };
}
