import sharp from "sharp";
import { id, fail, text, symbol, transaction } from "../platform/util.js";
import { articleMedia } from "../../src/domain/article-format.js";
import { mediaURL } from "../../src/domain/article-media.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const mediaView = (row) => ({
  id: row.id,
  symbol: row.symbol,
  name: row.name,
  mime: row.mime,
  width: row.width,
  height: row.height,
  bytes: row.bytes,
  provenance: JSON.parse(row.provenance),
  createdAt: row.created_at,
  url: "/journal-media/" + row.id,
});
export async function storeImage(db, user, input, bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > MAX_IMAGE_BYTES
  )
    throw fail("Choose an image under 8 MB.");
  let normalized;
  try {
    const image = sharp(bytes, { limitInputPixels: 32000000, animated: false });
    const meta = await image.metadata();
    if (
      !["jpeg", "png", "webp", "avif"].includes(meta.format) ||
      (meta.pages || 1) > 1
    )
      throw Error("format");
    normalized = await image
      .rotate()
      .resize({
        width: 3200,
        height: 3200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw fail(
      "Use a valid PNG, JPEG, WebP or AVIF image under 32 megapixels.",
    );
  }
  const provenance = {
    kind: ["upload", "commons", "ai"].includes(input.provenance?.kind)
      ? input.provenance.kind
      : "upload",
    credit: text(input.provenance?.credit || "", 400, 0),
    license: text(input.provenance?.license || "", 200, 0),
    source: mediaURL(input.provenance?.source) || null,
    model: text(input.provenance?.model || "", 100, 0),
    jobId: input.provenance?.jobId || null,
  };
  const row = {
    id: id(),
    user_id: user,
    symbol: symbol(input.symbol),
    name: text(input.name || "Untitled image", 200),
    mime: "image/webp",
    width: normalized.info.width,
    height: normalized.info.height,
    bytes: normalized.data.length,
    content: normalized.data,
    provenance: JSON.stringify(provenance),
    created_at: Date.now(),
  };
  return transaction(db, () => {
    const usage = db
      .prepare(
        "SELECT COUNT(*) n,COALESCE(SUM(bytes),0) bytes FROM journal_media WHERE user_id=?",
      )
      .get(user);
    if (usage.n >= 500 || usage.bytes + row.bytes > 200 * 1024 * 1024)
      throw fail("Media library limit reached (500 images or 200 MB).", 409);
    db.prepare(
      "INSERT INTO journal_media(id,user_id,symbol,name,mime,width,height,bytes,content,provenance,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      ...[
        row.id,
        user,
        row.symbol,
        row.name,
        row.mime,
        row.width,
        row.height,
        row.bytes,
        row.content,
        row.provenance,
        row.created_at,
      ],
    );
    return mediaView(row);
  });
}
export function validateArticleMedia(db, user, body) {
  let blocks;
  try {
    blocks = articleMedia(body);
  } catch (e) {
    throw fail("Media: " + e.message);
  }
  if (blocks.length > 30)
    throw fail("Use at most thirty media blocks per article.");
  const ids = [
    ...new Set(blocks.filter((m) => m.type === "image").map((m) => m.fileId)),
  ];
  for (const file of ids)
    if (
      !db
        .prepare("SELECT 1 FROM journal_media WHERE id=? AND user_id=?")
        .get(file, user)
    )
      throw fail("An article image is unavailable in your library.");
  return ids;
}
export function snapshotArticleMedia(db, user, edition, body) {
  for (const file of validateArticleMedia(db, user, body))
    db.prepare("INSERT OR IGNORE INTO article_revision_media VALUES(?,?)").run(
      edition,
      file,
    );
}
