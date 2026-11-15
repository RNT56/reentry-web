import { externalURL as external } from "../../shared/external-url.js";
import { esc } from "../../shared/format.js";
import { icon } from "../../shared/icons.js";
import { formatArticle } from "../../domain/article-format.js";
import { scenarioCards } from "../intelligence/shared.js";
import { avatar, chamber } from "../politics/people.js";
import { contextDestination, contextSections } from "./context-reader.js";

export const contextDate = (value) =>
  value
    ? new Date(
        typeof value === "string" && value.length === 10
          ? value + "T12:00:00Z"
          : value,
      ).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const count = (value) => Number(value || 0).toLocaleString();
const scope = (section) =>
  section === "journal"
    ? "RNT · Public"
    : section === "capitol"
      ? "Public record"
      : "Private";
const sourceLink = (s) => {
  const url = external(s.url);
  return url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.source || "Source")}${icon("arrow")}</a>`
    : `<span>${esc(s.title || "Source")}</span>`;
};
const citations = (sources) =>
  sources?.length
    ? `<details class="drawer-sources"><summary>Sources <span>${sources.length}</span>${icon("plus")}</summary><div>${sources.map(sourceLink).join("")}</div></details>`
    : "";
const back = () =>
  `<button class="drawer-back" data-drawer-list>${icon("arrowLeft")}<span>All entries</span></button>`;
export function contextLoading(detail = false) {
  return `<div class="drawer-loading" role="status" aria-label="Loading ${detail ? "entry" : "entries"}"><span class="drawer-skeleton skeleton-short"></span><span class="drawer-skeleton skeleton-title"></span>${Array.from({ length: detail ? 6 : 4 }, () => `<div class="drawer-skeleton-block"><span class="drawer-skeleton"></span><span class="drawer-skeleton skeleton-short"></span></div>`).join("")}</div>`;
}
export function contextListItems(symbol, section, items) {
  return items
    .map((entry) => {
      const id = entry.slug || entry.id;
      return `<a class="drawer-entry" href="${esc(contextDestination(symbol, section, id))}" data-drawer-entry="${esc(id)}"><span class="drawer-entry-meta">${esc(contextDate(entry.at))}${section === "journal" ? ` · Edition ${entry.revision}` : section === "scenarios" ? ` · ${entry.branches} branches` : ""}</span><h3>${esc(entry.title)}</h3>${entry.excerpt ? `<p>${esc(entry.excerpt)}</p>` : ""}<span class="drawer-entry-arrow">${icon("arrow")}</span></a>`;
    })
    .join("");
}
export function contextList(symbol, section, data) {
  return `<header class="drawer-section-heading"><span>${scope(section)}</span><h2>${contextSections[section]}<small>${count(data.count)}</small></h2></header><div data-drawer-entries>${contextListItems(symbol, section, data.items)}</div>${!data.items.length ? `<div class="drawer-empty">${icon("layers")}<h3>${section === "journal" ? "No published articles" : section === "research" ? "No completed briefs" : "No scenario trees"}</h3><a href="${esc(contextDestination(symbol, section))}" target="_blank" rel="noopener noreferrer">Open ${contextSections[section]} ${icon("arrow")}</a></div>` : ""}<button class="drawer-more" data-drawer-more ${data.nextOffset === null ? "hidden" : ""}>More entries ${icon("plus")}</button>`;
}
export function journalEntry(article) {
  const formatted = formatArticle(article.body);
  return `${back()}<article class="drawer-article"><header class="drawer-article-heading"><div>${esc(article.author)} · ${esc(contextDate(article.publishedAt))}<span>${formatted.minutes} min</span></div><h2>${esc(article.title)}</h2><span>Edition ${article.revision}</span></header><div class="journal-prose drawer-prose" data-motion-static>${formatted.html}</div>${article.scenario?.branches?.length ? `<section class="drawer-scenarios"><div class="drawer-section-heading"><h2>Scenario map</h2></div>${scenarioCards(article.scenario, false)}</section>` : ""}${citations(article.sources)}</article>`;
}
export function researchEntry(job) {
  const r = job.result;
  const sample = r.sentiment || [];
  const sentiments = ["positive", "neutral", "negative", "mixed"].map(
    (label) => ({
      label,
      count: sample.filter((s) => s.label === label).length,
    }),
  );
  return `${back()}<header class="drawer-section-heading"><span>Private · ${esc(contextDate(job.createdAt))}</span><h2>Research brief</h2></header><p class="drawer-thesis">${esc(r.summary)}</p>${sample.length ? `<div class="drawer-sentiment" aria-label="Sentiment of ${sample.length} supplied sources"><div>${sentiments.map((s) => `<i class="${s.label}" style="flex:${s.count}"></i>`).join("")}</div><span>${sentiments.map((s) => `${s.count} ${s.label}`).join(" · ")}</span></div>` : ""}<div class="drawer-claims">${(
    r.claims || []
  )
    .map(
      (claim) =>
        `<article><span>${claim.kind === "fact" ? "Reported" : "Inference"}</span><p>${esc(claim.text)}</p><div class="drawer-evidence">${(
          claim.sourceIds || []
        )
          .map((id) => job.sources?.find((s) => s.id === id))
          .filter(Boolean)
          .map(sourceLink)
          .join("")}</div></article>`,
    )
    .join(
      "",
    )}</div>${r.scenarios?.length ? `<button class="drawer-related" data-drawer-section="scenarios">${icon("layers")}<span>Explore scenario trees</span>${icon("arrow")}</button>` : ""}${citations(job.sources)}`;
}
export function scenarioEntry(set) {
  const origin =
    set.provenance?.kind === "ai-chart"
      ? "AI chart"
      : set.provenance?.kind === "ai-research"
        ? "AI research"
        : "Your tree";
  return `${back()}<header class="drawer-section-heading"><span>Private · ${origin}</span><h2>${esc(set.title)}</h2><p>${set.counts.events} verified events · ${set.counts.prices} price samples</p></header><section class="drawer-scenarios">${scenarioCards(set, false)}</section>${
    set.observations?.length
      ? `<details class="drawer-sources"><summary>Observations <span>${set.observations.length}</span>${icon("plus")}</summary><div>${set.observations
          .slice(0, 40)
          .map(
            (o) =>
              `<article><small>${esc(contextDate(o.occurredAt))} · ${o.kind === "price" ? `${esc(o.value)} ${esc(o.currency)}` : o.verified ? "Verified event" : "Unverified event"}</small>${sourceLink(o)}</article>`,
          )
          .join("")}</div></details>`
      : ""
  }`;
}
export function disclosureItems(rows) {
  const usd = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  return rows
    .map(
      (r) =>
        `<details class="drawer-filing" data-filing-id="${esc(r.id)}"><summary>${avatar(r)}<span><b>${esc(r.member)}</b><small>${esc(chamber(r.chamber))} · Filed ${esc(contextDate(r.filed))}</small></span><span class="drawer-filing-amount"><b class="${r.side === "buy" ? "buy" : r.side === "sell" ? "sell" : ""}">${r.side === "buy" ? "Buy" : r.side === "sell" ? "Sell" : r.side === "exchange" ? "Exchange" : "Other"}</b><small>${esc(r.low === null || r.low === undefined ? r.amount || "—" : usd(r.low) + (r.high === null || r.high === undefined ? "+" : "–" + usd(r.high)))}</small></span>${icon("chevron")}</summary><div class="drawer-filing-detail"><dl><div><dt>Traded</dt><dd>${esc(contextDate(r.traded))}</dd></div><div><dt>Owner</dt><dd>${esc(r.owner)}</dd></div><div><dt>Reported range · USD</dt><dd>${esc(r.amount || (r.low == null ? "—" : usd(r.low) + (r.high == null ? "+" : "–" + usd(r.high))))}</dd></div><div><dt>Transaction</dt><dd>${esc(r.type)}</dd></div></dl>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}${sourceLink({ title: "Official filing", url: r.url })}</div></details>`,
    )
    .join("");
}
export function capitolEntry(data, days) {
  const s = data.summary;
  const total = s.buys + s.sells;
  return `<header class="drawer-section-heading"><span>Public record · Filing dates</span><h2>Capitol activity</h2></header><div class="drawer-period" role="group" aria-label="Disclosure filing window">${[
    [30, "30D"],
    [90, "90D"],
    [365, "1Y"],
    [0, "All"],
  ]
    .map(
      ([d, label]) =>
        `<button data-drawer-days="${d}" aria-pressed="${days === d}">${label}</button>`,
    )
    .join(
      "",
    )}</div>${data.coverage ? `<div class="drawer-flow"><div><span><b>${count(s.buys)}</b> buy disclosures</span><span><b>${count(s.sells)}</b> sell disclosures</span></div><i role="img" aria-label="${s.buys} buy and ${s.sells} sell disclosures" style="--buy-share:${total ? (s.buys / total) * 100 : 50}%"></i><small>${count(s.people)} filers · ${count(s.count)} disclosures</small></div>` : ""}<div data-drawer-entries>${disclosureItems(data.rows)}</div>${!data.rows.length ? `<div class="drawer-empty">${icon("layers")}<h3>${data.coverage ? "No filings in this period" : "Disclosures unavailable"}</h3>${data.coverage ? "" : "<button data-drawer-retry>Retry</button>"}</div>` : ""}<button class="drawer-more" data-drawer-more ${data.nextOffset === null ? "hidden" : ""}>More disclosures ${icon("plus")}</button>`;
}
