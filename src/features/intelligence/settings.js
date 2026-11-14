import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { modal, close, toast } from "../../shared/ui.js";
import { usd, when, empty, loading, download, action } from "./shared.js";
export function mountAISettings(root) {
  let alive = true,
    info,
    costs;
  root.innerHTML = loading();
  async function load() {
    try {
      const values = await Promise.all([
        request("/api/intelligence"),
        request("/api/ai/costs"),
      ]);
      if (!alive || !root.isConnected) return;
      [info, costs] = values;
      render();
    } catch (e) {
      if (alive && root.isConnected)
        root.innerHTML = empty(
          "AI settings unavailable",
          e.message,
          '<button class="secondary" data-ai-retry>Retry</button>',
        );
    }
  }
  function render() {
    const p = info.preferences,
      s = info.spending;
    root.innerHTML = `<div class="section-line"><h2>Intelligence</h2><span class="small">${esc(s.month)}</span></div><div class="ai-settings-grid"><section class="panel ai-budget"><span class="eyebrow">USAGE / USD</span><div class="budget-display"><div><strong>${usd(s.spent)}</strong></div></div><div class="budget-breakdown"><span>Held <b>${usd(s.held)}</b></span><span>Limit <b>${usd(p.monthlyLimit)}</b></span><span>Available <b>${usd(Math.max(0, p.monthlyLimit - s.spent - s.held))}</b></span></div></section><section class="panel ai-connections"><h3>Connections</h3>${[
      "gemini",
      "anthropic",
    ]
      .map((provider) => {
        const key = info.credentials.find((c) => c.provider === provider);
        return `<div class="provider-row"><span class="provider-glyph">${provider === "gemini" ? "✦" : "A"}</span><div><b>${provider === "gemini" ? "Google Gemini" : "Anthropic Claude"}</b><small>${key ? "Connected" : "—"}</small></div><button class="secondary small-button" data-connect="${provider}" ${!info.vaultAvailable ? "disabled" : ""}>${key ? "Replace" : "Connect"}</button>${key ? `<button class="icon-button" aria-label="Remove ${provider} key" data-disconnect="${provider}">×</button>` : ""}</div>`;
      })
      .join(
        "",
      )}${!info.vaultAvailable ? '<p class="inline-notice">The operator must configure AI_MASTER_KEY to enable encrypted key storage.</p>' : ""}</section><section class="panel ai-controls"><form id="ai-preferences"><div class="section-line"><h3>Defaults</h3><label class="toggle-label"><input name="enabled" type="checkbox" ${p.enabled ? "checked" : ""}> Enable AI</label></div><div class="form-row"><div class="field"><label for="ai-provider">Provider</label><select id="ai-provider"><option value="gemini" ${p.provider === "gemini" ? "selected" : ""}>Gemini</option><option value="anthropic" ${p.provider === "anthropic" ? "selected" : ""}>Claude</option></select></div><div class="field"><label for="ai-model">Model</label><select name="model" id="ai-model">${info.models
      .filter((m) => m.provider === p.provider)
      .map(
        (m) =>
          `<option value="${esc(m.id)}" ${p.model === m.id ? "selected" : ""}>${esc(m.label)}</option>`,
      )
      .join(
        "",
      )}</select></div><div class="field"><label for="ai-monthly">Monthly cap · US$</label><input id="ai-monthly" name="monthly" type="number" min="0" max="1000" step=".01" value="${p.monthlyLimit / 1000000}" required></div><div class="field"><label for="ai-run">Per-run cap · US$</label><input id="ai-run" name="run" type="number" min=".001" max="10" step=".001" value="${p.runLimit / 1000000}" required><span class="small" id="ai-max-hold"></span></div></div>${!p.consentAt ? '<label class="consent-line"><input name="consent" type="checkbox"> Send selected research and drafts to this provider</label>' : ""}<div class="actions"><button class="primary">Save AI settings</button></div>${!info.workerEnabled ? '<p class="inline-notice">Background jobs are disabled on this server.</p>' : ""}${!info.pricesValid ? '<p class="inline-notice">Pricing needs an operator update before more AI calls can run.</p>' : ""}</form></section></div><section class="panel cost-ledger"><div class="section-line"><div><h3>Usage</h3></div><button class="secondary small-button" data-cost-export>Export ledger ↓</button></div>${costs.entries.length ? `<div class="ledger-scroll"><table><thead><tr><th>Research</th><th>Model</th><th>Tokens in / out</th><th>Status</th><th>USD</th></tr></thead><tbody>${costs.entries.map((e) => `<tr><td><b>${esc(e.symbol)}</b><small>${esc(when(e.created_at))}</small></td><td>${esc(e.model)}</td><td>${e.usage ? `${(e.usage.input + e.usage.cached + e.usage.write5m + e.usage.write1h).toLocaleString()} / ${e.usage.output.toLocaleString()}` : "—"}${e.usage?.cached ? `<small>${e.usage.cached.toLocaleString()} cached</small>` : ""}</td><td>${esc(e.state)}${e.state === "uncertain" ? ` <button class="link" data-reconcile="${esc(e.id)}">Reconcile ↗</button>` : ""}</td><td>${usd(e.cost ?? e.reserved)}${e.cost === null ? " held" : ""}</td></tr>`).join("")}</tbody></table></div>` : '<p class="small">No activity</p>'}</section>`;
    function showHold() {
      const model = info.models.find(
        (m) => m.id === root.querySelector("#ai-model").value,
      );
      const limits = info.reservationLimits;
      const hold = Math.ceil(
        limits.input * model.input + limits.output * model.output,
      );
      root.querySelector("#ai-max-hold").textContent =
        "Max hold · $" + (Math.ceil(hold / 1000) / 1000).toFixed(3);
    }
    root.querySelector("#ai-model").onchange = showHold;
    showHold();
    root.querySelector("#ai-provider").onchange = (e) => {
      const provider = e.target.value;
      root.querySelector("#ai-model").innerHTML = info.models
        .filter((m) => m.provider === provider)
        .map(
          (m) =>
            `<option value="${esc(m.id)}" ${m.id === info.defaultModels[provider] ? "selected" : ""}>${esc(m.label)}</option>`,
        )
        .join("");
      showHold();
    };
    root.querySelector("#ai-preferences").onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      action(
        f.querySelector('button[type="submit"],button:not([type])'),
        async () => {
          await request("/api/ai/preferences", "PUT", {
            enabled: f.elements.namedItem("enabled").checked,
            model: f.elements.namedItem("model").value,
            monthlyLimit: Math.round(
              Number(f.elements.namedItem("monthly").value) * 1000000,
            ),
            runLimit: Math.round(
              Number(f.elements.namedItem("run").value) * 1000000,
            ),
            consent: !!f.elements.namedItem("consent")?.checked,
          });
          toast("AI settings saved.");
          await load();
        },
      );
    };
  }
  root.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-ai-retry")) load();
    if (b.dataset.connect) {
      const provider = b.dataset.connect;
      modal(
        `<span class="eyebrow">PRIVATE CONNECTION</span><h2>Connect ${provider === "gemini" ? "Gemini" : "Claude"}</h2><form id="provider-key-form"><div class="field"><label for="provider-key">Your API key</label><input id="provider-key" name="key" type="password" autocomplete="off" spellcheck="false" minlength="20" maxlength="512" required></div><div class="actions"><button class="primary">Save connection</button><a class="link" target="_blank" rel="noopener noreferrer" href="${provider === "gemini" ? "https://aistudio.google.com/api-keys" : "https://platform.claude.com/settings/keys"}">Get a key ↗</a></div></form>`,
      );
      document.querySelector("#provider-key-form").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        action(
          f.querySelector('button[type="submit"],button:not([type])'),
          async () => {
            const key = f.elements.namedItem("key").value;
            f.elements.namedItem("key").value = "";
            await request("/api/ai/credentials/" + provider, "PUT", { key });
            close();
            toast("Key encrypted and stored.");
            await load();
          },
        );
      };
    }
    if (b.dataset.disconnect)
      action(b, async () => {
        await request("/api/ai/credentials/" + b.dataset.disconnect, "DELETE");
        toast("Key removed. Queued calls cancelled.");
        await load();
      });
    if (b.hasAttribute("data-cost-export"))
      download(costs, "reentry-ai-ledger.json");
    if (b.dataset.reconcile) {
      modal(
        '<h2>Reconcile an unconfirmed call</h2><form id="reconcile-form"><div class="field"><label for="reconcile-cost">Confirmed charge · US$</label><input id="reconcile-cost" name="cost" type="number" min="0" max="1000" step=".000001" required></div><div class="field"><label for="reconcile-note">Evidence / invoice reference</label><input id="reconcile-note" name="note" maxlength="500" required></div><button class="primary">Record reconciliation</button></form>',
      );
      document.querySelector("#reconcile-form").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        action(
          f.querySelector('button[type="submit"],button:not([type])'),
          async () => {
            await request(
              "/api/ai/costs/" + b.dataset.reconcile + "/reconcile",
              "POST",
              {
                cost: Math.round(
                  Number(f.elements.namedItem("cost").value) * 1000000,
                ),
                note: f.elements.namedItem("note").value,
              },
            );
            close();
            await load();
          },
        );
      };
    }
  };
  load();
  return {
    destroy() {
      alive = false;
      root.onclick = null;
    },
  };
}
