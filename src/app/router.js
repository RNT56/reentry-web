export const navigation = Object.freeze([
  { id: "portfolio", label: "Portfolio" },
  { id: "activity", label: "Buybacks" },
  { id: "explore", label: "Research" },
  { id: "markets", label: "Markets" },
  { id: "politics", label: "Capitol" },
]);
export function parseRoute(hash) {
  const [path, query] = hash.replace(/^#\/?/, "").split("?");
  return {
    page:
      path === "settings" || navigation.some((n) => n.id === path)
        ? path
        : "portfolio",
    selected: new URLSearchParams(query).get("asset"),
  };
}
export function routeURL(page, selected) {
  const valid =
    page === "settings" || navigation.some((n) => n.id === page)
      ? page
      : "portfolio";
  return `#/${valid}${valid === "portfolio" && selected ? "?" + new URLSearchParams({ asset: selected }) : ""}`;
}

export function assetRoute(page, symbol, { tab, job, scenario } = {}) {
  const params = new URLSearchParams({ symbol });
  if (tab) params.set("tab", tab);
  if (job) params.set("job", job);
  if (scenario) params.set("scenario", scenario);
  return `${routeURL(page)}?${params}`;
}

/** Asset context is separate from the portfolio's holding ID. */
export function applyAssetRoute(model, hash) {
  const { page } = parseRoute(hash);
  const params = new URLSearchParams(hash.split("?")[1]);
  const symbol = (params.get("symbol") || "").trim().toUpperCase();
  if (!symbol || symbol.length > 40 || !/^[A-Z0-9.^=:_/-]+$/.test(symbol))
    return;
  if (page === "explore") {
    const tab = params.get("tab");
    model.intelligence = {
      ...model.intelligence,
      symbol,
      entrySymbol: symbol,
      entryPending: true,
      watchlistId: null,
      tab: ["research", "scenarios", "strategies", "journal"].includes(tab)
        ? tab
        : "research",
      jobId: params.get("job"),
      focusSetId: params.get("scenario"),
      aiJobId: null,
      aiEventKey: null,
      monitorJobId: null,
      monitorChange: null,
    };
  } else if (page === "politics") {
    model.politics = {
      days: 90,
      chamber: "all",
      side: "all",
      scope: "all",
      q: "",
      member: "",
      ticker: symbol,
    };
  }
}
