import { request } from "../../shared/http.js";
import { createChartAutosave } from "./chart-autosave.js";

const workspaces = new Map();
let activeOwner = null,
  installed = false;
const owned = () =>
  [...workspaces.values()].filter((w) => w.owner === activeOwner);
function install() {
  if (installed) return;
  installed = true;
  const flush = () => owned().forEach(({ sync }) => void sync.flushAll());
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("online", () =>
    owned().forEach(({ sync }) => sync.resume()),
  );
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
    workspaces.set(key, {
      owner,
      sync: createChartAutosave({
        ownerId: owner,
        symbol,
        request,
        storage,
        canWrite: () => activeOwner === owner,
      }),
    });
  }
  if (workspaces.size > 40) {
    for (const [otherKey, workspace] of workspaces) {
      if (otherKey !== key && workspace.sync.canEvict())
        workspaces.delete(otherKey);
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
