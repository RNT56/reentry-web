import { request } from "../../shared/http.js";
import { assetRoute } from "../../app/router.js";

export const contextSections = Object.freeze({
  journal: "Journal",
  research: "Research",
  scenarios: "Scenarios",
  capitol: "Capitol",
});
export function contextDestination(symbol, section, entry = "") {
  if (section === "journal")
    return entry
      ? `/journal/${encodeURIComponent(entry)}`
      : `/journal?symbol=${encodeURIComponent(symbol)}`;
  return assetRoute(section === "capitol" ? "politics" : "explore", symbol, {
    ...(section === "scenarios"
      ? { tab: "scenarios", ...(entry ? { scenario: entry } : {}) }
      : {}),
    ...(section === "research" && entry ? { job: entry } : {}),
  });
}

/** Each navigation owns its request. Late results cannot replace a newer tab or asset. */
export function createContextReader(symbol, { read = request } = {}) {
  let controller,
    generation = 0,
    destroyed = false;
  return {
    async load({ section, entry = "", days = 90, offset = 0, version } = {}) {
      if (destroyed) return null;
      if (!Object.hasOwn(contextSections, section))
        throw Error("Unknown context section.");
      const epoch = ++generation;
      controller?.abort();
      controller = new AbortController();
      const options = { signal: controller.signal };
      let path;
      if (section === "capitol") {
        const params = new URLSearchParams({
          ticker: symbol,
          days: String(days),
          offset: String(offset),
        });
        if (version) params.set("version", version);
        path = "/api/politics?" + params;
      } else if (!entry)
        path =
          `/api/asset-context/${section}?` +
          new URLSearchParams({ symbol, offset: String(offset) });
      else
        path =
          (section === "journal"
            ? "/api/public/journal/"
            : section === "research"
              ? "/api/research/jobs/"
              : "/api/scenarios/") + encodeURIComponent(entry);
      try {
        const data = await read(path, "GET", undefined, options);
        if (destroyed || generation !== epoch) return null;
        if (
          section !== "capitol" &&
          data.symbol !== symbol &&
          !(
            section === "journal" &&
            data.assets?.some((asset) => asset.symbol === symbol)
          )
        )
          throw Error("This entry belongs to another asset.");
        if (
          section === "capitol" &&
          data.rows.some((row) => row.ticker !== symbol)
        )
          throw Error("These disclosures belong to another asset.");
        if (
          section === "research" &&
          entry &&
          (data.kind !== "research" || data.status !== "completed")
        )
          throw Error("This brief is unavailable.");
        return data;
      } catch (error) {
        if (destroyed || generation !== epoch || options.signal.aborted)
          return null;
        throw error;
      }
    },
    cancel() {
      generation++;
      controller?.abort();
    },
    destroy() {
      destroyed = true;
      generation++;
      controller?.abort();
    },
  };
}

export function contextEntryFromURL(href, section, base) {
  const url = new URL(href, base);
  if (section === "journal")
    return decodeURIComponent(url.pathname.split("/")[2] || "");
  const query = new URLSearchParams(url.hash.split("?")[1] || url.search);
  return section === "research"
    ? query.get("job") || ""
    : section === "scenarios"
      ? query.get("scenario") || ""
      : "";
}
