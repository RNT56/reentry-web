export const performanceRanges = {
  "1mo": { label: "1M" },
  "3mo": { label: "3M" },
  "6mo": { label: "6M" },
  ytd: { label: "YTD" },
  "1y": { label: "1Y" },
  "5y": { label: "5Y" },
  all: { label: "All" },
};
export const performanceSeries = [
  { id: "gain", label: "Investment", detail: "Estimate", color: "#a9d9ad" },
  { id: "salary", label: "Salary", detail: "Benchmark", color: "#d8c495" },
  {
    id: "sp500",
    label: "S&P 500",
    detail: "Matched capital",
    color: "#8dbde4",
  },
  {
    id: "world",
    label: "MSCI World",
    detail: "Matched capital",
    color: "#b4a2dc",
  },
];
function startDate(through, range) {
  if (range === "all") return "2012-01-01";
  const end = new Date(through + "T00:00:00Z");
  if (range === "ytd") return `${end.getUTCFullYear() - 1}-12-31`;
  const months = { "1mo": 1, "3mo": 3, "6mo": 6, "1y": 12, "5y": 60 }[range];
  if (!months) throw Error("Invalid performance timeframe");
  const wanted = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() - months);
  const last = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(wanted, last));
  return end.toISOString().slice(0, 10);
}
export function performanceWindow(data, variant = "mid", range = "all") {
  const values = data?.variants?.[variant];
  if (!values || !data.dates.length) return null;
  const wanted = startDate(data.through, range);
  let first = data.dates.findIndex(
    (d, i) => d >= wanted && Number.isFinite(values.gain[i]),
  );
  if (first < 0) return null;
  const dates = data.dates.slice(first),
    times = dates.map((d) => Date.parse(d + "T00:00:00Z") / 1000);
  const series = performanceSeries.map((meta) => {
    const raw = meta.id === "salary" ? data.salary : values[meta.id],
      baseline = raw?.[first];
    const points = dates.map((_, i) => ({
      time: times[i],
      price:
        Number.isFinite(baseline) && Number.isFinite(raw[first + i])
          ? Math.round((raw[first + i] - baseline) * 100) / 100
          : null,
    }));
    return {
      ...meta,
      points,
      available: points.some((p) => Number.isFinite(p.price)),
      partial: points.some((p) => !Number.isFinite(p.price)),
    };
  });
  return {
    from: dates[0],
    through: dates.at(-1),
    range,
    series,
    dates,
    clipped: range !== "all" && dates[0] > wanted,
  };
}
export function politicalChartSymbol(id) {
  let hash = 2166136261;
  for (const c of id) {
    hash ^= c.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (
    "PF." +
    id
      .replace(/[^a-z0-9]/gi, "-")
      .toUpperCase()
      .slice(0, 18) +
    "." +
    (hash >>> 0).toString(16).toUpperCase()
  );
}
