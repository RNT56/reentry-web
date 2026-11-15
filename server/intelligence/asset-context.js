import { symbol } from "../platform/util.js";

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

/** Read-only, exact-listing context. Public content comes exclusively from published snapshots. */
export function assetContext(db, owner, asset) {
  const journalFrom =
    "FROM articles a JOIN article_revisions r ON r.article_id=a.id AND r.revision=a.published_revision WHERE r.symbol=?";
  const researchFrom =
    "FROM ai_jobs WHERE user_id=? AND symbol=? AND kind='research' AND status='completed'";
  const scenariosFrom =
    "FROM scenario_sets WHERE user_id=? AND symbol=? AND id NOT IN (SELECT set_id FROM article_revisions)";
  const count = (from, params) =>
    db.prepare("SELECT COUNT(*) AS n " + from).get(...params).n;
  return {
    symbol: asset,
    journal: {
      count: count(journalFrom, [asset]),
      items: db
        .prepare(
          "SELECT a.slug,r.title,r.body,r.published_at,r.author,r.revision " +
            journalFrom +
            " ORDER BY r.published_at DESC,a.slug LIMIT 1",
        )
        .all(asset)
        .map((r) => ({
          slug: r.slug,
          title: r.title,
          excerpt: excerpt(r.body),
          author: r.author,
          at: r.published_at,
          revision: r.revision,
        })),
    },
    research: {
      count: count(researchFrom, [owner, asset]),
      items: db
        .prepare(
          "SELECT id,result,finished_at,created_at " +
            researchFrom +
            " ORDER BY created_at DESC,id LIMIT 1",
        )
        .all(owner, asset)
        .map((r) => {
          const result = parse(r.result, {});
          return {
            id: r.id,
            title: excerpt(result.summary || result.title || "Research brief"),
            at: r.finished_at || r.created_at,
          };
        }),
    },
    scenarios: {
      count: count(scenariosFrom, [owner, asset]),
      items: db
        .prepare(
          "SELECT id,title,branches,updated_at " +
            scenariosFrom +
            " ORDER BY updated_at DESC,id LIMIT 1",
        )
        .all(owner, asset)
        .map((r) => ({
          id: r.id,
          title: r.title,
          branches: parse(r.branches, []).length,
          at: r.updated_at,
        })),
    },
  };
}

export function registerAssetContextRoutes(app, { db }) {
  app.get(
    "/api/asset-context",
    { preHandler: app.requireUser },
    async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      return assetContext(db, req.auth.user_id, symbol(req.query.symbol));
    },
  );
}
