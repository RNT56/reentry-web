import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { sourceBytes } from "./network.js";

export const HISTORY_SOURCE =
  "https://huggingface.co/datasets/austin-starks/congressional-stock-trades";
const BASE = HISTORY_SOURCE + "/resolve/main/";
const CHECK_MS = 300000;
const clean = (v, max = 300) =>
  typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
function internRows(rows, pool) {
  for (const r of rows)
    for (const key of [
      "member",
      "memberId",
      "portrait",
      "state",
      "office",
      "ticker",
      "asset",
      "assetType",
      "owner",
      "type",
      "url",
      "filed",
      "traded",
    ]) {
      const value = r[key];
      if (typeof value !== "string") continue;
      const existing = pool.get(value);
      if (existing !== undefined) r[key] = existing;
      else pool.set(value, value);
    }
}
const day = (value) => {
  const v = value instanceof Date ? value.toISOString() : value;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = v.slice(0, 10),
    stamp = Date.parse(d);
  return Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 10) === d
    ? d
    : null;
};
export function officialDocument(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const h = u.pathname.match(/^\/public_disc\/ptr-pdfs\/\d{4}\/(\d+)\.pdf$/i);
    if (u.hostname === "disclosures-clerk.house.gov" && h)
      return "house:" + h[1];
    const s = u.pathname.match(
      /^\/search\/view\/(?:ptr|paper)\/([a-f0-9-]+)\/?$/i,
    );
    if (u.hostname === "efdsearch.senate.gov" && s)
      return "senate:" + s[1].toLowerCase();
  } catch {
    /* Invalid provenance never becomes evidence. */
  }
  return null;
}
export function normalizeHistory(events, filings, now = Date.now()) {
  const docs = new Map(filings.map((f) => [String(f.docId), f])),
    covered = new Set(),
    current = new Map();
  for (const f of filings) {
    const id = officialDocument(f.sourceUrl);
    if (id && f.extractionStatus === "ok") covered.add(id);
  }
  let rejected = 0;
  for (const e of events) {
    if (e.supersededAt && Date.parse(e.supersededAt) <= now) continue;
    if (Date.parse(e.availableAt) > now) continue;
    const doc = officialDocument(e.sourceUrl),
      f = docs.get(String(e.sourceDocId)),
      filed = day(f?.filingDate),
      traded = day(e.transactionDate),
      id = clean(e.eventId, 220);
    if (
      !doc ||
      !filed ||
      !traded ||
      !id ||
      !/^[A-Z]\d{6}$/.test(e.memberId) ||
      !["house", "senate"].includes(e.chamber) ||
      !Number.isFinite(Date.parse(e.availableAt)) ||
      !Number.isFinite(Date.parse(filed)) ||
      !Number.isFinite(Date.parse(traded)) ||
      traded > filed ||
      Date.parse(filed) > now + 86400000
    ) {
      rejected++;
      continue;
    }
    covered.add(doc);
    // All contributing documents, including superseded originals, are covered by this reconciled event.
    try {
      for (const rowId of JSON.parse(e.contributorRowIds || "[]"))
        covered.add(e.chamber + ":" + String(rowId).split(":")[0]);
    } catch {
      /* source URL still verified */
    }
    const low =
        Number.isFinite(e.amountLow) && e.amountLow >= 0 ? e.amountLow : null,
      high =
        Number.isFinite(e.amountHigh) && e.amountHigh >= 0
          ? e.amountHigh
          : null;
    if (low !== null && high !== null && high < low) {
      rejected++;
      continue;
    }
    const side =
      e.action === "purchase"
        ? "buy"
        : e.action === "sale"
          ? "sell"
          : e.action === "exchange"
            ? "exchange"
            : "other";
    const row = {
      id: "history:" + id,
      memberId: "congress:" + e.memberId,
      bioguide: e.memberId,
      member: clean(
        e.displayName || [e.filerFirst, e.filerLast].join(" "),
        200,
      ),
      portrait: `https://unitedstates.github.io/images/congress/225x275/${e.memberId}.jpg`,
      party: null,
      state: "",
      chamber: e.chamber,
      office: "",
      ticker: /^[A-Z0-9.^=-]{1,20}$/.test(e.ticker || "") ? e.ticker : null,
      asset: clean(e.assetDescription),
      assetType: clean(e.assetTypeCode || e.assetTypeLabel, 80) || null,
      side,
      type:
        side === "buy"
          ? "Purchase"
          : side === "sell"
            ? e.partialSale
              ? "Sale (Partial)"
              : "Sale"
            : clean(e.action, 60),
      owner:
        {
          spouse: "Spouse",
          joint: "Joint",
          self: "Self",
          dependent_child: "Dependent child",
          not_indicated: "Unspecified",
        }[e.owner] ||
        clean(e.owner, 80) ||
        "Unspecified",
      low,
      high,
      amount: null,
      filed,
      traded,
      lag: Math.round((Date.parse(filed) - Date.parse(traded)) / 86400000),
      url: e.sourceUrl,
      comment: clean(e.comment, 1200) || null,
      provider: "history",
      availableAt:
        e.availableAt instanceof Date
          ? e.availableAt.toISOString()
          : e.availableAt,
      eventVersion: Number(e.version) || 1,
    };
    if (!current.has(id) || current.get(id).eventVersion < row.eventVersion)
      current.set(id, row);
  }
  if (events.length && rejected > events.length * 0.05)
    throw Error(
      `Historical disclosure validation failed: ${rejected}/${events.length}`,
    );
  return { rows: [...current.values()], documents: [...covered], rejected };
}
export function validateHistoryManifest(m) {
  if (
    m?.schemaVersion !== 2 ||
    m.audit?.passed !== true ||
    m.dataset !== "austin-starks/congressional-stock-trades"
  )
    throw Error("Unverified archive manifest");
  const result = [];
  let total = 0;
  for (const table of ["political_trade_events", "political_filings"]) {
    const t = m.tables?.[table];
    if (
      !t ||
      !Array.isArray(t.manifests) ||
      !Number.isSafeInteger(t.rows) ||
      t.rows < 0 ||
      t.rows > 500000 ||
      t.manifests.length > 60
    )
      throw Error("Invalid archive table");
    for (const part of t.manifests)
      for (const f of part.files || []) {
        if (
          !new RegExp(`^data/${table}/\\d{4}-\\d{5}-of-\\d{5}\\.parquet$`).test(
            f.publicPath,
          ) ||
          !/^[a-f0-9]{64}$/.test(f.sha256) ||
          !Number.isSafeInteger(f.size) ||
          f.size < 12 ||
          f.size > 8000000 ||
          !Number.isInteger(part.year) ||
          !f.publicPath.includes("/" + part.year + "-") ||
          part.year < 2012 ||
          part.year > 2100
        )
          throw Error("Invalid archive shard");
        total += f.size;
        result.push({ ...f, table, year: part.year });
      }
  }
  if (!result.length || result.length > 120 || total > 64000000)
    throw Error("Archive size exceeds limits");
  return result;
}
export function createPoliticalHistory({
  db,
  fetcher = fetch,
  now = Date.now,
  enabled = false,
}) {
  let snapshot = null,
    inflight = null,
    timer = null,
    controller = null,
    started = false,
    stopped = false;
  const stored = db
    .prepare("SELECT payload FROM political_archives WHERE id='history:meta'")
    .get();
  const sync = db
    .prepare("SELECT * FROM political_sync WHERE id='history'")
    .get() || {
    checked_at: null,
    attempted_at: null,
    next_check_at: 0,
    etag: null,
    failures: 0,
    last_error: null,
  };
  const parts = new Map();
  function read(id) {
    const r = db.prepare("SELECT * FROM political_archives WHERE id=?").get(id);
    return r
      ? {
          revision: r.revision,
          data: JSON.parse(
            gunzipSync(r.payload, { maxOutputLength: 40000000 }),
          ),
        }
      : null;
  }
  if (stored)
    try {
      const meta = JSON.parse(gunzipSync(stored.payload));
      const strings = new Map();
      for (const year of meta.years) {
        const p = read("history:" + year);
        if (!p) throw Error("Incomplete archive");
        internRows(p.data.rows, strings);
        parts.set(year, p);
      }
      snapshot = {
        ...meta,
        rows: [...parts.values()].flatMap((p) => p.data.rows),
        documents: [
          ...new Set([...parts.values()].flatMap((p) => p.data.documents)),
        ],
      };
    } catch {
      parts.clear();
      sync.etag = null;
    }
  function saveSync() {
    db.prepare(
      "INSERT INTO political_sync(id,checked_at,attempted_at,next_check_at,etag,failures,last_error) VALUES('history',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,attempted_at=excluded.attempted_at,next_check_at=excluded.next_check_at,etag=excluded.etag,failures=excluded.failures,last_error=excluded.last_error",
    ).run(
      sync.checked_at,
      sync.attempted_at,
      sync.next_check_at,
      sync.etag,
      sync.failures,
      sync.last_error,
    );
  }
  function schedule() {
    if (!started || stopped) return;
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        void refresh().catch(() => {});
      },
      Math.max(1000, sync.next_check_at - now()),
    );
    timer.unref?.();
  }
  async function shard(f, signal) {
    const { bytes } = await sourceBytes(fetcher, BASE + f.publicPath, {
      limit: f.size,
      signal,
    });
    if (
      bytes.length !== f.size ||
      createHash("sha256").update(bytes).digest("hex") !== f.sha256
    )
      throw Error("Archive checksum mismatch");
    return { table: f.table, bytes };
  }
  function refresh() {
    if (inflight) return inflight;
    if (stopped) return Promise.resolve();
    controller = new AbortController();
    sync.attempted_at = now();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(180000),
    ]);
    inflight = (async () => {
      const result = await sourceBytes(fetcher, BASE + "snapshot.json", {
        signal,
        limit: 500000,
        etag: snapshot ? sync.etag : null,
      });
      if (!result.unchanged) {
        const manifest = JSON.parse(result.bytes),
          files = validateHistoryManifest(manifest),
          years = [...new Set(files.map((f) => f.year))].sort();
        if (snapshot && snapshot.years.some((y) => !years.includes(y)))
          throw Error("Historical partitions disappeared");
        const next = new Map(),
          strings = new Map();
        for (const year of [...years].reverse()) {
          const selected = files.filter((f) => f.year === year),
            revision = createHash("sha256")
              .update(selected.map((f) => f.sha256).join(":"))
              .digest("hex");
          if (parts.get(year)?.revision === revision) {
            next.set(year, parts.get(year));
            continue;
          }
          const shards = [];
          for (const f of selected) {
            shards.push(await shard(f, signal));
            await yieldTurn();
          }
          const decoded = await decodeHistory(shards, now(), signal);
          internRows(decoded.data.rows, strings);
          next.set(year, { revision, ...decoded });
        }
        const meta = {
          years,
          revision:
            manifest.sourceFingerprint ||
            createHash("sha256").update(result.bytes).digest("hex"),
          publishedAt: manifest.generatedAt,
          sourceCheckedAt: manifest.lastSourceCheckAt,
          source: HISTORY_SOURCE,
          failedFilings: manifest.totals?.failedFilings || 0,
        };
        if (stopped) return;
        db.exec("BEGIN IMMEDIATE");
        try {
          const put = db.prepare(
            "INSERT INTO political_archives(id,revision,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at",
          );
          for (const [year, p] of next)
            if (parts.get(year)?.revision !== p.revision)
              put.run("history:" + year, p.revision, p.payload, now());
          put.run(
            "history:meta",
            meta.revision,
            gzipSync(JSON.stringify(meta)),
            now(),
          );
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        parts.clear();
        for (const [year, p] of next) {
          delete p.payload;
          parts.set(year, p);
        }
        snapshot = {
          ...meta,
          rows: [...next.values()].flatMap((p) => p.data.rows),
          documents: [
            ...new Set([...next.values()].flatMap((p) => p.data.documents)),
          ],
        };
        sync.etag = result.etag;
      }
      Object.assign(sync, {
        checked_at: now(),
        next_check_at: now() + CHECK_MS,
        failures: 0,
        last_error: null,
      });
      saveSync();
    })()
      .catch((e) => {
        if (stopped) return;
        sync.failures++;
        sync.last_error = "Archive temporarily unavailable";
        sync.next_check_at =
          now() +
          Math.max(
            Math.min(3600000, 60000 * 2 ** Math.min(6, sync.failures - 1)),
            Math.min(86400000, e.retryAfter || 0),
          );
        saveSync();
        if (!snapshot) throw e;
      })
      .finally(() => {
        inflight = null;
        controller = null;
        schedule();
      });
    return inflight;
  }
  return {
    get() {
      if (now() >= sync.next_check_at) void refresh().catch(() => {});
      return {
        ...snapshot,
        status: snapshot
          ? sync.last_error
            ? "cached"
            : "available"
          : inflight
            ? "importing"
            : "unavailable",
        checkedAt: sync.checked_at,
        nextCheckAt: sync.next_check_at,
        refreshing: !!inflight,
      };
    },
    refresh,
    start() {
      if (!enabled || started || stopped) return;
      started = true;
      schedule();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      await inflight?.catch(() => {});
    },
  };
}

// Parquet decoding is transient and memory-heavy. Release its heap after each partition.
function decodeHistory(shards, now, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./history-worker.js", import.meta.url), {
      workerData: { shards, now },
      resourceLimits: { maxOldGenerationSizeMb: 192 },
      execArgv: [],
    });
    const abort = () => {
      void worker.terminate();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    const clean = () => signal.removeEventListener("abort", abort);
    worker.once("message", (data) => {
      clean();
      resolve(data);
      void worker.terminate();
    });
    worker.once("error", (e) => {
      clean();
      reject(e);
    });
    worker.once("exit", (code) => {
      clean();
      if (code !== 0) reject(Error("Archive decoder stopped"));
    });
  });
}
