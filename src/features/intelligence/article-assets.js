import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { icon } from "../../shared/icons.js";
import { monogram, bindLogos } from "../../shared/ui.js";
import {
  assetInfo,
  assetTypeLabel,
  featuredAssets,
} from "../../domain/assets.js";

const matches = (asset, query) =>
  [asset.symbol, asset.name, asset.isin].some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
const valid = (asset) =>
  asset &&
  /^[A-Za-z0-9.^=-]{1,32}$/.test(asset.symbol) &&
  typeof asset.name === "string";

// Invalidating a query also aborts it. A late response cannot select or repaint a different query.
export function createAssetLookup({
  onResults,
  onStatus,
  search = (q, signal) =>
    request("/api/search?q=" + encodeURIComponent(q), "GET", undefined, {
      signal,
    }),
  delay = 180,
}) {
  let timer,
    controller,
    version = 0;
  function cancel() {
    version++;
    clearTimeout(timer);
    controller?.abort();
  }
  return {
    cancel,
    query(value) {
      cancel();
      const query = value.trim(),
        current = version;
      const local = featuredAssets.filter((a) => !query || matches(a, query));
      onResults(local.slice(0, 8));
      if (query.length < 2) {
        onStatus(
          query
            ? "Type another character to search all listings."
            : "Search by company name, symbol or ISIN.",
        );
        return;
      }
      onStatus("Searching listings…");
      timer = setTimeout(async () => {
        controller = new AbortController();
        try {
          const result = await search(query, controller.signal);
          if (current !== version) return;
          const all = [...(result.results || []).filter(valid), ...local];
          const unique = all.filter(
            (a, index) =>
              all.findIndex(
                (b) => b.symbol.toUpperCase() === a.symbol.toUpperCase(),
              ) === index,
          );
          unique.sort(
            (a, b) =>
              Number(b.symbol.toLowerCase() === query.toLowerCase()) -
              Number(a.symbol.toLowerCase() === query.toLowerCase()),
          );
          onResults(
            unique.slice(0, 12).map((a) => ({
              ...assetInfo(a),
              symbol: a.symbol.toUpperCase(),
            })),
          );
          onStatus(
            unique.length
              ? `${Math.min(unique.length, 12)} matching listings. Choose the exact symbol and exchange.`
              : "No matching assets. Try a company name or ticker.",
          );
        } catch (error) {
          if (current !== version || error.name === "AbortError") return;
          onResults(local.slice(0, 8));
          onStatus(
            "Search unavailable. Known matching assets are shown; edit the search to retry.",
          );
        }
      }, delay);
    },
  };
}

export function articleAssetsMarkup(prefix) {
  return `<section class="article-assets" data-article-assets aria-label="Article assets">
    <label for="${prefix}-asset-search">Primary asset</label>
    <div class="article-asset-search" data-asset-search="primary"><input id="${prefix}-asset-search" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="${prefix}-primary-results" aria-describedby="${prefix}-primary-status" maxlength="80" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Company name, ticker or ISIN"><div class="article-asset-popup" hidden><div id="${prefix}-primary-results" role="listbox" aria-label="Matching primary assets"></div><p id="${prefix}-primary-status" role="status" aria-live="polite"></p></div></div>
    <div class="article-asset-selected" data-primary-asset></div>
    <p class="article-asset-note">The scenario map belongs to the primary asset. Related assets link this article to their pages.</p>
    <div class="article-related-assets" data-related-assets></div>
    <button type="button" class="link" data-link-asset>${icon("plus")} Link a related asset</button>
    <div class="article-related-search" hidden><label for="${prefix}-related-search">Related asset</label><div class="article-asset-search" data-asset-search="related"><input id="${prefix}-related-search" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="${prefix}-related-results" aria-describedby="${prefix}-related-status" maxlength="80" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Search another asset"><div class="article-asset-popup" hidden><div id="${prefix}-related-results" role="listbox" aria-label="Matching related assets"></div><p id="${prefix}-related-status" role="status" aria-live="polite"></p></div></div><button type="button" class="link" data-cancel-related>Done</button></div>
    <p class="article-asset-change-note" data-asset-change-note role="status" hidden></p>
  </section>`;
}

export function mountArticleAssets(
  root,
  { assets = [], onChange = () => {} } = {},
) {
  let selected = assets.map((a) => ({ ...a })),
    alive = true;
  const primary = root.querySelector('[data-asset-search="primary"] input');
  const controllers = [];
  function values() {
    return selected.map((a) => ({ ...a }));
  }
  function paint() {
    root.querySelector("[data-primary-asset]").innerHTML = selected[0]
      ? `<span class="article-asset-symbol">${esc(selected[0].symbol)}</span><span><b>${esc(selected[0].name)}</b><small>${esc([selected[0].exchange, assetTypeLabel(selected[0].assetType)].filter(Boolean).join(" · "))}</small></span>`
      : "";
    root.querySelector("[data-related-assets]").innerHTML = selected
      .slice(1)
      .map(
        (a) =>
          `<span class="article-related-chip"><span><b>${esc(a.symbol)}</b> ${esc(a.name)}</span><button type="button" data-remove-asset="${esc(a.symbol)}" aria-label="Remove related asset ${esc(a.symbol)}">${icon("close")}</button></span>`,
      )
      .join("");
    root.querySelector("[data-link-asset]").disabled = selected.length >= 8;
    primary.setCustomValidity(
      selected[0] && primary.value.trim().toUpperCase() === selected[0].symbol
        ? ""
        : "Choose the primary asset from the suggestions.",
    );
    const related = root.querySelector('[data-asset-search="related"] input');
    related.setCustomValidity(
      !root.querySelector(".article-related-search").hidden &&
        related.value.trim()
        ? "Choose the related asset from the suggestions, or clear the search."
        : "",
    );
  }
  for (const searchRoot of root.querySelectorAll("[data-asset-search]")) {
    const isPrimary = searchRoot.dataset.assetSearch === "primary";
    const input = searchRoot.querySelector("input"),
      popup = searchRoot.querySelector(".article-asset-popup"),
      list = searchRoot.querySelector('[role="listbox"]'),
      status = searchRoot.querySelector('[role="status"]');
    let results = [],
      active = -1,
      open = false,
      composing = false;
    function activate(index) {
      active = index;
      for (const option of list.querySelectorAll('[role="option"]'))
        option.setAttribute(
          "aria-selected",
          String(Number(option.dataset.assetIndex) === active),
        );
      const option = list.querySelector(`[data-asset-index="${active}"]`);
      if (option) {
        input.setAttribute("aria-activedescendant", option.id);
        // Scroll only the results, never the surrounding modal or editor.
        const bounds = list.getBoundingClientRect(),
          row = option.getBoundingClientRect();
        if (row.top < bounds.top) list.scrollTop += row.top - bounds.top;
        else if (row.bottom > bounds.bottom)
          list.scrollTop += row.bottom - bounds.bottom;
      } else input.removeAttribute("aria-activedescendant");
    }
    const lookup = createAssetLookup({
      onResults(items) {
        if (!alive || !open) return;
        results = items.filter(
          (a) => isPrimary || !selected.some((s) => s.symbol === a.symbol),
        );
        list.innerHTML = results
          .map(
            (a, i) =>
              `<div role="option" id="${list.id}-${i}" aria-selected="false" data-asset-index="${i}"><span class="article-asset-option-logo" aria-hidden="true">${monogram(a)}</span><span class="article-asset-option-name"><b>${esc(a.name)}</b><small><strong>${esc(a.symbol)}</strong>${esc([a.exchange, assetTypeLabel(a.assetType)].filter(Boolean).map((value) => " · " + value).join(""))}</small></span></div>`,
          )
          .join("");
        bindLogos();
        list.scrollTop = 0;
        activate(-1);
      },
      onStatus(message) {
        if (alive && open) status.textContent = message;
      },
    });
    function hide() {
      lookup.cancel();
      open = false;
      popup.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }
    function search() {
      open = true;
      popup.hidden = false;
      input.setAttribute("aria-expanded", "true");
      lookup.query(input.value);
    }
    function choose(index) {
      const asset = results[index];
      if (!asset || !alive) return;
      if (isPrimary) {
        selected = [
          asset,
          ...selected.slice(1).filter((a) => a.symbol !== asset.symbol),
        ];
        input.value = asset.symbol;
      } else if (
        selected.length < 8 &&
        !selected.some((a) => a.symbol === asset.symbol)
      ) {
        selected.push(asset);
        input.value = "";
      }
      hide();
      paint();
      onChange(values());
      input.focus();
    }
    input.oninput = () => {
      paint();
      if (!composing) search();
    };
    input.oncompositionstart = () => {
      composing = true;
      lookup.cancel();
    };
    input.oncompositionend = () => {
      composing = false;
      search();
    };
    input.onfocus = () => {
      if (!isPrimary || input.value !== selected[0]?.symbol) search();
    };
    // The new-article dialog focuses its first input before this picker mounts.
    if (input === input.ownerDocument.activeElement) input.onfocus();
    input.onkeydown = (event) => {
      if (event.isComposing) return;
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (!open) search();
        if (results.length)
          activate(
            active < 0
              ? event.key === "ArrowDown"
                ? 0
                : results.length - 1
              : (active +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  results.length) %
                  results.length,
          );
      } else if (event.key === "Enter" && open) {
        event.preventDefault();
        event.stopPropagation();
        if (active >= 0) choose(active);
        else if (results.length) activate(0);
      } else if (
        event.key === "Escape" &&
        (open ||
          (isPrimary
            ? input.value !== (selected[0]?.symbol || "")
            : input.value))
      ) {
        event.preventDefault();
        event.stopPropagation();
        input.value = isPrimary ? selected[0]?.symbol || "" : "";
        hide();
        paint();
      } else if (event.key === "Tab") hide();
    };
    list.onpointerdown = (event) => {
      if (event.target.closest('[role="option"]')) event.preventDefault();
    };
    list.onclick = (event) => {
      const option = event.target.closest("[data-asset-index]");
      if (option) choose(Number(option.dataset.assetIndex));
    };
    searchRoot.onfocusout = (event) => {
      if (!searchRoot.contains(event.relatedTarget)) hide();
    };
    const outside = (event) => {
      if (!searchRoot.contains(event.target)) hide();
    };
    document.addEventListener("pointerdown", outside);
    controllers.push(() => {
      hide();
      document.removeEventListener("pointerdown", outside);
    });
  }
  primary.value = selected[0]?.symbol || "";
  root.onclick = (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.removeAsset) {
      selected = selected.filter(
        (a, i) => i === 0 || a.symbol !== button.dataset.removeAsset,
      );
      paint();
      onChange(values());
      root.querySelector("[data-link-asset]").focus();
    }
    if (button.hasAttribute("data-link-asset")) {
      root.querySelector(".article-related-search").hidden = false;
      root.querySelector('[data-asset-search="related"] input').focus();
    }
    if (button.hasAttribute("data-cancel-related")) {
      root.querySelector(".article-related-search").hidden = true;
      root.querySelector('[data-asset-search="related"] input').value = "";
      root.querySelector("[data-link-asset]").focus();
      paint();
    }
  };
  paint();
  return {
    values,
    validate: () =>
      primary.reportValidity() &&
      root
        .querySelector('[data-asset-search="related"] input')
        .reportValidity(),
    destroy() {
      alive = false;
      controllers.forEach((dispose) => dispose());
      root.onclick = null;
    },
  };
}
