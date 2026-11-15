import { esc } from "../../shared/format.js";
import { icon } from "../../shared/icons.js";
import { contextSections, contextDestination } from "./context-reader.js";
import { openAssetContextDrawer } from "./context-drawer.js";

/** On-demand readers: no background requests and no navigation of the chart. */
export function mountAssetContextDock(root, asset) {
  let drawer = null;
  root.classList.add("asset-context-dock");
  root.setAttribute("aria-label", asset.symbol + " related content");
  root.innerHTML = `<span class="context-dock-label">In focus</span>${Object.entries(
    contextSections,
  )
    .map(
      ([key, label]) =>
        `<a data-context-section="${key}" aria-haspopup="dialog" href="${esc(contextDestination(asset.symbol, key))}"><span>${label}</span>${icon("arrow")}</a>`,
    )
    .join("")}`;
  root.onclick = (event) => {
    const link = event.target.closest("[data-context-section]");
    if (
      !link ||
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    drawer?.destroy();
    drawer = openAssetContextDrawer({
      asset,
      section: link.dataset.contextSection,
      onClose: () => {
        drawer = null;
      },
    });
  };
  return {
    destroy() {
      drawer?.destroy();
      drawer = null;
      root.onclick = null;
    },
  };
}
