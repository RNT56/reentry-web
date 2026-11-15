import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import {
  normalizePoliticalFeed,
  portraitURL,
  createPoliticalFeed,
} from "../server/politics/feed.js";
import {
  summarizeDisclosures,
  filterDisclosures,
} from "../server/politics/routes.js";
const now = Date.parse("2026-11-15T12:00:00Z");
const trade = {
  id: "house_123_t0",
  filer_id: "person-a",
  filer_name: "Example Member",
  source_id: "house_clerk",
  filing_date: "2026-11-12",
  transaction_date: "2026-10-20",
  ticker: "AAPL",
  asset_name: "Apple",
  transaction_type: "Purchase",
  amount_range_low: 1001,
  amount_range_high: 15000,
  amount_range_label: "$1,001 - $15,000",
  owner: "Spouse",
  party: "D",
  state: "CA",
  doc_url:
    "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/123.pdf",
};
const people = [
  {
    id: "person-a",
    full_name: "Example Member",
    photo_url:
      "https://unitedstates.github.io/images/congress/225x275/P000197.jpg",
  },
];
const normalize = (rows = [trade]) =>
  normalizePoliticalFeed(rows, people, { now });
test("Disclosures preserve range, owner, trade and filing dates, and official links; duplicates collapse", () => {
  const data = normalize([trade, trade]);
  assert.equal(data.rows.length, 1);
  const r = data.rows[0];
  assert.equal(r.lag, 23);
  assert.equal(r.owner, "Spouse");
  assert.equal(r.low, 1001);
  assert.equal(r.high, 15000);
  assert.equal(r.side, "buy");
  assert.equal(r.url, trade.doc_url);
  assert.equal(r.portrait, people[0].photo_url);
  assert.equal(r.chamber, "house");
  assert.equal("ret_since" in r, false);
});
test("Feed validation rejects unsafe provenance, invalid dates, malformed ranges and future filings", () => {
  for (const patch of [
    { doc_url: "javascript:alert(1)" },
    { doc_url: "https://evil.test/x" },
    { transaction_date: "2026-02-31" },
    { filing_date: "2030-01-01" },
    { transaction_date: "2026-11-14" },
    { amount_range_high: 2 },
    { source_id: "unknown" },
  ])
    assert.throws(() => normalize([{ ...trade, ...patch }]));
  assert.equal(portraitURL("https://evil.test/photo.jpg"), null);
  assert.equal(
    portraitURL(
      "https://unitedstates.github.io.evil.test/images/congress/225x275/P000197.jpg",
    ),
    null,
  );
});
test("Unknown ticker, owner and amount stay unknown; no inferred prices or totals", () => {
  const r = normalize([
    {
      ...trade,
      ticker: null,
      owner: null,
      amount_range_low: null,
      amount_range_high: null,
      transaction_type: "Unknown",
    },
  ]).rows[0];
  assert.equal(r.ticker, null);
  assert.equal(r.owner, "Unspecified");
  assert.equal(r.low, null);
  assert.equal(r.side, "other");
});
test("Political filters and aggregation use filing date and transaction counts, with exact private asset scopes", () => {
  const rows = normalize([
    trade,
    {
      ...trade,
      id: "2",
      ticker: "MSFT",
      transaction_type: "Sale (Full)",
      filer_id: "person-b",
      filer_name: "Other Member",
    },
    {
      ...trade,
      id: "3",
      filing_date: "2026-09-01",
      transaction_date: "2026-08-01",
      transaction_type: "Exchange",
    },
  ]).rows;
  assert.equal(filterDisclosures(rows, { days: 30 }, null, now).length, 2);
  assert.equal(
    filterDisclosures(rows, { days: 0, side: "buy" }, new Set(["MSFT"]), now)
      .length,
    0,
  );
  assert.equal(
    filterDisclosures(rows, { days: 0, q: "other" }, null, now).length,
    1,
  );
  assert.equal(filterDisclosures(rows, { days: 0 }, new Set(), now).length, 0);
  const s = summarizeDisclosures(rows);
  assert.equal(s.buys, 1);
  assert.equal(s.sells, 1);
  assert.equal(s.people, 2);
  assert.equal(s.medianLag, 23);
  assert.equal(s.tickers.find((a) => a.symbol === "AAPL").count, 2);
  assert.equal(s.flow.length, 2);
  assert.throws(() => filterDisclosures(rows, { days: -1 }));
});
function fixture(t, fetcher) {
  const db = openStore(":memory:");
  migratePlatform(db);
  const service = createPoliticalFeed({ db, fetcher, now: () => now });
  t.after(async () => {
    await service.stop();
    db.close();
  });
  return { db, service };
}
const sha = "a".repeat(40);
const mock = (url) =>
  new Response(
    JSON.stringify(
      url.includes("/commits?")
        ? [{ sha, commit: { committer: { date: "2026-11-13T00:00:00Z" } } }]
        : url.endsWith("/filers.json")
          ? people
          : [trade],
    ),
  );
test("Feed pins files to a revision, coalesces refreshes, persists, and serves last good data on failures", async (t) => {
  let calls = 0,
    fail = false;
  const { db, service } = fixture(t, async (url) => {
    calls++;
    if (fail) throw Error("offline");
    if (!url.includes("/commits?")) assert.ok(url.includes("/" + sha + "/"));
    return mock(url);
  });
  await Promise.all([service.refresh(), service.refresh()]);
  assert.equal(calls, 3);
  const first = await service.get();
  assert.equal(first.rows.length, 1);
  assert.equal(first.status, "available");
  fail = true;
  await service.refresh();
  const offline = await service.get();
  assert.equal(offline.rows.length, 1);
  assert.equal(offline.status, "cached");
  const saved = db.prepare("SELECT * FROM political_feed").get();
  assert.ok(saved.version.startsWith(sha));
  const restart = createPoliticalFeed({
    db,
    fetcher: () => {
      throw Error("Unexpected fetch");
    },
    now: () => now,
  });
  assert.equal((await restart.get()).rows.length, 1);
  await restart.stop();
  const sources = await service.evidence({ symbol: "AAPL" });
  assert.equal(sources[0].published_at, Date.parse(trade.filing_date));
  assert.ok(sources[0].content.includes("not an exact"));
  assert.equal((await service.evidence({ symbol: "NVDA" })).length, 0);
});
test("Unavailable initial sources stay empty and malformed replacements cannot destroy a valid snapshot", async (t) => {
  let bad = true;
  const { service } = fixture(t, async (url) =>
    bad ? new Response("{}") : mock(url),
  );
  assert.equal((await service.get()).status, "unavailable");
  bad = false;
  await service.refresh();
  bad = true;
  await service.refresh();
  assert.equal((await service.get()).rows.length, 1);
});
