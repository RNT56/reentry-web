import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { formatArticle } from "../../domain/article-format.js";
import { icon, toast } from "../../shared/ui.js";
import { action, usd, when } from "./shared.js";

const tasks = {
  article: "Full article",
  paragraph: "Paragraph",
  theory: "Theory",
  thesis: "Thesis",
  assumption: "Assumption",
  scenario: "Scenario",
  rewrite: "Rewrite",
  grammar: "Grammar check",
  structure: "Structure check",
};
const style =
  "Direct, analytical prose. One central idea and one analysis scenario per article. Separate competing theses into linked articles. Distinguish facts, assumptions and judgments. Clear headings and developed paragraphs. No em dashes.";

export function createWritingAssistant(
  root,
  { getDraft, getWriter, onTitle, canEdit = () => true },
) {
  let alive = true,
    job = null,
    context = null,
    pollTimer,
    loading = false,
    generation = 0,
    applied = false;
  const articleId = getDraft().id;
  root.innerHTML = `<header class="writing-ai-head"><span class="eyebrow">WRITING PARTNER</span><h3>Develop the idea.</h3><p>Your voice. Your final say.</p></header>
    <div class="writing-ai-model" data-writing-model>Loading your AI settings…</div>
    <label for="writing-task">I want to work on</label><select id="writing-task">${Object.entries(
      tasks,
    )
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join("")}</select>
    <label for="writing-prompt">What should it do?</label><textarea id="writing-prompt" rows="5" maxlength="4000" placeholder="Explain the thesis, evidence, angle or change you have in mind."></textarea>
    <div class="writing-ai-selection" data-assistant-selection>Uses the current article as context. Select a passage to work on just that text.</div>
    <details class="writing-voice"><summary>Voice & length</summary><label for="writing-voice">Writing direction</label><textarea id="writing-voice" rows="6" maxlength="2000">${esc(style)}</textarea><label for="writing-length">Target words</label><input id="writing-length" type="number" min="50" max="2600" value="1600" step="50"></details>
    <button type="button" class="primary writing-generate" data-writing-generate>${icon("sparkles")} Generate suggestion</button>
    <p class="writing-ai-note">Uses your connected model and existing spending limits. Nothing is inserted or published automatically.</p>
    <div class="writing-ai-status" role="status" aria-live="polite" data-writing-job-status></div>
    <div data-writing-result></div>
    <details class="writing-history"><summary>Recent writing tasks</summary><div data-writing-history>Loading…</div></details>`;
  const status = root.querySelector("[data-writing-job-status]");
  const resultRoot = root.querySelector("[data-writing-result]");
  function live() {
    return alive && root.isConnected && getDraft()?.id === articleId;
  }
  async function settings() {
    try {
      const info = await request("/api/intelligence");
      if (!live()) return;
      const p = info.preferences,
        model = info.models.find((m) => m.id === p.model);
      const ready =
        info.workerEnabled &&
        info.vaultAvailable &&
        info.pricesValid &&
        p.enabled &&
        p.consentAt &&
        info.credentials.some((c) => c.provider === p.provider);
      root.querySelector("[data-writing-model]").innerHTML =
        `<span>${icon("sparkles")} ${esc(model?.label || p.model)}</span><small>${ready ? `Per-run cap ${usd(p.runLimit)}` : "Enable your connected model in AI settings"}</small><button type="button" class="link" data-ai-settings>AI settings ${icon("arrow")}</button>`;
      root.querySelector("[data-writing-generate]").disabled = !ready;
    } catch (error) {
      if (live())
        root.querySelector("[data-writing-model]").textContent = error.message;
    }
  }
  function showJob() {
    if (!live() || !job) return;
    const pending = ["queued", "running"].includes(job.status);
    status.innerHTML = pending
      ? `<span class="writing-job-indicator"></span>${job.status === "queued" ? "Queued" : "Writing"} · ${esc(tasks[job.writing?.task] || "Suggestion")} ${job.status === "queued" ? '<button type="button" class="link" data-writing-cancel>Cancel</button>' : ""}`
      : job.status === "failed"
        ? esc(job.error || "This writing task failed.")
        : job.status === "cancelled"
          ? "Writing task cancelled."
          : "Suggestion ready for review.";
    root.querySelector("[data-writing-generate]").disabled = pending || loading;
    if (!job.result) {
      resultRoot.innerHTML = "";
      return;
    }
    const r = job.result;
    const stale = getWriter().getBody() !== job.article.body;
    resultRoot.innerHTML = `<section class="writing-proposal"><div class="writing-result-heading"><span class="eyebrow">${esc(tasks[job.writing.task])}</span><span>${esc(job.model)}</span></div><p class="writing-result-summary">${esc(r.summary)}</p>${applied ? '<p class="writing-review-clear">Applied to this draft. Use Undo in the editor to revert.</p>' : stale ? '<p class="writing-stale">The article has changed since this request. Copy the suggestion or run a new check against the current text.</p>' : ""}${r.content ? `<div class="writing-proposal-text">${formatArticle(r.content).html}</div><div class="writing-apply-actions"><button type="button" class="secondary" data-writing-apply="append" ${stale || applied ? "disabled" : ""}>Append to article</button>${context ? `<button type="button" class="secondary" data-writing-apply="selection" ${stale || applied ? "disabled" : ""}>${context.text ? "Replace selection" : "Insert at cursor"}</button>` : ""}<button type="button" class="secondary" data-writing-apply="replace" ${stale || applied ? "disabled" : ""}>Replace article</button><button type="button" class="link" data-writing-copy>Copy suggestion</button></div>${r.title ? `<div class="writing-suggested-title"><span>Suggested title</span><b>${esc(r.title)}</b><button type="button" class="link" data-writing-title>Use title</button></div>` : ""}` : ""}${r.issues.length ? `<div class="writing-review-issues">${r.issues.map((issue, i) => `<article class="writing-review-issue"><span class="eyebrow">${esc(issue.category)}</span>${issue.quote ? `<blockquote>${esc(issue.quote)}</blockquote>` : ""}<p>${esc(issue.explanation)}</p>${issue.replacement ? `<div class="writing-correction">${esc(issue.replacement)}</div><button type="button" class="link" data-writing-correct="${i}" ${stale ? "disabled" : ""}>Apply correction ${icon("arrow")}</button>` : ""}</article>`).join("")}</div>` : !r.content ? '<p class="writing-review-clear">No issues identified in this check.</p>' : ""}<p class="writing-ai-note">AI suggestions can contain mistakes. Check facts and sources before publishing.</p></section>`;
  }
  async function history() {
    const data = await request(`/api/journal/${articleId}/assist`);
    if (!live()) return;
    root.querySelector("[data-writing-history]").innerHTML = data.jobs.length
      ? data.jobs
          .map(
            (j) =>
              `<button type="button" data-writing-job="${esc(j.id)}"><b>${esc(tasks[j.task])}</b><span>${esc(j.status)} · ${esc(when(j.created_at))}</span></button>`,
          )
          .join("")
      : '<p class="small">Your writing tasks will appear here.</p>';
    if (!job) {
      const pending = data.jobs.find((j) =>
        ["queued", "running"].includes(j.status),
      );
      if (pending) await loadJob(pending.id);
    }
  }
  async function loadJob(id) {
    const version = ++generation;
    clearTimeout(pollTimer);
    try {
      const value = await request(`/api/journal/${articleId}/assist/${id}`);
      if (!live() || version !== generation) return;
      job = value;
      showJob();
      if (["queued", "running"].includes(job.status))
        pollTimer = setTimeout(() => loadJob(id), 2200);
      else history().catch(() => {});
    } catch (error) {
      if (!live() || version !== generation) return;
      status.textContent = error.message + " Reopen the task below to retry.";
      root.querySelector("[data-writing-generate]").disabled = false;
    }
  }
  root.querySelector("#writing-task").onchange = (event) => {
    const task = event.target.value;
    root.querySelector("#writing-length").value =
      task === "article" ? 1600 : task === "paragraph" ? 150 : 300;
    root.querySelector("[data-writing-generate]").innerHTML =
      `${icon("sparkles")} ${["grammar", "structure"].includes(task) ? "Check article" : "Generate suggestion"}`;
  };
  root.onclick = (event) => {
    const b = event.target.closest("button");
    if (!b || !live()) return;
    if ((!canEdit() || loading) && !b.hasAttribute("data-writing-copy"))
      return toast("Wait for the draft change to finish.");
    if (
      b.hasAttribute("data-writing-generate") &&
      (loading || ["queued", "running"].includes(job?.status))
    )
      return;
    if (b.hasAttribute("data-writing-generate"))
      action(b, async () => {
        loading = true;
        try {
          const data = getDraft(),
            writer = getWriter(),
            requestedContext = writer.selection();
          const words = Number(root.querySelector("#writing-length").value);
          const task = root.querySelector("#writing-task").value;
          status.textContent = "Preparing your writing task…";
          const r = await request(`/api/journal/${articleId}/assist`, "POST", {
            revision: data.revision,
            title: data.title,
            body: writer.getBody(),
            selection: ["grammar", "structure"].includes(task)
              ? ""
              : requestedContext.text,
            sources: data.sources,
            task,
            words,
            prompt: root.querySelector("#writing-prompt").value,
            style: root.querySelector("#writing-voice").value,
            requestKey: crypto.randomUUID(),
          });
          if (!live()) return;
          context = requestedContext;
          applied = false;
          await loadJob(r.id);
          await history();
        } catch (error) {
          if (live()) status.textContent = error.message;
          throw error;
        } finally {
          loading = false;
          if (live())
            setTimeout(() => {
              if (live())
                b.disabled = ["queued", "running"].includes(job?.status);
            }, 0);
        }
      });
    if (b.dataset.writingJob) {
      context = null;
      applied = false;
      loadJob(b.dataset.writingJob);
    }
    if (b.hasAttribute("data-writing-cancel"))
      action(b, async () => {
        await request("/api/research/jobs/" + job.id, "DELETE");
        await loadJob(job.id);
      });
    if (b.dataset.writingApply)
      action(b, async () => {
        getWriter().apply(
          job.result.content,
          b.dataset.writingApply,
          context
            ? { ...context, body: job.article.body }
            : { body: job.article.body },
        );
        applied = true;
        showJob();
        toast(
          "Suggestion applied. You can undo it in the editor. Save when ready.",
        );
      });
    if (b.dataset.writingCorrect !== undefined)
      action(b, async () => {
        const issue = job.result.issues[Number(b.dataset.writingCorrect)];
        getWriter().replaceQuote(
          issue.quote,
          issue.replacement,
          job.article.body,
        );
        // Subsequent issues remain tied to the text just reviewed after this explicit correction.
        job.article.body = getWriter().getBody();
        job.result.issues.splice(Number(b.dataset.writingCorrect), 1);
        showJob();
        toast("Correction applied. Save when ready.");
      });
    if (b.hasAttribute("data-writing-copy"))
      action(b, async () => {
        await navigator.clipboard.writeText(job.result.content);
        toast("Suggestion copied.");
      });
    if (b.hasAttribute("data-writing-title")) {
      onTitle(job.result.title);
      toast("Title applied to the draft.");
    }
  };
  settings();
  history().catch((error) => {
    if (live())
      root.querySelector("[data-writing-history]").textContent = error.message;
  });
  return {
    refresh() {
      if (job?.result) showJob();
    },
    destroy() {
      alive = false;
      generation++;
      clearTimeout(pollTimer);
      root.onclick = null;
    },
  };
}
