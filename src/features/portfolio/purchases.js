import { $, money, number, esc, uid, today } from "../../shared/format.js";
import {
  monogram,
  bindLogos,
  associateLabels,
  modal,
  close,
  toast,
} from "../../shared/ui.js";

import {
  featuredAssets,
  assetInfo,
  assetTypeLabel,
} from "../../domain/assets.js";
import { request } from "../../shared/http.js";

export function createPurchases(model, services) {
  const { save, render, refresh, current, navigate } = services;
  function purchase(existing) {
    let chosen = existing ? assetInfo(existing) : null,
      entryMode = "shares",
      seq = 0,
      timer;
    modal(
      `<span class="eyebrow">YOUR PORTFOLIO</span><h2>${existing ? "Add purchase" : "Add an asset"}</h2><form id="purchase-form">${existing ? `<div class="selected-stock row">${monogram(existing)}<span>${esc(existing.name)} · ${esc(existing.symbol)}</span></div>` : `<div class="field asset-search-field"><label for="stock-search">Stock, ETF or crypto</label><input id="stock-search" placeholder="Name, ticker or ISIN" autocomplete="off" spellcheck="false"><div class="asset-filters" id="asset-filters"><button type="button" class="selected" data-filter="all">All</button><button type="button" data-filter="EQUITY">Stocks</button><button type="button" data-filter="ETF">ETFs</button><button type="button" data-filter="CRYPTOCURRENCY">Crypto</button></div><div class="search-results" id="search-results"></div><div id="chosen"></div></div>`}<div class="entry-mode"><button type="button" data-entry="shares" class="on">Shares</button><button type="button" data-entry="amount">Invested €</button></div><div class="form-row"><div class="field"><label id="quantity-label" for="purchase-qty">Shares</label><input id="purchase-qty" name="qty" type="number" inputmode="decimal" step="any" min="0.00000001" placeholder="0" required></div><div class="field"><label for="purchase-price">Buy-in per share (€)</label><input id="purchase-price" name="price" type="number" inputmode="decimal" step="any" min="0.00000001" placeholder="0.00" required></div></div><div class="entry-preview" id="entry-preview">Your actual purchase price in EUR.</div><div id="asset-tax"></div><details ${existing ? "open" : ""}><summary>Purchase details</summary><div class="field"><label>Purchase date</label><input name="date" type="date" value="${today()}" max="${today()}" required></div><div class="form-row"><div><label>Depot</label><select name="broker" ${existing ? "disabled" : ""}>${["Trade Republic", "Consorsbank", "Other"].map((b) => `<option ${existing?.broker === b ? "selected" : ""}>${b}</option>`).join("")}</select></div><div><label>Fee (€)</label><input name="fee" type="number" inputmode="decimal" step="any" min="0" value="0" required></div></div><div class="field"><label>ISIN (optional, for precise logos)</label><input name="isin" maxlength="12" pattern="[A-Z]{2}[A-Z0-9]{9}[0-9]" value="${esc(chosen?.isin || "")}" placeholder="e.g. US0378331005"></div></details><div class="error" id="form-error" role="alert"></div><div class="actions"><button type="button" class="secondary" id="cancel">Cancel</button><button class="primary">${existing ? "Save purchase" : "Add asset"}</button></div></form>`,
    );
    const dialogForm = $("#purchase-form");
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
          ? `<div class="asset-tax-notice"><span class="pill">${assetTypeLabel(t)}</span><label>Effective tax rate (%)</label><input name="taxRate" type="number" inputmode="decimal" min="0" max="100" step="any" value="${existing?.taxRate ?? ""}" placeholder="Required" required></div>`
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
        if (/^[A-Za-z0-9.^=-]{1,32}$/.test(query))
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
            if (req !== seq || !dialogForm.isConnected || !$("#search-results"))
              return;
            results = data.results || [];
            paint();
          } catch {
            if (req !== seq || !dialogForm.isConnected || !$("#search-results"))
              return;
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
          model.state.holdings.find(
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
          model.state.holdings.push(h);
        }
        model.selected = h.id;
        save();
        close();
        navigate("portfolio", model.selected);
        refresh();
        toast("Purchase added.");
      } catch (err) {
        $("#form-error").textContent = err.message;
      }
    };
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
    model.state.holdings.push(h);
    model.quotes.DEMO = { price: 150, time: Date.now() / 1000 };
    model.selected = h.id;
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
        model.state.holdings = model.state.holdings.filter(
          (a) => a.id !== h.id,
        );
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
            delete model.scenario[h.id];
            save();
            close();
            render();
          };
        }),
    );
  }
  function assetSettings(h) {
    modal(
      `<h2>Asset settings</h2><form id="asset-settings"><div class="field"><label>Asset type</label><select name="assetType">${["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY", "INDEX", "OTHER"].map((t) => `<option value="${t}" ${(h.assetType || "EQUITY") === t ? "selected" : ""}>${assetTypeLabel(t)}</option>`).join("")}</select></div><div class="field"><label>ISIN (optional)</label><input name="isin" value="${esc(h.isin || "")}" pattern="[A-Z]{2}[A-Z0-9]{9}[0-9]" maxlength="12" autocapitalize="characters"></div><div class="field"><label>Effective tax rate (%)</label><input name="taxRate" type="number" min="0" max="100" step="any" value="${h.taxRate ?? model.state.settings.rate}" required></div><div class="actions"><button class="primary">Save settings</button></div></form>`,
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

  return { purchase, manage, demo };
}
