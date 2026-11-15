import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { icon } from "../../shared/icons.js";
import { assetRoute } from "../../app/router.js";

const date = (value) =>
  value
    ? new Date(
        typeof value === "string" ? value + "T12:00:00Z" : value,
      ).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
const number = (value) => Number(value || 0).toLocaleString();
const item = (href, title, meta) =>
  `<a class="asset-context-entry" href="${esc(href)}"><span>${esc(title)}</span><small>${esc(meta)}</small></a>`;

export function mountAssetContext(root, { symbol }) {
  const aborter = new AbortController();
  let alive = true,
    context = null,
    capitol = null,
    contextError = false,
    capitolError = false;
  const hrefs = {
    journal: `/journal?symbol=${encodeURIComponent(symbol)}`,
    research: assetRoute("explore", symbol),
    scenarios: assetRoute("explore", symbol, { tab: "scenarios" }),
    capitol: assetRoute("politics", symbol),
  };
  root.classList.add("asset-context");
  root.setAttribute("aria-label", symbol + " context");
  root.innerHTML = `<div class="asset-context-heading"><h2>In focus</h2><span>${esc(symbol)}</span></div><div class="asset-context-grid">${[
    ["journal", "Journal", "RNT · Public"],
    ["research", "Research", "Private"],
    ["scenarios", "Scenarios", "Private"],
    ["capitol", "Capitol", "Filed · 90 days"],
  ]
    .map(
      ([key, label, scope]) =>
        `<section class="asset-context-card" data-context="${key}"><a class="asset-context-link" href="${esc(hrefs[key])}"><h3>${label}</h3><span data-context-count aria-label="Loading">—</span>${icon("arrow")}</a><span class="asset-context-scope">${scope}</span><div class="asset-context-preview" aria-busy="true"><span class="asset-context-skeleton" aria-label="Loading ${label}"></span></div></section>`,
    )
    .join("")}</div>`;
  function paint(key, data, error, markup) {
    if (!alive || !root.isConnected) return;
    const card = root.querySelector(`[data-context="${key}"]`);
    const count = card.querySelector("[data-context-count]");
    count.textContent = data && !error ? number(data.count) : "—";
    count.removeAttribute("aria-label");
    const preview = card.querySelector(".asset-context-preview");
    preview.setAttribute("aria-busy", "false");
    preview.innerHTML = error
      ? `<button class="asset-context-retry" data-context-retry="${key === "capitol" ? "capitol" : "context"}">Unavailable · Retry ${icon("refresh")}</button>`
      : markup ||
        `<a class="asset-context-empty" href="${esc(hrefs[key])}">${key === "journal" ? "No published articles" : key === "research" ? "Open research" : key === "scenarios" ? "Open scenario trees" : "No filings in 90 days"}${icon("arrow")}</a>`;
  }
  function paintContext() {
    for (const key of ["journal", "research", "scenarios"]) {
      const data = context?.[key];
      paint(
        key,
        data,
        contextError,
        data?.items
          .slice(0, 1)
          .map((entry) => {
            if (key === "journal")
              return item(
                `/journal/${encodeURIComponent(entry.slug)}`,
                entry.title,
                `${entry.author} · ${date(entry.at)}`,
              );
            if (key === "research")
              return item(
                assetRoute("explore", symbol, { job: entry.id }),
                entry.title,
                date(entry.at),
              );
            return item(
              assetRoute("explore", symbol, {
                tab: "scenarios",
                scenario: entry.id,
              }),
              entry.title,
              `${entry.branches} scenario${entry.branches === 1 ? "" : "s"} · ${date(entry.at)}`,
            );
          })
          .join(""),
      );
    }
  }
  function paintCapitol() {
    const data = capitol?.summary;
    const rows = capitol?.rows || [];
    const markup = data?.count
      ? `<a href="${esc(hrefs.capitol)}" class="asset-context-flow"><span><b>${number(data.buys)}</b> buys</span><span><b>${number(data.sells)}</b> sells</span><i style="--buy-share:${data.buys + data.sells ? (data.buys / (data.buys + data.sells)) * 100 : 50}%"></i></a>${rows
          .slice(0, 1)
          .map((r) =>
            item(
              hrefs.capitol,
              `${r.member} · ${r.side === "buy" ? "Purchase" : r.side === "sell" ? "Sale" : "Exchange"}`,
              `Filed ${date(r.filed)} · ${number(data.people)} filer${data.people === 1 ? "" : "s"}`,
            ),
          )
          .join("")}`
      : "";
    paint("capitol", data, capitolError, markup);
  }
  async function loadContext() {
    contextError = false;
    try {
      context = await request(
        "/api/asset-context?" + new URLSearchParams({ symbol }),
        "GET",
        undefined,
        { signal: aborter.signal },
      );
    } catch {
      contextError = true;
    }
    paintContext();
  }
  async function loadCapitol() {
    capitolError = false;
    try {
      capitol = await request(
        "/api/politics?" + new URLSearchParams({ ticker: symbol, days: "90" }),
        "GET",
        undefined,
        { signal: aborter.signal },
      );
      // An unavailable feed is not evidence of zero disclosures.
      capitolError =
        capitol.status === "unavailable" ||
        (!capitol.fetchedAt && !capitol.summary?.count);
    } catch {
      capitolError = true;
    }
    paintCapitol();
  }
  root.onclick = (event) => {
    const retry = event.target.closest("[data-context-retry]");
    if (!retry || retry.disabled) return;
    retry.disabled = true;
    void (retry.dataset.contextRetry === "capitol"
      ? loadCapitol()
      : loadContext());
  };
  void loadContext();
  void loadCapitol();
  return {
    destroy() {
      alive = false;
      aborter.abort();
      root.onclick = null;
    },
  };
}
