import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectSECMetrics,
  createConnectors,
} from "../server/intelligence/connectors.js";
const current = {
  start: "2026-07-01",
  end: "2026-09-30",
  filed: "2026-10-23",
  val: 100,
  form: "10-Q",
};
const old = {
  start: "2010-07-01",
  end: "2010-12-31",
  filed: "2011-01-23",
  val: 36.15e9,
  form: "10-Q",
};
const recent = {
  form: ["10-Q"],
  reportDate: ["2026-09-30"],
  filingDate: ["2026-10-23"],
};
const facts = (concepts) => ({
  facts: {
    "us-gaap": Object.fromEntries(
      Object.entries(concepts).map(([name, values]) => [
        name,
        { units: { USD: values } },
      ]),
    ),
  },
});

test("revenue uses the newest fiscal period across modern and legacy concepts and retains provenance", () => {
  const result = selectSECMetrics(
    facts({
      Assets: [current],
      Revenues: [{ ...old, filed: "2026-11-01" }],
      RevenueFromContractWithCustomerExcludingAssessedTax: [
        { ...current, val: 76441e6 },
      ],
      RevenueFromContractWithCustomerIncludingAssessedTax: [
        { ...current, end: "2026-06-30", start: "2026-04-01", val: 70000e6 },
      ],
    }),
    recent,
  );
  assert.equal(result.Revenues.val, 76441e6);
  assert.equal(result.Revenues.end, "2026-09-30");
  assert.equal(
    result.Revenues.concept,
    "RevenueFromContractWithCustomerExcludingAssessedTax",
  );
  assert.equal(result.Revenues.unit, "USD");
});

test("current SalesRevenueNet is a fallback when a preferred revenue alias is stale", () => {
  const result = selectSECMetrics(
    facts({
      Assets: [current],
      RevenueFromContractWithCustomerExcludingAssessedTax: [old],
      SalesRevenueNet: [{ ...current, val: 55 }],
    }),
    recent,
  );
  assert.equal(result.Revenues.val, 55);
  assert.equal(result.Revenues.concept, "SalesRevenueNet");
});

test("deprecated revenue is omitted rather than mixed with the latest report or current balance sheet", () => {
  assert.equal(
    selectSECMetrics(facts({ Revenues: [old] }), recent).Revenues,
    undefined,
  );
  assert.equal(
    selectSECMetrics(facts({ Assets: [current], Revenues: [old] })).Revenues,
    undefined,
  );
  assert.equal(
    selectSECMetrics(facts({ Revenues: [old] })).Revenues.end,
    "2010-12-31",
  );
});

test("same-period revenue prefers the latest filing then its explicit shortest reporting period", () => {
  const result = selectSECMetrics(
    facts({
      Revenues: [
        { ...current, filed: "2026-10-22", val: 99 },
        { ...current, start: "2026-01-01", val: 300 },
        { ...current, val: 100 },
      ],
    }),
    recent,
  );
  assert.equal(result.Revenues.val, 100);
  assert.equal(result.Revenues.start, "2026-07-01");
});

test("malformed periods, periods after filing and unsupported facts cannot win selection", () => {
  const result = selectSECMetrics(
    facts({
      Revenues: [
        { ...current, end: "2099-12-31", val: 999 },
        { ...current, end: "2026-02-31", val: 999 },
        { ...current, filed: undefined, val: 999 },
        { ...current, form: "8-K", val: 999 },
        { ...current, val: 100 },
      ],
    }),
    recent,
  );
  assert.equal(result.Revenues.val, 100);
});

test("SEC connector serializes selected modern revenue as the stable Revenues UI metric", async () => {
  const connectors = createConnectors({
    secAgent: "Tests operator@example.com",
    market: {
      quote: async () => {
        throw Error("fixture");
      },
    },
    fetcher: async (url) => {
      let value = {};
      if (url.endsWith("/company_tickers.json"))
        value = { 0: { ticker: "MSFT", cik_str: 789019 } };
      if (url.includes("/submissions/"))
        value = {
          name: "Microsoft",
          filings: {
            recent: {
              ...recent,
              accessionNumber: ["0000789019-26-000001"],
              primaryDocument: ["msft.htm"],
            },
          },
        };
      if (url.includes("/companyfacts/"))
        value = facts({
          Assets: [current],
          Revenues: [old],
          RevenueFromContractWithCustomerExcludingAssessedTax: [
            { ...current, val: 76441e6 },
          ],
        });
      return new Response(JSON.stringify(value), { status: 200 });
    },
  });
  const result = await connectors.collect({ symbol: "MSFT", name: "MSFT" });
  const content = JSON.parse(
    result.sources.find((source) => source.kind === "fundamentals").content,
  );
  assert.equal(content.metrics.Revenues.val, 76441e6);
  assert.equal(content.metrics.Revenues.end, "2026-09-30");
  assert.ok(!JSON.stringify(content.metrics).includes("2010-12-31"));
});
