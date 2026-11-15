import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import {
  normalizePoliticalFeed,
  portraitURL,
  createPoliticalFeed,
  POLITICAL_CHECK_INTERVAL,
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

test("Real published Pelosi, Blumenthal and Gottheimer filings retain identity, ownership, ranges and portraits", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/political-named-filings.json", import.meta.url),
    ),
  );
  const data = normalizePoliticalFeed(fixture.rows, fixture.people, { now });
  assert.equal(data.rejected, 0);
  assert.deepEqual(data.people.map((p) => p.name).sort(), [
    "Josh Gottheimer",
    "Nancy Pelosi",
    "Richard Blumenthal",
  ]);
  const pelosi = data.rows.find((r) => r.member === "Nancy Pelosi");
  assert.equal(pelosi.owner, "Spouse");
  assert.equal(pelosi.ticker, "WBD");
  assert.equal(pelosi.filed, "2026-11-06");
  assert.equal(pelosi.low, 50001);
  assert.equal(pelosi.high, 100000);
  assert.ok(pelosi.portrait.endsWith("P000197.jpg"));
  assert.equal(
    data.rows.find((r) => r.member === "Josh Gottheimer").owner,
    "Joint",
  );
  assert.equal(
    data.rows
      .find((r) => r.member === "Richard Blumenthal")
      .asset.includes("\n"),
    false,
  );
});

test("People remain discoverable outside the rolling feed; featured profiles are not hidden by activity rankings", async () => {
  const { politicalPeople, featuredPeople } = await import(
    "../server/politics/people.js"
  );
  const directory = politicalPeople(
    [
      {
        id: "house_nancy_pelosi",
        full_name: "Nancy Pelosi",
        chamber: "house",
        trade_count: 9999,
      },
    ],
    normalize().rows,
  );
  const p = directory.find((p) => p.name === "Nancy Pelosi");
  assert.equal(p.count, 0); // Do not use an upstream lifetime count for our partial feed.
  assert.equal(p.latestFiled, null);
  assert.equal(
    featuredPeople([
      ...Array.from({ length: 20 }, (_, i) => ({ id: String(i) })),
      p,
    ])[0].id,
    p.id,
  );
});

test("Twelve-hour checks use ETags and never redownload unchanged datasets; manual checks share a cooldown", async (t) => {
  let clock = now,
    calls = 0;
  const db = openStore(":memory:");
  migratePlatform(db);
  const service = createPoliticalFeed({
    db,
    now: () => clock,
    fetcher: async (url, options) => {
      calls++;
      if (url.includes("/commits?")) {
        if (options.headers["If-None-Match"]) {
          assert.equal(options.headers["If-None-Match"], '"revision-1"');
          return new Response(null, { status: 304 });
        }
        return new Response(
          JSON.stringify([
            {
              sha,
              commit: { committer: { date: new Date(now).toISOString() } },
            },
          ]),
          { headers: { ETag: '"revision-1"' } },
        );
      }
      return mock(url);
    },
  });
  t.after(async () => {
    await service.stop();
    db.close();
  });
  const first = await service.get();
  assert.equal(calls, 3);
  await service.get({ force: true });
  assert.equal(calls, 3);
  clock += 60000;
  const checked = await service.get({ force: true });
  assert.equal(calls, 4);
  assert.equal(checked.version, first.version);
  assert.equal(checked.fetchedAt, first.fetchedAt);
  assert.equal(checked.checkedAt, clock);
  assert.equal(checked.nextCheckAt, clock + POLITICAL_CHECK_INTERVAL);
  clock += POLITICAL_CHECK_INTERVAL;
  await service.get({ force: true });
  assert.equal(calls, 5);
  const restart = createPoliticalFeed({
    db,
    now: () => clock,
    fetcher: () => {
      throw Error("Must retain shared cooldown");
    },
  });
  const restarted = await restart.get({ force: true });
  assert.equal(restarted.checkedAt, clock);
  assert.equal(restarted.status, "available");
  await restart.stop();
});

test("New revisions replace snapshots atomically; failed imports keep the last verified data and retry after backoff", async (t) => {
  let clock = now,
    revision = sha,
    broken = false,
    count = 0;
  const db = openStore(":memory:");
  migratePlatform(db);
  const service = createPoliticalFeed({
    db,
    now: () => clock,
    fetcher: async (url) => {
      count++;
      if (url.includes("/commits?"))
        return Response.json([
          {
            sha: revision,
            commit: { committer: { date: new Date(clock).toISOString() } },
          },
        ]);
      if (url.endsWith("filers.json")) return Response.json(people);
      return Response.json(
        broken
          ? [{ ...trade, doc_url: "https://evil.test/filing" }]
          : [{ ...trade, id: revision }],
      );
    },
  });
  t.after(async () => {
    await service.stop();
    db.close();
  });
  const first = await service.get();
  clock += POLITICAL_CHECK_INTERVAL;
  revision = "b".repeat(40);
  broken = true;
  const failed = await service.get({ force: true });
  assert.equal(failed.version, first.version);
  assert.equal(failed.status, "cached");
  assert.equal(failed.checkedAt, first.checkedAt);
  const before = count;
  await service.get({ force: true });
  assert.equal(count, before);
  broken = false;
  clock = failed.nextCheckAt;
  const recovered = await service.get({ force: true });
  assert.notEqual(recovered.version, first.version);
  assert.equal(recovered.rows[0].id, revision);
  assert.equal(recovered.status, "available");
  assert.equal(recovered.checkedAt, clock);
});

test("Rate limits survive restarts and override manual refresh without a request storm", async (t) => {
  let clock = now,
    calls = 0;
  const db = openStore(":memory:");
  migratePlatform(db);
  const options = {
    db,
    now: () => clock,
    fetcher: async () => {
      calls++;
      return new Response("limited", {
        status: 429,
        headers: { "Retry-After": "900" },
      });
    },
  };
  const service = createPoliticalFeed(options);
  t.after(() => db.close());
  const first = await service.get();
  assert.equal(first.status, "unavailable");
  assert.equal(first.nextCheckAt, now + 900000);
  await service.stop();
  const restart = createPoliticalFeed(options);
  t.after(() => restart.stop());
  clock += 60000;
  await Promise.all(
    Array.from({ length: 20 }, () => restart.get({ force: true })),
  );
  assert.equal(calls, 1);
  clock = first.nextCheckAt;
  await restart.get({ force: true });
  assert.equal(calls, 2);
});

test("A recently checked old publication is marked delayed, never presented as newly published", async (t) => {
  const db = openStore(":memory:");
  migratePlatform(db);
  const service = createPoliticalFeed({
    db,
    now: () => now + 5 * 86400000,
    fetcher: mock,
  });
  t.after(async () => {
    await service.stop();
    db.close();
  });
  const data = await service.get();
  assert.equal(data.status, "delayed");
  assert.equal(data.publishedAt, "2026-11-13T00:00:00Z");
  assert.equal(data.checkedAt, now + 5 * 86400000);
});

test("The background worker checks at the next due time even with no visitors and stops cleanly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = now,
    calls = 0;
  const db = openStore(":memory:");
  migratePlatform(db);
  const service = createPoliticalFeed({
    db,
    enabled: true,
    now: () => clock,
    fetcher: async (url) => {
      calls++;
      return mock(url);
    },
  });
  t.after(async () => {
    await service.stop();
    db.close();
  });
  service.start();
  service.start();
  await service.refresh();
  assert.equal(calls, 3);
  clock += POLITICAL_CHECK_INTERVAL - 1;
  t.mock.timers.tick(POLITICAL_CHECK_INTERVAL - 1);
  assert.equal(calls, 3);
  clock++;
  t.mock.timers.tick(1);
  await service.refresh();
  assert.equal(calls, 4);
  await service.stop();
  clock += POLITICAL_CHECK_INTERVAL;
  t.mock.timers.tick(POLITICAL_CHECK_INTERVAL);
  assert.equal(calls, 4);
});

test("A deployed five-minute cache adopts the twelve-hour cadence without fetching or rewriting it", async (t) => {
  const { db, service } = fixture(t, mock);
  await service.refresh();
  const oldDue = now + 300000;
  db.prepare("UPDATE political_sync SET next_check_at=? WHERE id='kadoa'").run(
    oldDue,
  );
  let calls = 0;
  const restart = createPoliticalFeed({
    db,
    now: () => now + 600000,
    fetcher: async () => {
      calls++;
      throw Error("Unexpected fetch");
    },
  });
  t.after(() => restart.stop());
  const d = await restart.get();
  assert.equal(calls, 0);
  assert.equal(d.nextCheckAt, now + 12 * 3600000);
  assert.equal(d.checkIntervalMs, 12 * 3600000);
  assert.equal(
    db
      .prepare("SELECT next_check_at FROM political_sync WHERE id='kadoa'")
      .get().next_check_at,
    oldDue,
  );
});
