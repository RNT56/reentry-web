import {
  defaultChartWorkspaceState,
  validateChartWorkspaceState,
  chartIndicatorIds,
} from "./chart-workspace.js";

export const chartStateVersion = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const equal = (a, b) => chartStateVersion(a) === chartStateVersion(b);

/** Merge independent intentions only. Ambiguous edits never choose a winner. */
export function mergeChartStates(base, local, remote, slot = 1) {
  const conflicts = [];
  const b = base || defaultChartWorkspaceState("Analysis " + slot);
  if (equal(local, b)) return { state: remote, conflicts };
  if (remote === null) return { state: local, conflicts: ["Cleared analysis"] };
  const pick = (before, mine, theirs, label) => {
    if (equal(mine, before)) return theirs;
    if (equal(theirs, before) || equal(mine, theirs)) return mine;
    conflicts.push(label);
    return mine;
  };
  const state = { ...remote };
  for (const [key, label] of [
    ["name", "Name"],
    ["scale", "Price scale"],
    ["chartType", "Chart style"],
  ])
    state[key] = pick(b[key], local[key], remote[key], label);
  const window = (s) => ({ range: s.range, viewport: s.viewport });
  Object.assign(
    state,
    pick(window(b), window(local), window(remote), "Time window"),
  );
  state.indicators = chartIndicatorIds.filter((id) =>
    pick(
      b.indicators.includes(id),
      local.indicators.includes(id),
      remote.indicators.includes(id),
      "Indicators",
    ),
  );
  if (local.currency !== b.currency || remote.currency !== b.currency) {
    const prices = (s) => ({ currency: s.currency, drawings: s.drawings });
    Object.assign(
      state,
      pick(prices(b), prices(local), prices(remote), "Currency / drawings"),
    );
  } else {
    const map = (s) => new Map(s.drawings.map((d) => [d.id, d]));
    const before = map(b),
      mine = map(local),
      theirs = map(remote);
    state.drawings = [];
    for (const id of new Set([...theirs.keys(), ...mine.keys()])) {
      const a = before.get(id),
        l = mine.get(id),
        r = theirs.get(id);
      const label = l?.text || r?.text || l?.type || r?.type || "Drawing";
      let merged;
      if (!a || !l || !r) merged = pick(a, l, r, label);
      else {
        merged = { id };
        for (const key of ["type", "anchors", "text", "color"]) {
          const value = pick(a[key], l[key], r[key], label);
          if (value !== undefined) merged[key] = value;
        }
      }
      if (merged) state.drawings.push(merged);
    }
  }
  if (!conflicts.length) {
    try {
      return { state: validateChartWorkspaceState(state), conflicts };
    } catch {
      conflicts.push("Drawing limit");
    }
  }
  return { state: local, conflicts: [...new Set(conflicts)] };
}
