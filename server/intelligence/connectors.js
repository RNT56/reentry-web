import { createStrategyEvidence } from "../strategies/evidence.js";
import { createRequestCache } from "../market/cache.js";
import { createRequestPacer } from "../market/pacing.js";
import { safeURL } from "../platform/util.js";
const trim = (v, n = 300) =>
  String(v || "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, n);
const link = (v) => {
  try {
    return safeURL(v);
  } catch {
    return null;
  }
};
const fiscalDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

export function selectSECMetrics(facts, recent = {}) {
  const gaap = facts.facts?.["us-gaap"] || {};
  const order = (a, b) =>
    b.end.localeCompare(a.end) ||
    b.filed.localeCompare(a.filed) ||
    String(b.start || "").localeCompare(String(a.start || ""));
  const rows = (concept) =>
    (gaap[concept]?.units?.USD || []).filter(
      (value) =>
        ["10-K", "10-Q"].includes(value.form) &&
        Number.isFinite(value.val) &&
        fiscalDate(value.end) &&
        fiscalDate(value.filed) &&
        value.end <= value.filed &&
        (!value.start || (fiscalDate(value.start) && value.start <= value.end)),
    );
  const chosen = {};
  for (const concept of [
    "Assets",
    "CashAndCashEquivalentsAtCarryingValue",
    "NetIncomeLoss",
  ]) {
    const value = rows(concept).sort(order)[0];
    if (value) chosen[concept] = { ...value, unit: "USD" };
  }
  const latestPeriod = [
    ...Object.values(chosen).map((value) => value.end),
    ...(recent.reportDate || []).filter(
      (end, index) =>
        ["10-K", "10-Q"].includes(recent.form?.[index]) &&
        fiscalDate(end) &&
        fiscalDate(recent.filingDate?.[index]) &&
        end <= recent.filingDate[index],
    ),
  ]
    .sort()
    .at(-1);
  const revenue = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "Revenues",
  ]
    .flatMap((concept) => rows(concept).map((value) => ({ ...value, concept })))
    .filter((value) => !latestPeriod || value.end >= latestPeriod)
    .sort(order)[0];
  if (revenue) chosen.Revenues = { ...revenue, unit: "USD" };
  return chosen;
}
export function createConnectors({
  market,
  macro,
  politics,
  fetcher = fetch,
  secAgent = process.env.SEC_USER_AGENT || "",
} = {}) {
  const cache = createRequestCache({ ttl: 300000, limit: 200 });
  const paceSEC = createRequestPacer({ limit: 4 });
  const secJSON = (...args) => paceSEC(() => json(...args));
  async function json(url, headers = {}, limit = 3000000) {
    const r = await fetcher(url, {
      headers: { Accept: "application/json", ...headers },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw Error("Connector unavailable");
    }
    const chunks = [];
    let size = 0;
    const reader = r.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw Error("Connector response too large");
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  const source = (kind, title, url, content, published_at = null) => ({
    kind,
    title: trim(title),
    url: link(url),
    content: trim(content, 7000),
    published_at: Number.isFinite(published_at) ? published_at : null,
  });
  const definitions = [
    {
      id: "market",
      label: "Yahoo Finance · price",
      async collect(asset) {
        const q = await market.quote(asset.symbol);
        return [
          source(
            "quote",
            `${asset.symbol} market quote`,
            `https://finance.yahoo.com/quote/${encodeURIComponent(asset.symbol)}/`,
            JSON.stringify(q),
            q.time * 1000,
          ),
        ];
      },
    },
    {
      id: "news",
      label: "Yahoo Finance · headlines",
      async collect(asset) {
        const d = await json(
          "https://query1.finance.yahoo.com/v1/finance/search?" +
            new URLSearchParams({
              q: asset.symbol,
              quotesCount: "0",
              newsCount: "12",
              enableFuzzyQuery: "false",
            }),
        );
        return (d.news || [])
          .filter((n) => n.relatedTickers?.includes(asset.symbol))
          .slice(0, 8)
          .map((n) =>
            source(
              "headline",
              n.title,
              n.link,
              `${n.title}\nPublisher: ${trim(n.publisher)}. Headline metadata only; full article not retrieved.`,
              n.providerPublishTime * 1000,
            ),
          );
      },
    },
    {
      id: "gdelt",
      label: "GDELT · news discovery",
      async collect(asset) {
        const phrase = asset.name
          .replace(
            /\b(incorporated|corporation|corp|inc|plc|limited|ltd)\b\.?/gi,
            "",
          )
          .replace(/[^\p{L}\p{N} .-]/gu, "")
          .trim();
        if (phrase.length < 3 || phrase === asset.symbol) return [];
        const d = await json(
          "https://api.gdeltproject.org/api/v2/doc/doc?" +
            new URLSearchParams({
              query: `"${phrase}"`,
              mode: "artlist",
              format: "json",
              maxrecords: "8",
              timespan: "1week",
              sort: "datedesc",
            }),
        );
        return (d.articles || [])
          .filter((n) =>
            String(n.title).toLowerCase().includes(phrase.toLowerCase()),
          )
          .slice(0, 6)
          .map((n) =>
            source(
              "headline",
              n.title,
              n.url,
              `${n.title}\nPublisher: ${trim(n.domain)}. Name-matched headline; verify the entity before relying on it. Full article not retrieved.`,
              Date.parse(
                String(n.seendate).replace(
                  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
                  "$1-$2-$3T$4:$5:$6Z",
                ),
              ),
            ),
          );
      },
    },
    {
      id: "sec",
      label: "SEC EDGAR · filings & fundamentals",
      configured: !!secAgent,
      async collect(asset) {
        if (!secAgent)
          throw Error(
            "Set SEC_USER_AGENT with an operator contact to enable EDGAR.",
          );
        const headers = { "User-Agent": secAgent };
        const tickers = await cache("sec:tickers", () =>
          secJSON("https://www.sec.gov/files/company_tickers.json", headers),
        );
        const entry = Object.values(tickers).find(
          (t) => t.ticker === asset.symbol,
        );
        if (!entry) return [];
        const cik = String(entry.cik_str).padStart(10, "0"),
          root = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/`;
        // The outer cache retains only normalized sources. Full SEC payloads can be
        // many megabytes; do not retain one historical filing/fact archive per asset.
        const sub = await secJSON(
          `https://data.sec.gov/submissions/CIK${cik}.json`,
          headers,
        );
        const recent = sub.filings?.recent || {},
          sources = [];
        for (
          let i = 0;
          i < Math.min(recent.form?.length || 0, 60) && sources.length < 4;
          i++
        ) {
          if (!["10-K", "10-Q", "8-K", "20-F", "6-K"].includes(recent.form[i]))
            continue;
          const accession = recent.accessionNumber[i];
          const doc = recent.primaryDocument[i];
          if (!/^[0-9-]+$/.test(accession) || !/^[a-zA-Z0-9_.-]+$/.test(doc))
            continue;
          sources.push(
            source(
              "filing",
              `${sub.name} · ${recent.form[i]} · ${recent.filingDate[i]}`,
              root + accession.replaceAll("-", "") + "/" + doc,
              `SEC filing metadata. Company ${sub.name}; form ${recent.form[i]}; filing date ${recent.filingDate[i]}; report date ${recent.reportDate[i]}; items ${recent.items?.[i] || "not specified"}. Document body has not been retrieved.`,
              Date.parse(recent.filingDate[i]),
            ),
          );
        }
        try {
          const facts = await secJSON(
            `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
            headers,
            18000000,
          );
          const chosen = selectSECMetrics(facts, recent);
          if (Object.keys(chosen).length)
            sources.push(
              source(
                "fundamentals",
                `${sub.name} · latest reported XBRL facts`,
                `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
                JSON.stringify({
                  company: sub.name,
                  metrics: chosen,
                  note: "Reported periods differ. These are not normalized TTM figures; use start/end, filing date and form.",
                }),
              ),
            );
        } catch {
          sources.push(
            source(
              "coverage",
              "SEC fundamentals unavailable",
              null,
              "Filings metadata was available; company facts could not be retrieved.",
            ),
          );
        }
        return sources;
      },
    },
  ];
  definitions.push({
    id: "strategies",
    label: "Price structure",
    collect: async (asset) => [await createStrategyEvidence(market)(asset)],
  });
  if (politics)
    definitions.push({
      id: "politics",
      label: "Political disclosures",
      collect: (asset) => politics.evidence(asset),
    });
  if (macro)
    definitions.push({
      id: "fred",
      label: "FRED",
      collect: async () => (await macro.getMacroEvidence()).slice(0, 5),
    });
  return {
    status: () =>
      definitions.map((d) => ({
        id: d.id,
        label: d.label,
        configured: d.configured !== false,
      })),
    async collect(asset) {
      const results = await Promise.allSettled(
        definitions.map((d) =>
          cache(
            d.id +
              ":" +
              asset.symbol +
              (d.id === "gdelt" ? ":" + asset.name : ""),
            () => d.collect(asset),
          ),
        ),
      );
      return {
        sources: results.flatMap((r, i) =>
          r.status === "fulfilled"
            ? r.value.map((s) => ({ ...s, connector: definitions[i].id }))
            : [],
        ),
        coverage: results.map((r, i) => ({
          connector: definitions[i].id,
          label: definitions[i].label,
          status:
            definitions[i].configured === false
              ? "not-configured"
              : r.status === "rejected"
                ? "unavailable"
                : r.value.length
                  ? "available"
                  : "no-matches",
          count: r.status === "fulfilled" ? r.value.length : 0,
        })),
      };
    },
  };
}
