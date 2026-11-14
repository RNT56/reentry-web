import { id, transaction } from "../platform/util.js";

const day = 86400000;
const finitePrice = (value) =>
  Number.isFinite(value) && value > 0 && value <= 1e12;

/** A daily provider timestamp identifies a session, not its closing instant. */
export function completedDailyBars(history, now = Date.now()) {
  if (history?.interval !== "1d" || !Array.isArray(history.points)) return [];
  if (history.points.length > 550)
    throw Error("Daily history exceeds its bound.");
  let format = null;
  if (typeof history.timeZone === "string") {
    try {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone: history.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      // Without an exchange zone, wait a full 48 hours after the bar timestamp.
    }
  }
  const dateKey = (time) => {
    const parts = Object.fromEntries(
      format.formatToParts(time).map((part) => [part.type, part.value]),
    );
    return parts.year + "-" + parts.month + "-" + parts.day;
  };
  const boundaries = new Map();
  const completedAt = (time) => {
    if (!format) return time + 2 * day;
    const key = dateKey(time);
    if (boundaries.has(key)) return boundaries.get(key);
    // Find the first instant on the next local calendar day, including DST.
    let low = time,
      high = time + 2 * day;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (dateKey(middle) <= key) low = middle;
      else high = middle;
    }
    boundaries.set(key, high);
    return high;
  };
  const bars = [];
  let previous = -Infinity;
  for (const point of history.points) {
    const time = point?.time * 1000;
    if (!Number.isSafeInteger(time) || time <= previous)
      throw Error("Daily history is not chronologically ordered.");
    previous = time;
    if (
      time <= 0 ||
      time > now ||
      !finitePrice(point.price) ||
      (point.close !== undefined && point.close !== point.price)
    )
      continue;
    const occurredAt = completedAt(time);
    if (occurredAt > now) continue;
    bars.push({ value: point.price, occurredAt, sessionAt: time });
  }
  return bars;
}

const crosses = (value, condition) =>
  finitePrice(condition?.price) &&
  (condition.direction === "above"
    ? value > condition.price
    : condition.direction === "below" && value < condition.price);

/** Record exact observed daily-close conditions; model prose never verifies events. */
export async function observeChartPrices(db, market, row, now = Date.now()) {
  const branches = JSON.parse(row.branches);
  const currencies = [...new Set(branches.map((branch) => branch.currency))];
  if (
    currencies.length !== 1 ||
    !["EUR", "USD"].includes(currencies[0]) ||
    !branches.length ||
    branches.length > 4 ||
    branches.some(
      (branch) =>
        !finitePrice(branch.chartCondition?.price) ||
        !finitePrice(branch.chartInvalidation?.price) ||
        !["above", "below"].includes(branch.chartCondition.direction) ||
        !["above", "below"].includes(branch.chartInvalidation.direction),
    )
  )
    return;
  const currency = currencies[0];
  const latest = db
    .prepare(
      "SELECT MAX(occurred_at) AS time FROM scenario_observations WHERE set_id=? AND kind='price'",
    )
    .get(row.id).time;
  const range = now - (latest || row.created_at) > 25 * day ? "1y" : "1mo";
  const history = await market.history(row.symbol, range, currency);
  if (history?.symbol !== row.symbol || history.currency !== currency) return;
  const bars = completedDailyBars(history, now).filter(
    // The provider does not supply an exact exchange closing instant. Skip the
    // publication session: a close before publication must never appear as an
    // outcome after publication merely because midnight is later.
    (bar) =>
      bar.sessionAt >= row.created_at && bar.occurredAt >= row.created_at,
  );
  if (!bars.length) return;
  const source = String(history.source || "Market history").slice(0, 140);
  const url = `https://finance.yahoo.com/quote/${encodeURIComponent(row.symbol)}/history/`;
  transaction(db, () => {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO scenario_observations VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    );
    const existing = new Set(
      db
        .prepare(
          "SELECT DISTINCT event_key FROM scenario_observations WHERE set_id=? AND kind='event'",
        )
        .all(row.id)
        .map((event) => event.event_key),
    );
    for (const bar of bars) {
      insert.run(
        id(),
        row.id,
        "price",
        "daily-close",
        bar.value,
        currency,
        1,
        source + " · completed daily close",
        url,
        bar.occurredAt,
        now,
      );
      for (const branch of branches) {
        const deadline = row.created_at + branch.horizonDays * day;
        if (bar.occurredAt > deadline) continue;
        for (const [suffix, condition] of [
          ["", branch.chartCondition],
          ["-invalidated", branch.chartInvalidation],
        ]) {
          const key = branch.eventKey + suffix;
          if (existing.has(key) || !crosses(bar.value, condition)) continue;
          insert.run(
            id(),
            row.id,
            "event",
            key,
            bar.value,
            currency,
            1,
            `${source} · daily close ${condition.direction} ${condition.price} ${currency}`,
            url,
            bar.occurredAt,
            now,
          );
          existing.add(key);
        }
      }
    }
    db.prepare("UPDATE scenario_sets SET last_check=? WHERE id=?").run(
      now,
      row.id,
    );
  });
}
