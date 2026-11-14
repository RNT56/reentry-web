export const navigation = Object.freeze([
  { id: "portfolio", label: "Portfolio" },
  { id: "activity", label: "Buybacks" },
  { id: "explore", label: "Research" },
  { id: "markets", label: "Markets" },
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
