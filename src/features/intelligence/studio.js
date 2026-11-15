import { articleAssetsMarkup, mountArticleAssets } from "./article-assets.js";
import { createWritingEditor, writingEditorMarkup } from "./writing-editor.js";
import { createWritingAssistant } from "./writing-assistant.js";
import { openArticlePreview } from "./article-preview.js";
import { openMediaComposer } from "./media-composer.js";
import { mediaMarkdown } from "../../domain/article-media.js";
import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { icon, modal, close, toast, associateLabels } from "../../shared/ui.js";
import { action, empty, when } from "./shared.js";
export function createStudio({ root, onMapped, refreshJournal }) {
  let draft = null,
    dirty = false,
    saving = false,
    deleting = false,
    loadVersion = 0,
    destroyed = false,
    items = [];
  let assetPicker,
    newAssetPicker,
    writer,
    assistant,
    preview,
    mediaComposer,
    assistOpen = true;
  const warn = (e) => {
    if (dirty || saving || deleting) {
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
      body: writer?.getBody() ?? form.elements.namedItem("article-body").value,
      symbol: assetPicker?.values()[0]?.symbol || "",
      assets: assetPicker?.values() || [],
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
    if (destroyed || !root.isConnected) return;
    writer?.destroy();
    mediaComposer?.destroy();
    assistant?.destroy();
    assetPicker?.destroy();
    writer = null;
    assistant = null;
    root.innerHTML = `<div class="studio-layout"><aside class="studio-list"><span class="eyebrow">RNT / AUTHOR STUDIO</span><h2>Articles</h2><button class="secondary" data-new-article>${icon("plus")} New article</button>${items.map((a) => `<div class="studio-card"><button type="button" class="studio-item ${draft?.id === a.id ? "selected" : ""} ${a.canDelete ? "deletable" : ""}" data-edit-article="${esc(a.id)}"><span class="eyebrow">${esc(a.symbol)} / ${a.publishedRevision ? "Published" : a.canDelete ? "Draft" : "Unpublished"}</span><b>${esc(a.title)}</b><small>${esc(when(a.updatedAt))}</small></button>${a.canDelete ? `<button type="button" class="studio-delete" data-delete-article="${esc(a.id)}" aria-label="Delete draft: ${esc(a.title)}" title="Delete draft">${icon("close")}</button>` : ""}</div>`).join("")}</aside><div class="studio-workbench ${assistOpen ? "" : "assistant-hidden"}"><div class="studio-editor">${draft ? `<form id="article-form"><div class="section-line"><span class="privacy-chip">${draft.publishedRevision ? "Published edition " + draft.publishedRevision + " · editing privately" : "Private draft"}</span><span id="draft-status" class="small">${dirty ? "Unsaved changes" : "Saved · revision " + draft.revision}</span></div><div class="form-row article-heading-fields">${field("Title", "article-title", draft.title, "text", 'maxlength="200" required')}</div>${articleAssetsMarkup("studio")}<div class="editor-toolbar"><button type="submit" class="primary">Save draft</button><button type="button" class="secondary" data-preview-article>Preview ${icon("arrow")}</button><button type="button" class="secondary" data-toggle-writing aria-pressed="${assistOpen}">${icon("sparkles")} Writing partner</button><button type="button" class="secondary" data-map-article>${icon("sparkles")} Map with AI</button><button type="button" class="secondary" data-publish>Publish ${icon("arrow")}</button>${draft.publishedRevision ? `<a class="link" href="/journal/${esc(draft.slug)}" target="_blank" rel="noopener">View live ${icon("arrow")}</a><button type="button" class="link" data-unpublish>Unpublish</button>` : ""}</div>${writingEditorMarkup(draft.body)}<details class="editor-scenarios" ${draft.branches.length ? "open" : ""}><summary>Scenario map · ${draft.branches.length} ${draft.branches.length === 1 ? "branch" : "branches"}</summary><div id="branch-editor">${branchesHTML(draft.branches)}</div><button class="secondary" type="button" data-add-branch>${icon("plus")} Map selected passage</button></details><details class="editor-sources"><summary>Public source links · ${draft.sources.length}</summary><div id="source-editor">${draft.sources.map((s) => `<div class="form-row" data-source-row>${field("Source title", "source-title", s.title, "text", 'maxlength="300"')}${field("HTTPS link", "source-url", s.url, "url", 'maxlength="2000"')}</div>`).join("")}</div><button class="secondary" type="button" data-add-public-source>${icon("plus")} Source link</button></details></form>` : empty("New article", "", `<button class="primary" data-new-article>Write an article ${icon("arrow")}</button>`)}</div>${draft ? '<aside class="writing-assistant" aria-label="AI writing partner"></aside>' : ""}</div></div>`;
    associateLabels(root);
    const form = root.querySelector("#article-form");
    if (form) {
      const markDirty = () => {
        dirty = true;
        assistant?.invalidateRequest();
        root.querySelector("#draft-status").textContent = "Unsaved changes";
      };
      assetPicker = mountArticleAssets(
        root.querySelector("[data-article-assets]"),
        {
          assets: draft.assets || [
            { symbol: draft.symbol, name: draft.symbol },
          ],
          onChange: (assets) => {
            markDirty();
            assistant?.refresh();
            const note = root.querySelector("[data-asset-change-note]");
            note.hidden =
              assets[0]?.symbol === draft.symbol || !read().branches.length;
            note.textContent = `Review the existing scenario ranges and conditions for ${assets[0]?.symbol} before saving.`;
          },
        },
      );
      writer = createWritingEditor(root.querySelector(".writing-surface"), {
        body: draft.body,
        onChange: markDirty,
        onMedia: (initial, context) => {
          if (!assetPicker.validate()) return;
          mediaComposer?.destroy();
          mediaComposer = openMediaComposer({
            getDraft: read,
            initial,
            onInsert: (media) => {
              if (!assetPicker.validate())
                throw Error("Choose an article asset first.");
              writer.apply(mediaMarkdown(media), "selection", context);
            },
          });
        },
      });
      assistant = createWritingAssistant(
        root.querySelector(".writing-assistant"),
        {
          getDraft: read,
          validate: () => assetPicker.validate(),
          getWriter: () => writer,
          canEdit: () => !saving && !deleting,
          onTitle: (title) => {
            form.elements.namedItem("article-title").value = title;
            markDirty();
          },
        },
      );
      form.oninput = (event) => {
        if (!event.target.closest(".writing-surface,.article-assets"))
          markDirty();
      };
      form.onkeydown = (event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          action(form.querySelector('[type="submit"]'), save);
        }
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        action(form.querySelector('[type="submit"]'), save);
      };
    }
  }
  async function save() {
    if (saving) throw Error("A draft save is already in progress.");
    if (deleting) throw Error("Wait for the draft deletion to finish.");
    loadVersion++;
    const form = root.querySelector("#article-form");
    if (form && !form.reportValidity())
      throw Error("Complete the article and scenario fields first.");
    const data = read();
    if (data.body.length > 40000)
      throw Error(
        "The article exceeds 40,000 characters. Shorten it before saving.",
      );
    saving = true;
    if (form) form.inert = true;
    try {
      draft = await request("/api/journal/" + data.id, "PUT", data);
      dirty = false;
      // A list refresh failure must not disguise a successful, revision-advancing save.
      items = items.map((a) => (a.id === draft.id ? draft : a));
      root.querySelector("#draft-status").textContent =
        "Saved · revision " + draft.revision;
      const card = [...root.querySelectorAll("[data-edit-article]")].find(
        (b) => b.dataset.editArticle === draft.id,
      );
      if (card) {
        card.querySelector(".eyebrow").textContent =
          `${draft.symbol} / ${draft.publishedRevision ? "Published" : draft.canDelete ? "Draft" : "Unpublished"}`;
        card.querySelector("b").textContent = draft.title;
        card.querySelector("small").textContent = when(draft.updatedAt);
      }
      root.querySelector("[data-asset-change-note]").hidden = true;
      toast("Draft saved.");
    } finally {
      saving = false;
      if (form) form.inert = false;
    }
  }
  async function load(id) {
    const version = ++loadVersion;
    try {
      const list = (await request("/api/journal")).articles;
      const selected = id ? await request("/api/journal/" + id) : draft;
      if (destroyed || version !== loadVersion) return;
      items = list;
      draft = selected;
      editor();
    } catch (e) {
      if (!destroyed && version === loadVersion) toast(e.message);
    }
  }
  async function removeDraft(button) {
    const id = button.dataset.deleteArticle;
    const item = items.find((a) => a.id === id);
    if (!item?.canDelete)
      throw Error("This article cannot be deleted as a draft.");
    const selected = draft?.id === id;
    const revision = selected ? draft.revision : item.revision;
    const form = selected ? root.querySelector("#article-form") : null;
    const wasInert = form?.inert;
    const card = button.closest(".studio-card");
    deleting = true;
    loadVersion++;
    if (form) form.inert = true;
    try {
      try {
        await request("/api/journal/" + id, "DELETE", { revision });
      } catch (error) {
        // A retry after a lost successful response, or deletion in another tab.
        if (error.status !== 404) throw error;
      }
      const index = items.findIndex((a) => a.id === id);
      items = items.filter((a) => a.id !== id);
      if (selected) {
        draft = null;
        dirty = false;
        editor();
      } else {
        // Preserve the active editor, including its unsaved text and selection.
        card?.remove();
      }
      if (destroyed || !root.isConnected) return;
      const next = items[Math.min(index, items.length - 1)];
      const focus = next
        ? [...root.querySelectorAll("[data-edit-article]")].find(
            (b) => b.dataset.editArticle === next.id,
          )
        : root.querySelector("[data-new-article]");
      focus?.focus({ preventScroll: true });
      toast("Draft deleted.");
    } finally {
      deleting = false;
      if (form) form.inert = wasInert;
    }
  }
  root.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (saving || deleting) {
      toast(
        deleting ? "The draft is being deleted." : "The draft is being saved.",
      );
      return;
    }
    if (
      ["data-preview-article", "data-map-article", "data-publish"].some(
        (attr) => b.hasAttribute(attr),
      ) &&
      !assetPicker.validate()
    )
      return;
    if (b.hasAttribute("data-preview-article")) {
      preview?.close();
      mediaComposer?.destroy();
      preview = openArticlePreview(read);
      return;
    }
    if (b.hasAttribute("data-toggle-writing")) {
      assistOpen = !assistOpen;
      root
        .querySelector(".studio-workbench")
        .classList.toggle("assistant-hidden", !assistOpen);
      b.setAttribute("aria-pressed", String(assistOpen));
      if (assistOpen)
        root
          .querySelector(".writing-assistant")
          .scrollIntoView({ block: "nearest", behavior: "instant" });
      return;
    }
    if (b.dataset.deleteArticle) {
      action(b, () => removeDraft(b));
      return;
    }
    if (b.hasAttribute("data-new-article")) {
      if (dirty) {
        toast("Save this draft before starting another.");
        return;
      }
      newAssetPicker?.destroy();
      modal(
        `<h2>A new thesis.</h2><form id="new-article">${articleAssetsMarkup("new-article")}<div class="field"><label for="new-title">Title</label><input id="new-title" name="title" maxlength="200" placeholder="What has to be true" required></div><button type="submit" class="primary">Create private draft</button></form>`,
      );
      const picker = mountArticleAssets(
        document.querySelector("#new-article [data-article-assets]"),
      );
      newAssetPicker = picker;
      document
        .querySelector("#modal")
        .addEventListener("close", () => picker.destroy(), { once: true });
      document.querySelector("#new-article").onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        action(
          f.querySelector('button[type="submit"],button:not([type])'),
          async () => {
            const r = await request("/api/journal", "POST", {
              symbol: picker.values()[0]?.symbol,
              assets: picker.values(),
              title: f.elements.namedItem("title").value,
              body: "",
            });
            close();
            await load(r.id);
          },
        );
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
      const passage = writer?.selection().text || "";
      draft = read();
      if (!passage) {
        toast("Select a passage in your article first.");
        writer?.focus();
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
          `<span class="eyebrow">PUBLISH AS RNT</span><h2>${esc(draft.title)}</h2><p class="sub">Public · ${draft.branches.length} scenarios · ${draft.sources.length} sources</p><label class="consent-line"><input id="publication-reviewed" type="checkbox"> I reviewed the text, mapped passages, sources and conditions.</label><button class="primary" id="confirm-publish">Publish this edition ${icon("arrow")}</button>`,
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
    isDirty: () => dirty || saving || deleting,
    async apply(job) {
      if (deleting || saving)
        throw Error("Wait for the current draft change to finish.");
      const version = ++loadVersion;
      const current = await request("/api/journal/" + job.article.id);
      if (destroyed || version !== loadVersion) return;
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
      destroyed = true;
      assetPicker?.destroy();
      newAssetPicker?.destroy();
      writer?.destroy();
      assistant?.destroy();
      preview?.close();
      loadVersion++;
      window.removeEventListener("beforeunload", warn);
      root.onclick = null;
    },
  };
}
