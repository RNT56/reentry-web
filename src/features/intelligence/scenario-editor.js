import { esc } from "../../shared/format.js";
import { modal, close } from "../../shared/ui.js";
import { request } from "../../shared/http.js";
import { action } from "./shared.js";
export function editPrivateScenario(set, onSaved) {
  const input = (name, label, value, type = "text", attrs = "") =>
    `<div class="field"><label>${label}</label><input name="${name}" value="${esc(value)}" type="${type}" ${attrs} required></div>`;
  modal(
    `<span class="eyebrow">PRIVATE REVISION / ${esc(set.symbol)}</span><h2>Make the thesis yours.</h2><p class="small">Save an independent revision. The original author’s map and existing evidence stay on record.</p><form id="private-scenario-form">${input("set-title", "Thesis title", set.title, "text", 'maxlength="200"')}${set.branches.map((b, i) => `<fieldset class="editor-branch" data-edit-branch="${i}"><legend>Branch ${i + 1}</legend>${input("title", "Title", b.title, "text", 'maxlength="120"')}${input("condition", "Condition", b.condition, "text", 'maxlength="600"')}<div class="form-row">${input("low", "Low", b.low, "number", 'min="0" step="any"')}${input("high", "High", b.high, "number", 'min="0" step="any"')}${input("currency", "Currency", b.currency, "text", 'pattern="[A-Z]{3}" maxlength="3"')}${input("horizonDays", "Horizon · days", b.horizonDays, "number", 'min="1" max="730"')}</div><div class="field"><label>Invalidated if…</label><input name="invalidation" value="${esc(b.invalidation)}" maxlength="400"></div></fieldset>`).join("")}<button class="primary">Save private revision</button></form>`,
  );
  const form = document.querySelector("#private-scenario-form");
  form.onsubmit = (e) => {
    e.preventDefault();
    action(form.querySelector(".primary"), async () => {
      const branches = [...form.querySelectorAll("[data-edit-branch]")].map(
        (f, i) => {
          const v = (n) => f.querySelector(`[name="${n}"]`).value;
          return {
            ...set.branches[i],
            title: v("title"),
            condition: v("condition"),
            low: Number(v("low")),
            high: Number(v("high")),
            currency: v("currency"),
            horizonDays: Number(v("horizonDays")),
            invalidation: v("invalidation"),
            passage: "",
          };
        },
      );
      await request("/api/scenarios/" + set.id + "/revise", "POST", {
        title: form.elements.namedItem("set-title").value,
        branches,
      });
      close();
      await onSaved();
    });
  };
}
