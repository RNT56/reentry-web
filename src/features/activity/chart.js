import { mountAssetContextDock } from "../portfolio/context-dock.js";
import { mountAssetChart } from "../charts/asset-chart.js";
import { loadChartHistory } from "../charts/history-data.js";
import { referenceLevels } from "../../domain/chart-levels.js";
import { target } from "../../domain/reentry.js";
import { esc } from "../../shared/format.js";
import { monogram, bindLogos } from "../../shared/ui.js";

export function mountBuybackChart(root, { ownerId, sales, whole, quotes }) {
  const assets = [...new Set(sales.map((s) => s.symbol))].map(
    (symbol) =>
      sales.find((s) => s.symbol === symbol && !s.demo) ||
      sales.find((s) => s.symbol === symbol),
  );
  let chart = null,
    context = null,
    selected =
      sales.find((s) => s.status === "waiting")?.symbol || assets[0]?.symbol;
  root.innerHTML =
    '<div class="buyback-chart-assets" role="group" aria-label="Buyback chart asset"></div><div class="buyback-history"></div><nav data-buyback-context></nav>';
  const tabs = root.querySelector(".buyback-chart-assets");
  function select(symbol) {
    chart?.destroy();
    context?.destroy();
    selected = symbol;
    const asset = assets.find((s) => s.symbol === symbol);
    context = mountAssetContextDock(
      root.querySelector("[data-buyback-context]"),
      asset,
    );
    const plans = sales.filter(
      (s) => s.symbol === symbol && s.status === "waiting",
    );
    tabs.innerHTML = assets
      .map(
        (a) =>
          `<button data-buyback-asset="${esc(a.symbol)}" aria-pressed="${a.symbol === selected}">${monogram(a)}<span>${esc(a.symbol)}</span></button>`,
      )
      .join("");
    bindLogos(root);
    chart = mountAssetChart(root.querySelector(".buyback-history"), {
      ownerId,
      symbol,
      surface: "price",
      label: symbol + " · Buybacks",
      ranges: true,
      currencyControl: true,
      candles: true,
      load: (state, current) =>
        asset.demo
          ? Promise.resolve({
              symbol,
              points: [],
              source: "Demo",
              currency: state.currency,
            })
          : loadChartHistory(symbol, state, current),
      history: !asset.demo,
      references: (data) =>
        plans
          .map((sale, i) => {
            const level = referenceLevels({
              symbol,
              currency: data.currency,
              target: target(sale, sale.targetGain || 0, whole).price,
              quote: quotes[symbol],
              displayFx: data.referenceFx,
            }).levels[0];
            return level
              ? {
                  ...level,
                  id: sale.id,
                  label: `Target +${sale.targetGain || 0}%${plans.length > 1 ? " · " + sale.date : ""}`,
                  color: i % 2 ? "#83bdf1" : "#b9f68b",
                }
              : null;
          })
          .filter(Boolean),
    });
  }
  tabs.onclick = (event) => {
    const button = event.target.closest("[data-buyback-asset]");
    if (button && button.dataset.buybackAsset !== selected)
      select(button.dataset.buybackAsset);
  };
  if (selected) select(selected);
  return {
    destroy() {
      context?.destroy();
      chart?.destroy();
    },
  };
}
