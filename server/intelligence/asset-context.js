import { symbol, integer, fail } from "../platform/util.js";
import { publishedAssetFilter } from "../journal/assets.js";

const parse = (value, fallback) => {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
};
const excerpt = (value, length = 180) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);

/** Exact-listing, read-only projections. Drafts and published scenario snapshots never enter private lists. */
export function assetContextList(
  db,
  owner,
  asset,
  section,
  offset = 0,
  limit = 20,
) {
  const definitions = {
    journal: {
      from:
        "FROM articles a JOIN article_revisions r ON r.article_id=a.id AND r.revision=a.published_revision WHERE " +
        publishedAssetFilter,
      fields: "a.slug,r.title,r.body,r.published_at,r.author,r.revision",
      order: "r.published_at DESC,a.slug",
      params: [asset, asset],
      view: (r) => ({
        slug: r.slug,
        title: r.title,
        excerpt: excerpt(r.body),
        author: r.author,
        at: r.published_at,
        revision: r.revision,
      }),
    },
    research: {
      from: "FROM ai_jobs WHERE user_id=? AND symbol=? AND kind='research' AND status='completed'",
      fields: "id,result,finished_at,created_at",
      order: "created_at DESC,id",
      params: [owner, asset],
      view: (r) => {
        const result = parse(r.result, {});
        return {
          id: r.id,
          title: excerpt(result.summary || result.title || "Research brief"),
          at: r.finished_at || r.created_at,
        };
      },
    },
    scenarios: {
      from: "FROM scenario_sets WHERE user_id=? AND symbol=? AND id NOT IN (SELECT set_id FROM article_revisions)",
      fields: "id,title,branches,updated_at",
      order: "updated_at DESC,id",
      params: [owner, asset],
      view: (r) => ({
        id: r.id,
        title: r.title,
        branches: parse(r.branches, []).length,
        at: r.updated_at,
      }),
    },
  };
  if (!Object.hasOwn(definitions, section))
    throw fail("Unknown context section.", 404);
  integer(offset, 0, 100000);
  integer(limit, 1, 20);
  const q = definitions[section];
  const count = db.prepare("SELECT COUNT(*) AS n " + q.from).get(...q.params).n;
  const items = db
    .prepare(
      `SELECT ${q.fields} ${q.from} ORDER BY ${q.order} LIMIT ? OFFSET ?`,
    )
    .all(...q.params, limit, offset)
    .map(q.view);
  return {
    count,
    items,
    nextOffset: offset + items.length < count ? offset + items.length : null,
  };
}

export function assetContext(db, owner, asset) {
  return {
    symbol: asset,
    ...Object.fromEntries(
      ["journal", "research", "scenarios"].map((section) => [
        section,
        assetContextList(db, owner, asset, section, 0, 1),
      ]),
    ),
  };
}
export function registerAssetContextRoutes(app, { db }) {
  const auth = { preHandler: app.requireUser };
  app.get("/api/asset-context", auth, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return assetContext(db, req.auth.user_id, symbol(req.query.symbol));
  });
  app.get("/api/asset-context/:section", auth, async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const asset = symbol(req.query.symbol);
    return {
      symbol: asset,
      ...assetContextList(
        db,
        req.auth.user_id,
        asset,
        req.params.section,
        integer(Number(req.query.offset || 0), 0, 100000),
      ),
    };
  });
}
