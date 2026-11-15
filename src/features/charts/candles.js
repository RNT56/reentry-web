export const validCandle = (p) =>
  [p.open, p.high, p.low, p.close].every((v) => Number.isFinite(v) && v > 0) &&
  p.low <= Math.min(p.open, p.close) &&
  p.high >= Math.max(p.open, p.close);

// Four SVG paths, independent of bar count. Missing OHLC stays a close marker.
export function renderCandles(points, g) {
  const width = Math.max(
    0.65,
    Math.min(12, ((g.R - g.L) / (g.end - g.start + 1)) * 0.65),
  );
  const paths = [
    { wick: "", body: "" },
    { wick: "", body: "" },
  ];
  let count = 0,
    missing = "";
  const n = (v) => Math.round(v * 100) / 100;
  for (let i = g.from; i <= g.to; i++) {
    const p = points[i],
      x = n(g.x(i));
    if (!validCandle(p)) {
      missing += `M${n(x - width / 2)} ${n(g.y(p.price))}h${n(width)}`;
      continue;
    }
    count++;
    const path = paths[p.close >= p.open ? 0 : 1],
      y = n(Math.min(g.y(p.open), g.y(p.close))),
      h = n(Math.max(1, Math.abs(g.y(p.close) - g.y(p.open))));
    path.wick += `M${x} ${n(g.y(p.high))}V${n(g.y(p.low))}`;
    path.body += `M${n(x - width / 2)} ${y}h${n(width)}v${h}h${n(-width)}Z`;
  }
  return {
    count,
    html:
      paths
        .map(
          (p, i) =>
            `<g class="chart-candles" fill="${i ? "#df9d90" : "#8bd5ab"}" stroke="${i ? "#df9d90" : "#8bd5ab"}"><path d="${p.wick}" fill="none" stroke-width="1"/><path d="${p.body}" stroke="none"/></g>`,
        )
        .join("") +
      (missing
        ? `<path d="${missing}" fill="none" stroke="#9caea0" stroke-width="1.5"/>`
        : ""),
  };
}
