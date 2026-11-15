import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { icon } from "../../shared/ui.js";

export function openArticlePreview(getDraft) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "studio-preview-dialog";
  dialog.setAttribute("aria-labelledby", "studio-preview-title");
  dialog.innerHTML = `<header class="studio-preview-header"><div><span class="eyebrow">PRIVATE PREVIEW</span><h2 id="studio-preview-title">Your finished article.</h2><span>Includes your current unsaved text.</span></div><div class="studio-preview-controls" role="group" aria-label="Preview width"><button type="button" data-preview-width="desktop" aria-pressed="true">Desktop</button><button type="button" data-preview-width="mobile" aria-pressed="false">Mobile</button><button type="button" data-preview-refresh>Refresh</button><button type="button" data-preview-close aria-label="Close article preview">${icon("close")}</button></div></header><div class="studio-preview-notice" role="status">Preparing preview…</div><div class="studio-preview-stage"><iframe title="Finished draft article preview" sandbox="allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer"></iframe></div>`;
  document.body.append(dialog);
  const frame = dialog.querySelector("iframe"),
    notice = dialog.querySelector(".studio-preview-notice");
  let version = 0,
    alive = true;
  async function refresh() {
    const current = ++version,
      data = getDraft();
    notice.hidden = false;
    notice.textContent = "Preparing preview…";
    try {
      const result = await request(
        `/api/journal/${data.id}/preview`,
        "POST",
        data,
      );
      if (!alive || current !== version) return;
      frame.srcdoc = result.html;
      notice.innerHTML = (result.warnings || []).map(esc).join(" ");
      notice.hidden = !result.warnings?.length;
    } catch (error) {
      if (alive && current === version) notice.textContent = error.message;
    }
  }
  dialog.onclick = (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-preview-close")) dialog.close();
    if (b.hasAttribute("data-preview-refresh")) refresh();
    if (b.dataset.previewWidth) {
      dialog.dataset.width = b.dataset.previewWidth;
      dialog
        .querySelectorAll("[data-preview-width]")
        .forEach((button) =>
          button.setAttribute("aria-pressed", String(button === b)),
        );
    }
  };
  dialog.addEventListener(
    "close",
    () => {
      alive = false;
      version++;
      dialog.remove();
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    },
    { once: true },
  );
  dialog.showModal();
  refresh();
  return {
    close() {
      if (alive) dialog.close();
    },
  };
}
