import { request } from "../../shared/http.js";
import { createChartAutosave } from "./chart-autosave.js";
import { createChartWatch } from "./chart-watch.js";

const workspaces = new Map();
let activeOwner = null,
  installed = false;
const owned = () =>
  [...workspaces.values()].filter((w) => w.owner === activeOwner);
function updateWatches() {
  for (const w of workspaces.values()) {
    if (
      w.owner === activeOwner &&
      w.subscribers &&
      document.visibilityState !== "hidden" &&
      navigator.onLine !== false
    )
      w.watch.start();
    else w.watch.stop();
  }
}
function install() {
  if (installed) return;
  installed = true;
  const flush = () => owned().forEach(({ sync }) => void sync.flushAll());
  window.addEventListener("pagehide", () => {
    flush();
    owned().forEach(({ watch }) => watch.stop());
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    updateWatches();
  });
  window.addEventListener("online", () => {
    owned().forEach(({ sync }) => sync.resume());
    updateWatches();
  });
  window.addEventListener("offline", () => {
    owned().forEach(({ sync }) => sync.connection("reconnecting"));
    updateWatches();
  });
  window.addEventListener("focus", updateWatches);
  window.addEventListener("pageshow", updateWatches);
  window.addEventListener("beforeunload", (event) => {
    flush();
    if (owned().some(({ sync }) => sync.needsUnloadWarning())) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}
export function setChartWorkspaceOwner(owner) {
  activeOwner = owner == null ? null : String(owner);
  for (const workspace of workspaces.values()) {
    if (workspace.owner === activeOwner) workspace.sync.resume();
    else workspace.sync.pause();
  }
  if (installed) updateWatches();
}
export function chartWorkspaceSync(ownerId, symbol) {
  install();
  const owner = String(ownerId),
    key = JSON.stringify([owner, symbol]);
  if (!workspaces.has(key)) {
    let storage;
    try {
      storage = window.sessionStorage;
    } catch {
      /* Unload guard covers unavailable storage. */
    }
    const workspace = { owner, subscribers: 0 };
    workspace.sync = createChartAutosave({
      ownerId: owner,
      symbol,
      request,
      storage,
      canWrite: () => activeOwner === owner,
      onSubscribers: (count) => {
        workspace.subscribers = count;
        updateWatches();
      },
    });
    workspace.watch = createChartWatch({
      sync: workspace.sync,
      request,
      ownerId: owner,
      symbol,
    });
    workspaces.set(key, workspace);
  }
  if (workspaces.size > 40) {
    for (const [otherKey, workspace] of workspaces) {
      if (otherKey !== key && workspace.sync.canEvict()) {
        workspace.watch.stop();
        workspaces.delete(otherKey);
      }
      if (workspaces.size <= 40) break;
    }
  }
  return workspaces.get(key).sync;
}
export async function flushChartAutosaves(ownerId) {
  const owner = String(ownerId);
  for (const workspace of workspaces.values()) {
    if (workspace.owner === owner && !(await workspace.sync.flushAll()))
      throw Error(
        "Chart changes are not synced. Retry or resolve them before signing out.",
      );
  }
}
