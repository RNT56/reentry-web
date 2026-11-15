import { icon } from "../shared/icons.js";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const string = (value, max = 400, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw Error("Complete the media fields within their limits.");
  return value.trim();
};
export const mediaTypes = {
  image: "Image",
  youtube: "YouTube",
  chart: "Chart",
  table: "Table",
  statistics: "Statistics",
  diagram: "Diagram",
  timeline: "Timeline",
};
export function mediaURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.href.length <= 2000
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function youtubeReference(value) {
  if (/^[\w-]{11}$/.test(value)) return { videoId: value, start: 0 };
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("Paste a YouTube video URL.");
  }
  if (u.protocol !== "https:" || u.username || u.password)
    throw Error("Use a secure YouTube URL.");
  const host = u.hostname.toLowerCase(),
    pieces = u.pathname.split("/").filter(Boolean);
  let videoId;
  if (host === "youtu.be") videoId = pieces[0];
  else if (
    [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "www.youtube-nocookie.com",
    ].includes(host)
  )
    videoId = ["embed", "shorts", "live"].includes(pieces[0])
      ? pieces[1]
      : u.searchParams.get("v");
  if (!/^[\w-]{11}$/.test(videoId || ""))
    throw Error("Choose a YouTube video, not a channel or playlist.");
  const time = u.searchParams.get("start") || u.searchParams.get("t") || "0";
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(time);
  const start = /^\d+$/.test(time)
    ? Number(time)
    : parts
      ? Number(parts[1] || 0) * 3600 +
        Number(parts[2] || 0) * 60 +
        Number(parts[3] || 0)
      : 0;
  return { videoId, start: Math.min(86400, start) };
}
export function validateMedia(input) {
  if (!input || !Object.hasOwn(mediaTypes, input.type))
    throw Error("Choose a supported media type.");
  const m = {
    version: 1,
    type: input.type,
    title: string(input.title || "", 200),
    caption: string(input.caption || "", 1000),
    width: ["inline", "wide", "cover"].includes(input.width)
      ? input.width
      : "inline",
    sources: [],
  };
  if (!Array.isArray(input.sources || []) || (input.sources || []).length > 12)
    throw Error("Use at most twelve media sources.");
  m.sources = (input.sources || []).map((s) => {
    const url = mediaURL(s.url);
    if (!url) throw Error("Media sources need HTTPS links.");
    return { title: string(s.title || "Source", 200), url };
  });
  m.asOf = string(input.asOf || "", 40);
  m.basis = ["reported", "calculated", "scenario", "illustration"].includes(
    input.basis,
  )
    ? input.basis
    : "reported";
  if (m.type === "image") {
    if (!/^[a-f0-9-]{36}$/.test(input.fileId || ""))
      throw Error("Choose an image from your library.");
    m.pixelWidth = Math.max(
      1,
      Math.min(3200, Math.floor(Number(input.pixelWidth) || 1600)),
    );
    m.pixelHeight = Math.max(
      1,
      Math.min(3200, Math.floor(Number(input.pixelHeight) || 900)),
    );
    m.fileId = input.fileId;
    m.alt = string(input.alt || "", 500, true);
    m.credit = string(input.credit || "", 400);
    m.fit = input.fit === "cover" ? "cover" : "contain";
    m.ratio = ["original", "16:9", "4:3", "1:1", "3:4"].includes(input.ratio)
      ? input.ratio
      : "original";
    m.focalX = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(input.focalX)) ? Number(input.focalX) : 50,
      ),
    );
    m.focalY = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(input.focalY)) ? Number(input.focalY) : 50,
      ),
    );
  } else if (m.type === "youtube") {
    const ref = youtubeReference(input.videoId || input.url || "");
    m.videoId = ref.videoId;
    m.start = Math.max(
      0,
      Math.min(86400, Math.floor(Number(input.start ?? ref.start) || 0)),
    );
  } else if (["chart", "table", "statistics"].includes(m.type)) {
    if (
      !Array.isArray(input.columns) ||
      input.columns.length < 2 ||
      input.columns.length > 8
    )
      throw Error("Use between two and eight data columns.");
    if (
      !Array.isArray(input.rows) ||
      !input.rows.length ||
      input.rows.length > 200
    )
      throw Error("Add between one and 200 data rows.");
    m.columns = input.columns.map((c) => string(c, 80, true));
    m.rows = input.rows.map((row) => {
      if (!Array.isArray(row) || row.length !== m.columns.length)
        throw Error("Every row must match the column count.");
      return row.map((cell, i) => {
        if (cell === null || cell === "") return null;
        if (
          typeof cell === "number" &&
          Number.isFinite(cell) &&
          Math.abs(cell) <= 1e18
        )
          return cell;
        if (m.type !== "table" && i > 0)
          throw Error(
            "Chart and statistic values must be numbers. Leave missing values blank.",
          );
        return string(String(cell), 300);
      });
    });
    if (
      m.type !== "table" &&
      !m.rows.some((r) => r.slice(1).some((v) => typeof v === "number"))
    )
      throw Error("Add at least one numeric value.");
    m.unit = string(input.unit || "", 60);
    m.chart = input.chart === "bar" ? "bar" : "line";
    m.transform = ["raw", "index", "change"].includes(input.transform)
      ? input.transform
      : "raw";
    m.aggregate = ["latest", "sum", "average", "change"].includes(
      input.aggregate,
    )
      ? input.aggregate
      : "latest";
    if (m.chart === "bar" && m.type === "chart" && m.rows.length > 36)
      throw Error("Use at most 36 rows for a bar chart.");
    if (
      m.basis !== "scenario" &&
      ((m.type === "chart" && m.transform !== "raw") ||
        (m.type === "statistics" && m.aggregate !== "latest"))
    )
      m.basis = "calculated";
  } else {
    if (
      !Array.isArray(input.nodes) ||
      !input.nodes.length ||
      input.nodes.length > 12
    )
      throw Error("Use one to twelve diagram steps.");
    m.nodes = input.nodes.map((n) => ({
      label: string(n.label, 100, true),
      detail: string(n.detail || "", 600),
      tag: string(n.tag || "", 60),
    }));
  }
  return m;
}
export const mediaMarkdown = (m) =>
  "```reentry-media\n" + JSON.stringify(validateMedia(m)) + "\n```";
export function parseData(text) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === delimiter || c === "\n" || c === "\r")) {
      row.push(cell.trim());
      cell = "";
      if (c !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else cell += c;
  }
  if (quoted) throw Error("Close the quoted CSV cell.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2)
    throw Error("Paste a header row and at least one data row.");
  return {
    columns: rows[0],
    rows: rows
      .slice(1)
      .map((r) =>
        r.map((c, i) =>
          i && c !== "" && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(c)
            ? Number(c)
            : c === ""
              ? null
              : c,
        ),
      ),
  };
}
export function dataCSV(m) {
  return [m.columns, ...m.rows]
    .map((r) =>
      r.map((c) => '"' + String(c ?? "").replaceAll('"', '""') + '"').join(","),
    )
    .join("\n");
}
export function chartRows(m) {
  const bases = m.columns.map(
    (_, i) => m.rows.find((r) => typeof r[i] === "number")?.[i],
  );
  return m.rows.map((row) =>
    row.map((value, i) =>
      i && typeof value === "number" && m.transform !== "raw"
        ? !bases[i]
          ? null
          : m.transform === "change"
            ? ((value - bases[i]) / Math.abs(bases[i])) * 100
            : (value / bases[i]) * 100
        : value,
    ),
  );
}
export function statisticValues(m) {
  return m.columns.slice(1).map((label, index) => {
    const cells = m.rows
      .map((r) => r[index + 1])
      .filter((v) => typeof v === "number");
    const value = !cells.length
      ? null
      : m.aggregate === "sum"
        ? cells.reduce((s, v) => s + v, 0)
        : m.aggregate === "average"
          ? cells.reduce((s, v) => s + v, 0) / cells.length
          : m.aggregate === "change"
            ? cells.length < 2 || cells[0] === 0
              ? null
              : ((cells.at(-1) - cells[0]) / Math.abs(cells[0])) * 100
            : cells.at(-1);
    return { label, value, unit: m.aggregate === "change" ? "%" : m.unit };
  });
}
export function priceDataset(history) {
  let points = history.points || [];
  if (!points.length) throw Error("No price history returned.");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: history.timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const date = (p) => formatter.format(new Date(p.time * 1000));
  const nativeWeekly = history.interval === "1wk";
  let cadence = nativeWeekly ? "Weekly closing prices" : "Daily closing prices";
  if (points.length > 200) {
    const monthly = nativeWeekly || points.length > 1100;
    cadence = nativeWeekly
      ? "Weekly closing prices · monthly samples"
      : monthly
        ? "Monthly closing prices"
        : "Weekly closing prices";
    const key = (p) => {
      const day = date(p);
      if (monthly) return day.slice(0, 7);
      const stamp = new Date(day + "T00:00:00Z");
      stamp.setUTCDate(stamp.getUTCDate() - ((stamp.getUTCDay() + 6) % 7));
      return stamp.toISOString().slice(0, 10);
    };
    points = [...new Map(points.map((p) => [key(p), p])).values()];
  }
  if (points.length > 200) throw Error("Choose a shorter period.");
  return {
    columns: [nativeWeekly ? "Week of" : "Date", history.symbol],
    rows: points.map((p) => [date(p), p.price]),
    title: history.symbol + " closing prices",
    unit: history.currency,
    asOf: "Retrieved " + new Date(history.retrievedAt).toISOString().slice(0, 10),
    basis: "reported",
    caption:
      cadence +
      " · " +
      history.currency +
      (history.converted ? " · historical FX conversion" : ""),
    sources: [
      {
        title: "Yahoo Finance · " + history.symbol,
        url:
          "https://finance.yahoo.com/quote/" +
          encodeURIComponent(history.symbol) +
          "/history/",
      },
    ],
  };
}
const number = (value) =>
  value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
        notation: Math.abs(value) >= 1e7 ? "compact" : "standard",
      }).format(value);
const colors = [
  "#c9f992",
  "#85cddd",
  "#dbb4ff",
  "#f4bf8b",
  "#f18ba3",
  "#99b7ff",
  "#e5d87e",
];
function table(m) {
  return `<div class="journal-table" tabindex="0" role="region" aria-label="${escape(m.title || "Source data")}"><table><thead><tr>${m.columns.map((c) => `<th scope="col">${escape(c)}</th>`).join("")}</tr></thead><tbody>${m.rows.map((r) => `<tr>${r.map((c) => `<td>${c === null ? "—" : escape(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function chart(m) {
  const rows = chartRows(m),
    values = rows
      .flatMap((r) => r.slice(1))
      .filter((v) => typeof v === "number");
  if (!values.length) return '<p class="media-empty">No numeric values</p>';
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    span = max - min || 1;
  const y = (n) => 290 - ((n - min) / span) * 240,
    step = 708 / Math.max(1, rows.length),
    x = (i) => 78 + step * (i + 0.5);
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);
  let svg = ticks
    .map(
      (v) =>
        `<path d="M64 ${y(v)}H800" class="media-grid"/><text x="54" y="${y(v) + 4}" text-anchor="end">${escape(number(v))}</text>`,
    )
    .join("");
  const stride = Math.max(1, Math.ceil(rows.length / 5));
  svg += rows
    .map((r, i) =>
      (i % stride === 0 && (i === 0 || rows.length - 1 - i >= stride * 0.65)) ||
      i === rows.length - 1
        ? `<text x="${x(i)}" y="318" text-anchor="middle">${escape(String(r[0] ?? "").slice(0, 16))}</text>`
        : "",
    )
    .join("");
  for (let c = 1; c < m.columns.length; c++) {
    let path = "",
      previous = false;
    rows.forEach((r, i) => {
      const v = r[c];
      if (typeof v !== "number") {
        previous = false;
        return;
      }
      const hint = escape(
        `${r[0]} · ${m.columns[c]}: ${number(v)} ${m.transform === "change" ? "%" : m.transform === "index" ? "(indexed)" : m.unit}`,
      );
      if (m.chart === "bar") {
        const width = (step * 0.8) / (m.columns.length - 1),
          left = x(i) - step * 0.4 + width * (c - 1);
        svg += `<rect x="${left}" y="${Math.min(y(0), y(v))}" width="${Math.max(1, width - 2)}" height="${Math.max(1, Math.abs(y(0) - y(v)))}" rx="2" fill="${colors[c - 1]}" data-tooltip="${hint}" tabindex="0" aria-label="${hint}"/>`;
      } else {
        path += `${previous ? "L" : "M"}${x(i)},${y(v)} `;
        previous = true;
        svg += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${colors[c - 1]}" data-tooltip="${hint}" tabindex="0" aria-label="${hint}"/>`;
      }
    });
    if (path)
      svg += `<path d="${path}" stroke="${colors[c - 1]}" fill="none" stroke-width="2.5" pointer-events="none"/>`;
  }
  return `<div class="media-chart-legend">${m.columns
    .slice(1)
    .map(
      (c, i) =>
        `<span><i style="background:${colors[i]}"></i>${escape(c)}</span>`,
    )
    .join(
      "",
    )}<small>${escape(m.transform === "index" ? "First value = 100" : m.transform === "change" ? "Change from first value · %" : m.unit)}</small></div><svg class="media-chart" viewBox="0 0 840 340" role="img" aria-label="${escape(m.title || "Data chart")}">${svg}</svg>`;
}
export function mediaText(m) {
  return [
    m.title,
    m.caption,
    ...(m.nodes || []).map((n) => n.label + ": " + n.detail),
  ]
    .filter(Boolean)
    .join("\n");
}
export function renderMedia(value, { editor = false } = {}) {
  let m;
  try {
    m = validateMedia(value);
  } catch {
    return '<p class="media-empty">Invalid media block. Open Markdown to correct it.</p>';
  }
  let body;
  if (m.type === "image")
    body = `<img class="article-media-image" src="/journal-media/${m.fileId}" alt="${escape(m.alt)}" width="${m.pixelWidth}" height="${m.pixelHeight}" loading="lazy" decoding="async" style="object-fit:${m.fit};object-position:${m.focalX}% ${m.focalY}%;${m.ratio !== "original" ? "aspect-ratio:" + m.ratio.replace(":", "/") : ""}">`;
  else if (m.type === "youtube")
    body = `<div class="media-video" data-youtube="${m.videoId}" data-start="${m.start}"><button type="button" class="media-video-play" data-play-youtube data-tooltip="Load the YouTube player${m.start ? " at " + m.start + " seconds" : ""}"><span aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><b>${escape(m.title || "Watch video")}</b></button><a href="https://www.youtube.com/watch?v=${m.videoId}&amp;t=${m.start}s" target="_blank" rel="noopener noreferrer">YouTube ${icon("arrow")}</a></div>`;
  else if (m.type === "chart") body = chart(m);
  else if (m.type === "table") body = table(m);
  else if (m.type === "statistics")
    body = `<div class="media-stat-values">${statisticValues(m)
      .map(
        (v) =>
          `<div><span>${escape(v.label)}</span><strong>${escape(number(v.value))}<small>${escape(v.unit)}</small></strong></div>`,
      )
      .join("")}</div>`;
  else
    body = `<ol class="media-steps ${m.type === "timeline" ? "media-timeline" : ""}">${m.nodes.map((n, i) => `<li><span>${escape(n.tag || String(i + 1).padStart(2, "0"))}</span><b>${escape(n.label)}</b>${n.detail ? `<p>${escape(n.detail)}</p>` : ""}</li>`).join("")}</ol>`;
  const metadata = [
    m.basis === "scenario" && !["chart", "statistics"].includes(m.type)
      ? "Scenario"
      : "",
    m.type === "table" ? m.unit : "",
    m.asOf,
  ]
    .filter(Boolean)
    .join(" · ");
  const calculation =
    m.type === "statistics"
      ? {
          latest: "Latest available value per series.",
          sum: "Sum of available values in each series.",
          average: "Arithmetic mean of available values in each series.",
          change:
            "(Last − first) ÷ absolute first value × 100. A zero baseline is unavailable.",
        }[m.aggregate]
      : m.transform === "index"
        ? "Each value ÷ first available value × 100. A zero baseline is unavailable."
        : m.transform === "change"
          ? "(Value − first) ÷ absolute first value × 100. A zero baseline is unavailable."
          : "Original source values. Missing observations remain empty.";
  return `<figure class="article-media media-${m.type} media-width-${m.width}" data-article-media="${escape(JSON.stringify(m))}" data-motion-static${editor ? ' contenteditable="false"' : ""}>${(m.title || metadata) && m.type !== "youtube" ? `<div class="media-heading">${m.title ? `<h3>${escape(m.title)}</h3>` : ""}${metadata ? `<span class="media-meta">${escape(metadata)}</span>` : ""}</div>` : ""}${body}${m.caption || m.credit ? `<figcaption>${escape(m.caption)}${m.credit ? `<span>${escape(m.credit)}</span>` : ""}</figcaption>` : ""}${["chart", "statistics"].includes(m.type) ? `<details class="media-data"><summary data-tooltip="${escape(calculation)}">Data · ${escape(m.basis)}</summary>${table(m)}<button type="button" class="link" data-download-media>Download CSV</button></details>` : ""}${m.sources.length ? `<div class="media-sources">${m.sources.map((s, i) => `<a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer" data-tooltip="${escape(s.title)}">${escape(s.title || "Source " + (i + 1))} ${icon("arrow")}</a>`).join("")}</div>` : ""}</figure>`;
}
