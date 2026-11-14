import { taxPresets } from "../../domain/portfolio.js";
import { $, today } from "../../shared/format.js";
import { modal, close, toast, icon } from "../../shared/ui.js";

import { accountCard, bindAccount } from "../identity/session.js";
import { validatePortfolio as validate } from "../../domain/portfolio-validation.js";

export function createSettings(model, services) {
  const { save, render, logout } = services;
  function settings() {
    return `<div class="settings-grid">${accountCard(model.currentUser)}<section class="panel settings-card"><h2>Calculation defaults</h2><form id="settings-form"><div class="field"><label>Tax rate</label><select id="tax-preset">${taxPresets.map((p) => `<option value="${p.rate}" ${model.state.settings.rate === p.rate ? "selected" : ""}>${p.label}</option>`).join("")}<option value="custom" ${!taxPresets.some((p) => p.rate === model.state.settings.rate) ? "selected" : ""}>Custom rate</option></select></div><div class="field"><label>Effective rate (%)</label><input id="rate" type="number" min="0" max="100" step="any" value="${model.state.settings.rate}" required></div><div class="form-row"><div><label>Sale fee (€)</label><input id="default-sf" type="number" min="0" step="any" value="${model.state.settings.sellFee}" required></div><div><label>Buyback fee (€)</label><input id="default-bf" type="number" min="0" step="any" value="${model.state.settings.buyFee}" required></div></div><div class="field"><label>Buyback share precision</label><select id="whole"><option value="false" ${!model.state.settings.whole ? "selected" : ""}>Allow fractional shares</option><option value="true" ${model.state.settings.whole ? "selected" : ""}>Whole shares only</option></select></div><button class="primary">Save defaults</button></form></section><section class="panel settings-card"><h2>Backups</h2><div class="field"><button class="secondary" id="export">${icon("download")} Export backup</button> <button class="secondary" id="import">${icon("upload")} Import backup</button><input id="import-file" type="file" accept="application/json" hidden></div><button class="link" id="method-settings">Calculation ${icon("arrow")}</button>${localStorage.getItem("reentry-v1") ? '<div class="field"><button class="secondary" id="import-local">Import old device portfolio</button></div>' : ""}</section></div>`;
  }
  function bindSettings() {
    bindAccount({ modal, close, toast, onLogout: logout });
    $("#tax-preset").onchange = (e) => {
      if (e.target.value !== "custom") $("#rate").value = e.target.value;
    };
    $("#settings-form").onsubmit = (e) => {
      e.preventDefault();
      model.state.settings = {
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
        new Blob([JSON.stringify(model.state, null, 2)], {
          type: "application/json",
        }),
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
          model.state = imported;
          model.scenario = {};
          model.quotes = {};
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
            model.state = imported;
            model.scenario = {};
            model.quotes = {};
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
      `<h2>Calculation</h2><dl class="calculation-ledger"><div><dt>Cash</dt><dd>Sale − fee − tax</dd></div><div><dt>Buyback ceiling</dt><dd>(Cash − buyback fee) ÷ target shares</dd></div><div><dt>Cost basis</dt><dd>FIFO · purchase fees included</dd></div><div><dt>Taxable gain</dt><dd>Gain − losses − allowance</dd></div><div><dt>Share increase</dt><dd>Target quantity ÷ sold quantity − 1</dd></div></dl><div class="actions"><a class="link" href="https://www.gesetze-im-internet.de/estg/__20.html" target="_blank" rel="noopener">§20 EStG ${icon("arrow")}</a><a class="link" href="https://www.gesetze-im-internet.de/estg/__32d.html" target="_blank" rel="noopener">§32d EStG ${icon("arrow")}</a></div>`,
    );
  }
  return { settings, bindSettings, method };
}
