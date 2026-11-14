import { createRequestCache } from "../market/cache.js";
export const indicators = [
  ["CPIAUCSL", "US inflation", "Prices", "US", "% YoY", "yoy", 45],
  ["PCEPILFE", "Core PCE", "Prices", "US", "% YoY", "yoy", 60],
  [
    "CP0000EZ19M086NEST",
    "Euro inflation",
    "Prices",
    "Euro area",
    "% YoY",
    "yoy",
    60,
  ],
  [
    "FPCPITOTLZGJPN",
    "Japan CPI · annual",
    "Prices",
    "Japan",
    "% annual",
    "level",
    800,
  ],
  [
    "FPCPITOTLZGGBR",
    "UK CPI · annual",
    "Prices",
    "UK",
    "% annual",
    "level",
    800,
  ],
  ["VIXCLS", "VIX", "Risk", "US", "index", "level", 10],
  ["BAMLH0A0HYM2", "High-yield spread", "Credit", "US", "%", "level", 10],
  ["NFCI", "Financial conditions", "Credit", "US", "index", "level", 15],
  ["FEDFUNDS", "Fed funds", "Rates", "US", "%", "level", 45],
  ["ECBDFR", "ECB deposit", "Rates", "Euro area", "%", "level", 10],
  ["DGS2", "Treasury · 2Y", "Rates", "US", "%", "level", 10],
  ["DGS10", "Treasury · 10Y", "Rates", "US", "%", "level", 10],
  ["T10Y2Y", "Yield curve · 10Y–2Y", "Rates", "US", "pp", "level", 10],
  ["UNRATE", "Unemployment", "Growth", "US", "%", "level", 45],
  ["GDPC1", "Real GDP", "Growth", "US", "% YoY", "yoy", 150],
  ["M2SL", "Money supply · M2", "Liquidity", "US", "% YoY", "yoy", 60],
  ["WALCL", "Fed balance sheet", "Liquidity", "US", "USD tn", "trillion", 15],
  [
    "DRTSCILM",
    "Bank lending tightening",
    "Credit",
    "US",
    "net %",
    "level",
    150,
  ],
  [
    "DCOILBRENTEU",
    "Brent crude",
    "Global",
    "Global",
    "USD / barrel",
    "level",
    15,
  ],
  ["DTWEXBGS", "Broad dollar", "Global", "Global", "index", "level", 15],
].map(([id, label, group, region, unit, transform, maxAgeDays]) => ({
  id,
  label,
  group,
  region,
  unit,
  transform,
  maxAgeDays,
  source: `https://fred.stlouisfed.org/series/${id}`,
}));

export function parseObservations(csv, id) {
  const lines = csv.trim().split(/\r?\n/),
    header = lines
      .shift()
      ?.replace(/^\uFEFF/, "")
      .split(",");
  if (
    !header ||
    !["DATE", "observation_date"].includes(header[0]) ||
    header[1] !== id
  )
    throw Error("Unexpected FRED format");
  const points = new Map();
  for (const line of lines) {
    const [date, raw] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const value = raw?.trim();
    if (!value || value === ".") continue;
    const n = Number(value);
    if (
      Number.isFinite(n) &&
      Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date
    )
      points.set(date, { date, value: n });
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function transformObservations(points, kind) {
  const byMonth = new Map(points.map((p) => [p.date.slice(0, 7), p]));
  return points.flatMap((p) => {
    if (kind === "yoy") {
      const previous = byMonth.get(
        `${Number(p.date.slice(0, 4)) - 1}${p.date.slice(4, 7)}`,
      );
      return previous?.value > 0
        ? [{ date: p.date, value: (p.value / previous.value - 1) * 100 }]
        : [];
    }
    return [
      {
        date: p.date,
        value: kind === "trillion" ? p.value / 1000000 : p.value,
      },
    ];
  });
}
async function boundedCSV(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw Error("FRED unavailable");
  }
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1500000) throw Error("FRED response limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export function createMacroService({
  fetcher = fetch,
  now = Date.now,
  ttl = 300000,
} = {}) {
  const cache = createRequestCache({ ttl, limit: 2, maxPending: 2, now }),
    lastGood = new Map();
  async function collect(definition, deadline) {
    const fetchedAt = now();
    try {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw Error("Snapshot deadline");
      const from = new Date(fetchedAt);
      from.setUTCFullYear(from.getUTCFullYear() - 6);
      const url =
        "https://fred.stlouisfed.org/graph/fredgraph.csv?" +
        new URLSearchParams({
          id: definition.id,
          cosd: from.toISOString().slice(0, 10),
        });
      const response = await fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(
          Math.max(1, Math.ceil(Math.min(12000, remaining))),
        ),
        headers: { Accept: "text/csv", "User-Agent": "Reentry macro data" },
      });
      const points = transformObservations(
        parseObservations(await boundedCSV(response), definition.id),
        definition.transform,
      ).filter((p) => Date.parse(p.date) <= fetchedAt);
      if (!points.length) throw Error("No observations");
      const latest = points.at(-1),
        previous = points.at(-2),
        ageDays = Math.floor((fetchedAt - Date.parse(latest.date)) / 86400000);
      const result = {
        ...definition,
        points,
        latest,
        change: previous ? latest.value - previous.value : null,
        fetchedAt,
        ageDays,
        status: ageDays > definition.maxAgeDays ? "stale" : "available",
      };
      lastGood.set(definition.id, result);
      return result;
    } catch {
      return lastGood.has(definition.id)
        ? {
            ...lastGood.get(definition.id),
            status: "stale",
            checkedAt: fetchedAt,
          }
        : {
            ...definition,
            status: "unavailable",
            points: [],
            latest: null,
            change: null,
            fetchedAt,
          };
    }
  }
  async function snapshot() {
    return cache("snapshot", async () => {
      const deadline = performance.now() + 18000;
      const rows = new Array(indicators.length);
      let cursor = 0;
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (cursor < indicators.length) {
            const index = cursor++;
            rows[index] = await collect(indicators[index], deadline);
          }
        }),
      );
      return { fetchedAt: now(), provider: "FRED", indicators: rows };
    });
  }
  return {
    snapshot,
    async getMacroEvidence() {
      const data = await snapshot();
      return data.indicators
        .filter((i) => i.latest)
        .map((i) => ({
          kind: "macro",
          title: `${i.label} · ${i.latest.value.toFixed(2)} ${i.unit}`,
          url: i.source,
          content: JSON.stringify({
            series: i.id,
            region: i.region,
            value: i.latest.value,
            unit: i.unit,
            observationDate: i.latest.date,
            changeFromPrevious: i.change,
            status: i.status,
            fetchedAt: i.fetchedAt,
          }),
          published_at: Date.parse(i.latest.date),
          connector: "fred",
        }));
    },
  };
}
export const getMacroEvidence = (service) => service.getMacroEvidence();
