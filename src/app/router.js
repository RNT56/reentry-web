export const navigation = Object.freeze([
  { id: "portfolio", label: "Portfolio" },
  { id: "activity", label: "Buybacks" },
  { id: "explore", label: "Research" },
  { id: "settings", label: "Settings" },
]);
export function parseRoute(hash) {
  const [path, query] = hash.replace(/^#\/?/, "").split("?");
  return {
    page: navigation.some((n) => n.id === path) ? path : "portfolio",
    selected: new URLSearchParams(query).get("asset"),
  };
}
export function routeURL(page, selected) {
  const valid = navigation.some((n) => n.id === page) ? page : "portfolio";
  return `#/${valid}${valid === "portfolio" && selected ? "?" + new URLSearchParams({ asset: selected }) : ""}`;
}
