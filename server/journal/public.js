import {
  formatArticle,
  articlePassageAnchor,
} from "../../src/domain/article-format.js";
import { brandMark } from "../../src/shared/brand.js";
import { icon } from "../../src/shared/icons.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (value) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const external = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password
      ? esc(u.href)
      : "#";
  } catch {
    return "#";
  }
};
export const stateLabels = {
  watching: "Watching",
  triggered: "Condition verified",
  observed: "Range observed",
  invalidated: "Invalidated",
  review: "Horizon elapsed",
};
const mark = (symbol) =>
  `<span class="journal-asset"><img src="https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png&amp;size=128" alt="" loading="lazy"><span>${esc(symbol)}</span></span>`;
export function publicDocument({
  articles = [],
  article,
  authorName,
  preview = false,
}) {
  const title = article
    ? `${article.title} · ${authorName}`
    : `${authorName} · Reentry Journal`;
  const cards = (items) =>
    items
      .map(
        (a, i) =>
          `<a class="journal-entry-row" href="/journal/${esc(a.slug)}"><span class="journal-entry-number">${String(i + 1).padStart(2, "0")}</span><div class="journal-entry-copy"><div class="journal-entry-meta">${mark(a.symbol)}<time>${date(a.publishedAt)}</time></div><h2>${esc(a.title)}</h2><p>${esc(a.excerpt)}</p></div><span class="journal-entry-arrow" aria-hidden="true">${icon("arrow")}</span></a>`,
      )
      .join("");
  let content;
  if (article) {
    const formatted = formatArticle(article.body);
    const sections = formatted.sections.map((s) => ({ ...s, label: s.text }));
    const passageId = (passage) =>
      articlePassageAnchor(article.body, passage, formatted);
    const minutes = formatted.minutes;
    const branch = (b, i) =>
      `<section class="journal-scenario" id="scenario-${i + 1}"><div class="journal-scenario-top"><span>${String(i + 1).padStart(2, "0")}</span><span class="state-${esc(b.status.status)}">${esc(stateLabels[b.status.status])}</span></div><h3>${esc(b.title)}</h3><div class="journal-scenario-range">${Number(b.low).toLocaleString("en-GB")}<span>–</span>${Number(b.high).toLocaleString("en-GB")}<small>${esc(b.currency)}</small></div><p>${esc(b.condition)}</p><div class="journal-scenario-horizon">${b.horizonDays}d</div>${b.passage && passageId(b.passage) ? `<a class="journal-passage-link" href="#${passageId(b.passage)}"><blockquote>${esc(b.passage)}</blockquote><span>${icon("arrowUpLeft")} Passage</span></a>` : ""}<details><summary>Evidence</summary><div class="journal-invalidation"><span>Invalidation</span><p>${esc(b.invalidation)}</p></div>${
        article.scenario.observations
          .filter((o) => b.status.evidence.includes(o.id))
          .map(
            (o) =>
              `<a class="journal-evidence" href="${external(o.url)}" rel="noopener noreferrer" target="_blank"><span>${esc(o.source)}</span><time>${date(o.occurredAt)}</time><b>${o.kind === "price" ? esc(o.value) + " " + esc(o.currency) : "Verified event"} ${icon("arrow")}</b></a>`,
          )
          .join("") ||
        '<span class="journal-evidence-empty">0 observations</span>'
      }</details></section>`;
    const toc = sections;
    content = `<div class="journal-reading-tools" role="group" aria-label="Reading controls"><a class="journal-back" href="/journal">${icon("arrowLeft")} Journal</a><span class="journal-reading-title" data-reading-title aria-hidden="true">${esc(article.title)}</span><div><button type="button" data-reading-focus aria-pressed="false" aria-label="Enable focused reading">Focus</button>${preview ? "" : `<button type="button" data-reading-share aria-label="Share article">Share ${icon("arrow")}</button>`}<button type="button" data-reading-motion aria-pressed="false" title="Reduce reading animations">Reduce motion</button></div></div><article class="journal-story"><header class="journal-story-head"><div class="journal-story-meta">${mark(article.symbol)}<span>${esc(article.author)}</span><time>${date(article.publishedAt)}</time><span>${minutes} min</span></div><h1>${esc(article.title)}</h1><div class="journal-story-rule"><span>${preview ? "Private draft preview" : "Edition " + article.revision}</span><span>${article.scenario.branches.length ? `${article.scenario.branches.length} scenario${article.scenario.branches.length === 1 ? "" : "s"}` : ""}</span></div></header><div class="journal-reading-layout"><nav class="journal-reading-rail" aria-label="Article sections">${toc.map((s) => `<a href="#${s.id}">${esc(s.label)}</a>`).join("")}${article.scenario.branches.length ? `<a href="#scenario-map">Scenario map ${icon("arrowDownRight")}</a>` : ""}${article.sources.length ? `<a href="#article-sources">Sources ${icon("arrowDownRight")}</a>` : ""}</nav><div class="journal-prose" data-motion-static id="article-prose" tabindex="-1">${formatted.html}</div></div>${article.scenario.branches.length ? `<section class="journal-map" id="scenario-map"><div class="journal-section-heading"><h2>The scenario map</h2><span>${article.scenario.branches.length.toString().padStart(2, "0")}</span></div><div class="journal-scenarios">${article.scenario.branches.map(branch).join("")}</div></section>` : ""}${article.sources.length ? `<section class="journal-source-list" id="article-sources"><div class="journal-section-heading"><h2>Sources</h2><span>${article.sources.length.toString().padStart(2, "0")}</span></div>${article.sources.map((s, i) => `<a href="${external(s.url)}" target="_blank" rel="noopener noreferrer"><span>${String(i + 1).padStart(2, "0")}</span><b>${esc(s.title)}</b><span>${icon("arrow")}</span></a>`).join("")}</section>` : ""}${preview ? "" : `<nav class="journal-editions" aria-label="Published editions"><span>Editions</span>${article.editions.map((e) => `<a href="/journal/${esc(article.slug)}?v=${e.revision}" ${e.revision === article.revision ? 'aria-current="page"' : ""}>${String(e.revision).padStart(2, "0")}<time>${date(e.published_at)}</time></a>`).join("")}</nav>`}<a class="journal-return" href="/journal"><span>More from ${esc(authorName)}</span><b>Back to the journal ${icon("arrow")}</b></a></article>`;
  } else {
    content = `<section class="journal-cover"><div class="journal-cover-meta"><span>THE PUBLIC JOURNAL / ${esc(authorName)}</span><span>${String(articles.length).padStart(2, "0")} essays</span></div><h1>Independent<br><em>conviction.</em></h1><div class="journal-cover-signature"><span>${esc(authorName)}</span><span>Research & perspectives</span></div></section><div class="journal-index">${cards(articles) || '<div class="journal-index-empty"><span>01</span><h2>Coming next.</h2></div>'}</div>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark">${preview ? '<meta name="robots" content="noindex,nofollow,noarchive">' : ""}<title>${esc(title)}</title><meta name="description" content="${esc((article ? formatArticle(article.body).plainText.slice(0, 160) : "") || `${authorName} · Research & perspectives`)}"><meta property="og:title" content="${esc(title)}"><meta property="og:type" content="${article ? "article" : "website"}"><link rel="icon" href="/favicon.svg?v=wave"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="preload" href="/fonts/geist.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/geist-mono.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/manrope.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/style.css"><script type="module" src="/journal.js"></script></head><body class="journal-experience${preview ? " journal-preview" : ""}">${article ? '<a class="journal-skip" href="#article-prose">Skip to article</a>' : ""}<div class="journal-progress" aria-hidden="true"></div><div class="shell journal-shell"><header class="journal-masthead"><a class="brand" href="/journal">${brandMark()}reentry<span> / ${esc(authorName)}</span></a><a href="/">Workspace ${icon("arrow")}</a></header><main>${content}<footer class="journal-footer"><a href="/journal">${esc(authorName)} · Reentry</a><a href="#">${icon("arrowUp")} Top</a></footer></main></div><span class="sr-only" role="status" id="journal-announcement"></span></body></html>`;
}
