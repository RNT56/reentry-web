import { esc } from "../../shared/format.js";
import { icon } from "../../shared/ui.js";
import { avatar } from "./people.js";
const count = (n) => Number(n || 0).toLocaleString();
const money = (n) =>
  "$" +
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
function range(v) {
  return !v.count
    ? "—"
    : !v.known
      ? "Not reported"
      : v.high === null
        ? "≥ " + money(v.low)
        : money(v.low) + " – " + money(v.high);
}
export function careerView(c) {
  if (!c) return "";
  const s = c.salary,
    h = c.history;
  return `<section class="politician-finances"><header class="capitol-section-title"><h2>Public pay. Private capital.</h2><span>${c.service ? `Congress · ${c.service.from.slice(0, 4)}–${c.service.through?.slice(0, 4) || "present"}` : "Reported activity"}</span></header><div class="politician-finance-grid"><div><span>${s ? esc(s.role) : "Political position"} · annual base</span><strong>${s ? money(s.annual) : "Unverified"}</strong><small>${s ? s.year + (s.basis === "role_benchmark" ? " role benchmark · USD" : " · USD") : "Salary source pending"}</small></div><div><span>Reported purchases</span><strong>${range(h.buys)}</strong><small>${count(h.buys.count)} transactions · USD</small></div><div><span>Reported sale proceeds</span><strong>${range(h.sells)}</strong><small>${count(h.sells.count)} transactions · USD</small></div></div><details class="politician-finance-source"><summary>Record ${h.from?.slice(0, 4) || "—"}–${h.through?.slice(0, 4) || "—"} ${icon("chevron")}</summary><div><p>${s?.basis === "role_benchmark" ? "Executive pay is the published 2026 schedule for the reported role, not verified pay received; freezes and former officeholders can differ. " : ""}${esc(c.gains.reason)} Amounts include the owners identified in each filing. Purchase and sale totals cover the available archive, not a verified complete career.</p>${s ? `<a href="${esc(s.source)}" target="_blank" rel="noopener noreferrer">Salary schedule ${icon("arrow")}</a>` : ""}${c.service ? `<a href="${esc(c.service.source)}" target="_blank" rel="noopener noreferrer">Congressional biography ${icon("arrow")}</a>` : ""}</div></details></section>`;
}
export function powerView(p, ticker, days) {
  if (!p) return "";
  const total = p.buyers.length + p.sellers.length,
    share = total ? (p.buyers.length / total) * 100 : 50;
  const names = (list, side) =>
    `<details class="power-participants"><summary><span>${side === "buy" ? "Buyers" : "Sellers"} <b>${count(list.length)}</b></span>${icon("chevron")}</summary><div>${list.map((n) => `<button data-person="${esc(n.id)}">${avatar(n)}<span>${esc(n.name)}</span><small>${count(side === "buy" ? n.buys : n.sells)}</small>${icon("arrow")}</button>`).join("") || '<span class="power-empty">None reported</span>'}</div></details>`;
  return `<section class="power-struggle" aria-label="${esc(ticker)} disclosed buying and selling"><header class="capitol-section-title"><h2>Power struggle <span>${esc(ticker)}</span></h2><span>${days ? days + "D" : "All time"} · filing window · all filers</span></header><div class="power-score"><div class="buy"><strong>${count(p.buyers.length)}</strong><span>buyers</span></div><div class="power-balance-label">${total ? Math.round(share) + "% buy-side" : "No buys or sales"}</div><div class="sell"><strong>${count(p.sellers.length)}</strong><span>sellers</span></div></div><div class="power-bar ${total ? "" : "is-empty"}" role="img" aria-label="${p.buyers.length} distinct buyers and ${p.sellers.length} distinct sellers"><i style="--power:${share}%"></i><i></i></div><div class="power-totals"><span>${count(p.buyDisclosures)} buy disclosures</span>${p.both ? `<span>${count(p.both)} on both sides</span>` : ""}<span>${count(p.sellDisclosures)} sell disclosures</span></div><div class="power-people">${names(p.buyers, "buy")}${names(p.sellers, "sell")}</div>${p.other ? `<small class="power-other">${count(p.other)} exchanges / other · excluded from balance</small>` : ""}</section>`;
}
