import { money, number, esc } from "../../shared/format.js";
import { icon, monogram } from "../../shared/ui.js";
import { qty } from "../../domain/portfolio.js";
import { reorderHandle } from "../../shared/reorder.js";

export function holdingCard(asset, model) {
  const selected = asset.id === model.selected;
  const price = model.quotes[asset.symbol]?.price;
  return `<div class="holding-shell">
    <button type="button" data-holding="${esc(asset.id)}" class="holding ${selected ? "selected" : ""}" aria-pressed="${selected}">
      <div class="row">${monogram(asset)}<div class="stock-info"><b>${esc(asset.name.replace(/\s+I$/, "").trim())}</b><span>${esc(asset.symbol)}${asset.demo ? " · Demo" : ""}</span></div><span class="holding-reorder-space" aria-hidden="true"></span></div>
      <div class="holding-values"><span>${number(qty(asset))} shares</span><b>${price ? money(price) : "—"}</b></div>
    </button>
    <button type="button" class="holding-remove" data-remove-holding="${esc(asset.id)}" aria-label="Remove ${esc(asset.symbol)} from ${esc(asset.broker)}" title="Remove ${esc(asset.symbol)}">${icon("close")}</button>
    ${reorderHandle(`Reorder ${asset.symbol} · ${asset.broker}`)}
  </div>`;
}
