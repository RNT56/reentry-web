import {
  id,
  fail,
  text,
  symbol,
  integer,
  transaction,
  audit,
} from "../platform/util.js";
import { validateBranches, validatePublicSources } from "../ai/contract.js";
import { createSet, setView } from "../intelligence/scenarios.js";
import { publicDocument } from "./public.js";
import {
  formatArticle,
  articleContainsPassage,
} from "../../src/domain/article-format.js";
import {
  articleAssets,
  saveArticleAssets,
  validateArticleAssets,
  publishedAssetFilter,
} from "./assets.js";
import { writingRequest } from "../ai/writing-contract.js";
export function registerJournalRoutes(
  app,
  { db, engine, isAuthor, authorName },
) {
  const auth = { preHandler: app.requireUser };
  const author = {
    preHandler: async (req, reply) => {
      await app.requireUser(req, reply);
      if (reply.sent) return;
      if (!isAuthor(req.auth.username))
        throw fail("Publishing is reserved for the author.", 403);
    },
  };
  function owned(req) {
    const a = db
      .prepare("SELECT * FROM articles WHERE id=? AND user_id=?")
      .get(req.params.id, req.auth.user_id);
    if (!a) throw fail("Article not found.", 404);
    return a;
  }
  const canDelete = (a) =>
    a.published_revision === null &&
    !db
      .prepare("SELECT 1 FROM article_revisions WHERE article_id=? LIMIT 1")
      .get(a.id);
  const draft = (a) => ({
    id: a.id,
    slug: a.slug,
    symbol: a.symbol,
    assets: articleAssets(db, a.id, a.symbol),
    title: a.title,
    body: a.body,
    branches: JSON.parse(a.branches),
    sources: JSON.parse(a.sources),
    revision: a.revision,
    publishedRevision: a.published_revision,
    canDelete: canDelete(a),
    updatedAt: a.updated_at,
  });
  function listings(asset) {
    return db
      .prepare(
        `SELECT a.slug,r.id AS edition_id,r.symbol,r.title,r.body,r.published_at,r.author,r.revision FROM articles a JOIN article_revisions r ON r.article_id=a.id AND r.revision=a.published_revision ${asset ? "WHERE " + publishedAssetFilter : ""} ORDER BY r.published_at DESC LIMIT 100`,
      )
      .all(...(asset ? [symbol(asset), symbol(asset)] : []))
      .map((a) => ({
        slug: a.slug,
        symbol: a.symbol,
        assets: articleAssets(db, a.edition_id, a.symbol, true),
        title: a.title,
        excerpt: formatArticle(a.body).plainText.slice(0, 180),
        publishedAt: a.published_at,
        author: a.author,
        revision: a.revision,
      }));
  }
  function published(slug, version) {
    const a = db
      .prepare(
        "SELECT id,slug,published_revision FROM articles WHERE slug=? AND published_revision IS NOT NULL",
      )
      .get(slug);
    if (!a) throw fail("Published article not found.", 404);
    const revision =
      version === undefined
        ? a.published_revision
        : integer(Number(version), 1, 100000);
    const r = db
      .prepare(
        "SELECT * FROM article_revisions WHERE article_id=? AND revision=?",
      )
      .get(a.id, revision);
    if (!r) throw fail("Published edition not found.", 404);
    const raw = setView(
      db,
      db.prepare("SELECT * FROM scenario_sets WHERE id=?").get(r.set_id),
    );
    // An explicit public projection. No account IDs, private job IDs, keys or prompts.
    return {
      slug: a.slug,
      symbol: r.symbol,
      assets: articleAssets(db, r.id, r.symbol, true),
      title: r.title,
      body: r.body,
      author: r.author,
      revision: r.revision,
      sources: JSON.parse(r.sources),
      publishedAt: r.published_at,
      scenario: {
        symbol: raw.symbol,
        title: raw.title,
        branches: raw.branches,
        createdAt: raw.createdAt,
        lastCheck: raw.lastCheck,
        observations: raw.observations,
      },
      editions: db
        .prepare(
          "SELECT revision,published_at FROM article_revisions WHERE article_id=? ORDER BY revision",
        )
        .all(a.id),
    };
  }
  app.get("/api/journal", author, async (req) => ({
    articles: db
      .prepare(
        "SELECT * FROM articles WHERE user_id=? ORDER BY updated_at DESC LIMIT 100",
      )
      .all(req.auth.user_id)
      .map(draft),
  }));
  app.post("/api/journal", author, async (req) =>
    transaction(db, () => {
      const b = req.body || {},
        user = req.auth.user_id,
        a = id(),
        now = Date.now();
      if (
        db
          .prepare("SELECT COUNT(*) AS n FROM articles WHERE user_id=?")
          .get(user).n >= 1000
      )
        throw fail("Article limit reached.");
      const slug =
        text(b.title, 200)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) +
        "-" +
        a.slice(0, 8);
      const assets = validateArticleAssets(b.assets, b.symbol);
      db.prepare(
        "INSERT INTO articles(id,user_id,slug,symbol,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        a,
        user,
        slug,
        symbol(b.symbol),
        text(b.title, 200),
        text(b.body || "", 40000, 0),
        now,
        now,
      );
      saveArticleAssets(db, a, assets);
      return { id: a };
    }),
  );
  app.get("/api/journal/:id", author, async (req) => draft(owned(req)));
  app.post("/api/journal/:id/preview", author, async (req) => {
    const a = owned(req),
      b = req.body || {};
    const body = text(b.body ?? a.body, 40000, 0);
    const warnings = [];
    const rawBranches = b.branches ?? JSON.parse(a.branches);
    if (!Array.isArray(rawBranches) || rawBranches.length > 12)
      throw fail("Use at most twelve scenario branches.");
    const branches = rawBranches.flatMap((branch) => {
      try {
        return validateBranches([branch]);
      } catch {
        warnings.push("An unfinished scenario was omitted from this preview.");
        return [];
      }
    });
    if (
      branches.some(
        (branch) =>
          branch.passage && !articleContainsPassage(body, branch.passage),
      )
    )
      warnings.push(
        "A mapped passage no longer matches the article. Review the scenario map before publishing.",
      );
    const rawSources = b.sources ?? JSON.parse(a.sources);
    if (!Array.isArray(rawSources) || rawSources.length > 20)
      throw fail("Use at most twenty source references.");
    const sources = rawSources.flatMap((source) => {
      try {
        return validatePublicSources([source]);
      } catch {
        warnings.push(
          "An unfinished source reference was omitted from this preview.",
        );
        return [];
      }
    });
    const article = {
      slug: a.slug,
      title: text(b.title || a.title, 200),
      symbol: symbol(b.symbol || a.symbol),
      assets: validateArticleAssets(
        b.assets,
        b.symbol || a.symbol,
        articleAssets(db, a.id, a.symbol),
      ),
      body,
      author: authorName,
      revision: a.revision,
      publishedAt: Date.now(),
      sources,
      editions: [],
      scenario: {
        branches: branches.map((branch) => ({
          ...branch,
          status: { status: "watching", evidence: [] },
        })),
        observations: [],
      },
    };
    return {
      html: publicDocument({ article, authorName, preview: true }),
      warnings: [...new Set(warnings)],
    };
  });
  app.post("/api/journal/:id/assist", author, async (req) => {
    const a = owned(req),
      b = req.body || {};
    if (b.revision !== a.revision)
      throw fail(
        "This draft changed on another device. Reload before requesting writing help.",
        409,
      );
    return engine.enqueueWriting(
      req.auth.user_id,
      writingRequest(b, {
        ...a,
        symbol: symbol(b.symbol ?? a.symbol),
        assets: validateArticleAssets(
          b.assets,
          b.symbol ?? a.symbol,
          articleAssets(db, a.id, a.symbol),
        ),
      }),
      text(b.requestKey, 100),
    );
  });
  app.get("/api/journal/:id/assist", author, async (req) => {
    const a = owned(req);
    return {
      jobs: db
        .prepare(
          "SELECT id,status,model,error,created_at,input FROM ai_jobs WHERE user_id=? AND kind='studio-writing' AND json_extract(input,'$.article.id')=? ORDER BY created_at DESC LIMIT 20",
        )
        .all(req.auth.user_id, a.id)
        .map(({ input, ...job }) => ({
          ...job,
          task: JSON.parse(input).writing.task,
        })),
    };
  });
  app.get("/api/journal/:id/assist/:job", author, async (req) => {
    const a = owned(req);
    const job = db
      .prepare(
        "SELECT id,status,model,error,created_at,input,result FROM ai_jobs WHERE id=? AND user_id=? AND kind='studio-writing'",
      )
      .get(req.params.job, req.auth.user_id);
    if (!job) throw fail("Writing task not found.", 404);
    const input = JSON.parse(job.input);
    if (input.article.id !== a.id) throw fail("Writing task not found.", 404);
    return {
      id: job.id,
      status: job.status,
      model: job.model,
      error: job.error,
      createdAt: job.created_at,
      article: input.article,
      writing: input.writing,
      result: job.result ? JSON.parse(job.result) : null,
    };
  });
  app.delete("/api/journal/:id", author, async (req) =>
    transaction(db, () => {
      const a = owned(req);
      if (!canDelete(a))
        throw fail(
          "Articles with published editions cannot be deleted as drafts.",
          409,
        );
      if (integer(req.body?.revision, 1, 100000) !== a.revision)
        throw fail(
          "This draft changed on another device. Reload before deleting.",
          409,
        );
      db.prepare("DELETE FROM articles WHERE id=? AND user_id=?").run(
        a.id,
        req.auth.user_id,
      );
      audit(db, req.auth.user_id, "article-draft-deleted", { article: a.id });
      return { ok: true };
    }),
  );
  app.put("/api/journal/:id", author, async (req) =>
    transaction(db, () => {
      const a = owned(req),
        b = req.body || {},
        branches = validateBranches(b.branches),
        body = text(b.body, 40000, 0),
        sources = validatePublicSources(b.sources),
        assets = validateArticleAssets(
          b.assets,
          b.symbol,
          articleAssets(db, a.id, a.symbol),
        );
      if (
        branches.some(
          (s) => s.passage && !articleContainsPassage(body, s.passage),
        )
      )
        throw fail("Each mapped passage must appear in the article.");
      const changed = db
        .prepare(
          "UPDATE articles SET symbol=?,title=?,body=?,branches=?,sources=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
        )
        .run(
          symbol(b.symbol),
          text(b.title, 200),
          body,
          JSON.stringify(branches),
          JSON.stringify(sources),
          Date.now(),
          a.id,
          req.auth.user_id,
          integer(b.revision, 1, 100000),
        );
      if (!changed.changes)
        throw fail(
          "This draft changed on another device. Reload before saving.",
          409,
        );
      saveArticleAssets(db, a.id, assets);
      return draft(db.prepare("SELECT * FROM articles WHERE id=?").get(a.id));
    }),
  );
  app.post("/api/journal/:id/map", author, async (req) => {
    const a = owned(req);
    if (!a.body.trim()) throw fail("Write the article before mapping it.");
    db.prepare(
      "INSERT OR IGNORE INTO research_assets(user_id,symbol,name) VALUES(?,?,?)",
    ).run(
      req.auth.user_id,
      a.symbol,
      articleAssets(db, a.id, a.symbol)[0].name,
    );
    return engine.enqueue(req.auth.user_id, {
      symbol: a.symbol,
      kind: "map-article",
      article: { id: a.id, revision: a.revision, title: a.title, body: a.body },
      requestKey: text(req.body?.requestKey, 100),
    });
  });
  app.post("/api/journal/:id/publish", author, async (req) =>
    transaction(db, () => {
      const a = owned(req);
      if (req.body?.reviewed !== true || req.body?.revision !== a.revision)
        throw fail("Review and save the latest draft before publishing.", 409);
      if (a.body.trim().length < 20)
        throw fail("Add the article text before publishing.");
      const branches = validateBranches(JSON.parse(a.branches));
      if (
        branches.some(
          (b) => !b.passage || !articleContainsPassage(a.body, b.passage),
        )
      )
        throw fail(
          "Every public scenario must link to an exact article passage.",
        );
      const existing = db
        .prepare(
          "SELECT id FROM article_revisions WHERE article_id=? AND revision=?",
        )
        .get(a.id, a.revision);
      if (!existing) {
        const now = Date.now(),
          edition = id(),
          set = createSet(
            db,
            req.auth.user_id,
            a.symbol,
            a.title,
            branches,
            { kind: "published-article", slug: a.slug, revision: a.revision },
            now,
          );
        db.prepare(
          "INSERT INTO article_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          edition,
          a.id,
          a.revision,
          authorName,
          a.symbol,
          a.title,
          a.body,
          JSON.stringify(branches),
          a.sources,
          set,
          now,
        );
        saveArticleAssets(db, edition, articleAssets(db, a.id, a.symbol), true);
      }
      db.prepare("UPDATE articles SET published_revision=? WHERE id=?").run(
        a.revision,
        a.id,
      );
      audit(db, req.auth.user_id, "article-published", {
        article: a.id,
        revision: a.revision,
      });
      return { url: "/journal/" + a.slug };
    }),
  );
  app.delete("/api/journal/:id/publication", author, async (req) => {
    const a = owned(req);
    db.prepare("UPDATE articles SET published_revision=NULL WHERE id=?").run(
      a.id,
    );
    audit(db, req.auth.user_id, "article-unpublished", { article: a.id });
    return { ok: true };
  });
  app.get("/api/public/journal", async (req) => ({
    articles: listings(req.query.symbol),
    authorName,
  }));
  app.get("/api/public/journal/:slug", async (req) =>
    published(req.params.slug, req.query.v),
  );
  app.post("/api/public/journal/:slug/fork", auth, async (req) => {
    const a = published(req.params.slug, req.body?.revision),
      user = req.auth.user_id;
    if (
      db
        .prepare("SELECT COUNT(*) AS n FROM scenario_sets WHERE user_id=?")
        .get(user).n >= 500
    )
      throw fail("Scenario limit reached.");
    const branches = validateBranches(a.scenario.branches);
    return {
      id: createSet(db, user, a.symbol, a.title, branches, {
        kind: "public-fork",
        slug: a.slug,
        revision: a.revision,
        author: a.author,
      }),
    };
  });
  app.get("/journal", async (req, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-cache")
      .send(
        publicDocument({ articles: listings(req.query.symbol), authorName }),
      ),
  );
  app.get("/journal/:slug", async (req, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-cache")
      .send(
        publicDocument({
          article: published(req.params.slug, req.query.v),
          authorName,
        }),
      ),
  );
}
