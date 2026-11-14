import { validatePortfolio as validate } from "./validation.js";
import {
  request,
  showAuth,
  accountCard,
  bindAccount,
  openPasskeys,
} from "./session.js";
import {
  featuredAssets,
  assetInfo,
  logoURL,
  assetTypeLabel,
} from "./assets.js";
import { calculate, target } from "./engine.js";
const $ = (s) => document.querySelector(s),
  money = (n) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: Math.abs(n) > 0 && Math.abs(n) < 0.01 ? 8 : 2,
    }).format(n),
  number = (n) =>
    new Intl.NumberFormat("en-GB", { maximumFractionDigits: 8 }).format(n),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  uid = () => crypto.randomUUID(),
  today = () => new Date().toLocaleDateString("en-CA");
const defaults = { rate: 27, sellFee: 1, buyFee: 1, whole: false };
let state = { version: 1, holdings: [], sales: [], settings: { ...defaults } },
  page = "portfolio",
  selected = null,
  percent = 5,
  scenario = {},
  quotes = {},
  busy = false;
let currentUser = null,
  revision = 0,
  saveTimer,
  pendingSave = null,
  saving = false,
  saveProblem = null;
window.addEventListener("beforeunload", (e) => {
  if (pendingSave || saving) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function flushSave() {
  clearTimeout(saveTimer);
  if (saving) return;
  if (!pendingSave) return;
  saving = true;
  syncLabel("Saving…");
  try {
    while (pendingSave) {
      const next = pendingSave;
      pendingSave = null;
      try {
        const r = await request("/api/portfolio", "PUT", {
          state: next,
          revision,
        });
        revision = r.revision;
        saveProblem = null;
      } catch (e) {
        pendingSave = pendingSave || next;
        saveProblem = e;
        throw e;
      }
    }
    syncLabel("Synced");
  } catch (e) {
    syncLabel(
      e.status === 409 ? "Conflict · tap to resolve" : "Not saved · retry",
    );
    toast(e.message);
  } finally {
    saving = false;
  }
}
function syncLabel(text) {
  const b = $("#sync-status");
  if (b) {
    b.textContent = text;
    b.classList.toggle("sync-error", !!saveProblem);
  }
}
async function signedIn(user, newAccount = false) {
  currentUser = user;
  try {
    const p = await request("/api/portfolio");
    state = validate(p.state);
    revision = p.revision;
    scenario = {};
    quotes = {};
    selected = null;
    page = "portfolio";
    render();
    if (state.holdings.length) refresh();
    if (newAccount) openPasskeys({ modal, close, toast });
  } catch (e) {
    currentUser = null;
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
  if (pendingSave || saving) {
    toast("Save or export your changes before signing out.");
    return;
  }
  try {
    await request("/api/auth/" + (all ? "logout-all" : "logout"), "POST", {});
    currentUser = null;
    state = { version: 1, holdings: [], sales: [], settings: { ...defaults } };
    quotes = {};
    scenario = {};
    close();
    await boot();
  } catch (e) {
    toast(e.message);
  }
}
function resolveSync() {
  if (saveProblem?.status === 401) {
    modal(
      `<h2>Sign in again</h2><p class="sub">Your session ended. Export your unsaved edits, then sign in and import them.</p><div class="actions"><button class="secondary" id="session-export">Export edits</button><button class="primary" id="session-login">Sign in</button></div>`,
    );
    $("#session-export").onclick = exportState;
    $("#session-login").onclick = () => {
      pendingSave = null;
      saveProblem = null;
      close();
      boot();
    };
    return;
  }
  if (saveProblem?.status === 409) {
    modal(
      `<h2>Changes on another device</h2><p class="sub">Export your current edits before loading the newer portfolio.</p><div class="actions"><button class="secondary" id="conflict-export">Export edits</button><button class="primary" id="conflict-reload">Load latest</button></div>`,
    );
    $("#conflict-export").onclick = exportState;
    $("#conflict-reload").onclick = async () => {
      pendingSave = null;
      saveProblem = null;
      close();
      await signedIn(currentUser);
    };
  } else flushSave();
}
function exportState() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "reentry-backup-" + today() + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function save() {
  pendingSave = structuredClone(state);
  syncLabel("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
}
let toastTimer;
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4000);
}
const qty = (h) => h.lots.reduce((s, l) => s + l.qty, 0),
  basis = (h) => h.lots.reduce((s, l) => s + l.qty * l.price + l.fee, 0),
  current = () =>
    state.holdings.find((h) => h.id === selected) || state.holdings[0];
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 17 17 5M5 5h12v12"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
  sliders:
    '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
}
function logo() {
  return '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 23V9h14M12 26 26 12M17 12h9v9" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function monogram(h) {
  const a = assetInfo(h),
    url = logoURL(a);
  return `<span class="stock-icon asset-logo" style="--stock:#adc8ba"><span>${esc(h.symbol.replace(/[^A-Z]/g, "").slice(0, 2))}</span>${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</span>`;
}
function bindLogos() {
  document.querySelectorAll(".asset-logo img").forEach((img) => {
    img.onerror = () => img.remove();
    if (img.complete && !img.naturalWidth) img.remove();
  });
}
function render() {
  if (!currentUser) return;
  for (const item of state.holdings)
    if (item.demo && !quotes[item.symbol])
      quotes[item.symbol] = { price: 150, time: Date.now() / 1000 };
  const h = current();
  if (h) selected = h.id;
  const totalBasis = state.holdings.reduce((s, h) => s + basis(h), 0),
    valued = state.holdings.filter((h) => quotes[h.symbol]?.price),
    totalValue = valued.reduce(
      (s, h) => s + quotes[h.symbol].price * qty(h),
      0,
    ),
    full = valued.length === state.holdings.length && valued.length > 0;
  $("#app").innerHTML =
    `<div class="shell"><header class="app-header"><button class="brand" data-page="portfolio" aria-label="Reentry home">${logo()}<span>reentry</span></button><nav class="nav" aria-label="Main navigation">${[
      ["portfolio", "Portfolio"],
      ["activity", "Buybacks"],
      ["settings", "Settings"],
    ]
      .map(
        ([id, t]) =>
          `<button data-page="${id}" class="${page === id ? "active" : ""}" ${page === id ? 'aria-current="page"' : ""}>${t}${id === "activity" && state.sales.filter((s) => s.status === "waiting").length ? `<span class="nav-count">${state.sales.filter((s) => s.status === "waiting").length}</span>` : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="header-right"><button class="account-username" data-page="settings">${icon("lock")} ${esc(currentUser.username)}</button><button class="primary small-button" id="add">${icon("plus")}<span>Add holding</span></button></div></header><main>${page === "portfolio" ? `<section class="overview"><div class="portfolio-total"><div class="eyebrow">Portfolio value <span class="currency-tag">EUR</span></div><div class="balance">${full ? money(totalValue) : "—"}<span class="balance-dot"></span></div><span class="small">${state.holdings.some((h) => h.demo) ? "Includes demo data" : full ? "Latest available prices" : state.holdings.length ? "Waiting for quotes" : "Start with your first holding"}</span></div><div class="overview-secondary"><div><span class="eyebrow">Invested</span><strong>${money(totalBasis)}</strong><span class="small">${state.holdings.length} holding${state.holdings.length === 1 ? "" : "s"}</span></div><div><span class="eyebrow">Unrealized</span><strong class="${full && totalValue >= totalBasis ? "positive" : full ? "negative" : ""}">${full ? money(totalValue - totalBasis) : "—"}</strong><span class="small">${full && totalBasis ? `${totalValue >= totalBasis ? "+" : ""}${((totalValue / totalBasis - 1) * 100).toFixed(2)}% return` : "Before tax"}</span></div></div></section>${h ? `<div class="workspace"><section class="holdings-panel"><div class="section-top"><h2>Holdings <span class="count">${state.holdings.length.toString().padStart(2, "0")}</span></h2><button class="icon-button ${busy ? "spinning" : ""}" aria-label="Refresh quotes" title="Refresh quotes" id="refresh" ${busy ? "disabled" : ""}>${icon("refresh")}</button></div><div class="holdings-list">${state.holdings.map((a) => `<button data-holding="${esc(a.id)}" class="holding ${a.id === selected ? "selected" : ""}" aria-pressed="${a.id === selected}"><div class="row">${monogram(a)}<div class="stock-info"><b>${esc(a.name.replace(/\s+I$/, "").trim())}</b><span>${esc(a.symbol)}${a.demo ? " · Demo" : ""}</span></div>${icon("chevron", "holding-arrow")}</div><div class="holding-values"><span>${number(qty(a))} shares</span><b>${quotes[a.symbol]?.price ? money(quotes[a.symbol].price) : "—"}</b></div></button>`).join("")}</div><button class="add-holding" id="add-second">${icon("plus")} Add holding</button><div class="holdings-bottom">${icon("lock")} Saved to your account</div></section><section class="planner"><div class="panel-head"><div class="row">${monogram(h)}<div><div class="eyebrow">${esc(h.symbol)} <span>·</span> Reentry planner</div><h1>${esc(h.name.replace(/\s+I$/, "").trim())}</h1></div></div><button class="icon-button" id="manage" aria-label="Manage purchases" title="Manage purchases">${icon("sliders")}</button></div><div class="planner-grid"><div class="trade-inputs"><div class="step-label"><span>01</span> Your sale</div><label for="sellqty">Shares to sell</label><div class="input-wrap"><input id="sellqty" type="number" min="0.00000001" max="${qty(h)}" step="any" value="${scenario[selected]?.q ?? qty(h)}"><span>shares</span></div><input aria-label="Percentage of shares to sell" id="slider" type="range" min="1" max="100" value="${((scenario[selected]?.q ?? qty(h)) / qty(h)) * 100}"><div class="quantity-actions"><span>${number(qty(h))} available</span><div>${[25, 50, 100].map((n) => `<button data-portion="${n}" ${n === 100 ? 'id="sellall"' : ""}>${n === 100 ? "Max" : n + "%"}</button>`).join("")}</div></div><div class="sale-price-field"><label for="sellprice">Sale price</label><div class="input-wrap"><input id="sellprice" type="number" min="0.00000001" step="any" placeholder="0.00" value="${scenario[selected]?.price ?? quoteInput(h)}"><span>EUR</span></div><div class="quote-line"><span title="${esc(quoteLabel(h).replace(/&[^;]+;/g, " "))}">${h.demo ? "Demo price" : quotes[h.symbol]?.price ? `${esc(quotes[h.symbol].exchange || "Quote")}${quotes[h.symbol].converted ? " · " + esc(quotes[h.symbol].originalCurrency) + "→EUR" : ""} · ${new Date(quotes[h.symbol].time * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}` : "Manual price"}</span><button class="link" id="usequote" ${!quotes[h.symbol]?.price ? "disabled" : ""}>Use quote</button></div>${quotes[h.symbol]?.error ? `<p class="error quote-error">${esc(quotes[h.symbol].error)}</p>` : ""}</div><details class="trade-details"><summary>${icon("sliders")} Fees & tax <span>${h.taxRate ?? state.settings.rate}%</span></summary><div class="form-row"><div><label>Sale fee (€)</label><input id="sf" type="number" min="0" step="any" value="${scenario[selected]?.sf ?? state.settings.sellFee}"></div><div><label>Buyback fee (€)</label><input id="bf" type="number" min="0" step="any" value="${scenario[selected]?.bf ?? state.settings.buyFee}"></div><div><label>Allowance (€)</label><input id="allowance" type="number" min="0" step="any" value="${scenario[selected]?.allowance ?? 0}"></div><div><label>Loss offset (€)</label><input id="losses" type="number" min="0" step="any" value="${scenario[selected]?.losses ?? 0}"></div></div></details><div class="position-context"><div><span>Average cost</span><b>${money(basis(h) / qty(h))}</b></div><div><span>Depot</span><b>${esc(h.broker)}</b></div></div></div><div id="results" class="results"></div></div></section></div>` : `<section class="welcome"><div class="welcome-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="welcome-mark">${logo()}</div><span class="orbit-point"></span></div><span class="eyebrow">YOUR NEXT MOVE</span><h1>Same capital.<br><span>More possibility.</span></h1><p>Add a holding. Find your next entry.</p><div class="welcome-actions"><button class="primary" id="empty-add">${icon("plus")} Add your first holding</button><button class="secondary" id="demo">Try demo ${icon("arrow")}</button></div><span class="welcome-note">Your portfolio. Across your devices.</span></section>`}` : `<div class="page-title"><span class="eyebrow">YOUR WORKSPACE</span><h1>${page === "activity" ? "Buybacks." : "Settings."}</h1></div>${page === "activity" ? activity() : settings()}`}<footer class="foot"><span><i class="status-dot"></i><button class="link" id="sync-status">${saveProblem ? "Not saved · retry" : pendingSave || saving ? "Saving…" : "Synced"}</button></span><a class="logo-credit" href="https://parqet.com/api" target="_blank" rel="noopener">Logos provided by Parqet</a><span>Estimated tax <span class="foot-divider">/</span> <button class="link" id="method">Calculation notes ${icon("arrow")}</button></span></footer></main></div>`;
  associateLabels($("#app"));
  bindLogos();
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        page = b.dataset.page;
        render();
      }),
  );
  document.querySelectorAll("[data-holding]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.holding;
        render();
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
  if (page === "settings") bindSettings();
  if (page === "activity")
    document
      .querySelectorAll("[data-rebuy]")
      .forEach((b) => (b.onclick = () => rebuy(b.dataset.rebuy)));
}
function quoteInput(h) {
  const p = quotes[h.symbol]?.price;
  return p ? Number(p.toFixed(h.assetType === "CRYPTOCURRENCY" ? 8 : 2)) : "";
}
function quoteLabel(h) {
  const q = quotes[h.symbol];
  if (h.demo) return "Illustrative demo prices · not market data";
  if (q?.error) return esc(q.error);
  if (!q) return "Quote not loaded · enter a EUR price";
  return `${esc(q.source || "Yahoo Finance")} · ${esc(q.exchange || "")} · ${esc(new Date(q.time * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }))}`;
}
function getResult() {
  const h = current(),
    s = scenario[selected];
  if (h.assetType && h.assetType !== "EQUITY" && !Number.isFinite(h.taxRate))
    throw Error(
      "Set an effective tax rate for this asset in purchase details.",
    );
  return {
    ...calculate(
      h.lots,
      s.q,
      s.price,
      s.sf,
      s.bf,
      current()?.taxRate ?? state.settings.rate,
      s.allowance,
      s.losses,
    ),
    precision: h.assetType === "CRYPTOCURRENCY" ? 8 : 2,
  };
}
function update() {
  scenario[selected] = {
    q: Number($("#sellqty").value),
    price: $("#sellprice").value === "" ? null : Number($("#sellprice").value),
    sf: Number($("#sf").value),
    bf: Number($("#bf").value),
    allowance: Number($("#allowance").value),
    losses: Number($("#losses").value),
  };
  $("#slider").value = (scenario[selected].q / qty(current())) * 100;
  $("#slider").style.setProperty(
    "--fill",
    Math.min(100, Number($("#slider").value)) + "%",
  );
  document
    .querySelectorAll("[data-portion]")
    .forEach((b) =>
      b.classList.toggle(
        "chosen",
        Math.abs(
          (scenario[selected].q / qty(current())) * 100 -
            Number(b.dataset.portion),
        ) < 0.001,
      ),
    );
  try {
    const r = getResult(),
      t = target(r, percent, state.settings.whole);
    $("#results").innerHTML =
      `<div class="result-top"><div class="step-label"><span>02</span> Your reentry</div><span class="pill">After tax</span></div><div class="target-choice"><label>Share increase</label><div class="switch">${[0, 5, 10].map((n) => `<button data-gain="${n}" class="${percent === n ? "on" : ""}" aria-pressed="${percent === n}">${n === 0 ? "Same" : `+${n}%`}</button>`).join("")}<button id="custom" class="${![0, 5, 10].includes(percent) ? "on" : ""}">${![0, 5, 10].includes(percent) ? "+" + percent + "%" : "Custom"}</button></div></div><div class="ceiling"><div class="eyebrow">BUY BACK AT OR BELOW</div><div class="target-price">${money(t.price)}</div><div class="target-meta"><span>${icon("layers")}${number(t.qty)} shares</span><span class="drop-badge">↓ ${t.drop.toFixed(2)}%</span></div></div>${chart(r)}<div class="settlement"><div><span>Tax estimate</span><b>${money(r.tax)}</b></div><div><span>Available to reinvest</span><b>${money(r.cash)}</b></div></div><button class="primary record-button" id="record"><span>Record sale</span>${icon("arrow")}</button><div class="result-note">${money(r.buyFee)} buyback fee included · ${state.settings.whole ? "Whole shares" : "Fractional shares"}</div><div class="mobile-target-dock"><button class="dock-target" id="dock-target"><span>Target +${percent}% ↗</span><b>${money(t.price)}</b><small>${number(t.qty)} shares</small></button><button class="primary" id="dock-record">Record sale ${icon("arrow")}</button></div>`;
    document.querySelectorAll("[data-gain]").forEach(
      (b) =>
        (b.onclick = () => {
          percent = Number(b.dataset.gain);
          update();
        }),
    );
    $("#custom").onclick = () => {
      modal(
        `<span class="eyebrow">REENTRY TARGET</span><h2>Custom target.</h2><form id="custom-form"><label>Additional shares (%)</label><div class="input-wrap"><input name="gain" type="number" min="0" max="1000" step="any" value="${percent}" required><span>%</span></div><div class="actions"><button class="primary">Set target ${icon("arrow")}</button></div></form>`,
      );
      $("#custom-form").onsubmit = (e) => {
        e.preventDefault();
        percent = Number(new FormData(e.target).get("gain"));
        close();
        update();
      };
    };
    $("#record").onclick = record;
    if ($("#dock-record")) $("#dock-record").onclick = record;
    if ($("#dock-target"))
      $("#dock-target").onclick = () => $("#custom").click();
  } catch (e) {
    $("#results").innerHTML =
      `<div class="result-top"><div class="step-label"><span>02</span> Your reentry</div></div><div class="result-empty">${logo()}<h2>One price away.</h2><p>${esc(e.message)}</p></div>`;
  }
}
function chart(r) {
  const max = Math.max(20, Math.ceil(percent / 10) * 10),
    base = target(r, 0).price,
    low = target(r, max).price,
    span = Math.max(0.01, base - low),
    px = (g) => 12 + (g / max) * 376,
    py = (g) => 14 + ((base - target(r, g).price) / span) * 74;
  const points = Array.from({ length: 41 }, (_, i) => {
      const g = (i * max) / 40;
      return `${px(g)},${py(g)}`;
    }),
    cx = px(percent),
    cy = py(percent);
  return `<div class="curve"><div class="curve-label"><span>Buyback price</span><span>Share increase</span></div><svg class="chart" viewBox="0 0 400 114" role="img" aria-label="Buyback ceiling by additional shares, with your ${percent}% target highlighted"><defs><linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#b9f68b" stop-opacity=".12"/><stop offset="1" stop-color="#b9f68b" stop-opacity="0"/></linearGradient></defs>${[15, 50, 85].map((y) => `<path d="M12 ${y}H388" stroke="#ffffff09" stroke-dasharray="3 5"/>`).join("")}<path d="M${points.join(" L")} L388,92 L12,92 Z" fill="url(#fade)"/><path d="M${points.join(" L")}" fill="none" stroke="#9ab984" stroke-width="1.5"/><path d="M${cx} ${cy}V94" stroke="#b9f68b55" stroke-dasharray="3 4"/><circle cx="${cx}" cy="${cy}" r="9" fill="#b9f68b16"/><circle cx="${cx}" cy="${cy}" r="4" fill="#c2f797" stroke="#202920" stroke-width="2"/>${[0, max / 4, max / 2, (max * 3) / 4, max].map((g) => `<text x="${px(g)}" y="111" fill="${g === percent ? "#d7f4c1" : "#747b78"}" font-size="9" text-anchor="${g === 0 ? "start" : g === max ? "end" : "middle"}">${g === 0 ? "0%" : "+" + number(g) + "%"}</text>`).join("")}</svg></div>`;
}
function associateLabels(root) {
  root.querySelectorAll("label").forEach((label, i) => {
    if (label.htmlFor) return;
    const input = label.nextElementSibling?.matches("input,select")
      ? label.nextElementSibling
      : label.nextElementSibling?.querySelector("input,select");
    if (input) {
      input.id ||= "field-" + i + "-" + root.id;
      label.htmlFor = input.id;
    }
  });
}
function modal(html) {
  $("#modal").innerHTML =
    `<button class="close icon-button" aria-label="Close dialog">${icon("close")}</button>${html}`;
  associateLabels($("#modal"));
  bindLogos();
  $("#modal .close").onclick = close;
  $("#modal").showModal();
  $("#modal").querySelector("input:not([type=hidden]),select")?.focus();
}
function close() {
  $("#modal").close();
}
function purchase(existing) {
  let chosen = existing ? assetInfo(existing) : null,
    entryMode = "shares",
    seq = 0,
    timer;
  modal(
    `<span class="eyebrow">YOUR PORTFOLIO</span><h2>${existing ? "Add purchase" : "Add an asset"}</h2><form id="purchase-form">${existing ? `<div class="selected-stock row">${monogram(existing)}<span>${esc(existing.name)} · ${esc(existing.symbol)}</span></div>` : `<div class="field asset-search-field"><label for="stock-search">Stock, ETF or crypto</label><input id="stock-search" placeholder="Name, ticker or ISIN" autocomplete="off" spellcheck="false"><div class="asset-filters" id="asset-filters"><button type="button" class="selected" data-filter="all">All</button><button type="button" data-filter="EQUITY">Stocks</button><button type="button" data-filter="ETF">ETFs</button><button type="button" data-filter="CRYPTOCURRENCY">Crypto</button></div><div class="search-results" id="search-results"></div><div id="chosen"></div></div>`}<div class="entry-mode"><button type="button" data-entry="shares" class="on">Shares</button><button type="button" data-entry="amount">Invested €</button></div><div class="form-row"><div class="field"><label id="quantity-label" for="purchase-qty">Shares</label><input id="purchase-qty" name="qty" type="number" inputmode="decimal" step="any" min="0.00000001" placeholder="0" required></div><div class="field"><label for="purchase-price">Buy-in per share (€)</label><input id="purchase-price" name="price" type="number" inputmode="decimal" step="any" min="0.00000001" placeholder="0.00" required></div></div><div class="entry-preview" id="entry-preview">Your actual purchase price in EUR.</div><div id="asset-tax"></div><details ${existing ? "open" : ""}><summary>Purchase details</summary><div class="field"><label>Purchase date</label><input name="date" type="date" value="${today()}" max="${today()}" required></div><div class="form-row"><div><label>Depot</label><select name="broker" ${existing ? "disabled" : ""}>${["Trade Republic", "Consorsbank", "Other"].map((b) => `<option ${existing?.broker === b ? "selected" : ""}>${b}</option>`).join("")}</select></div><div><label>Fee (€)</label><input name="fee" type="number" inputmode="decimal" step="any" min="0" value="0" required></div></div><div class="field"><label>ISIN (optional, for precise logos)</label><input name="isin" maxlength="12" pattern="[A-Z]{2}[A-Z0-9]{9}[0-9]" value="${esc(chosen?.isin || "")}" placeholder="e.g. US0378331005"></div></details><div class="error" id="form-error" role="alert"></div><div class="actions"><button type="button" class="secondary" id="cancel">Cancel</button><button class="primary">${existing ? "Save purchase" : "Add asset"}</button></div></form>`,
  );
  $("#cancel").onclick = close;
  function preview() {
    const q = Number($("#purchase-qty").value),
      p = Number($("#purchase-price").value);
    $("#entry-preview").textContent =
      q && p
        ? entryMode === "shares"
          ? `${number(q)} shares · ${money(q * p)} before fees`
          : `${money(q)} ÷ ${money(p)} = ${number(q / p)} shares · before fees`
        : "Your actual purchase price in EUR.";
  }
  document.querySelectorAll("[data-entry]").forEach(
    (b) =>
      (b.onclick = () => {
        entryMode = b.dataset.entry;
        document
          .querySelectorAll("[data-entry]")
          .forEach((x) => x.classList.toggle("on", x === b));
        $("#quantity-label").textContent =
          entryMode === "shares" ? "Shares" : "Trade value (€)";
        $("#purchase-qty").value = "";
        $("#purchase-qty").focus();
        preview();
      }),
  );
  $("#purchase-qty").oninput = preview;
  $("#purchase-price").oninput = preview;
  function taxField() {
    const t = chosen?.assetType || "EQUITY";
    $("#asset-tax").innerHTML =
      t !== "EQUITY"
        ? `<div class="asset-tax-notice"><span class="pill">${assetTypeLabel(t)}</span><p>Set an effective tax rate for this asset. Exemptions and holding-period rules are not automatic.</p><label>Effective tax rate (%)</label><input name="taxRate" type="number" inputmode="decimal" min="0" max="100" step="any" value="${existing?.taxRate ?? ""}" placeholder="Required" required></div>`
        : "";
    associateLabels($("#modal"));
  }
  if (!existing) {
    let results = featuredAssets,
      filter = "all";
    function paint() {
      const filtered = results.filter(
        (r) => filter === "all" || r.assetType === filter,
      );
      $("#search-results").innerHTML = filtered
        .map(
          (r) =>
            `<button type="button" class="asset-result" data-symbol="${esc(r.symbol)}">${monogram(r)}<span><b>${esc(r.name)}</b><small>${esc(r.symbol)} · ${esc(r.exchange)} · ${assetTypeLabel(r.assetType)}</small></span><span class="asset-select-arrow">↗</span></button>`,
        )
        .join("");
      const query = $("#stock-search").value.trim();
      if (/^[A-Za-z0-9.^=\-]{1,32}$/.test(query))
        $("#search-results").insertAdjacentHTML(
          "beforeend",
          `<button type="button" class="manual-result" id="manual-symbol">Use ${esc(query.toUpperCase())} manually</button>`,
        );
      if (!filtered.length && !query)
        $("#search-results").innerHTML =
          '<p class="small">Search for another asset.</p>';
      document
        .querySelectorAll("[data-symbol]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              choose(results.find((r) => r.symbol === b.dataset.symbol))),
        );
      if ($("#manual-symbol"))
        $("#manual-symbol").onclick = () =>
          choose({
            symbol: query.toUpperCase(),
            name: query.toUpperCase(),
            assetType: "OTHER",
          });
      bindLogos();
    }
    function choose(r) {
      chosen = assetInfo(r);
      $("#search-results").innerHTML = "";
      $("#asset-filters").hidden = true;
      $("#stock-search").value = r.name;
      $("#chosen").innerHTML =
        `<div class="selected-stock row">${monogram(r)}<span><b>${esc(r.name)}</b><small>${esc(r.symbol)} · ${assetTypeLabel(r.assetType)}</small></span><button type="button" id="change-asset" aria-label="Change asset">×</button></div>`;
      $("#change-asset").onclick = () => {
        chosen = null;
        $("#chosen").innerHTML = "";
        $("#stock-search").value = "";
        $("#asset-filters").hidden = false;
        results = featuredAssets;
        paint();
        $("#stock-search").focus();
      };
      $("#purchase-form [name=isin]").value = chosen.isin || "";
      taxField();
      bindLogos();
      $("#purchase-qty").focus();
    }
    document.querySelectorAll("[data-filter]").forEach(
      (b) =>
        (b.onclick = () => {
          filter = b.dataset.filter;
          document
            .querySelectorAll("[data-filter]")
            .forEach((x) => x.classList.toggle("selected", x === b));
          paint();
        }),
    );
    paint();
    $("#stock-search").oninput = () => {
      chosen = null;
      $("#chosen").innerHTML = "";
      $("#asset-tax").innerHTML = "";
      $("#asset-filters").hidden = false;
      clearTimeout(timer);
      const query = $("#stock-search").value.trim(),
        req = ++seq;
      if (query.length < 2) {
        results = featuredAssets;
        paint();
        return;
      }
      $("#search-results").innerHTML =
        '<p class="search-status">Searching…</p>';
      timer = setTimeout(async () => {
        try {
          const data = await request(
            "/api/search?q=" + encodeURIComponent(query),
          );
          if (req !== seq || !$("#search-results")) return;
          results = data.results || [];
          paint();
        } catch (e) {
          if (req !== seq || !$("#search-results")) return;
          results = featuredAssets.filter((a) =>
            (a.name + " " + a.symbol + " " + a.isin)
              .toLowerCase()
              .includes(query.toLowerCase()),
          );
          paint();
          $("#search-results").insertAdjacentHTML(
            "afterbegin",
            '<p class="search-status">Search unavailable. Showing known assets.</p>',
          );
        }
      }, 250);
    };
  } else taxField();
  $("#purchase-form").insertAdjacentHTML(
    "beforeend",
    '<a class="logo-credit picker-credit" href="https://parqet.com/api" target="_blank" rel="noopener">Logos provided by Parqet</a>',
  );
  $("#purchase-form").onsubmit = (e) => {
    e.preventDefault();
    try {
      if (!chosen) throw Error("Choose an asset first.");
      const d = new FormData(e.target),
        price = Number(d.get("price")),
        q = Number(d.get("qty")),
        lot = {
          id: uid(),
          qty: entryMode === "shares" ? q : Number((q / price).toFixed(8)),
          price,
          date: String(d.get("date")),
          fee: Number(d.get("fee")),
        };
      if (!Number.isFinite(lot.qty) || lot.qty <= 0 || !price)
        throw Error("Check your shares and price.");
      const broker = existing?.broker || String(d.get("broker")),
        isin = String(d.get("isin") || "").trim(),
        taxRate =
          chosen.assetType === "EQUITY" || !chosen.assetType
            ? null
            : Number(d.get("taxRate"));
      let h =
        existing ||
        state.holdings.find(
          (x) => x.symbol === chosen.symbol && x.broker === broker && !x.demo,
        );
      if (h) {
        h.lots.push(lot);
        if (isin) h.isin = isin;
      } else {
        h = {
          id: uid(),
          symbol: chosen.symbol,
          name: chosen.name,
          assetType: chosen.assetType || "EQUITY",
          isin,
          taxRate,
          broker,
          lots: [lot],
        };
        state.holdings.push(h);
      }
      selected = h.id;
      save();
      close();
      page = "portfolio";
      render();
      refresh();
      toast("Purchase added.");
    } catch (err) {
      $("#form-error").textContent = err.message;
    }
  };
}
async function refresh() {
  if (busy) return;
  busy = true;
  render();
  await Promise.all(
    state.holdings
      .filter((h) => !h.demo)
      .map(async (h) => {
        try {
          const res = await fetch(
            "/api/quote?symbol=" + encodeURIComponent(h.symbol),
          );
          const data = await res.json();
          if (!res.ok) throw Error(data.error || "Quote unavailable");
          quotes[h.symbol] = data;
        } catch (e) {
          quotes[h.symbol] = { ...quotes[h.symbol], error: e.message };
        }
      }),
  );
  busy = false;
  render();
}
function demo() {
  const h = {
    id: uid(),
    symbol: "DEMO",
    name: "Example Industries",
    broker: "Trade Republic",
    demo: true,
    lots: [{ id: uid(), qty: 100, price: 100, date: "2025-01-15", fee: 0 }],
  };
  state.holdings.push(h);
  quotes.DEMO = { price: 150, time: Date.now() / 1000 };
  selected = h.id;
  save();
  render();
}
function manage() {
  const h = current();
  modal(
    `<h2>Purchase history</h2><p class="sub">${esc(h.name)} · ${esc(h.broker)}</p>${[
      ...h.lots,
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(
        (l) =>
          `<div class="lot-row"><div class="row"><b>${number(l.qty)} shares × ${money(l.price)}</b><button class="link" data-edit="${esc(l.id)}">Edit</button></div><span class="small">${esc(l.date)} · ${money(l.fee)} fee</span></div>`,
      )
      .join(
        "",
      )}<button class="secondary" id="asset-metadata">Asset settings ↗</button><div class="actions"><button class="danger" id="remove">Remove holding</button><button class="primary" id="add-lot">＋ Add purchase</button></div>`,
  );
  $("#asset-metadata").onclick = () => {
    close();
    assetSettings(h);
  };
  $("#add-lot").onclick = () => {
    close();
    purchase(h);
  };
  $("#remove").onclick = () => {
    close();
    modal(
      `<h2>Remove this holding?</h2><p class="sub">${esc(h.name)} and its purchase entries will be removed. Recorded sales stay in your buyback plans.</p><div class="actions"><button class="secondary" id="no">Keep holding</button><button class="danger" id="yes">Remove holding</button></div>`,
    );
    $("#no").onclick = close;
    $("#yes").onclick = () => {
      state.holdings = state.holdings.filter((a) => a.id !== h.id);
      save();
      close();
      render();
    };
  };
  document.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        const l = h.lots.find((l) => l.id === b.dataset.edit);
        close();
        modal(
          `<h2>Edit purchase</h2><form id="edit-lot">${[
            ["qty", "Shares", l.qty],
            ["price", "Buy-in (€)", l.price],
            ["fee", "Fee (€)", l.fee],
          ]
            .map(
              ([k, label, v]) =>
                `<div class="field"><label>${label}</label><input name="${k}" value="${v}" type="number" min="${k === "fee" ? 0 : 0.00000001}" step="any" required></div>`,
            )
            .join(
              "",
            )}<label>Date</label><input name="date" type="date" value="${esc(l.date)}" max="${today()}" required><div class="actions"><button class="primary">Save changes</button></div></form>`,
        );
        $("#edit-lot").onsubmit = (e) => {
          e.preventDefault();
          const f = new FormData(e.target);
          Object.assign(l, {
            qty: Number(f.get("qty")),
            price: Number(f.get("price")),
            fee: Number(f.get("fee")),
            date: String(f.get("date")),
          });
          delete scenario[h.id];
          save();
          close();
          render();
        };
      }),
  );
}
function record() {
  const h = current(),
    r = getResult(),
    sc = { ...scenario[selected] };
  modal(
    `<h2>Record your sale</h2><p class="sub">Record an executed trade. No order is placed.</p><form id="sale-form"><p class="note">${number(r.q)} shares of ${esc(h.name)}. Actual execution details.</p><div class="form-row"><div><label>Actual sale price (€)</label><input name="price" type="number" min="0.00000001" step="any" value="${r.price}" required></div><div><label>Actual sale fee (€)</label><input name="fee" type="number" min="0" step="any" value="${sc.sf}" required></div></div><div class="field"><label>Actual tax withheld (€)</label><input name="tax" type="number" min="0" step="any" value="${r.tax}" required></div><div class="field"><label>Sale date</label><input name="date" type="date" max="${today()}" value="${today()}" required></div><div class="error" id="sale-error"></div><div class="actions"><button type="button" class="secondary" id="cancel-sale">Cancel</button><button class="primary">Confirm & save plan</button></div></form>`,
  );
  $("#cancel-sale").onclick = close;
  $("#sale-form").onsubmit = (e) => {
    e.preventDefault();
    try {
      const f = new FormData(e.target),
        actual = calculate(
          h.lots,
          r.q,
          Number(f.get("price")),
          Number(f.get("fee")),
          r.buyFee,
          h.taxRate ?? state.settings.rate,
        ),
        tax = Number(f.get("tax"));
      actual.cash = actual.proceeds - Number(f.get("fee")) - tax;
      if (actual.cash <= actual.buyFee)
        throw Error("Tax and fees exceed the sale proceeds.");
      state.sales.unshift({
        id: uid(),
        holdingId: h.id,
        name: h.name,
        symbol: h.symbol,
        broker: h.broker,
        assetType: h.assetType,
        isin: h.isin,
        taxRate: h.taxRate,
        demo: !!h.demo,
        q: r.q,
        precision: r.precision,
        targetGain: percent,
        price: actual.price,
        tax,
        cash: actual.cash,
        buyFee: r.buyFee,
        date: String(f.get("date")),
        status: "waiting",
      });
      h.lots = actual.remaining;
      state.holdings = state.holdings.filter((a) => qty(a) > 1e-8);
      delete scenario[h.id];
      save();
      close();
      page = "activity";
      render();
      toast("Sale recorded. Your buyback targets are now fixed.");
    } catch (err) {
      $("#sale-error").textContent = err.message;
    }
  };
}
function activity() {
  return `<section class="panel">${state.sales.length ? state.sales.map((s) => `<article class="history-item"><div class="row"><div class="history-identity">${monogram(s)}<div><strong>${esc(s.name)}</strong> <span class="small">${esc(s.symbol)}</span> ${s.demo ? '<span class="demo-tag">Demo</span>' : ""}<p style="margin:4px 0">${number(s.q)} shares sold · ${esc(s.date)} · ${esc(s.broker)}</p></div></div><span class="pill">${s.status === "complete" ? "Completed" : "Awaiting reentry"}</span></div><p>${money(s.cash)} cash after tax · ${money(s.price)} sale price</p>${s.status === "complete" ? `<p class="positive">Bought ${number(s.rebuyQty)} shares at ${money(s.rebuyPrice)}. Cash remaining: ${money(s.leftover)}.</p>` : `<div class="history-targets">${[0, 5, 10, ...(![0, 5, 10].includes(s.targetGain) && Number.isFinite(s.targetGain) ? [s.targetGain] : [])].map((g) => `<span>${g === 0 ? "Same shares" : "+" + g + "% shares"}<b>${money(target(s, g, state.settings.whole).price)}</b></span>`).join("")}</div><button class="secondary" data-rebuy="${esc(s.id)}">Record buyback ↗</button>`}</article>`).join("") : `<div class="empty"><div class="large-icon">↗</div><h2>No buybacks yet.</h2><p>Record a sale to keep your buyback targets here.</p></div>`}</section>`;
}
function rebuy(id) {
  const s = state.sales.find((s) => s.id === id);
  modal(
    `<h2>Record your buyback</h2><p class="sub">${esc(s.name)} · ${money(s.cash)} available</p><form id="rebuy-form"><div class="form-row"><div class="field"><label>Shares bought</label><input name="qty" type="number" min="0.00000001" step="any" value="${s.q}" required></div><div class="field"><label>Price per share (€)</label><input name="price" type="number" min="0.00000001" step="any" required></div></div><div class="form-row"><div><label>Fee (€)</label><input name="fee" type="number" min="0" step="any" value="${s.buyFee}" required></div><div><label>Purchase date</label><input name="date" type="date" min="${esc(s.date)}" max="${today()}" value="${today()}" required></div></div><div class="error" id="rebuy-error"></div><div class="actions"><button class="primary">Complete buyback</button></div></form>`,
  );
  $("#rebuy-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      q = Number(f.get("qty")),
      p = Number(f.get("price")),
      fee = Number(f.get("fee")),
      cost = q * p + fee;
    if (cost > s.cash + 0.001) {
      $("#rebuy-error").textContent =
        "This exceeds your available cash. Reduce quantity or price.";
      return;
    }
    let h = state.holdings.find(
      (h) =>
        h.symbol === s.symbol && h.broker === s.broker && !!h.demo === !!s.demo,
    );
    if (!h) {
      h = {
        id: uid(),
        name: s.name,
        symbol: s.symbol,
        broker: s.broker,
        assetType: s.assetType,
        isin: s.isin,
        taxRate: s.taxRate,
        demo: s.demo,
        lots: [],
      };
      state.holdings.push(h);
    }
    h.lots.push({
      id: uid(),
      qty: q,
      price: p,
      fee,
      date: String(f.get("date")),
    });
    Object.assign(s, {
      status: "complete",
      rebuyQty: q,
      rebuyPrice: p,
      leftover: s.cash - cost,
    });
    save();
    close();
    render();
    toast("Buyback complete. Your portfolio has been updated.");
  };
}
function settings() {
  return `<div class="settings-grid">${accountCard(currentUser)}<section class="panel settings-card"><h2>Calculation defaults</h2><p class="sub">Applied to new scenarios.</p><form id="settings-form"><div class="field"><label>Tax rate</label><select id="tax-preset"><option value="27" ${state.settings.rate === 27 ? "selected" : ""}>27% · simple estimate</option><option value="26.375" ${state.settings.rate === 26.375 ? "selected" : ""}>26.375% · Germany, no church tax</option><option value="27.818627" ${state.settings.rate === 27.818627 ? "selected" : ""}>27.8186% · Germany, 8% church tax</option><option value="27.99511" ${state.settings.rate === 27.99511 ? "selected" : ""}>27.9951% · Germany, 9% church tax</option><option value="custom" ${![27, 26.375, 27.818627, 27.99511].includes(state.settings.rate) ? "selected" : ""}>Custom rate</option></select></div><div class="field"><label>Effective rate (%)</label><input id="rate" type="number" min="0" max="100" step="any" value="${state.settings.rate}" required></div><div class="form-row"><div><label>Sale fee (€)</label><input id="default-sf" type="number" min="0" step="any" value="${state.settings.sellFee}" required></div><div><label>Buyback fee (€)</label><input id="default-bf" type="number" min="0" step="any" value="${state.settings.buyFee}" required></div></div><div class="field"><label>Buyback share precision</label><select id="whole"><option value="false" ${!state.settings.whole ? "selected" : ""}>Allow fractional shares</option><option value="true" ${state.settings.whole ? "selected" : ""}>Whole shares only</option></select></div><button class="primary">Save defaults</button></form></section><section class="panel settings-card"><h2>Data & privacy</h2><p class="sub" style="margin-top:12px">Private to your account, synced across devices. Export a copy whenever you like.</p><div class="field"><button class="secondary" id="export">↓ Export backup</button> <button class="secondary" id="import">↑ Import backup</button><input id="import-file" type="file" accept="application/json" hidden></div><div class="divider"></div><h3>Market data</h3><p class="sub" style="margin:12px 0">Yahoo Finance · refreshes every 5 minutes. Foreign quotes convert to EUR at an indicative FX rate. Prices may be delayed.</p><p class="note">Holdings are stored in your private account. Quotes and logos come from external providers.</p><button class="link" id="method-settings">Calculation notes ↗</button>${localStorage.getItem("reentry-v1") ? '<div class="field"><button class="secondary" id="import-local">Import old device portfolio</button></div>' : ""}</section></div>`;
}
function bindSettings() {
  bindAccount({ modal, close, toast, onLogout: logout });
  $("#tax-preset").onchange = (e) => {
    if (e.target.value !== "custom") $("#rate").value = e.target.value;
  };
  $("#settings-form").onsubmit = (e) => {
    e.preventDefault();
    state.settings = {
      rate: Number($("#rate").value),
      sellFee: Number($("#default-sf").value),
      buyFee: Number($("#default-bf").value),
      whole: $("#whole").value === "true",
    };
    save();
    toast("Defaults saved.");
    render();
  };
  $("#export").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "reentry-backup-" + today() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("#import").onclick = () => $("#import-file").click();
  $("#import-file").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1900000) throw Error("Backup is too large.");
      const imported = validate(JSON.parse(await file.text()));
      modal(
        `<h2>Restore this backup?</h2><p class="sub">Replace the current portfolio with ${imported.holdings.length} holdings and ${imported.sales.length} recorded sales. Export your current data first if you need to keep it.</p><div class="actions"><button class="secondary" id="cancel-import">Cancel</button><button class="primary" id="confirm-import">Restore backup</button></div>`,
      );
      $("#cancel-import").onclick = close;
      $("#confirm-import").onclick = () => {
        state = imported;
        scenario = {};
        quotes = {};
        save();
        close();
        render();
        toast("Backup imported.");
      };
    } catch (err) {
      toast(err.message);
    }
  };
  $("#method-settings").onclick = method;
  if ($("#import-local"))
    $("#import-local").onclick = () => {
      try {
        const imported = validate(
          JSON.parse(localStorage.getItem("reentry-v1")),
        );
        modal(
          `<h2>Import device portfolio?</h2><p class="sub">Replace this account’s portfolio with ${imported.holdings.length} saved holdings. Only continue if these records belong to you.</p><div class="actions"><button class="secondary" id="cancel-local">Cancel</button><button class="primary" id="confirm-local">Import</button></div>`,
        );
        $("#cancel-local").onclick = close;
        $("#confirm-local").onclick = () => {
          state = imported;
          scenario = {};
          save();
          close();
          render();
          toast("Device portfolio imported.");
        };
      } catch (e) {
        toast(e.message);
      }
    };
}
function method() {
  modal(
    `<h2>Calculation notes</h2><p class="note">Cash = sale proceeds − sale fee − tax.<br>Buyback ceiling = (cash − buyback fee) ÷ target shares.</p><p class="sub">Tax uses the oldest purchases in each holding first (FIFO). Purchase fees are included in acquisition cost; the sale fee reduces realized gain. Eligible losses, then remaining allowance, reduce positive taxable gains. No automatic refund is assumed on a loss.</p><p class="sub" style="margin-top:14px">Targets round down to euro cents, or eight decimal places for crypto. Whole-share targets round share counts up. The gain percentage refers to more shares than sold, not investment profit. Record actual withheld tax after selling. Buyback holdings receive a new acquisition cost.</p><p class="sub" style="margin-top:14px">Ordinary shares use your account tax rate. Other asset types require an explicit effective rate and corrected cost basis; exemptions, holding-period rules and fund advance taxes are not inferred. Update purchases for splits. Foreign quotes convert to indicative EUR prices and may differ from executable broker prices.</p><p class="sub" style="margin-top:16px"><a href="https://www.gesetze-im-internet.de/estg/__20.html" target="_blank" rel="noopener">§20 EStG: gains and FIFO ↗</a><br><a href="https://www.gesetze-im-internet.de/estg/__32d.html" target="_blank" rel="noopener">§32d EStG: tax rates ↗</a><br><a href="https://finance.yahoo.com/" target="_blank" rel="noopener">Yahoo Finance market data ↗</a></p>`,
  );
}
boot();
setInterval(() => {
  if (
    currentUser &&
    !document.hidden &&
    page === "portfolio" &&
    !$("#modal").open &&
    state.holdings.length
  )
    refresh();
}, 300000);

function assetSettings(h) {
  modal(
    `<h2>Asset settings</h2><form id="asset-settings"><div class="field"><label>Asset type</label><select name="assetType">${["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY", "INDEX", "OTHER"].map((t) => `<option value="${t}" ${(h.assetType || "EQUITY") === t ? "selected" : ""}>${assetTypeLabel(t)}</option>`).join("")}</select></div><div class="field"><label>ISIN (optional)</label><input name="isin" value="${esc(h.isin || "")}" pattern="[A-Z]{2}[A-Z0-9]{9}[0-9]" maxlength="12" autocapitalize="characters"></div><div class="field"><label>Effective tax rate (%)</label><input name="taxRate" type="number" min="0" max="100" step="any" value="${h.taxRate ?? state.settings.rate}" required></div><p class="small">Applied only to this asset. Exemptions and holding-period rules are not automatic.</p><div class="actions"><button class="primary">Save settings</button></div></form>`,
  );
  $("#asset-settings").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    Object.assign(h, {
      assetType: String(f.get("assetType")),
      isin: String(f.get("isin")),
      taxRate: Number(f.get("taxRate")),
    });
    save();
    close();
    render();
  };
}
