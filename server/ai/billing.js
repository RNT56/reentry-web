import { id, fail, transaction, audit } from "../platform/util.js";
import { priceFor, reservationFor, costFor } from "./catalog.js";
export const monthStart = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
export function spending(db, user, now = Date.now()) {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN created_at>=? AND state IN ('settled','reconciled') THEN cost ELSE 0 END),0) AS spent,COALESCE(SUM(CASE WHEN state IN ('reserved','uncertain') THEN reserved ELSE 0 END),0) AS held FROM ai_ledger WHERE user_id=?`,
    )
    .get(monthStart(now), user);
  // Outstanding holds carry across month boundaries until reconciled.
  return {
    ...totals,
    month: new Date(monthStart(now)).toISOString().slice(0, 7),
    currency: "USD",
  };
}
export function preferences(db, user) {
  db.prepare(
    "INSERT OR IGNORE INTO ai_preferences(user_id,updated_at) VALUES(?,?)",
  ).run(user, Date.now());
  return db.prepare("SELECT * FROM ai_preferences WHERE user_id=?").get(user);
}
export function reserve(db, job, prompt, now = Date.now()) {
  return transaction(db, () => {
    const p = preferences(db, job.user_id);
    if (!p.enabled || !p.consent_at)
      throw fail("Enable AI and approve data sharing in AI settings.", 409);
    const pricing = priceFor(job.model, now),
      reserved = reservationFor(prompt, pricing),
      totals = spending(db, job.user_id, now);
    if (
      reserved > p.run_limit ||
      reserved + totals.spent + totals.held > p.monthly_limit
    )
      throw fail("Spending limit reached. No AI request was sent.", 409);
    db.prepare(
      "INSERT INTO ai_ledger(id,job_id,user_id,provider,model,state,reserved,pricing,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      id(),
      job.id,
      job.user_id,
      job.provider,
      job.model,
      "reserved",
      reserved,
      JSON.stringify(pricing),
      now,
    );
    return { pricing, reserved };
  });
}
export function settle(db, job, response, pricing) {
  const totalInput =
    response.usage.input +
    response.usage.cached +
    response.usage.write5m +
    response.usage.write1h;
  const priced =
    totalInput > 100000 ? priceFor(job.model, Date.now(), totalInput) : pricing;
  db.prepare(
    "UPDATE ai_ledger SET usage=?,request_id=?,response_model=? WHERE job_id=? AND state='reserved'",
  ).run(
    JSON.stringify({ ...response.usage, reported: response.reportedUsage }),
    response.requestId,
    response.responseModel,
    job.id,
  );
  // Never silently price a different model returned by provider routing.
  if (
    response.responseModel !== job.model &&
    !new RegExp(
      "^" + job.model.replaceAll(".", "\\.") + "-(?:[0-9]{3}|[0-9]{8})$",
    ).test(response.responseModel)
  )
    throw fail(
      "Provider routed to an unpriced model. Usage needs reconciliation.",
      409,
    );
  const cost = costFor(response.usage, priced);
  db.prepare(
    "UPDATE ai_ledger SET state='settled',cost=?,usage=?,request_id=?,response_model=?,pricing=?,settled_at=? WHERE job_id=? AND state='reserved'",
  ).run(
    cost,
    JSON.stringify({ ...response.usage, reported: response.reportedUsage }),
    response.requestId,
    response.responseModel,
    JSON.stringify(priced),
    Date.now(),
    job.id,
  );
  const row = db
    .prepare("SELECT reserved FROM ai_ledger WHERE job_id=?")
    .get(job.id);
  if (cost > row.reserved) {
    db.prepare("UPDATE ai_preferences SET enabled=0 WHERE user_id=?").run(
      job.user_id,
    );
    audit(db, job.user_id, "reservation-overrun", {
      job: job.id,
      cost,
      reserved: row.reserved,
    });
  }
  return cost;
}
export function release(db, jobId, uncertain) {
  db.prepare(
    "UPDATE ai_ledger SET state=?,cost=?,settled_at=? WHERE job_id=? AND state='reserved'",
  ).run(
    uncertain ? "uncertain" : "settled",
    uncertain ? null : 0,
    uncertain ? null : Date.now(),
    jobId,
  );
}
