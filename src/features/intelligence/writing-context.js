import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { toast } from "../../shared/ui.js";

const date = (stamp) =>
  stamp
    ? new Date(stamp).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Date unavailable";
const safe = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
};
export function writingContextMarkup(context) {
  if (!context) return '<p class="writing-ai-note">Draft context only</p>';
  return `<p class="writing-ai-note">Snapshot · ${esc(context.asOf)}</p>${context.assets
    .map(
      (asset) =>
        `<section class="writing-context-asset"><h4>${esc(asset.symbol)} <span>${esc(asset.role)}</span></h4><p>${esc(asset.name)}</p>${Object.entries(
          asset.groups,
        )
          .map(
            ([key, group]) =>
              `<details class="writing-context-group"><summary>${esc(group.label)} <span>${group.included} / ${group.available}</span></summary>${group.items.length ? group.items.map((item) => `<article><strong>${esc(item.title)}</strong><small>${esc(item.epistemic)} · ${date(item.updatedAt)}${item.publishedAt ? ` · Published ${date(item.publishedAt)}` : ""}</small>${safe(item.url) ? `<a href="${esc(safe(item.url))}" target="_blank" rel="noopener noreferrer">Open source</a>` : ""}<pre>${esc(item.content)}</pre>${item.truncated ? '<span class="writing-context-limit" tabindex="0" data-tooltip="Excerpt shortened for this request.">Excerpt</span>' : ""}</article>`).join("") : `<p class="writing-ai-note">No ${esc(key)} included for this listing.</p>`}${group.omitted ? `<p class="writing-context-limit">${group.omitted} omitted</p>` : ""}</details>`,
          )
          .join("")}</section>`,
    )
    .join("")}`;
}

export function createWritingContextPanel(root, { getDraft, articleId }) {
  let alive = true,
    generation = 0,
    previewGeneration = 0,
    assetKey = "",
    controller,
    prepared = null,
    preparedKey = "";
  root.innerHTML = `<details class="writing-context"><summary>Asset context <span data-context-count>Loading…</span></summary><div class="writing-context-tools"><button type="button" class="link" data-refresh-context>Refresh</button></div><div data-context-records></div></details><details class="writing-full-request" hidden><summary data-request-heading>Full request</summary><label for="writing-request-text">Instructions sent to the model</label><textarea id="writing-request-text" rows="16" readonly></textarea><button type="button" class="link" data-copy-writing-request>Copy full request</button><details><summary>Response format</summary><pre data-writing-response-schema></pre></details></details>`;
  const count = root.querySelector("[data-context-count]"),
    records = root.querySelector("[data-context-records]"),
    full = root.querySelector(".writing-full-request");
  function key() {
    const draft = getDraft();
    return JSON.stringify([draft.symbol, draft.assets]);
  }
  function render(context) {
    const totals = context.assets.flatMap((a) => Object.values(a.groups));
    count.textContent = `${totals.reduce((n, g) => n + g.included, 0)} records · ${context.assets.map((a) => a.symbol).join(", ")}`;
    records.innerHTML = writingContextMarkup(context);
  }
  async function refresh(force = false) {
    const nextKey = key();
    if (!alive || (!force && nextKey === assetKey)) return;
    assetKey = nextKey;
    previewGeneration++;
    prepared = null;
    full.hidden = true;
    const current = ++generation,
      draft = getDraft();
    controller?.abort();
    controller = new AbortController();
    count.textContent = "Loading…";
    records.textContent = "Loading stored knowledge for the selected assets…";
    try {
      const data = await request(
        `/api/journal/${articleId}/assist/context`,
        "POST",
        { symbol: draft.symbol, assets: draft.assets },
        { signal: controller.signal },
      );
      if (!alive || current !== generation || key() !== nextKey) return;
      render(data.context);
    } catch (error) {
      if (!alive || current !== generation || error.name === "AbortError")
        return;
      count.textContent = "Unavailable";
      records.textContent = error.message + " Use Refresh to retry.";
    }
  }
  function showRequest(value, title) {
    full.hidden = false;
    full.open = true;
    root.querySelector("[data-request-heading]").textContent = title;
    root.querySelector("#writing-request-text").value =
      value.prompt || "The full prompt was not saved for this older request.";
    root.querySelector("[data-writing-response-schema]").textContent =
      value.schema
        ? JSON.stringify(value.schema, null, 2)
        : "Structured text and review suggestions.";
  }
  root.onclick = async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-refresh-context")) await refresh(true);
    if (button.hasAttribute("data-copy-writing-request")) {
      try {
        await navigator.clipboard.writeText(
          root.querySelector("#writing-request-text").value,
        );
        toast("Full request copied.");
      } catch {
        toast("Copy unavailable. Select the request text to copy it.");
      }
    }
  };
  refresh();
  return {
    refresh,
    invalidatePreview() {
      previewGeneration++;
      prepared = null;
      full.hidden = true;
    },
    async preview(payload, reveal = false) {
      const fingerprint = JSON.stringify(payload),
        selectionKey = key();
      if (!prepared || preparedKey !== fingerprint) {
        const currentPreview = ++previewGeneration;
        generation++;
        controller?.abort();
        assetKey = selectionKey;
        const value = await request(
          `/api/journal/${articleId}/assist/preview`,
          "POST",
          payload,
        );
        if (
          !alive ||
          key() !== selectionKey ||
          currentPreview !== previewGeneration
        )
          throw Error(
            "The draft or request changed. Prepare this request again.",
          );
        prepared = value;
        preparedKey = fingerprint;
      }
      if (alive) {
        render(prepared.context);
        if (reveal)
          showRequest(prepared, "Prepared request · " + prepared.model);
      }
      return prepared;
    },
    inspect(job) {
      previewGeneration++;
      generation++;
      controller?.abort();
      prepared = null;
      records.innerHTML = writingContextMarkup(job.assetContext);
      count.textContent = "Saved request snapshot";
      showRequest(job, "Request used · " + job.model);
      root.querySelector(".writing-context").open = true;
    },
    destroy() {
      alive = false;
      generation++;
      previewGeneration++;
      controller?.abort();
      root.onclick = null;
    },
  };
}
