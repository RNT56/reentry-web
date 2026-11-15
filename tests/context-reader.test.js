import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createContextReader,
  contextEntryFromURL,
  contextDestination,
} from "../src/features/portfolio/context-reader.js";
import {
  journalEntry,
  researchEntry,
  disclosureItems,
  capitolEntry,
} from "../src/features/portfolio/context-views.js";
import {
  capitolFilters,
  sameCapitolFilters,
} from "../src/features/politics/loading.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

test("preview links resolve exact article, private brief and tree IDs from app hash routes", () => {
  for (const section of ["journal", "research", "scenarios"]) {
    const href = contextDestination("SAP.DE", section, "entry&with/slash");
    assert.equal(
      contextEntryFromURL(href, section, "https://app.test/"),
      "entry&with/slash",
    );
  }
  assert.equal(
    contextEntryFromURL(
      contextDestination("AAPL", "research"),
      "research",
      "https://app.test/",
    ),
    "",
  );
  assert.equal(
    contextEntryFromURL(
      "#/politics?symbol=AAPL",
      "capitol",
      "https://app.test/",
    ),
    "",
  );
});

test("rapid tab switches abort the prior request and ignore even abort-resistant late replies", async () => {
  const calls = [],
    reader = createContextReader("INTC", {
      read: (path, method, body, options) => {
        const d = deferred();
        calls.push({ ...d, path, method, body, ...options });
        return d.promise;
      },
    });
  const first = reader.load({ section: "journal" });
  const second = reader.load({ section: "research" });
  assert.equal(calls[0].signal.aborted, true);
  calls[1].resolve({ symbol: "INTC", items: [] });
  assert.deepEqual(await second, { symbol: "INTC", items: [] });
  calls[0].resolve({ symbol: "INTC", items: ["stale"] });
  assert.equal(await first, null);
  assert.ok(calls.every((c) => c.method === "GET" && c.body === undefined));
});

test("cached-tab navigation and closing the drawer cancel in-flight work without surfacing errors", async () => {
  const calls = [],
    reader = createContextReader("INTC", {
      read: () => {
        const d = deferred();
        calls.push(d);
        return d.promise;
      },
    });
  const first = reader.load({ section: "journal" });
  reader.cancel();
  calls[0].reject(Error("late network error"));
  assert.equal(await first, null);
  const second = reader.load({ section: "scenarios" });
  reader.destroy();
  calls[1].resolve({ symbol: "INTC" });
  assert.equal(await second, null);
  assert.equal(await reader.load({ section: "research" }), null);
  assert.equal(calls.length, 2);
});

test("private entries cannot display another asset or an incomplete/non-research AI job", async () => {
  let payload = { symbol: "MSFT" };
  const reader = createContextReader("INTC", { read: async () => payload });
  await assert.rejects(
    reader.load({ section: "scenarios", entry: "wrong" }),
    /another asset/,
  );
  payload = { symbol: "INTC", kind: "chart-analysis", status: "completed" };
  await assert.rejects(
    reader.load({ section: "research", entry: "wrong" }),
    /unavailable/,
  );
  payload = { symbol: "INTC", kind: "research", status: "running" };
  await assert.rejects(
    reader.load({ section: "research", entry: "running" }),
    /unavailable/,
  );
  payload = { symbol: "INTC", kind: "research", status: "completed" };
  assert.equal(
    await reader.load({ section: "research", entry: "ok" }),
    payload,
  );
  payload = { rows: [{ ticker: "AAPL" }] };
  await assert.rejects(reader.load({ section: "capitol" }), /another asset/);
  payload = { symbol: "AAPL", assets: [{ symbol: "INTC" }] };
  assert.equal(
    await reader.load({ section: "journal", entry: "published-related-asset" }),
    payload,
  );
});

test("drawer pagination and filing windows remain scoped to the selected listing", async () => {
  const paths = [];
  const reader = createContextReader("SAP.DE", {
    read: async (path) => {
      paths.push(path);
      return { symbol: "SAP.DE", rows: [] };
    },
  });
  await reader.load({ section: "research", offset: 20 });
  await reader.load({
    section: "capitol",
    days: 365,
    offset: 50,
    version: "version&1",
  });
  assert.equal(paths[0], "/api/asset-context/research?symbol=SAP.DE&offset=20");
  const params = new URL(paths[1], "https://app.test").searchParams;
  assert.equal(params.get("ticker"), "SAP.DE");
  assert.equal(params.get("days"), "365");
  assert.equal(params.get("offset"), "50");
  assert.equal(params.get("version"), "version&1");
  await assert.rejects(reader.load({ section: "__proto__" }), /Unknown/);
  assert.equal(paths.length, 2);
});

test("journal and brief reading surfaces escape content, retain safe sources and render mixed sentiment", () => {
  const journal = journalEntry({
    title: "<script>bad</script>",
    body: "<script>alert(1)</script>\n\n[Bad](javascript:alert(1))\n\n[Evidence](https://example.org)",
    author: "RNT",
    revision: 1,
    publishedAt: 1,
    sources: [{ title: "Unsafe", url: "javascript:alert(1)" }],
  });
  assert.doesNotMatch(journal, /<script>|href="javascript:/);
  assert.match(journal, /href="https:\/\/example.org"/);
  const brief = researchEntry({
    createdAt: 1,
    result: {
      summary: "<img onerror=alert(1)>",
      sentiment: [{ label: "mixed" }],
      claims: [{ kind: "fact", text: "Evidence", sourceIds: ["a"] }],
    },
    sources: [{ id: "a", title: "Evidence", url: "https://example.org" }],
  });
  assert.match(brief, /1 mixed/);
  assert.doesNotMatch(brief, /<img onerror/);
  assert.match(brief, /Reported/);
});

test("filing previews preserve unknown trade types and never present unavailable feeds as zero activity", () => {
  const rows = disclosureItems([
    {
      id: "1",
      member: "Test Person",
      chamber: "house",
      side: "other",
      low: null,
      high: null,
      amount: "Not stated",
      url: "javascript:alert(1)",
    },
  ]);
  assert.match(rows, />Other</);
  assert.doesNotMatch(rows, />Exchange<|href="javascript:/);
  const unavailable = capitolEntry(
    {
      summary: { buys: 0, sells: 0, people: 0, count: 0 },
      rows: [],
      coverage: null,
      nextOffset: null,
    },
    90,
  );
  assert.match(unavailable, /Disclosures unavailable/);
  assert.doesNotMatch(unavailable, /buy disclosures/);
});

test("Capitol distinguishes a refresh from a new filter without including navigation scroll memory", () => {
  const filters = {
    days: 90,
    chamber: "all",
    side: "all",
    scope: "all",
    q: "",
    member: "",
    ticker: "INTC",
    returnTo: { scroll: 700 },
  };
  const snapshot = capitolFilters(filters);
  assert.equal(
    sameCapitolFilters(snapshot, { ...filters, returnTo: { scroll: 200 } }),
    true,
  );
  assert.equal(
    sameCapitolFilters(snapshot, { ...filters, ticker: "MSFT" }),
    false,
  );
  assert.equal(sameCapitolFilters(null, filters), false);
  assert.equal("returnTo" in snapshot, false);
});
