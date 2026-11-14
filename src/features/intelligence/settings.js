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
      s = info.spending,
      ratio = p.monthlyLimit
        ? Math.min(100, ((s.spent + s.held) / p.monthlyLimit) * 100)
        : 0;
    root.innerHTML = `<div class="section-line"><div><span class="eyebrow">YOUR PRIVATE INTELLIGENCE</span><h2>AI, on your terms.</h2></div><span class="privacy-chip">↗ Bring your own key</span></div><div class="ai-settings-grid"><section class="panel ai-budget"><span class="eyebrow">${esc(s.month)} / USD</span><div class="budget-display"><div><strong>${usd(s.spent)}</strong><span>estimated API cost</span></div><svg viewBox="0 0 100 100" role="img" aria-label="${Math.round(ratio)} percent of monthly budget used or reserved"><circle cx="50" cy="50" r="42" class="budget-track"/><circle cx="50" cy="50" r="42" class="budget-progress" stroke-dasharray="${ratio * 2.639} 264"/><text x="50" y="55" text-anchor="middle">${Math.round(ratio)}%</text></svg></div><div class="budget-breakdown"><span>Reserved / unconfirmed <b>${usd(s.held)}</b></span><span>Monthly cap <b>${usd(p.monthlyLimit)}</b></span><span>Available <b>${usd(Math.max(0, p.monthlyLimit - s.spent - s.held))}</b></span></div><p class="small">Based on reported tokens at published rates. Provider credits, taxes and usage outside Reentry are excluded. Unconfirmed calls keep their budget reservation.</p></section><section class="panel ai-connections"><span class="eyebrow">ENCRYPTED CONNECTIONS</span><h3>Your models. Your account.</h3>${[
      "gemini",
      "anthropic",
    ]
      .map((provider) => {
        const key = info.credentials.find((c) => c.provider === provider);
        return `<div class="provider-row"><span class="provider-glyph">${provider === "gemini" ? "✦" : "A"}</span><div><b>${provider === "gemini" ? "Google Gemini" : "Anthropic Claude"}</b><small>${key ? `Stored · fingerprint ${esc(key.fingerprint)}` : "No key connected"}</small></div><button class="secondary small-button" data-connect="${provider}" ${!info.vaultAvailable ? "disabled" : ""}>${key ? "Replace" : "Connect"}</button>${key ? `<button class="icon-button" aria-label="Remove ${provider} key" data-disconnect="${provider}">×</button>` : ""}</div>`;
      })
      .join(
        "",
      )}${!info.vaultAvailable ? '<p class="inline-notice">The operator must configure AI_MASTER_KEY to enable encrypted key storage.</p>' : ""}<p class="small">Keys stay encrypted on the server and are never sent back to the browser. Connecting stores a key; your first research run checks provider access.</p></section><section class="panel ai-controls"><form id="ai-preferences"><div class="section-line"><h3>Research controls</h3><label class="toggle-label"><input name="enabled" type="checkbox" ${p.enabled ? "checked" : ""}> Enable AI</label></div><div class="form-row"><div class="field"><label for="ai-model">Default model</label><select name="model" id="ai-model">${info.models.map((m) => `<option value="${esc(m.id)}" ${p.model === m.id ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></div><div class="field"><label for="ai-monthly">Monthly cap · US$</label><input id="ai-monthly" name="monthly" type="number" min="0" max="1000" step=".01" value="${p.monthlyLimit / 1000000}" required></div><div class="field"><label for="ai-run">Per-run cap · US$</label><input id="ai-run" name="run" type="number" min=".001" max="10" step=".001" value="${p.runLimit / 1000000}" required></div></div>${!p.consentAt ? '<label class="consent-line"><input name="consent" type="checkbox"> I approve sending selected asset data, research sources and article drafts to my chosen provider. Portfolio quantities and buy-in prices are excluded.</label>' : ""}<div class="actions"><button class="primary">Save AI settings</button><span class="small">Automation is enabled separately for each asset.</span></div>${!info.workerEnabled ? '<p class="inline-notice">Background jobs are disabled on this server.</p>' : ""}${!info.pricesValid ? '<p class="inline-notice">Pricing needs an operator update before more AI calls can run.</p>' : ""}<details class="provider-details"><summary>Pricing & provider data policies</summary><p class="small">Google’s free API tier may use submitted content to improve products. Choose a paid tier if its data policy better fits your needs.</p>${info.models.map((m) => `<p class="small"><a href="${esc(m.source)}" target="_blank" rel="noopener noreferrer">${esc(m.label)} ↗</a> · $${m.input} input / $${m.output} output per million tokens</p>`).join("")}<a class="small" href="https://aistudio.google.com/docs/terms" target="_blank" rel="noopener noreferrer">Google terms ↗</a> · <a class="small" href="https://privacy.claude.com/en/collections/10672480-data-usage-and-retention" target="_blank" rel="noopener noreferrer">Anthropic data policy ↗</a></details></form></section></div><section class="panel cost-ledger"><div class="section-line"><div><span class="eyebrow">ACCOUNTABLE BY DESIGN</span><h3>Every call has a receipt.</h3></div><button class="secondary small-button" data-cost-export>Export ledger ↓</button></div>${costs.entries.length ? `<div class="ledger-scroll"><table><thead><tr><th>Research</th><th>Model</th><th>Tokens in / out</th><th>Status</th><th>USD</th></tr></thead><tbody>${costs.entries.map((e) => `<tr><td><b>${esc(e.symbol)}</b><small>${esc(when(e.created_at))}</small></td><td>${esc(e.model)}</td><td>${e.usage ? `${(e.usage.input + e.usage.cached + e.usage.write5m + e.usage.write1h).toLocaleString()} / ${e.usage.output.toLocaleString()}` : "—"}${e.usage?.cached ? `<small>${e.usage.cached.toLocaleString()} cached</small>` : ""}</td><td>${esc(e.state)}${e.state === "uncertain" ? ` <button class="link" data-reconcile="${esc(e.id)}">Reconcile ↗</button>` : ""}</td><td>${usd(e.cost ?? e.reserved)}${e.cost === null ? " held" : ""}</td></tr>`).join("")}</tbody></table></div>` : '<p class="small">Your first AI request will appear here. No calls have been charged through Reentry.</p>'}</section>`;
    root.querySelector("#ai-preferences").onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      action(f.querySelector("button"), async () => {
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
      });
    };
  }
  root.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-ai-retry")) load();
    if (b.dataset.connect) {
      const provider = b.dataset.connect;
      modal(
        `<span class="eyebrow">PRIVATE CONNECTION</span><h2>Connect ${provider === "gemini" ? "Gemini" : "Claude"}</h2><form id="provider-key-form"><div class="field"><label for="provider-key">Your API key</label><input id="provider-key" name="key" type="password" autocomplete="off" spellcheck="false" minlength="20" maxlength="512" required></div><p class="small">Stored encrypted. Only your requests can use this key.</p><div class="actions"><button class="primary">Save connection</button><a class="link" target="_blank" rel="noopener noreferrer" href="${provider === "gemini" ? "https://aistudio.google.com/api-keys" : "https://platform.claude.com/settings/keys"}">Get a key ↗</a></div></form>`,
      );
      document.querySelector("#provider-key-form").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        action(f.querySelector("button"), async () => {
          const key = f.elements.namedItem("key").value;
          f.elements.namedItem("key").value = "";
          await request("/api/ai/credentials/" + provider, "PUT", { key });
          close();
          toast("Key encrypted and stored.");
          await load();
        });
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
        '<h2>Reconcile an unconfirmed call</h2><p class="sub">Check the provider’s usage record first. Enter the amount charged for this request, including zero if the provider confirms no charge.</p><form id="reconcile-form"><div class="field"><label for="reconcile-cost">Confirmed charge · US$</label><input id="reconcile-cost" name="cost" type="number" min="0" max="1000" step=".000001" required></div><div class="field"><label for="reconcile-note">Evidence / invoice reference</label><input id="reconcile-note" name="note" maxlength="500" required></div><button class="primary">Record reconciliation</button></form>',
      );
      document.querySelector("#reconcile-form").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        action(f.querySelector("button"), async () => {
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
        });
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
