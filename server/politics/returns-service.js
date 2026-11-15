import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { careerProfile } from "./career.js";
import {
  estimateReturns,
  prepareReturns,
  returnCutoff,
  RETURN_MODEL_VERSION,
} from "./returns-model.js";
import { POLITICAL_CHECK_INTERVAL } from "./schedule.js";
import { performanceBenchmarks } from "./performance.js";

// Public, shared calculations. No user holdings, credentials or AI calls enter
// this service. A single bounded queue coalesces requests across all accounts.
export function createPoliticalReturns({ db, market, now = Date.now }) {
  const clock = typeof now === "function" ? now : () => now;
  const jobs = new Map();
  let running = null,
    stopped = false;
  const unpack = (row) => {
    try {
      return row
        ? JSON.parse(gunzipSync(row.payload, { maxOutputLength: 4000000 }))
        : null;
    } catch {
      return null;
    }
  };
  async function prices(symbol) {
    const cached = db
        .prepare("SELECT * FROM political_return_prices WHERE symbol=?")
        .get(symbol),
      value = unpack(cached);
    if (cached?.next_check > clock())
      return clock() - cached.checked_at <= POLITICAL_CHECK_INTERVAL
        ? value
        : null;
    try {
      const result = await market.returnHistory(symbol);
      if (stopped) return null;
      db.prepare(
        "INSERT INTO political_return_prices VALUES(?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET payload=excluded.payload,checked_at=excluded.checked_at,next_check=excluded.next_check",
      ).run(
        symbol,
        gzipSync(JSON.stringify(result)),
        clock(),
        clock() + POLITICAL_CHECK_INTERVAL,
      );
      return result;
    } catch {
      if (stopped) return null;
      db.prepare(
        "INSERT INTO political_return_prices VALUES(?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET next_check=excluded.next_check",
      ).run(symbol, gzipSync("null"), clock(), clock() + 3600000);
      // Stale series are not silently substituted for a new estimate.
      return null;
    }
  }
  async function execute(job) {
    const histories = new Map(),
      symbols = [
        ...new Set([
          ...prepareReturns(job.rows, returnCutoff(job.career, clock()))
            .symbols,
          ...performanceBenchmarks.map((b) => b.symbol),
        ]),
      ];
    job.total = symbols.length;
    for (let i = 0; i < symbols.length && !stopped; i += 3) {
      await Promise.all(
        symbols.slice(i, i + 3).map(async (symbol) => {
          const h = await prices(symbol);
          if (h) histories.set(symbol, h);
          job.done++;
        }),
      );
    }
    if (stopped) return;
    const result = estimateReturns(job.rows, histories, job.career, clock());
    const missingPrices = Boolean(
      result.coverage.reasons.some((r) => r.key === "price") ||
        result.performance?.benchmarks.some((b) => !b.available),
    );
    // Keep a previously usable estimate available during a complete outage.
    if (!result.available && missingPrices && job.previous?.available) {
      db.prepare(
        "UPDATE political_return_estimates SET next_check=?,fingerprint=?,failed=1 WHERE member=?",
      ).run(clock() + 3600000, job.fingerprint, job.id);
      return;
    }
    db.prepare(
      "INSERT INTO political_return_estimates VALUES(?,?,?,?,?,?) ON CONFLICT(member) DO UPDATE SET fingerprint=excluded.fingerprint,payload=excluded.payload,updated_at=excluded.updated_at,next_check=excluded.next_check,failed=excluded.failed",
    ).run(
      job.id,
      job.fingerprint,
      gzipSync(JSON.stringify(result)),
      clock(),
      clock() + (missingPrices ? 3600000 : POLITICAL_CHECK_INTERVAL),
      Number(missingPrices),
    );
  }
  function pump() {
    if (running || stopped || !jobs.size) return;
    const job = jobs.values().next().value;
    job.state = "calculating";
    running = execute(job)
      .catch(() => {
        // Avoid a hot retry loop even for an unexpected provider/schema failure.
        if (!stopped)
          db.prepare(
            "INSERT INTO political_return_estimates VALUES(?,?,?,?,?,1) ON CONFLICT(member) DO UPDATE SET fingerprint=excluded.fingerprint,next_check=excluded.next_check,failed=1",
          ).run(
            job.id,
            job.fingerprint,
            gzipSync("null"),
            clock(),
            clock() + 3600000,
          );
      })
      .finally(() => {
        jobs.delete(job.id);
        running = null;
        pump();
      });
  }
  return {
    get(person, allRows, { knownRevision } = {}) {
      if (stopped) return { status: "unavailable", result: null };
      const rows = allRows.filter((r) => r.memberId === person.id),
        career = careerProfile(person, rows, clock()),
        fingerprint = createHash("sha256")
          .update(
            JSON.stringify([
              RETURN_MODEL_VERSION,
              person.id,
              career.salary,
              returnCutoff(career, clock()),
              rows.map((r) => [
                r.id,
                r.ticker,
                r.asset,
                r.assetType,
                r.owner,
                r.low,
                r.high,
                r.side,
                r.type,
                r.traded,
                r.comment,
              ]),
            ]),
          )
          .digest("hex"),
        cached = db
          .prepare("SELECT * FROM political_return_estimates WHERE member=?")
          .get(person.id),
        result = unpack(cached);
      // A failed run's retry deadline applies even if the prior good fingerprint
      // is older; otherwise every browser poll would start another failed job.
      const deferredFailure =
        cached &&
        cached.failed &&
        cached.next_check > clock() &&
        (cached.fingerprint === fingerprint ||
          result?.modelVersion === RETURN_MODEL_VERSION);
      const fresh =
        cached?.fingerprint === fingerprint &&
        result?.modelVersion === RETURN_MODEL_VERSION &&
        cached.next_check > clock() &&
        clock() - cached.updated_at <= POLITICAL_CHECK_INTERVAL;
      if (
        !fresh &&
        !deferredFailure &&
        !jobs.has(person.id) &&
        jobs.size < 20
      ) {
        jobs.set(person.id, {
          id: person.id,
          rows,
          career,
          fingerprint,
          previous: result,
          done: 0,
          total: 0,
          state: "queued",
        });
        pump();
      }
      const job = jobs.get(person.id);
      const busy = !job && !fresh && !deferredFailure && jobs.size >= 20;
      const revision = cached
        ? `${cached.updated_at}.${cached.fingerprint}`
        : null;
      return {
        status:
          job?.state ||
          (busy
            ? "busy"
            : fresh && result
              ? cached.failed
                ? "partial"
                : "ready"
              : result
                ? "stale"
                : "unavailable"),
        progress: job ? { done: job.done, total: job.total } : null,
        result: revision && revision === knownRevision ? null : result,
        revision,
        updatedAt: cached?.updated_at || null,
        nextCheckAt: cached?.next_check || null,
      };
    },
    async stop() {
      stopped = true;
      if (running) await running;
      jobs.clear();
    },
  };
}
