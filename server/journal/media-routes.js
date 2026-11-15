import { fail, text, symbol } from "../platform/util.js";
import { storeImage, mediaView, MAX_IMAGE_BYTES } from "./media-store.js";
import { collectSources } from "../intelligence/sources.js";
import { articleAssets, validateArticleAssets } from "./assets.js";

const plain = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .slice(0, 400);
const imageHost = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      u.hostname === "upload.wikimedia.org" &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
};
async function boundedResponse(response, maximum) {
  if (!response.ok)
    throw fail(
      "The media source is unavailable. Retry or upload the file.",
      502,
    );
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw fail("The media source exceeds the size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createCommons(fetcher = fetch) {
  async function query(params) {
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    u.search = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "imageinfo",
      iiprop: "url|mime|size|extmetadata",
      iiurlwidth: "800",
      ...params,
    });
    const response = await fetcher(u, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "ReentryJournal/1.0 (https://reentry.xn--pav-dma.tech)",
      },
    });
    const data = JSON.parse(
      (await boundedResponse(response, 2 * 1024 * 1024)).toString(),
    );
    return Object.values(data.query?.pages || {}).flatMap((page) => {
      const info = page.imageinfo?.[0],
        metadata = info?.extmetadata || {};
      if (
        !info ||
        !["image/jpeg", "image/png", "image/webp"].includes(info.mime) ||
        !imageHost(info.url) ||
        !metadata.LicenseShortName?.value
      )
        return [];
      return [
        {
          id: page.pageid,
          title: page.title,
          url: info.url,
          thumbnail: imageHost(info.thumburl) || info.url,
          source: "https://commons.wikimedia.org/?curid=" + page.pageid,
          credit: plain(metadata.Artist?.value),
          license: plain(metadata.LicenseShortName?.value),
          width: info.width,
          height: info.height,
        },
      ];
    });
  }
  return {
    search: (q) =>
      query({
        generator: "search",
        gsrsearch: q,
        gsrnamespace: "6",
        gsrlimit: "12",
      }),
    async download(pageId) {
      const item = (await query({ pageids: String(pageId) }))[0];
      if (!item)
        throw fail(
          "This image is unavailable or has no license metadata.",
          404,
        );
      const response = await fetcher(item.thumbnail, {
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: { "User-Agent": "ReentryJournal/1.0" },
      });
      return { item, bytes: await boundedResponse(response, MAX_IMAGE_BYTES) };
    },
  };
}
export function registerMediaRoutes(
  app,
  { db, engine, market, connectors, author, owned, commons = createCommons() },
) {
  app.get("/api/journal/media/library", author, async (req) => ({
    images: db
      .prepare(
        "SELECT id,symbol,name,mime,width,height,bytes,provenance,created_at FROM journal_media WHERE user_id=? AND archived=0 ORDER BY created_at DESC LIMIT 500",
      )
      .all(req.auth.user_id)
      .map(mediaView),
  }));
  app.post(
    "/api/journal/media/upload",
    {
      ...author,
      bodyLimit: 12 * 1024 * 1024,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req) => {
      const b = req.body || {};
      if (
        typeof b.data !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(b.data) ||
        b.data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4
      )
        throw fail("Choose an image under 8 MB.");
      return storeImage(
        db,
        req.auth.user_id,
        {
          ...b,
          provenance: {
            kind: "upload",
            credit: b.credit || "",
            source: b.source || "",
            license: b.license || "",
          },
        },
        Buffer.from(b.data, "base64"),
      );
    },
  );
  app.delete("/api/journal/media/:media", author, async (req) => {
    const row = db
      .prepare("SELECT id FROM journal_media WHERE id=? AND user_id=?")
      .get(req.params.media, req.auth.user_id);
    if (!row) throw fail("Image not found.", 404);
    db.prepare("UPDATE journal_media SET archived=1 WHERE id=?").run(row.id);
    return { ok: true };
  });
  app.get("/journal-media/:media", async (req, reply) => {
    const row = db
      .prepare("SELECT * FROM journal_media WHERE id=?")
      .get(req.params.media);
    if (!row) throw fail("Image not found.", 404);
    const visible = db
      .prepare(
        "SELECT 1 FROM article_revision_media m JOIN article_revisions r ON r.id=m.revision_id JOIN articles a ON a.id=r.article_id WHERE m.media_id=? AND a.published_revision IS NOT NULL LIMIT 1",
      )
      .get(row.id);
    if (!visible) {
      await app.requireUser(req, reply);
      if (reply.sent) return;
      if (req.auth.user_id !== row.user_id) throw fail("Image not found.", 404);
    }
    return reply
      .type(row.mime)
      .header(
        "Cache-Control",
        visible ? "public,max-age=0,must-revalidate" : "private,no-store",
      )
      .header("X-Content-Type-Options", "nosniff")
      .send(Buffer.from(row.content));
  });
  app.get(
    "/api/journal/media/commons",
    { ...author, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => ({
      images: await commons.search(text(req.query.q, 120, 2)),
    }),
  );
  app.post("/api/journal/media/commons", author, async (req) => {
    const page = Number(req.body?.pageId);
    if (!Number.isSafeInteger(page) || page < 1)
      throw fail("Choose a source image.");
    const { item, bytes } = await commons.download(page);
    return storeImage(
      db,
      req.auth.user_id,
      {
        symbol: req.body.symbol,
        name: item.title.replace(/^File:/, "").slice(0, 200),
        provenance: { kind: "commons", ...item },
      },
      bytes,
    );
  });
  function selected(req) {
    const article = owned(req),
      b = req.body || {};
    const assets = validateArticleAssets(
      b.assets,
      b.symbol || article.symbol,
      articleAssets(db, article.id, article.symbol),
    );
    const asset = assets.find(
      (a) => a.symbol === (b.asset || b.symbol || article.symbol),
    );
    if (!asset) throw fail("Choose an article asset.");
    return asset;
  }
  app.post("/api/journal/:id/media/sources", author, async (req) => {
    const asset = selected(req);
    if (req.body.refresh)
      await collectSources(db, connectors, req.auth.user_id, asset);
    return {
      sources: db
        .prepare(
          "SELECT id,title,url,content,kind,published_at,fetched_at FROM research_sources WHERE user_id=? AND symbol=? ORDER BY fetched_at DESC LIMIT 60",
        )
        .all(req.auth.user_id, asset.symbol),
    };
  });
  app.post("/api/journal/:id/media/prices", author, async (req) => {
    const asset = selected(req),
      range = ["1mo", "3mo", "1y", "5y"].includes(req.body.range)
        ? req.body.range
        : "1y";
    const data = await market.history(
      symbol(asset.symbol),
      range,
      ["USD", "EUR"].includes(req.body.currency) ? req.body.currency : "USD",
    );
    return { ...data, symbol: asset.symbol, retrievedAt: Date.now() };
  });
  app.post("/api/journal/:id/media/ai/preview", author, async (req) =>
    engine.previewMedia(req.auth.user_id, owned(req), req.body || {}),
  );
  app.post("/api/journal/:id/media/ai", author, async (req) =>
    engine.enqueueMedia(req.auth.user_id, owned(req), req.body || {}),
  );
  app.get("/api/journal/:id/media/ai", author, async (req) => {
    const a = owned(req);
    return {
      jobs: db
        .prepare(
          "SELECT id,status,model,error,created_at,input,result FROM ai_jobs WHERE user_id=? AND kind IN ('studio-media','studio-image') AND json_extract(input,'$.article.id')=? ORDER BY created_at DESC LIMIT 20",
        )
        .all(req.auth.user_id, a.id)
        .map((j) => ({
          id: j.id,
          status: j.status,
          model: j.model,
          error: j.error,
          createdAt: j.created_at,
          request: { task: JSON.parse(j.input).task },
          result: j.result ? JSON.parse(j.result) : null,
        })),
    };
  });
  app.get("/api/journal/:id/media/ai/:job", author, async (req) => {
    const a = owned(req);
    const job = db
      .prepare(
        "SELECT id,status,model,error,input,result FROM ai_jobs WHERE id=? AND user_id=? AND kind IN ('studio-media','studio-image') AND json_extract(input,'$.article.id')=?",
      )
      .get(req.params.job, req.auth.user_id, a.id);
    if (!job) throw fail("Generation not found.", 404);
    const input = JSON.parse(job.input);
    return {
      id: job.id,
      status: job.status,
      model: job.model,
      error: job.error,
      prompt: input.renderedPrompt,
      request: { task: input.task },
      result: job.result ? JSON.parse(job.result) : null,
    };
  });
}
