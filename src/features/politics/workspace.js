import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { icon, monogram, bindLogos, toast } from "../../shared/ui.js";
import { chooseWatchlists } from "../watchlists/controls.js";
import { mountPriceChart } from "../charts/price-chart.js";
import { avatar, chamber, party, choosePolitician } from "./people.js";
import { careerView, powerView } from "./insights.js";
import { mountReturnEstimate } from "./returns.js";

const count = (n) => Number(n || 0).toLocaleString();
const date = (v) =>
  v
    ? new Date(v + "T12:00:00Z").toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const compact = (n) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
function band(r) {
  return r.low !== null && r.high !== null
    ? "$" + compact(r.low) + "–" + compact(r.high)
    : r.low !== null
      ? "$" + compact(r.low) + "+"
      : r.amount || "Not specified";
}
function architecture() {
  return `<svg class="capitol-architecture" viewBox="0 0 1000 440" fill="none" aria-hidden="true"><defs><radialGradient id="capitol-aura"><stop stop-color="#387e61" stop-opacity=".32"/><stop offset="1" stop-color="#17372b" stop-opacity="0"/></radialGradient><linearGradient id="capitol-lines" x2="0" y2="1"><stop stop-color="#9ac3a7" stop-opacity=".65"/><stop offset="1" stop-color="#568d74" stop-opacity=".03"/></linearGradient></defs><ellipse cx="690" cy="230" rx="380" ry="270" fill="url(#capitol-aura)"/><g stroke="url(#capitol-lines)" stroke-width="1"><path d="M210 392h760M245 380h690M270 367h640M290 350h600M310 338h560M335 320h510M355 280h470M355 275l235-65 235 65M548 210v-32h84v32M542 178h96M548 170c0-63 20-103 42-109 22 6 42 46 42 109M538 170h104M555 160c0-57 17-89 35-99 18 10 35 42 35 99M568 160c0-50 10-86 22-99 12 13 22 49 22 99M578 160l12-99 12 99M580 61V45h20v16M590 45V29m-5 0h10M365 280v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40m28-40v40"/><ellipse cx="590" cy="178" rx="48" ry="5"/><ellipse cx="590" cy="170" rx="52" ry="5"/><path d="M80 420 500 220m500 200L680 220M0 400h1000M70 430h930M270 440V320m50 120V300m550 140V300m50 140V320" stroke-dasharray="2 10"/></g><g fill="#8ec8a5"><circle cx="590" cy="29" r="2.5"/><circle cx="310" cy="338" r="2" opacity=".5"/><circle cx="870" cy="338" r="2" opacity=".5"/></g></svg>`;
}
export function mountPolitics(root, { model, navigate }) {
  const ownerId = model.currentUser.id || model.currentUser.username;
  const memory =
    model.politics ||
    (model.politics = {
      days: 90,
      chamber: "all",
      side: "all",
      scope: "all",
      q: "",
      member: "",
      ticker: "",
    });
  let alive = true,
    epoch = 0,
    controller = null,
    searchTimer,
    chart = null,
    returnEstimate = null,
    chartTicker = null,
    data = null,
    lists = [],
    rows = [],
    more = false,
    resetting = false,
    feedMetadata = null,
    checking = false,
    statusController = null,
    lastClientCheck = 0;
  const live = () => alive && root.isConnected;
  root.innerHTML = `<header class="capitol-hero">${architecture()}<div class="capitol-title"><span class="eyebrow">US · PUBLIC RECORD</span><h1>Capitol<span>.</span></h1><div class="capitol-freshness" data-feed-status role="status">Fetching disclosures</div></div><div class="capitol-stats" data-capitol-stats><div><span>Disclosures</span><b>—</b></div><div><span>Filers</span><b>—</b></div><div><span>Median filing lag</span><b>—</b></div></div></header><div class="capitol-sync-row" data-sync-status role="status"></div><div class="capitol-controls"><button class="capitol-back link" data-clear-person hidden aria-label="Back to people">${icon("arrowLeft")}<span>People</span></button><div class="capitol-search">${icon("sliders")}<input type="search" aria-label="Search politicians and assets" placeholder="Person, ticker or asset" value="${esc(memory.q)}" autocomplete="off"></div><button class="link capitol-people-button" data-people>People ${icon("chevron")}</button><div class="capitol-filters"><select data-filter="scope" aria-label="Disclosure scope"><option value="all">All disclosures</option><option value="portfolio">My holdings</option></select><select data-filter="chamber" aria-label="Branch or chamber">${[
    ["all", "All chambers"],
    ["house", "House"],
    ["senate", "Senate"],
    ["executive", "Executive"],
  ]
    .map(
      ([v, t]) =>
        `<option value="${v}" ${memory.chamber === v ? "selected" : ""}>${t}</option>`,
    )
    .join(
      "",
    )}</select><select data-filter="side" aria-label="Transaction direction">${[
    ["all", "All transactions"],
    ["buy", "Purchases"],
    ["sell", "Sales"],
    ["exchange", "Exchanges"],
  ]
    .map(
      ([v, t]) =>
        `<option value="${v}" ${memory.side === v ? "selected" : ""}>${t}</option>`,
    )
    .join(
      "",
    )}</select><div class="capitol-period" aria-label="Filing date window">${[
    [30, "30D"],
    [90, "90D"],
    [365, "1Y"],
    [0, "All"],
  ]
    .map(
      ([v, t]) =>
        `<button data-days="${v}" aria-pressed="${Number(memory.days) === v}">${t}</button>`,
    )
    .join(
      "",
    )}</div></div></div><div data-capitol-results class="capitol-results" aria-busy="true"><div class="capitol-loading"></div></div>`;
  root.querySelector("input").oninput = (e) => {
    memory.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 250);
  };
  root.querySelectorAll("select").forEach(
    (s) =>
      (s.onchange = () => {
        memory[s.dataset.filter] = s.value;
        if (!resetting) load();
      }),
  );
  function photos() {
    bindLogos();
    root.querySelectorAll(".political-avatar img").forEach((img) => {
      img.onerror = () => img.remove();
      if (img.complete && !img.naturalWidth) img.remove();
    });
  }
  function stats() {
    const s = data.summary;
    root.querySelector("[data-capitol-stats]").innerHTML =
      `<div><span>Disclosures</span><b>${count(s.count)}</b></div><div><span>Filers</span><b>${count(s.people)}</b></div><div><span>Median filing lag</span><b>${s.medianLag === null ? "—" : count(s.medianLag)}<small>d</small></b></div>`;
    freshness();
  }
  function freshness() {
    const meta = feedMetadata || data;
    if (!meta || !live()) return;
    const c = meta.coverage;
    root.querySelector("[data-feed-status]").innerHTML = c
      ? `<span class="capitol-status-dot ${meta.status === "available" ? "" : "delayed"}"></span><span>Filed through ${date(c.through)}${meta.status === "cached" ? " · cached" : meta.status === "stale" ? " · check overdue" : meta.status === "delayed" ? " · source lag" : ""}</span><button class="link" data-coverage>Coverage ${icon("arrow")}</button>`
      : "<span>Disclosures unavailable</span>";
    const age = meta.checkedAt
      ? Math.max(0, Math.floor((Date.now() - meta.checkedAt) / 60000))
      : null;
    const checked =
      age === null
        ? "Check for updates"
        : age < 1
          ? "Checked just now"
          : age < 60
            ? `Checked ${age}m ago`
            : `Checked ${Math.floor(age / 60)}h ago`;
    const pending =
      data?.version && meta.version && meta.version !== data.version;
    root.querySelector("[data-sync-status]").innerHTML =
      `<button class="link capitol-refresh ${checking || meta.refreshing ? "is-checking" : ""}" data-refresh aria-label="Check for new disclosures" ${checking ? "disabled" : ""} title="Automatic checks every 12 hours">${icon("refresh")}<span>${checking || meta.refreshing ? "Checking source" : checked}</span></button>${pending ? '<button class="link capitol-new-filings" data-apply-update>New filings · Show latest ' + icon("arrow") + "</button>" : `<span class="capitol-sync-cadence">Every 12h${meta.historyStatus === "importing" ? " · importing history" : meta.historyStatus === "unavailable" ? " · history unavailable" : meta.historyStatus === "cached" ? " · history cached" : ""}</span>`}`;
    const fetched = root.querySelector("[data-last-checked]");
    if (fetched)
      fetched.textContent = meta.checkedAt
        ? new Date(meta.checkedAt).toLocaleString()
        : "Not verified yet";
  }
  async function checkUpdates(force = false) {
    if (
      !live() ||
      checking ||
      document.hidden ||
      (!force && Date.now() - lastClientCheck < 10000)
    )
      return;
    checking = true;
    lastClientCheck = Date.now();
    statusController = new AbortController();
    freshness();
    try {
      const next = await request(
        force ? "/api/politics/refresh" : "/api/politics/status",
        force ? "POST" : "GET",
        force ? {} : undefined,
        { signal: statusController.signal, timeout: 30000, ownerId },
      );
      if (!live()) return;
      feedMetadata = next;
      // Never remount an active chart, close an expanded filing, or steal keyboard focus.
      if (
        data &&
        next.version &&
        data.version !== next.version &&
        !chart &&
        !root.querySelector(".disclosure-detail:not([hidden])") &&
        !root.contains(document.activeElement) &&
        !document.querySelector("dialog[open]") &&
        root
          .querySelector("[data-capitol-results]")
          .getAttribute("aria-busy") !== "true"
      )
        await load(false, { quiet: true });
    } catch (e) {
      if (live() && e.name !== "AbortError") {
        if (feedMetadata || data)
          feedMetadata = {
            ...(feedMetadata || data),
            status: "cached",
            refreshing: false,
          };
        if (force) toast(e.message);
      }
    } finally {
      checking = false;
      freshness();
    }
  }

  function tradeRow(r) {
    return `<article class="disclosure-row" data-disclosure="${esc(r.id)}"><button class="disclosure-person" data-person="${esc(r.memberId)}">${avatar(r)}<span><strong>${esc(r.member)}</strong><small>${esc(chamber(r.chamber))}${r.state ? " · " + esc(r.state) : ""}${r.party ? " · " + esc(r.party) : ""}</small></span></button><button class="disclosure-asset" ${r.ticker ? `data-ticker="${esc(r.ticker)}"` : "disabled"}>${r.ticker ? monogram({ symbol: r.ticker, name: r.asset }) : '<span class="disclosure-unlisted">—</span>'}<span><strong>${esc(r.ticker || "No ticker")}</strong><small>${esc(r.asset)}</small></span></button><span class="disclosure-side ${r.side}">${icon(r.side === "buy" ? "arrowUpRight" : r.side === "sell" ? "arrowDownRight" : "swap")}${r.side === "buy" ? "Buy" : r.side === "sell" ? "Sell" : r.side === "exchange" ? "Exchange" : "Other"}</span><span class="disclosure-amount" title="${esc(r.amount || "Reported USD range")}">${esc(band(r))}<small>USD range</small></span><span class="disclosure-dates"><time datetime="${r.filed}">${date(r.filed)}</time><small>${r.lag}d after trade</small></span><button class="icon-button disclosure-expand" data-details="${esc(r.id)}" aria-label="Details for ${esc(r.member)} ${esc(r.ticker || r.asset)}" aria-expanded="false">${icon("plus")}</button><div class="disclosure-detail" hidden><dl><div class="disclosure-instrument"><dt>Asset as reported${r.assetType ? " · " + esc(r.assetType) : ""}</dt><dd>${esc(r.asset)}</dd></div><div><dt>Traded</dt><dd>${date(r.traded)}</dd></div><div><dt>Filed</dt><dd>${date(r.filed)}</dd></div><div><dt>Owner</dt><dd>${esc(r.owner)}</dd></div><div><dt>Transaction</dt><dd>${esc(r.type)}</dd></div><div><dt>Reported range · USD</dt><dd>${esc(r.amount || band(r))}</dd></div></dl>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}<div class="disclosure-detail-actions"><a class="link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Official filing ${icon("arrow")}</a>${r.ticker ? `<button class="link" data-watch="${esc(r.ticker)}">${icon("plus")} Watchlist</button><button class="link" data-research="${esc(r.ticker)}">Research ${icon("arrow")}</button>` : ""}</div></div></article>`;
  }
  function flow() {
    let bars = data.summary.flow;
    const annual = bars.length > 24;
    if (annual) {
      const years = new Map();
      for (const b of bars) {
        const year = b.date.slice(0, 4),
          v = years.get(year) || { date: year, buys: 0, sells: 0, other: 0 };
        v.buys += b.buys;
        v.sells += b.sells;
        v.other += b.other;
        years.set(year, v);
      }
      bars = [...years.values()];
    }
    if (!bars.length) return "";
    const max = Math.max(...bars.map((b) => b.buys + b.sells + b.other), 1);
    return `<div class="disclosure-flow"><div class="capitol-section-title"><span>Disclosure flow</span><span class="flow-legend"><i></i>Buy<i></i>Sell</span></div><div class="disclosure-flow-bars" role="img" aria-label="${annual ? "Annual" : "Monthly"} disclosed transaction counts">${bars.map((b) => `<div title="${b.date}: ${b.buys} purchases, ${b.sells} sales, ${b.other} other"><span class="flow-bar"><i style="height:${(b.buys / max) * 100}%"></i><i style="height:${(b.sells / max) * 100}%"></i><i style="height:${(b.other / max) * 100}%"></i></span><small>${annual ? b.date.slice(2) : new Date(b.date + "-15").toLocaleDateString(undefined, { month: "short" })}</small></div>`).join("")}</div></div>`;
  }
  function render() {
    const s = data.summary,
      result = root.querySelector("[data-capitol-results]");
    stats();
    root.querySelector(".capitol-back").hidden = !memory.member;
    chart?.destroy();
    returnEstimate?.destroy();
    returnEstimate = null;
    chart = null;
    chartTicker = null;
    const asset = memory.ticker
      ? {
          symbol: memory.ticker,
          name:
            rows.find((r) => r.ticker === memory.ticker)?.asset ||
            memory.ticker,
        }
      : null;
    result.innerHTML = `${
      data.member
        ? `<section class="politician-focus">${avatar(data.member, true)}<div><span class="eyebrow">${esc(chamber(data.member.chamber))}${data.member.party ? " · " + party(data.member.party) : ""}</span><h2>${esc(data.member.name)}</h2><p>${esc(data.member.state || data.member.office)}</p><button class="link" data-clear-person>${icon("arrowLeft")} All filers</button></div>${flow()}</section>${careerView(data.career)}`
        : s.members.length
          ? `<section class="politician-section"><div class="capitol-section-title"><h2>People <span>${count(s.members.length)}</span></h2><button class="link" data-people>All people ${icon("arrow")}</button></div><div class="politician-rail">${s.members
              .map(
                (p) =>
                  `<button class="politician-card" data-person="${esc(p.id)}">${avatar(p, true)}<span class="politician-caption"><strong>${esc(p.name)}</strong><span>${esc(chamber(p.chamber))}${p.party ? " · " + p.party : ""}</span><span class="politician-activity"><b>${count(p.count)}</b> disclosures <i style="--share:${(p.buys / (p.buys + p.sells || 1)) * 100}%"></i></span></span></button>`,
              )
              .join("")}</div></section>`
          : ""
    }
    ${
      asset
        ? `<section class="capitol-asset-focus"><header><div>${monogram(asset)}<h2>${esc(asset.symbol)}</h2><button class="icon-button" data-clear-ticker aria-label="Clear asset filter">${icon("close")}</button></div><span><button class="link" data-watch="${esc(asset.symbol)}">${icon("plus")} Watchlist</button><button class="link" data-research="${esc(asset.symbol)}">Research ${icon("arrow")}</button></span></header><div data-capitol-chart class="price-history"></div></section>`
        : s.tickers.length
          ? `<section class="disclosure-assets"><div class="capitol-section-title"><h2>Asset activity</h2><span>Disclosed transactions</span></div><div class="disclosure-asset-rail">${s.tickers
              .slice(0, 8)
              .map(
                (a) =>
                  `<button data-ticker="${esc(a.symbol)}">${monogram(a)}<span><strong>${esc(a.symbol)}</strong><small>${a.members} ${a.members === 1 ? "filer" : "filers"}</small></span><span class="asset-disclosure-count"><b>${count(a.count)}</b><small><i class="buy">${a.buys}</i> / <i class="sell">${a.sells}</i></small></span></button>`,
              )
              .join("")}</div></section>`
          : ""
    }
    ${asset ? powerView(data.power, asset.symbol, Number(memory.days)) : ""}
    <section class="disclosure-ledger"><header class="capitol-section-title"><h2>Disclosures <span>${count(s.count)}</span></h2><span><i class="buy">${count(s.buys)} buys</i> · <i class="sell">${count(s.sells)} sells</i></span></header><div class="disclosure-columns" aria-hidden="true"><span>Filer</span><span>Asset</span><span>Action</span><span>Reported value</span><span>Filed</span><span></span></div><div data-trade-rows>${rows.map(tradeRow).join("") || `<div class="capitol-empty"><span>${icon("layers")}</span><h3>${data.coverage ? "No matching disclosures" : "The disclosure feed is unavailable"}</h3><button class="link" ${data.coverage ? "data-reset" : "data-retry"}>${data.coverage ? "Reset filters" : "Retry"} ${icon("arrow")}</button></div>`}</div><button class="disclosure-more link" data-more ${data.nextOffset === null ? "hidden" : ""}>Load more ${icon("plus")}</button></section>
    <details class="capitol-coverage"><summary>Sources & coverage ${icon("chevron")}</summary><div><p><a href="https://huggingface.co/datasets/austin-starks/congressional-stock-trades" target="_blank" rel="noopener noreferrer">NexusTrade · historical archive ${icon("arrow")}</a></p><p><a href="https://github.com/kadoa-org/congress-trading-monitor" target="_blank" rel="noopener noreferrer">Kadoa · Congress Trading Monitor ${icon("arrow")}</a></p>${data.coverage ? `<dl><div><dt>Available filing history</dt><dd>${date(data.coverage.from)} – ${date(data.coverage.through)}</dd></div><div><dt>Disclosed transactions</dt><dd>${count(data.coverage.rows)}</dd></div><div><dt>Last checked</dt><dd data-last-checked>${data.checkedAt ? new Date(data.checkedAt).toLocaleString() : "Not verified yet"}</dd></div><div><dt>Source published</dt><dd>${data.publishedAt ? new Date(data.publishedAt).toLocaleString() : "—"}</dd></div><div><dt>Automatic checks</dt><dd>Every 12 hours</dd></div></dl>` : ""}${(data.sources || []).map((source) => `<dl><div><dt>${esc(source.name)} · ${esc(source.status)}</dt><dd>Published ${source.publishedAt ? new Date(source.publishedAt).toLocaleString() : "—"}</dd></div><div><dt>Checked</dt><dd>${source.checkedAt ? new Date(source.checkedAt).toLocaleString() : "—"}</dd></div></dl>`).join("")}<p>House Clerk · Senate eFD · Office of Government Ethics. Reported USD ranges and filing dates. Archive coverage may be partial; filing dates can differ from first publication.</p><p>Portraits: <a href="/people/credits.html" target="_blank" rel="noopener noreferrer">Sources & credits</a></p></div></details>`;
    if (data.member) {
      const host = document.createElement("section");
      host.className = "political-returns";
      result.querySelector(".politician-finances").after(host);
      returnEstimate = mountReturnEstimate(host, data.member.id, { ownerId });
    }
    if (asset) {
      chartTicker = asset.symbol;
      chart = mountPriceChart(
        root.querySelector("[data-capitol-chart]"),
        asset,
        {},
        { ownerId },
      );
    }
    photos();
    result.setAttribute("aria-busy", "false");
  }
  async function load(append = false, { quiet = false } = {}) {
    if (!live()) return;
    const operation = ++epoch;
    controller?.abort();
    controller = new AbortController();
    const result = root.querySelector("[data-capitol-results]");
    result.setAttribute("aria-busy", "true");
    root.querySelector(".capitol-controls").classList.add("is-loading");
    const query = new URLSearchParams(
      Object.entries(memory).filter(
        ([k, v]) =>
          v !== "" &&
          [
            "days",
            "chamber",
            "side",
            "scope",
            "q",
            "member",
            "ticker",
          ].includes(k),
      ),
    );
    if (append) {
      query.set("offset", data.nextOffset);
      query.set("version", data.version);
    }
    try {
      const next = await request("/api/politics?" + query, "GET", undefined, {
        signal: controller.signal,
        timeout: 30000,
      });
      if (!live() || operation !== epoch) return;
      data = next;
      feedMetadata = next;
      rows = append ? [...rows, ...next.rows] : next.rows;
      if (append) {
        root
          .querySelector("[data-trade-rows]")
          .insertAdjacentHTML("beforeend", next.rows.map(tradeRow).join(""));
        root.querySelector("[data-more]").hidden = next.nextOffset === null;
        photos();
      } else render();
    } catch (e) {
      if (!live() || operation !== epoch || e.name === "AbortError") return;
      if (append && e.status === 409) {
        await load();
        return;
      }
      if (!quiet) toast(e.message);
      if (!data)
        result.innerHTML =
          '<div class="capitol-empty"><h3>Disclosures unavailable</h3><button class="link" data-retry>Retry</button></div>';
    } finally {
      if (live() && operation === epoch) {
        more = false;
        result.setAttribute("aria-busy", "false");
        root.querySelector(".capitol-controls").classList.remove("is-loading");
        const b = root.querySelector("[data-more]");
        if (b) b.disabled = false;
      }
    }
  }
  async function research(symbol) {
    const all = await request("/api/research/assets?list=all");
    if (!all.assets.some((a) => a.symbol === symbol))
      await request(
        "/api/research/assets/" + encodeURIComponent(symbol),
        "PUT",
        {
          name: rows.find((r) => r.ticker === symbol)?.asset || symbol,
          automatic: false,
          intervalHours: 24,
        },
        { ownerId },
      );
    if (!live()) return;
    model.intelligence = {
      ...model.intelligence,
      tab: "research",
      symbol,
      watchlistId: null,
      jobId: null,
      aiJobId: null,
      aiEventKey: null,
      monitorJobId: null,
      monitorChange: null,
      focusSetId: null,
    };
    navigate("explore");
  }
  root.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.hasAttribute("data-people")) {
      b.disabled = true;
      choosePolitician({
        isAlive: live,
        onSelect: (id) => {
          selectPerson(id, true);
        },
      })
        .catch((e) => toast(e.message))
        .finally(() => {
          b.disabled = false;
        });
    } else if (b.hasAttribute("data-refresh")) checkUpdates(true);
    else if (b.hasAttribute("data-apply-update")) {
      if (chart?.canLeave?.() === false)
        toast("Your chart is saving. Try again in a moment.");
      else load();
    } else if (b.dataset.days !== undefined) {
      memory.days = Number(b.dataset.days);
      root
        .querySelectorAll("[data-days]")
        .forEach((n) => n.setAttribute("aria-pressed", String(n === b)));
      load();
    } else if (b.dataset.person) {
      selectPerson(b.dataset.person);
    } else if (b.hasAttribute("data-clear-person")) {
      const previous = memory.returnTo;
      memory.member = "";
      if (previous) {
        Object.assign(memory, previous.filters);
        delete memory.returnTo;
        syncControls();
      }
      load().then(() => {
        if (live() && previous) {
          root
            .querySelector(".politician-rail")
            ?.scrollTo({ left: previous.rail });
          window.scrollTo({ top: previous.scroll, behavior: "instant" });
        }
      });
    } else if (b.dataset.ticker) {
      memory.ticker = b.dataset.ticker;
      load();
    } else if (b.hasAttribute("data-clear-ticker")) {
      memory.ticker = "";
      load();
    } else if (b.dataset.details) {
      const row = b.closest(".disclosure-row"),
        detail = row.querySelector(".disclosure-detail");
      detail.hidden = !detail.hidden;
      b.setAttribute("aria-expanded", String(!detail.hidden));
      b.innerHTML = icon(detail.hidden ? "plus" : "minus");
    } else if (b.dataset.watch)
      chooseWatchlists(
        {
          symbol: b.dataset.watch,
          name:
            rows.find((r) => r.ticker === b.dataset.watch)?.asset ||
            b.dataset.watch,
        },
        { ownerId },
      ).catch((e) => toast(e.message));
    else if (b.dataset.research) {
      b.disabled = true;
      research(b.dataset.research).catch((e) => {
        toast(e.message);
        b.disabled = false;
      });
    } else if (b.hasAttribute("data-more")) {
      if (!more && data?.nextOffset !== null) {
        more = true;
        b.disabled = true;
        load(true);
      }
    } else if (b.hasAttribute("data-retry")) load();
    else if (b.hasAttribute("data-coverage")) {
      const detail = root.querySelector(".capitol-coverage");
      if (detail) {
        detail.open = true;
        detail.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } else if (b.hasAttribute("data-reset")) {
      resetFilters();
      load();
    }
  };
  function syncControls() {
    root.querySelector("input").value = memory.q;
    resetting = true;
    root.querySelectorAll("select").forEach((n) => {
      n.value = memory[n.dataset.filter];
      n.dispatchEvent(new Event("change", { bubbles: false }));
    });
    resetting = false;
    root
      .querySelectorAll("[data-days]")
      .forEach((n) =>
        n.setAttribute(
          "aria-pressed",
          String(Number(n.dataset.days) === Number(memory.days)),
        ),
      );
  }
  function selectPerson(id, fromDirectory = false) {
    if (chart?.canLeave?.() === false) {
      toast("Your chart is saving. Try again in a moment.");
      return;
    }
    if (!memory.member)
      memory.returnTo = {
        filters: Object.fromEntries(
          ["days", "scope", "chamber", "side", "q", "member", "ticker"].map(
            (k) => [k, memory[k]],
          ),
        ),
        scroll: window.scrollY,
        rail: root.querySelector(".politician-rail")?.scrollLeft || 0,
      };
    if (fromDirectory) resetFilters();
    memory.member = id;
    memory.q = "";
    syncControls();
    load().then(() => {
      if (live())
        root
          .querySelector(".capitol-controls")
          .scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
  function resetFilters() {
    Object.assign(memory, {
      days: 0,
      scope: "all",
      chamber: "all",
      side: "all",
      q: "",
      member: "",
      ticker: "",
    });
    root.querySelector("input").value = "";
    resetting = true;
    root.querySelectorAll("select").forEach((n) => {
      n.value = "all";
      n.dispatchEvent(new Event("change", { bubbles: false }));
    });
    resetting = false;
    root
      .querySelectorAll("[data-days]")
      .forEach((n) =>
        n.setAttribute("aria-pressed", String(n.dataset.days === "0")),
      );
  }
  const onResume = () => {
    if (!document.hidden) checkUpdates();
  };
  const refreshTimer = setInterval(() => checkUpdates(), 15 * 60000);
  document.addEventListener("visibilitychange", onResume);
  window.addEventListener("focus", onResume);

  (async () => {
    try {
      lists = (await request("/api/watchlists")).lists;
      if (!live()) return;
      const select = root.querySelector("[data-filter=scope]");
      select.insertAdjacentHTML(
        "beforeend",
        lists
          .map(
            (l) => `<option value="list:${esc(l.id)}">${esc(l.name)}</option>`,
          )
          .join(""),
      );
      if (![...select.options].some((o) => o.value === memory.scope))
        memory.scope = "all";
      select.value = memory.scope;
      await load();
    } catch (e) {
      if (live()) {
        toast(e.message);
        await load();
      }
    }
  })();
  return {
    canLeave: () => chart?.canLeave?.() !== false,
    destroy() {
      alive = false;
      epoch++;
      controller?.abort();
      statusController?.abort();
      clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      clearTimeout(searchTimer);
      chart?.destroy();
      returnEstimate?.destroy();
      chart = null;
      chartTicker = null;
      root.onclick = null;
    },
    get chartSymbol() {
      return chartTicker;
    },
  };
}
