const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const stateLabels = {
  watching: "Watching",
  triggered: "Condition verified",
  observed: "Range observed",
  invalidated: "Invalidated",
  review: "Horizon elapsed",
};
export function publicDocument({ articles, article, authorName }) {
  const title = article
    ? `${article.title} · ${authorName}`
    : `${authorName} · Reentry Journal`;
  const cards = (items) =>
    items
      .map(
        (a) =>
          `<a class="journal-public-card" href="/journal/${esc(a.slug)}"><span class="eyebrow">${esc(a.symbol)} <span> / ${new Date(a.publishedAt).toLocaleDateString("en-GB")}</span></span><h2>${esc(a.title)}</h2><p>${esc(a.excerpt)}</p><span class="link">Read thesis ↗</span></a>`,
      )
      .join("");
  const branch = (b) =>
    `<section class="scenario-node"><span class="node-status">${esc(stateLabels[b.status.status])}</span><h3>${esc(b.title)}</h3><div class="node-range">${esc(b.low)}<span>–</span>${esc(b.high)} <small>${esc(b.currency)}</small></div><p>${esc(b.condition)}</p><div class="small">${b.horizonDays} days · conditional range</div>${b.passage ? `<blockquote>${esc(b.passage)}</blockquote>` : ""}<details><summary>Evidence & invalidation</summary><p>${esc(b.invalidation)}</p>${
      article.scenario.observations
        .filter((o) => b.status.evidence.includes(o.id))
        .map(
          (o) =>
            `<p><a href="${esc(o.url)}" rel="noopener noreferrer" target="_blank">${esc(o.source)}</a><br><small>${new Date(o.occurredAt).toISOString().slice(0, 16)} UTC · ${o.kind === "price" ? esc(o.value) + " " + esc(o.currency) : "Author-verified event"}</small></p>`,
        )
        .join("") || "<p>No qualifying evidence yet.</p>"
    }</details></section>`;
  const content = article
    ? `<a class="link" href="/journal">← All writing</a><article class="public-reading"><div class="journal-byline"><span class="concept-tag">${esc(article.author)} / ${esc(article.symbol)}</span><span>${new Date(article.publishedAt).toLocaleDateString("en-GB")} · Edition ${article.revision}</span></div><h1>${esc(article.title)}</h1><div class="article-body">${article.body
        .split(/\n\s*\n/)
        .map((p) => `<p>${esc(p).replaceAll("\n", "<br>")}</p>`)
        .join(
          "",
        )}</div>${article.scenario.branches.length ? `<div class="section-line"><h2>The scenario map</h2><span class="small">Conditions → possible outcomes</span></div><div class="scenario-branches ${article.scenario.branches.length > 3 ? "many-branches" : ""}" style="--branches:${Math.min(3, article.scenario.branches.length)}">${article.scenario.branches.map(branch).join("")}</div><p class="small">Price samples are observed periodically and may miss intraday touches. Events are verified by the author. A price touch does not establish causality.</p>` : ""}${article.sources.length ? `<details class="public-sources"><summary>Sources · ${article.sources.length}</summary>${article.sources.map((s) => `<p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a></p>`).join("")}</details>` : ""}<nav class="edition-nav" aria-label="Published editions">${article.editions.map((e) => `<a href="/journal/${esc(article.slug)}?v=${e.revision}" ${e.revision === article.revision ? 'aria-current="page"' : ""}>Edition ${e.revision}</a>`).join("")}</nav></article>`
    : `<section class="public-heading"><span class="eyebrow">THE PUBLIC JOURNAL / ${esc(authorName)}</span><h1>Conviction.<br><em>With a record.</em></h1><p>Ideas, conditions, and what happened next.</p></section><div class="public-articles">${cards(articles) || '<div class="research-empty"><span class="orbit-mark">↗</span><h2>The first thesis is ahead.</h2><p>Published writing and its scenario maps will appear here.</p></div>'}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(title)}</title><meta name="description" content="${esc(article?.body.slice(0, 160) || "RNT’s public research journal and observable asset scenarios.")}"/><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css"></head><body><div class="shell public-shell"><header class="app-header"><a class="brand" href="/journal"><span>↗ reentry</span></a><span class="small">JOURNAL / ${esc(authorName)}</span><a class="secondary small-button" href="/">Your workspace ↗</a></header><main>${content}<footer class="foot"><span>${esc(authorName)} · Reentry</span><span>Public thinking. Private workspaces.</span></footer></main></div></body></html>`;
}
