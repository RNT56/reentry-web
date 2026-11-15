import { fail, symbol, text } from "../platform/util.js";
import { assetInfo } from "../../src/domain/assets.js";

export function validateArticleAssets(value, primary, fallback = []) {
  primary = symbol(primary);
  if (value === undefined) {
    const existing = fallback.find((a) => a.symbol === primary);
    value = [
      existing || assetInfo({ symbol: primary }),
      ...fallback.filter(
        (a, index) =>
          a.symbol !== primary && (index > 0 || fallback[0].symbol === primary),
      ),
    ];
  }
  if (!Array.isArray(value) || !value.length || value.length > 8)
    throw fail("Select one primary asset and at most seven related assets.");
  const assets = value.map((a) => {
    if (!a || typeof a !== "object") throw fail("Invalid article asset.");
    const asset = {
      symbol: symbol(a.symbol),
      name: text(a.name || a.symbol, 200),
      exchange: text(a.exchange || "", 80, 0),
      assetType: text(a.assetType || "OTHER", 24),
      isin: text(a.isin || "", 12, 0),
    };
    if (
      ![
        "EQUITY",
        "ETF",
        "MUTUALFUND",
        "CRYPTOCURRENCY",
        "INDEX",
        "OTHER",
      ].includes(asset.assetType) ||
      (asset.isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(asset.isin))
    )
      throw fail("Invalid article asset metadata.");
    return asset;
  });
  if (
    assets[0].symbol !== primary ||
    new Set(assets.map((a) => a.symbol)).size !== assets.length
  )
    throw fail(
      "The primary asset must come first, without duplicate listings.",
    );
  return assets;
}

export function articleAssets(db, id, primary, edition = false) {
  const table = edition ? "article_revision_assets" : "article_assets";
  const key = edition ? "revision_id" : "article_id";
  const rows = db
    .prepare(
      `SELECT symbol,metadata FROM ${table} WHERE ${key}=? ORDER BY position`,
    )
    .all(id);
  // Old editions keep their exact symbol without rewriting existing durable rows.
  return validateArticleAssets(
    undefined,
    primary,
    rows.map((r) => ({ ...JSON.parse(r.metadata), symbol: r.symbol })),
  );
}

export function saveArticleAssets(db, id, assets, edition = false) {
  const table = edition ? "article_revision_assets" : "article_assets";
  const key = edition ? "revision_id" : "article_id";
  db.prepare(`DELETE FROM ${table} WHERE ${key}=?`).run(id);
  const insert = db.prepare(
    `INSERT INTO ${table}(${key},symbol,position,metadata) VALUES(?,?,?,?)`,
  );
  assets.forEach((asset, index) =>
    insert.run(id, asset.symbol, index, JSON.stringify(asset)),
  );
}

// Match only the published snapshot, never newer private draft associations.
export const publishedAssetFilter =
  "(r.symbol=? OR EXISTS(SELECT 1 FROM article_revision_assets ra WHERE ra.revision_id=r.id AND ra.symbol=?))";
