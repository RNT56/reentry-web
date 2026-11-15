import { recordSale, recordBuyback } from "../../domain/trades.js";
import { $, money, number, esc, uid, today } from "../../shared/format.js";
import { icon, monogram, modal, close, toast } from "../../shared/ui.js";

import { target } from "../../domain/reentry.js";

export function createActivity(model, services) {
  const { save, render, current, getResult, navigate } = services;
  function record() {
    const h = current(),
      r = getResult(),
      sc = { ...model.scenario[model.selected] };
    modal(
      `<h2>Record your sale</h2><form id="sale-form"><p class="note">${number(r.q)} shares of ${esc(h.name)}</p><div class="form-row"><div><label>Actual sale price (€)</label><input name="price" type="number" min="0.00000001" step="any" value="${r.price}" required></div><div><label>Actual sale fee (€)</label><input name="fee" type="number" min="0" step="any" value="${sc.sf}" required></div></div><div class="field"><label>Actual tax withheld (€)</label><input name="tax" type="number" min="0" step="any" value="${r.tax}" required></div><div class="field"><label>Sale date</label><input name="date" type="date" max="${today()}" value="${today()}" required></div><div class="error" id="sale-error"></div><div class="actions"><button type="button" class="secondary" id="cancel-sale">Cancel</button><button class="primary">Confirm & save plan</button></div></form>`,
    );
    $("#cancel-sale").onclick = close;
    $("#sale-form").onsubmit = (e) => {
      e.preventDefault();
      try {
        const f = new FormData(e.target);
        model.state = recordSale(model.state, {
          id: uid(),
          holdingId: h.id,
          quantity: r.q,
          price: Number(f.get("price")),
          sellFee: Number(f.get("fee")),
          buyFee: r.buyFee,
          tax: Number(f.get("tax")),
          targetGain: model.percent,
          date: String(f.get("date")),
        });
        delete model.scenario[h.id];
        save();
        close();
        navigate("activity");
        toast("Sale recorded. Your buyback targets are now fixed.");
      } catch (err) {
        $("#sale-error").textContent = err.message;
      }
    };
  }
  function activity() {
    return `${model.state.sales.length ? '<section id="buyback-chart" class="buyback-chart"></section>' : ""}<section class="panel">${model.state.sales.length ? model.state.sales.map((s) => `<article class="history-item"><div class="row"><div class="history-identity">${monogram(s)}<div><strong>${esc(s.name)}</strong> <span class="small">${esc(s.symbol)}</span> ${s.demo ? '<span class="demo-tag">Demo</span>' : ""}<p style="margin:4px 0">${number(s.q)} shares sold · ${esc(s.date)} · ${esc(s.broker)}</p></div></div><span class="trade-state">${s.status === "complete" ? "Complete" : "Open"}</span></div><p>${money(s.cash)} cash after tax · ${money(s.price)} sale price</p>${s.status === "complete" ? `<p class="positive">Bought ${number(s.rebuyQty)} shares at ${money(s.rebuyPrice)}. Cash remaining: ${money(s.leftover)}.</p>` : `<div class="history-targets">${[0, 5, 10, ...(![0, 5, 10].includes(s.targetGain) && Number.isFinite(s.targetGain) ? [s.targetGain] : [])].map((g) => `<span>${g === 0 ? "Same shares" : "+" + g + "% shares"}<b>${money(target(s, g, model.state.settings.whole).price)}</b></span>`).join("")}</div><button class="secondary" data-rebuy="${esc(s.id)}">Record buyback ${icon("arrow")}</button>`}</article>`).join("") : `<div class="empty"><div class="large-icon">${icon("arrow")}</div><h2>No buybacks yet.</h2></div>`}</section>`;
  }
  function rebuy(id) {
    const s = model.state.sales.find((s) => s.id === id);
    modal(
      `<h2>Record your buyback</h2><p class="sub">${esc(s.name)} · ${money(s.cash)} available</p><form id="rebuy-form"><div class="form-row"><div class="field"><label>Shares bought</label><input name="qty" type="number" min="0.00000001" step="any" value="${s.q}" required></div><div class="field"><label>Price per share (€)</label><input name="price" type="number" min="0.00000001" step="any" required></div></div><div class="form-row"><div><label>Fee (€)</label><input name="fee" type="number" min="0" step="any" value="${s.buyFee}" required></div><div><label>Purchase date</label><input name="date" type="date" min="${esc(s.date)}" max="${today()}" value="${today()}" required></div></div><div class="error" id="rebuy-error"></div><div class="actions"><button class="primary">Complete buyback</button></div></form>`,
    );
    $("#rebuy-form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        model.state = recordBuyback(model.state, {
          saleId: id,
          quantity: Number(f.get("qty")),
          price: Number(f.get("price")),
          fee: Number(f.get("fee")),
          date: String(f.get("date")),
          holdingId: uid(),
          lotId: uid(),
        });
      } catch (error) {
        $("#rebuy-error").textContent = error.message;
        return;
      }
      save();
      close();
      render();
      toast("Buyback complete. Your portfolio has been updated.");
    };
  }

  return { record, rebuy, activity };
}
