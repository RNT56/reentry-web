import { createHash } from "node:crypto";
import { publishedAssetFilter } from "../journal/assets.js";

const parse = (value, fallback = {}) => {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
};
const clip = (value, limit) => String(value ?? "").slice(0, limit);
const url = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.href.length <= 2000
      ? u.href
      : null;
  } catch {
    return null;
  }
};
const content = (value) =>
  typeof value === "string" ? value : JSON.stringify(value);
const categories = [
  "notes",
  "sources",
  "research",
  "scenarios",
  "charts",
  "articles",
  "disclosures",
];
const labels = {
  notes: "Author notes",
  sources: "Stored sources",
  research: "AI research and analysis",
  scenarios: "Scenario maps and observations",
  charts: "Saved chart analyses",
  articles: "Related articles",
  disclosures: "Public disclosures",
};

/** Read existing knowledge only. Every private query is scoped to the author and exact listing. */
export function collectWritingContext(db, owner, article) {
  const assetList = article.assets || [
    { symbol: article.symbol, name: article.symbol },
  ];
  const feed = db
    .prepare("SELECT payload,fetched_at FROM political_feed WHERE id='kadoa'")
    .get();
  const rawPoliticalRows = feed ? parse(feed.payload).rows : [];
  const politicalRows = Array.isArray(rawPoliticalRows) ? rawPoliticalRows : [];
  let remaining = 36000;
  const assets = assetList.map((asset, index) => {
    const primary = index === 0,
      s = asset.symbol;
    const groups = Object.fromEntries(
      categories.map((kind) => [
        kind,
        { label: labels[kind], available: 0, items: [] },
      ]),
    );
    const params = [owner, s];
    const sourceRows = [
      ...db
        .prepare(
          "SELECT id,kind,title,url,content,published_at,fetched_at,connector FROM research_sources WHERE user_id=? AND symbol=? AND connector='manual' ORDER BY fetched_at DESC,id LIMIT 8",
        )
        .all(...params),
      ...db
        .prepare(
          "SELECT id,kind,title,url,content,published_at,fetched_at,connector FROM research_sources WHERE user_id=? AND symbol=? AND connector!='manual' ORDER BY fetched_at DESC,id LIMIT 100",
        )
        .all(...params),
    ];
    for (const row of sourceRows) {
      const kind = row.connector === "manual" ? "notes" : "sources";
      groups[kind].items.push({
        id: "source:" + row.id,
        title: row.title,
        kind: row.kind,
        provenance: row.connector,
        url: url(row.url),
        publishedAt: row.published_at,
        updatedAt: row.fetched_at,
        epistemic:
          kind === "notes"
            ? "author note"
            : row.kind === "headline"
              ? "headline metadata, not full article text"
              : "stored source material",
        content: row.content,
      });
    }
    for (const group of ["notes", "sources"])
      groups[group].available = db
        .prepare(
          `SELECT COUNT(*) n FROM research_sources WHERE user_id=? AND symbol=? AND connector${group === "notes" ? "=" : "!="}'manual'`,
        )
        .get(...params).n;
    groups.sources.items.sort(
      (a, b) =>
        ([
          "fundamentals",
          "filing",
          "quote",
          "technical",
          "macro",
          "headline",
          "coverage",
        ].indexOf(a.kind) + 1 || 9) -
        ([
          "fundamentals",
          "filing",
          "quote",
          "technical",
          "macro",
          "headline",
          "coverage",
        ].indexOf(b.kind) + 1 || 9),
    );
    const jobsFrom =
      "FROM ai_jobs WHERE user_id=? AND symbol=? AND kind IN ('research','chart-analysis','source-monitor') AND status='completed'";
    groups.research.available = db
      .prepare("SELECT COUNT(*) n " + jobsFrom)
      .get(...params).n;
    for (const row of db
      .prepare(
        "SELECT id,kind,result,input,finished_at,created_at " +
          jobsFrom +
          " ORDER BY created_at DESC,id LIMIT 4",
      )
      .all(...params)) {
      const result = parse(row.result),
        input = parse(row.input);
      const references = (input.sources || []).slice(0, 12).map((r) => ({
        id: r.id,
        title: r.title,
        url: url(r.url),
        kind: r.kind,
        publishedAt: r.publishedAt,
        fetchedAt: r.fetchedAt,
      }));
      groups.research.items.push({
        id: "analysis:" + row.id,
        title: result.title || result.summary || row.kind,
        kind: row.kind,
        updatedAt: row.finished_at || row.created_at,
        epistemic:
          "prior AI interpretation, not independently verified evidence",
        content: { result, references },
      });
    }
    const scenarioFrom =
      "FROM scenario_sets WHERE user_id=? AND symbol=? AND id NOT IN (SELECT set_id FROM article_revisions)";
    groups.scenarios.available = db
      .prepare("SELECT COUNT(*) n " + scenarioFrom)
      .get(...params).n;
    for (const row of db
      .prepare(
        "SELECT id,title,branches,created_at,updated_at,last_check " +
          scenarioFrom +
          " ORDER BY updated_at DESC,id LIMIT 4",
      )
      .all(...params)) {
      const observations = db
        .prepare(
          "SELECT kind,event_key,value,currency,verified,source_title,source_url,occurred_at,recorded_at FROM scenario_observations WHERE set_id=? ORDER BY recorded_at DESC,id LIMIT 12",
        )
        .all(row.id)
        .map((o) => ({ ...o, source_url: url(o.source_url) }));
      groups.scenarios.items.push({
        id: "scenario:" + row.id,
        title: row.title,
        updatedAt: row.updated_at,
        epistemic:
          "conditional author scenario; observation verification is explicit, not implied",
        content: {
          branches: parse(row.branches, []),
          createdAt: row.created_at,
          lastCheck: row.last_check,
          observations,
        },
      });
    }
    const charts = db
      .prepare(
        "SELECT slot,revision,state,updated_at FROM chart_workspaces WHERE user_id=? AND symbol=? AND state IS NOT NULL ORDER BY slot",
      )
      .all(...params);
    groups.charts.available = charts.length;
    for (const row of charts) {
      const state = parse(row.state);
      groups.charts.items.push({
        id: `chart:${s}:${row.slot}`,
        title: state.name || `Analysis ${row.slot}`,
        updatedAt: row.updated_at,
        epistemic:
          "author chart annotations and settings, not fresh market prices",
        content: {
          revision: row.revision,
          currency: state.currency,
          range: state.range,
          scale: state.scale,
          indicators: state.indicators,
          drawings: state.drawings,
        },
      });
    }
    const publicFrom =
      "FROM articles a JOIN article_revisions r ON r.article_id=a.id AND r.revision=a.published_revision WHERE " +
      publishedAssetFilter;
    const privateFrom =
      "FROM articles a WHERE a.user_id=? AND a.id!=? AND (a.symbol=? OR EXISTS(SELECT 1 FROM article_assets aa WHERE aa.article_id=a.id AND aa.symbol=?))";
    groups.articles.available =
      db.prepare("SELECT COUNT(*) n " + publicFrom).get(s, s).n +
      db
        .prepare("SELECT COUNT(*) n " + privateFrom)
        .get(owner, article.id, s, s).n;
    for (const row of db
      .prepare(
        "SELECT a.slug,r.title,r.body,r.sources,r.published_at,r.revision " +
          publicFrom +
          " ORDER BY r.published_at DESC,a.slug LIMIT 3",
      )
      .all(s, s))
      groups.articles.items.push({
        id: `edition:${row.slug}:${row.revision}`,
        title: row.title,
        path: `/journal/${row.slug}?v=${row.revision}`,
        updatedAt: row.published_at,
        epistemic: "published author analysis, not independent evidence",
        content: { body: row.body, sources: parse(row.sources, []) },
      });
    for (const row of db
      .prepare(
        "SELECT a.id,a.title,a.body,a.sources,a.branches,a.updated_at,a.revision " +
          privateFrom +
          " ORDER BY a.updated_at DESC,a.id LIMIT 3",
      )
      .all(owner, article.id, s, s))
      groups.articles.items.push({
        id: `draft:${row.id}:${row.revision}`,
        title: row.title,
        updatedAt: row.updated_at,
        epistemic:
          "private author draft, not published or independently verified",
        content: {
          body: row.body,
          branches: parse(row.branches, []),
          sources: parse(row.sources, []),
        },
      });
    const trades = politicalRows
      .filter((r) => r.ticker === s)
      .sort((a, b) =>
        String(b.filed || b.filingDate || "").localeCompare(
          String(a.filed || a.filingDate || ""),
        ),
      );
    groups.disclosures.available = trades.length;
    for (const row of trades.slice(0, primary ? 8 : 3)) {
      const {
        id,
        member,
        chamber,
        owner: disclosedOwner,
        side,
        low,
        high,
        amount,
        traded,
        filed,
        transactionDate,
        filingDate,
        ticker,
        asset: assetName,
      } = row;
      groups.disclosures.items.push({
        id: "disclosure:" + id,
        title: member || "Public investment disclosure",
        url: url(row.url),
        updatedAt: feed.fetched_at,
        epistemic:
          "reported public disclosure; transaction date differs from filing date; amounts are ranges, not exact trades",
        content: {
          member,
          chamber,
          owner: disclosedOwner,
          side,
          low,
          high,
          amount,
          traded,
          filed,
          transactionDate,
          filingDate,
          ticker,
          asset: assetName,
        },
      });
    }
    const totalLimit = primary
      ? assetList.length === 1
        ? 28000
        : 16000
      : Math.floor(20000 / Math.max(1, assetList.length - 1));
    let assetRemaining = Math.min(totalLimit, remaining);
    // Round-robin categories preserve breadth before allocating extra evidence to a single category.
    const picked = Object.fromEntries(categories.map((c) => [c, []]));
    const limits = {
      notes: primary ? 4 : 2,
      sources: primary ? 14 : 5,
      research: primary ? 3 : 1,
      scenarios: primary ? 3 : 1,
      charts: primary ? 3 : 1,
      articles: primary ? 4 : 2,
      disclosures: primary ? 8 : 3,
    };
    for (let round = 0; round < 14; round++)
      for (const category of categories) {
        const item = groups[category].items[round];
        if (!item || round >= limits[category] || assetRemaining < 150)
          continue;
        const raw = content(item.content),
          budget = Math.min(
            assetRemaining,
            primary ? (category === "sources" ? 2500 : 1800) : 800,
          );
        const value = {
          ...item,
          title: clip(item.title, 240),
          content: clip(raw, budget),
          truncated: raw.length > budget,
        };
        picked[category].push(value);
        assetRemaining -= value.content.length;
        remaining -= value.content.length;
      }
    for (const category of categories) {
      const group = groups[category];
      group.items = picked[category];
      group.included = group.items.length;
      group.omitted = Math.max(0, group.available - group.included);
      group.truncated = group.items.filter((i) => i.truncated).length;
    }
    return {
      symbol: s,
      name: asset.name,
      exchange: asset.exchange || null,
      role: primary ? "primary" : "related",
      groups,
    };
  });
  return {
    version: "writing-context-v1",
    asOf: new Date().toISOString().slice(0, 10),
    assets,
    limits: {
      textCharacters: 36000,
      source:
        "Existing stored records only. No live refresh or URL fetch is performed. Public disclosures cover the stored recent feed; historical archive shards are not expanded here. Excerpts and omitted records are identified. Previous AI analyses and author scenarios are not independent evidence.",
    },
  };
}

export function writingContextHash(context) {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
