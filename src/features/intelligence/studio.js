import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { modal, close, toast, associateLabels } from "../../shared/ui.js";
import { action, empty, when } from "./shared.js";
export function createStudio({ root, onMapped, refreshJournal }) {
  let draft = null,
    dirty = false,
    saving = false,
    items = [];
  const warn = (e) => {
    if (dirty || saving) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", warn);
  const field = (label, name, value = "", type = "text", extra = "") =>
    `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  function branchesHTML(branches) {
    return branches
      .map(
        (b, i) =>
          `<fieldset class="editor-branch" data-branch-index="${i}"><legend>Branch ${i + 1}</legend>${field("Title", "title", b.title, "text", 'maxlength="120" required')}${field("Condition to verify", "condition", b.condition, "text", 'maxlength="600" required')}<div class="form-row">${field("Low", "low", b.low, "number", 'min="0" step="any" required')}${field("High", "high", b.high, "number", 'min="0" step="any" required')}${field("Currency", "currency", b.currency || "USD", "text", 'pattern="[A-Z]{3}" maxlength="3" required')}${field("Days", "horizonDays", b.horizonDays || 90, "number", 'min="1" max="730" required')}</div>${field("Invalidated if…", "invalidation", b.invalidation, "text", 'maxlength="400"')}<label>Exact article passage</label><textarea name="passage" maxlength="2000" required>${esc(b.passage)}</textarea><input type="hidden" name="eventKey" value="${esc(b.eventKey)}"><button class="link" type="button" data-remove-branch="${i}">Remove branch</button></fieldset>`,
      )
      .join("");
  }
  function read() {
    const form = root.querySelector("#article-form");
    if (!form) return draft;
    const branches = [...form.querySelectorAll("[data-branch-index]")].map(
      (f) => {
        const v = (n) => f.querySelector(`[name="${n}"]`).value;
        return {
          title: v("title"),
          condition: v("condition"),
          low: Number(v("low")),
          high: Number(v("high")),
          currency: v("currency").toUpperCase(),
          horizonDays: Number(v("horizonDays")),
          invalidation: v("invalidation"),
          passage: v("passage"),
          eventKey: v("eventKey"),
        };
      },
    );
    return {
      ...draft,
      title: form.elements.namedItem("article-title").value,
      body: form.elements.namedItem("article-body").value,
      symbol: form.elements.namedItem("article-symbol").value.toUpperCase(),
      branches,
      sources: [...form.querySelectorAll("[data-source-row]")]
        .map((r) => ({
          title: r.querySelector('[name="source-title"]').value,
          url: r.querySelector('[name="source-url"]').value,
        }))
        .filter((s) => s.url.trim()),
    };
  }
  function editor() {
    if (!root.isConnected) return;
    root.innerHTML = `<div class="studio-layout"><aside class="studio-list"><span class="eyebrow">RNT / AUTHOR STUDIO</span><h2>Your thinking,<br>on record.</h2><button class="secondary" data-new-article>＋ New article</button>${items.map((a) => `<button class="studio-item ${draft?.id === a.id ? "selected" : ""}" data-edit-article="${esc(a.id)}"><span class="eyebrow">${esc(a.symbol)} / ${a.publishedRevision ? "Published" : "Draft"}</span><b>${esc(a.title)}</b><small>${esc(when(a.updatedAt))}</small></button>`).join("")}</aside><div class="studio-editor">${draft ? `<form id="article-form"><div class="section-line"><span class="privacy-chip">${draft.publishedRevision ? "Published edition " + draft.publishedRevision + " · editing privately" : "Private draft"}</span><span id="draft-status" class="small">${dirty ? "Unsaved changes" : "Saved · revision " + draft.revision}</span></div><div class="form-row">${field("Asset ticker", "article-symbol", draft.symbol, "text", 'maxlength="32" required')}${field("Title", "article-title", draft.title, "text", 'maxlength="200" required')}</div><label class="sr-only" for="article-body">Article text</label><textarea class="article-textarea" id="article-body" name="article-body" maxlength="40000" placeholder="A clear thesis. What would have to be true?" required>${esc(draft.body)}</textarea><div class="editor-toolbar"><button type="submit" class="primary">Save draft</button><button type="button" class="secondary" data-map-article>✦ Map with AI</button><button type="button" class="secondary" data-publish>Publish ↗</button>${draft.publishedRevision ? `<a class="link" href="/journal/${esc(draft.slug)}" target="_blank" rel="noopener">View live ↗</a><button type="button" class="link" data-unpublish>Unpublish</button>` : ""}</div><details class="editor-scenarios" ${draft.branches.length ? "open" : ""}><summary>Scenario map · ${draft.branches.length} branches</summary><p class="small">Each branch links an exact passage to a condition, price range and horizon.</p><div id="branch-editor">${branchesHTML(draft.branches)}</div><button class="secondary" type="button" data-add-branch>＋ Map selected passage</button></details><details class="editor-sources"><summary>Public source links · ${draft.sources.length}</summary><div id="source-editor">${draft.sources.map((s) => `<div class="form-row" data-source-row>${field("Source title", "source-title", s.title, "text", 'maxlength="300"')}${field("HTTPS link", "source-url", s.url, "url", 'maxlength="2000"')}</div>`).join("")}</div><button class="secondary" type="button" data-add-public-source>＋ Source link</button></details></form>` : empty("A thesis starts here.", "Only you can publish as RNT. AI maps remain drafts until you review them.", '<button class="primary" data-new-article>Write an article ↗</button>')}</div></div>`;
    associateLabels(root);
    const form = root.querySelector("#article-form");
    if (form) {
      form.oninput = () => {
        dirty = true;
        root.querySelector("#draft-status").textContent = "Unsaved changes";
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        action(form.querySelector('[type="submit"]'), save);
      };
    }
  }
  async function save() {
    if (saving) throw Error("A draft save is already in progress.");
    const form = root.querySelector("#article-form");
    if (form && !form.reportValidity())
      throw Error("Complete the article and scenario fields first.");
    const data = read();
    saving = true;
    if (form) form.inert = true;
    try {
      draft = await request("/api/journal/" + data.id, "PUT", data);
      dirty = false;
      // A list refresh failure must not disguise a successful, revision-advancing save.
      items = items.map((a) => (a.id === draft.id ? draft : a));
      editor();
      toast("Draft saved.");
    } finally {
      saving = false;
      if (form) form.inert = false;
    }
  }
  async function load(id) {
    try {
      items = (await request("/api/journal")).articles;
      if (id) draft = await request("/api/journal/" + id);
      editor();
    } catch (e) {
      toast(e.message);
    }
  }
  root.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (saving) {
      toast("The draft is being saved.");
      return;
    }
    if (b.hasAttribute("data-new-article")) {
      if (dirty) {
        toast("Save this draft before starting another.");
        return;
      }
      modal(
        '<h2>A new thesis.</h2><form id="new-article"><div class="field"><label for="new-symbol">Asset ticker</label><input id="new-symbol" name="symbol" maxlength="32" placeholder="INTC" required></div><div class="field"><label for="new-title">Title</label><input id="new-title" name="title" maxlength="200" placeholder="What has to be true" required></div><button class="primary">Create private draft</button></form>',
      );
      document.querySelector("#new-article").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        action(f.querySelector("button"), async () => {
          const r = await request("/api/journal", "POST", {
            symbol: f.elements.namedItem("symbol").value,
            title: f.elements.namedItem("title").value,
            body: "",
          });
          close();
          await load(r.id);
        });
      };
    }
    if (b.dataset.editArticle) {
      if (dirty) {
        toast("Save this draft before switching articles.");
        return;
      }
      load(b.dataset.editArticle);
    }
    if (b.hasAttribute("data-add-branch")) {
      const textarea = root.querySelector("#article-body"),
        passage = textarea.value.slice(
          textarea.selectionStart,
          textarea.selectionEnd,
        );
      draft = read();
      if (!passage) {
        toast("Select a passage in your article first.");
        textarea.focus();
        return;
      }
      if (draft.branches.length >= 12) {
        toast("Twelve branches is the maximum.");
        return;
      }
      draft.branches.push({
        title: "",
        condition: "",
        low: "",
        high: "",
        currency: "USD",
        horizonDays: 90,
        invalidation: "",
        eventKey: "condition-" + crypto.randomUUID().slice(0, 8),
        passage,
      });
      dirty = true;
      editor();
    }
    if (b.dataset.removeBranch !== undefined) {
      draft = read();
      draft.branches.splice(Number(b.dataset.removeBranch), 1);
      dirty = true;
      editor();
    }
    if (b.hasAttribute("data-add-public-source")) {
      draft = read();
      draft.sources.push({ title: "", url: "" });
      dirty = true;
      editor();
      root.querySelector(".editor-sources").open = true;
    }
    if (b.hasAttribute("data-map-article"))
      action(b, async () => {
        if (dirty) await save();
        const r = await request("/api/journal/" + draft.id + "/map", "POST", {
          requestKey: crypto.randomUUID(),
        });
        toast("AI mapping queued.");
        onMapped(r.id);
      });
    if (b.hasAttribute("data-publish"))
      action(b, async () => {
        if (dirty) await save();
        modal(
          `<span class="eyebrow">PUBLISH AS RNT</span><h2>${esc(draft.title)}</h2><p class="sub">This article, ${draft.branches.length} scenario branches and ${draft.sources.length} source links will be visible to everyone. Published editions stay on record.</p><label class="consent-line"><input id="publication-reviewed" type="checkbox"> I reviewed the text, mapped passages, sources and conditions.</label><button class="primary" id="confirm-publish">Publish this edition ↗</button>`,
        );
        document.querySelector("#confirm-publish").onclick = (e) =>
          action(e.target, async () => {
            if (!document.querySelector("#publication-reviewed").checked)
              throw Error("Confirm your review before publishing.");
            await request("/api/journal/" + draft.id + "/publish", "POST", {
              reviewed: true,
              revision: draft.revision,
            });
            close();
            await load(draft.id);
            refreshJournal();
            toast("Published as RNT.");
          });
      });
    if (b.hasAttribute("data-unpublish"))
      action(b, async () => {
        await request("/api/journal/" + draft.id + "/publication", "DELETE");
        await load(draft.id);
        refreshJournal();
        toast("Article removed from public view.");
      });
  };
  load();
  return {
    isDirty: () => dirty || saving,
    async apply(job) {
      const current = await request("/api/journal/" + job.article.id);
      if (current.revision !== job.article.revision || dirty)
        throw Error(
          "The draft changed since this mapping. Save and map the latest version.",
        );
      draft = {
        ...current,
        branches: job.result.scenarios,
        sources: [
          ...current.sources,
          ...job.sources
            .filter((s) => s.url)
            .map((s) => ({ title: s.title, url: s.url })),
        ]
          .filter((s, i, a) => a.findIndex((t) => t.url === s.url) === i)
          .slice(0, 20),
      };
      dirty = true;
      editor();
      toast("Mapping applied to the draft. Review and save before publishing.");
    },
    destroy() {
      window.removeEventListener("beforeunload", warn);
      root.onclick = null;
    },
  };
}
