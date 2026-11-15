import {
  defaultChartWorkspaceState,
  validateChartWorkspaceState,
} from "./chart-workspace.js";
import { chartStateVersion } from "./chart-merge.js";

export const chartViewSurfaces = [
  "price",
  "strategies",
  "structure",
  "buyback",
];
export function defaultChartViewState(surface = "price") {
  return {
    ...defaultChartWorkspaceState("Chart view"),
    range: surface === "price" ? "1mo" : "5y",
    indicators: [],
    priceCurrency: "EUR",
  };
}
export function validateChartViewState(input, surface = "price") {
  const numeric = surface === "buyback";
  const state = validateChartWorkspaceState({
    ...input,
    name: "Chart view",
    indicators: [],
    drawings: [],
    ...(numeric ? { viewport: null } : {}),
  });
  const priceCurrency = input.priceCurrency ?? input.currency;
  if (typeof priceCurrency !== "string" || !/^[A-Z]{3,6}$/.test(priceCurrency))
    throw Object.assign(Error("Invalid chart price currency."), {
      statusCode: 400,
    });
  state.priceCurrency = priceCurrency;
  if (numeric && input.viewport != null) {
    const { from, to } = input.viewport;
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from >= to ||
      from < -1e6 ||
      to > 1e6
    )
      throw Object.assign(Error("Invalid chart view."), { statusCode: 400 });
    state.viewport = { from, to };
  }
  return state;
}
export function mergeChartViews(base, local, remote, surface = "price") {
  const before = base || defaultChartViewState(surface);
  const equal = (a, b) => chartStateVersion(a) === chartStateVersion(b);
  if (equal(local, before)) return { state: remote, conflicts: [] };
  if (!remote) return { state: local, conflicts: ["View reset"] };
  const state = { ...remote },
    conflicts = [];
  for (const [keys, label] of [
    [["range", "viewport"], "Time view"],
    [["currency", "priceCurrency", "scale", "priceRange"], "Price view"],
    [["chartType"], "Chart style"],
  ]) {
    const pick = (value) => Object.fromEntries(keys.map((k) => [k, value[k]]));
    const b = pick(before),
      l = pick(local),
      r = pick(remote);
    const selected = equal(l, b) ? r : equal(r, b) || equal(l, r) ? l : null;
    if (selected) Object.assign(state, selected);
    else conflicts.push(label);
  }
  return {
    state: conflicts.length ? local : validateChartViewState(state, surface),
    conflicts,
  };
}
