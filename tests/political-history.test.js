import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import fs from "node:fs";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import {
  normalizeHistory,
  officialDocument,
  validateHistoryManifest,
  createPoliticalHistory,
} from "../server/politics/history.js";
import { mergePoliticalSources } from "../server/politics/service.js";
import {
  powerStruggle,
  matchingPeople,
  filterDisclosures,
} from "../server/politics/routes.js";
import { careerProfile } from "../server/politics/career.js";
import { sourceBytes } from "../server/politics/network.js";
import portraits from "../server/politics/catalog/portraits.json" with { type: "json" };
const now = Date.parse("2026-11-15T12:00:00Z");
const url =
  "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033725.pdf";
const filing = {
  docId: "20033725",
  sourceUrl: url,
  filingDate: "2026-01-23T00:00:00Z",
  extractionStatus: "ok",
};
const event = {
  eventId: "house:20033725:17",
  version: 1,
  sourceDocId: "20033725",
  sourceUrl: url,
  memberId: "P000197",
  displayName: "Nancy Pelosi",
  chamber: "house",
  transactionDate: "2025-12-30T00:00:00Z",
  availableAt: "2026-01-24T04:59:59Z",
  action: "sale",
  owner: "spouse",
  ticker: "DIS",
  assetDescription: "Walt Disney",
  amountLow: 1000001,
  amountHigh: 5000000,
  contributorRowIds: '["20033725:17","20000001:2"]',
};
const row = () => normalizeHistory([event], [filing], now).rows[0];
test("Historical events preserve the real filing day, owner, ranges and first availability; native Parquet dates work", () => {
  const r = normalizeHistory(
    [
      {
        ...event,
        transactionDate: new Date(event.transactionDate),
        availableAt: new Date(event.availableAt),
      },
    ],
    [{ ...filing, filingDate: new Date(filing.filingDate) }],
    now,
  ).rows[0];
  assert.equal(r.filed, "2026-01-23");
  assert.equal(r.owner, "Spouse");
  assert.equal(r.low, 1000001);
  assert.equal(r.high, 5000000);
  assert.equal(r.availableAt, event.availableAt.replace("Z", ".000Z"));
  assert.equal(r.lag, 24);
});
test("Amendments supersede old versions and covered original documents prevent cross-feed duplicates", () => {
  const h = normalizeHistory(
    [
      { ...event, version: 1, supersededAt: "2026-02-01" },
      { ...event, version: 2, amountHigh: 10000000 },
    ],
    [filing],
    now,
  );
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].high, 10000000);
  assert.ok(h.documents.includes("house:20000001"));
  const p = {
    id: "house_nancy_pelosi",
    name: "Nancy Pelosi",
    portrait:
      "https://unitedstates.github.io/images/congress/225x275/P000197.jpg",
    chamber: "house",
    party: "D",
    state: "CA",
  };
  const merged = mergePoliticalSources(
    {
      people: [p],
      rows: [
        { ...row(), id: "rolling-duplicate", memberId: p.id },
        {
          ...row(),
          id: "newer",
          memberId: p.id,
          filed: "2026-11-13",
          url: url.replace("20033725", "99999999"),
        },
      ],
    },
    h,
  );
  assert.equal(merged.rows.length, 2);
  assert.equal(merged.people.length, 1);
  assert.equal(merged.people[0].id, "congress:P000197");
  assert.equal(merged.aliases[p.id], "congress:P000197");
  assert.equal(merged.people[0].portrait, "/people/P000197.jpg");
});
test("Future availability is excluded, malformed identity and provenance cannot become history", () => {
  assert.equal(
    normalizeHistory([{ ...event, availableAt: "2030-01-01" }], [filing], now)
      .rows.length,
    0,
  );
  for (const patch of [
    { sourceUrl: "https://evil.test/x" },
    { memberId: "wrong" },
    { amountHigh: 4 },
    { availableAt: "invalid" },
    { transactionDate: "2026-02-01" },
  ])
    assert.throws(() =>
      normalizeHistory([{ ...event, ...patch }], [filing], now),
    );
  assert.equal(
    officialDocument(
      "https://efdsearch.senate.gov/search/view/paper/1234-abcd/",
    ),
    "senate:1234-abcd",
  );
  assert.equal(
    officialDocument(
      "https://efdsearch.senate.gov.evil.test/search/view/ptr/a/",
    ),
    null,
  );
});
test("People rail contains every matching filer, including inactive people, without a 12/16-person cap", () => {
  const directory = Array.from({ length: 50 }, (_, i) => ({
    id: "p" + i,
    name: "Person " + i,
    chamber: i % 2 ? "senate" : "house",
  }));
  const active = directory.slice(0, 20).map((p) => ({ ...p, count: 1 }));
  assert.equal(matchingPeople(directory, active, {}).length, 50);
  assert.equal(
    matchingPeople(
      directory,
      active.filter((p) => p.chamber === "house"),
      { chamber: "house" },
    ).length,
    25,
  );
  assert.equal(
    matchingPeople(directory, active, { scope: "portfolio" }).length,
    20,
  );
});
test("Power balance counts unique buyers and sellers, including both-side filers, within the selected filing window", () => {
  const rows = [
    { ...row(), memberId: "a", side: "buy" },
    { ...row(), memberId: "a", side: "buy" },
    { ...row(), memberId: "a", side: "sell" },
    { ...row(), memberId: "b", side: "sell" },
    { ...row(), memberId: "c", side: "exchange" },
  ];
  const p = powerStruggle(rows);
  assert.equal(p.buyers.length, 1);
  assert.equal(p.sellers.length, 2);
  assert.equal(p.buyDisclosures, 2);
  assert.equal(p.both, 1);
  assert.equal(p.other, 1);
  assert.equal(
    powerStruggle(filterDisclosures(rows, { days: 30 }, null, now)).people,
    0,
  );
});
test("Salary and transaction proceeds never masquerade as career profits", () => {
  const c = careerProfile({ bioguide: "P000197" }, [row()], now);
  assert.equal(c.salary.annual, 174000);
  assert.equal(c.gains.value, null);
  assert.equal(c.gains.status, "not_disclosed");
  assert.equal(c.history.sells.low, 1000001);
  assert.equal(c.service.from.slice(0, 4), "1987");
  assert.equal(
    careerProfile({ id: "oge_donald_trump" }, [], now).salary.annual,
    400000,
  );
  assert.equal(
    careerProfile({ id: "oge_christopher_wright" }, [], now).salary.basis,
    "role_benchmark",
  );
  assert.equal(careerProfile({ id: "unknown" }, [], now).salary, null);
});
test("Archive cache survives restart and respects rate-limit backoff without losing historical rows", async (t) => {
  const db = openStore(":memory:");
  migratePlatform(db);
  t.after(() => db.close());
  const put = db.prepare("INSERT INTO political_archives VALUES(?,?,?,?)");
  put.run(
    "history:2026",
    "r",
    gzipSync(JSON.stringify({ rows: [row()], documents: ["house:20033725"] })),
    now,
  );
  put.run(
    "history:meta",
    "r",
    gzipSync(JSON.stringify({ years: [2026], revision: "r" })),
    now,
  );
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response("", { status: 429, headers: { "retry-after": "900" } });
  };
  const s = createPoliticalHistory({ db, fetcher, now: () => now });
  await s.refresh();
  const d = s.get();
  assert.equal(d.rows.length, 1);
  assert.equal(d.status, "cached");
  assert.equal(d.nextCheckAt, now + 900000);
  await s.stop();
  const next = createPoliticalHistory({ db, fetcher, now: () => now });
  assert.equal(next.get().rows.length, 1);
  assert.equal(calls, 1);
  await next.stop();
});
test("Archive network and manifest enforce fixed hosts, bounded responses and verified checksums", async () => {
  await assert.rejects(sourceBytes(fetch, "http://huggingface.co/x"));
  await assert.rejects(
    sourceBytes(async () => new Response("12345"), "https://huggingface.co/x", {
      limit: 3,
    }),
  );
  await assert.rejects(
    sourceBytes(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://evil.test/x" },
        }),
      "https://huggingface.co/x",
    ),
  );
  assert.throws(() =>
    validateHistoryManifest({ schemaVersion: 2, audit: { passed: false } }),
  );
});
test("Every bundled portrait is a nonempty local image with a traceable source", () => {
  assert.ok(Object.keys(portraits).length >= 550);
  for (const p of Object.values(portraits)) {
    assert.match(p.path, /^\/people\/[a-zA-Z0-9_-]+\.(jpg|png)$/);
    assert.ok(
      fs.statSync(new URL("../public" + p.path, import.meta.url)).size > 500,
    );
    assert.ok(p.source.startsWith("https://"));
    assert.ok(p.license);
  }
  assert.match(
    portraits.oge_william_burns.description,
    /CIA|Central Intelligence|Burns/i,
  );
  assert.match(
    portraits.oge_michael_whitaker.description,
    /Federal Aviation|FAA/i,
  );
});
test("Name variants and moves between House and Senate resolve to one Bioguide identity", () => {
  const people = ["house_tammy", "senate_tammy"].map((id, i) => ({
    id,
    name: "Tammy Duckworth",
    chamber: i ? "senate" : "house",
    portrait:
      "https://unitedstates.github.io/images/congress/225x275/D000622.jpg",
  }));
  const d = mergePoliticalSources(
    {
      people,
      rows: people.map((p, i) => ({
        ...row(),
        id: String(i),
        url: url.replace("20033725", String(i)),
        memberId: p.id,
        member: p.name,
        portrait: p.portrait,
        bioguide: undefined,
      })),
    },
    { rows: [], documents: [] },
  );
  assert.equal(d.people.length, 1);
  assert.equal(new Set(d.rows.map((r) => r.memberId)).size, 1);
  assert.equal(d.aliases.house_tammy, "congress:D000622");
  assert.equal(d.people[0].chamber, "senate");
});
test("A corrupted replacement shard leaves the persisted archive untouched", async (t) => {
  const db = openStore(":memory:");
  migratePlatform(db);
  t.after(() => db.close());
  const put = db.prepare("INSERT INTO political_archives VALUES(?,?,?,?)");
  put.run(
    "history:2026",
    "valid",
    gzipSync(JSON.stringify({ rows: [row()], documents: ["house:20033725"] })),
    now,
  );
  put.run(
    "history:meta",
    "valid",
    gzipSync(JSON.stringify({ years: [2026], revision: "valid" })),
    now,
  );
  const tables = Object.fromEntries(
    ["political_trade_events", "political_filings"].map((table) => [
      table,
      {
        rows: 1,
        manifests: [
          {
            year: 2026,
            files: [
              {
                publicPath: `data/${table}/2026-00000-of-00001.parquet`,
                sha256: "0".repeat(64),
                size: 20,
              },
            ],
          },
        ],
      },
    ]),
  );
  const manifest = {
    schemaVersion: 2,
    dataset: "austin-starks/congressional-stock-trades",
    audit: { passed: true },
    tables,
  };
  const s = createPoliticalHistory({
    db,
    now: () => now,
    fetcher: async (url) =>
      url.endsWith("snapshot.json")
        ? Response.json(manifest)
        : new Response("x".repeat(20)),
  });
  await s.refresh();
  assert.equal(s.get().revision, "valid");
  assert.equal(s.get().status, "cached");
  assert.equal(
    db
      .prepare(
        "SELECT revision FROM political_archives WHERE id='history:2026'",
      )
      .get().revision,
    "valid",
  );
  await s.stop();
});

test("The archive reuses healthy five-minute caches until the new twelve-hour deadline", async (t) => {
  const db = openStore(":memory:");
  migratePlatform(db);
  t.after(() => db.close());
  const put = db.prepare("INSERT INTO political_archives VALUES(?,?,?,?)");
  put.run(
    "history:2026",
    "r",
    gzipSync(JSON.stringify({ rows: [row()], documents: ["house:20033725"] })),
    now,
  );
  put.run(
    "history:meta",
    "r",
    gzipSync(JSON.stringify({ years: [2026], revision: "r" })),
    now,
  );
  db.prepare(
    "INSERT INTO political_sync(id,checked_at,attempted_at,next_check_at,etag,failures) VALUES(?,?,?,?,?,0)",
  ).run("history", now, now, now + 300000, '"r"');
  let clock = now + 600000,
    calls = 0;
  const h = createPoliticalHistory({
    db,
    now: () => clock,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 304 });
    },
  });
  t.after(() => h.stop());
  assert.equal(h.get().nextCheckAt, now + 12 * 3600000);
  assert.equal(calls, 0);
  clock = now + 12 * 3600000 - 1;
  h.get();
  assert.equal(calls, 0);
  clock++;
  h.get();
  await h.refresh();
  assert.equal(calls, 1);
  assert.equal(h.get().nextCheckAt, clock + 12 * 3600000);
});
