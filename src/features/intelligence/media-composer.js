import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { modal, close, icon } from "../../shared/ui.js";
import {
  mediaTypes,
  validateMedia,
  renderMedia,
  parseData,
  priceDataset,
  youtubeReference,
} from "../../domain/article-media.js";
import { mediaPresets } from "../../domain/media-presets.js";

const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select = (label, name, values, value) =>
  `<label>${label}<select name="${name}">${Object.entries(values)
    .map(
      ([k, v]) =>
        `<option value="${k}" ${k === value ? "selected" : ""}>${v}</option>`,
    )
    .join("")}</select></label>`;
const empty = (type) => ({
  type,
  title: "",
  caption: "",
  width: "inline",
  sources: [],
  basis: "reported",
  asOf: "",
  columns: ["Period", "Value"],
  rows: [["", null]],
  unit: "",
  chart: "line",
  transform: "raw",
  aggregate: "latest",
  nodes: [{ label: "", detail: "", tag: "" }],
  alt: "",
  credit: "",
  ratio: "original",
  fit: "contain",
  focalX: 50,
  focalY: 50,
});
const price = (n) => "$" + (Number(n || 0) / 1000000).toFixed(3);

export function openMediaComposer({ getDraft, initial, onInsert }) {
  let block = initial ? structuredClone(initial) : empty("chart"),
    tab = "create",
    imageQuery = "",
    images = [],
    matches = [],
    sources = [],
    jobs = [],
    proposals = [],
    prepared = null,
    preparedKey = "",
    task = "suggest",
    prompt = mediaPresets.suggest,
    aspect = "16:9",
    busy = false,
    alive = true,
    timer,
    version = 0,
    activeJob = null,
    pendingRequest = null;
  modal(
    `<h2>${initial ? "Edit visual" : "Insert visual"}</h2><section class="media-composer"><nav class="media-tabs" aria-label="Visual tools">${["create", "library", "find", "ai"].map((t) => `<button type="button" data-media-tab="${t}">${{ create: "Create", library: "Library", find: "Find images", ai: "AI studio" }[t]}</button>`).join("")}</nav><div class="media-workspace"><div class="media-controls"></div><div class="media-preview"><span class="eyebrow">ARTICLE PREVIEW</span><div data-media-preview></div><div data-media-proposals></div></div></div><footer><button type="button" class="media-mobile-preview secondary" data-media-action="toggle-preview" aria-pressed="false">Preview visual</button><span role="status" data-media-status></span><button type="button" class="primary" data-media-action="insert">${initial ? "Update visual" : "Insert visual"}</button></footer></section>`,
  );
  const root = document.querySelector(".media-composer"),
    dialog = root.closest("dialog"),
    controls = root.querySelector(".media-controls");
  const value = (n) => root.querySelector(`[name="${n}"]`)?.value;
  const status = (message) => {
    if (alive)
      root.querySelector("[data-media-status]").textContent = message || "";
  };
  const api = (suffix, method = "GET", body) =>
    request(`/api/journal/${getDraft().id}/media/${suffix}`, method, body);
  const assets = () => {
    const d = getDraft();
    return { assets: d.assets, symbol: d.symbol };
  };
  function invalidate() {
    prepared = null;
    version++;
    const box = root.querySelector("[data-request-review]");
    if (box) box.innerHTML = "";
    const b = root.querySelector('[data-media-action="generate"]');
    if (b) b.disabled = true;
  }
  function common() {
    return `${field("Title", "title", block.title, "text", 'maxlength="200"')}${field("Caption", "caption", block.caption, "text", 'maxlength="1000"')}${select("Layout", "width", { inline: "Inline", wide: "Wide", cover: "Full width" }, block.width)}<details><summary data-tooltip="Sources, date and whether values are reported, calculated or hypothetical">Evidence & credits</summary>${field("As of", "asOf", block.asOf, "text", 'maxlength="40"')}${select("Basis", "basis", { reported: "Reported", calculated: "Calculated", scenario: "Scenario assumption", illustration: "Illustration" }, block.basis)}<label>Sources<textarea name="sources" placeholder="Source title | https://…">${esc(block.sources.map((s) => s.title + " | " + s.url).join("\n"))}</textarea></label></details>`;
  }
  function grid() {
    return `<div class="media-grid-editor"><table><thead><tr>${block.columns.map((c, i) => `<th><input aria-label="Column ${i + 1}" data-column="${i}" value="${esc(c)}" maxlength="80"></th>`).join("")}<th></th></tr></thead><tbody>${block.rows.map((r, i) => `<tr>${r.map((c, j) => `<td><input aria-label="Row ${i + 1}, column ${j + 1}" data-cell="${i}:${j}" value="${esc(c ?? "")}" maxlength="300"></td>`).join("")}<td><button type="button" data-remove-row="${i}" aria-label="Remove row ${i + 1}">×</button></td></tr>`).join("")}</tbody></table></div><div class="media-actions"><button type="button" data-media-action="row">+ Row</button><button type="button" data-media-action="column">+ Column</button><button type="button" data-media-action="remove-column">− Column</button></div><details><summary>Paste or import data</summary><label>CSV or spreadsheet cells<textarea name="csv" placeholder="Period,Revenue&#10;2025,100"></textarea></label><button type="button" data-media-action="parse">Use pasted data</button><label class="media-file">Import CSV<input type="file" name="csv-file" accept=".csv,.tsv,text/csv,text/tab-separated-values"></label></details>`;
  }
  function dataTools() {
    const d = getDraft();
    return `<details><summary data-tooltip="Take a dated snapshot of price history, or inspect stored research for this article's assets">Asset data</summary>${select("Asset", "asset", Object.fromEntries((d.assets || [{ symbol: d.symbol }]).map((a) => [a.symbol, a.symbol])), d.symbol)}<div class="form-row">${select("Period", "range", { "1mo": "1 month", "3mo": "3 months", "1y": "1 year", "5y": "5 years" }, "3mo")}${select("Currency", "currency", { USD: "USD", EUR: "EUR" }, "USD")}</div><div class="media-actions"><button type="button" data-media-action="prices">Use price history</button><button type="button" data-media-action="sources">Stored sources</button><button type="button" data-media-action="refresh">Refresh sources</button></div><div data-asset-sources>${sourcesMarkup()}</div></details>`;
  }
  function sourcesMarkup() {
    return sources
      .map(
        (s, i) =>
          `<details><summary>${esc(s.title)}</summary><p>${esc(s.content)}</p>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open source ${icon("arrow")}</a><button type="button" data-cite="${i}">Cite</button>` : ""}</details>`,
      )
      .join("");
  }
  function render() {
    if (!alive) return;
    root
      .querySelectorAll("[data-media-tab]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.mediaTab === tab)),
      );
    if (tab === "create") {
      let specific = "";
      if (["chart", "table", "statistics"].includes(block.type))
        specific = `${grid()}${field("Unit", "unit", block.unit, "text", 'maxlength="60"')}${block.type === "chart" ? select("Chart", "chart", { line: "Line", bar: "Bar" }, block.chart) + select("Calculation", "transform", { raw: "Raw values", index: "Index to 100", change: "Change from first value (%)" }, block.transform) : block.type === "statistics" ? select("Calculation", "aggregate", { latest: "Latest available", sum: "Sum", average: "Average", change: "First to last change (%)" }, block.aggregate) : ""}${dataTools()}`;
      if (block.type === "image")
        specific = `<label class="media-file">Upload image<input type="file" name="image-file" accept="image/png,image/jpeg,image/webp,image/avif"></label>${field("Alternative text", "alt", block.alt, "text", 'maxlength="500"')}${field("Credit", "credit", block.credit, "text", 'maxlength="400"')}<div class="form-row">${select("Crop", "ratio", { original: "Original", "16:9": "16:9", "4:3": "4:3", "1:1": "Square", "3:4": "Portrait" }, block.ratio)}${select("Fit", "fit", { contain: "Fit image", cover: "Fill crop" }, block.fit)}</div>${field("Focal point X", "focalX", block.focalX, "range", 'min="0" max="100"')}${field("Focal point Y", "focalY", block.focalY, "range", 'min="0" max="100"')}`;
      if (block.type === "youtube")
        specific = `${field("YouTube URL", "video", block.videoId ? "https://www.youtube.com/watch?v=" + block.videoId : "", "url")}${field("Start at (seconds)", "start", block.start || 0, "number", 'min="0" max="86400"')}`;
      if (["diagram", "timeline"].includes(block.type))
        specific = `${block.nodes.map((n, i) => `<fieldset data-node="${i}"><legend>Step ${i + 1}</legend>${field("Label", `node-label-${i}`, n.label, "text", 'maxlength="100"')}${field("Detail", `node-detail-${i}`, n.detail, "text", 'maxlength="600"')}${field("Date or marker", `node-tag-${i}`, n.tag, "text", 'maxlength="60"')}<button type="button" data-remove-node="${i}">Remove step</button></fieldset>`).join("")}<div class="media-actions"><button type="button" data-media-action="node">+ Step</button><button type="button" data-media-action="scenario">Use scenario map</button></div>`;
      controls.innerHTML = `${select("Visual", "type", mediaTypes, block.type)}${specific}${common()}`;
    } else if (tab === "library")
      controls.innerHTML = `<div class="media-library">${images.length ? images.map((im, i) => `<article><button type="button" data-library="${i}"><img src="${esc(im.url)}" alt="${esc(im.name)}" loading="lazy"><b>${esc(im.name)}</b><small>${im.width} × ${im.height}</small></button><button type="button" data-archive="${i}" aria-label="Remove ${esc(im.name)} from library" data-tooltip="Hide from your library. Existing article images remain available.">×</button></article>`).join("") : '<p class="media-empty">No images yet</p>'}</div><button type="button" data-media-action="upload-tab">Upload image</button>`;
    else if (tab === "find")
      controls.innerHTML = `<label>Wikimedia Commons<input name="image-query" type="search" value="${esc(imageQuery)}" placeholder="Search images"></label><button type="button" data-media-action="search">Search</button><div class="media-library">${matches.map((im, i) => `<article><img src="${esc(im.thumbnail)}" alt="${esc(im.title)}" loading="lazy"><b>${esc(im.title.replace(/^File:/, ""))}</b><small>${esc(im.license)}</small><a href="${esc(im.source)}" target="_blank" rel="noopener noreferrer">Source ${icon("arrow")}</a><button type="button" data-commons="${i}">Import image</button></article>`).join("")}</div>`;
    else
      controls.innerHTML = `${select("Create with AI", "task", { suggest: "Suggest visuals", chart: "Chart", table: "Table", statistics: "Statistics", diagram: "Diagram", timeline: "Timeline", image: "Generate image" }, task)}<label>Your instructions<textarea class="media-prompt" name="prompt" maxlength="4000">${esc(prompt)}</textarea></label><button type="button" class="link" data-media-action="reset-prompt">Reset preset</button>${task === "image" ? select("Aspect ratio", "aspect", { "16:9": "Landscape", "1:1": "Square", "4:3": "4:3", "3:4": "Portrait" }, aspect) : ""}<div class="media-actions"><button type="button" data-media-action="prepare">Review request</button><button type="button" class="primary" data-media-action="generate" disabled>Generate</button></div><div data-request-review></div><details><summary>Recent generations</summary><div data-media-history>${historyMarkup()}</div></details>`;
    preview();
  }
  function historyMarkup() {
    return jobs
      .map(
        (j, i) =>
          `<div class="media-job"><button type="button" data-job="${i}">${esc(j.request?.task || "Visual")} · ${esc(j.status)}</button>${j.status === "queued" ? `<button type="button" data-cancel="${i}">Cancel</button>` : ""}${j.error ? `<p>${esc(j.error)}</p>` : ""}</div>`,
      )
      .join("");
  }
  function preview() {
    try {
      const m = validateMedia(block);
      root.querySelector("[data-media-preview]").innerHTML = renderMedia(m);
      root.querySelector('[data-media-action="insert"]').disabled = false;
    } catch (e) {
      root.querySelector("[data-media-preview]").innerHTML =
        `<div class="media-placeholder">${esc(e.message)}</div>`;
      root.querySelector('[data-media-action="insert"]').disabled = true;
    }
  }
  function read() {
    if (tab === "ai") {
      prompt = value("prompt") ?? prompt;
      aspect = value("aspect") || aspect;
      return;
    }
    if (tab !== "create") return;
    for (const key of [
      "title",
      "caption",
      "width",
      "asOf",
      "basis",
      "unit",
      "chart",
      "transform",
      "aggregate",
      "alt",
      "credit",
      "ratio",
      "fit",
      "focalX",
      "focalY",
    ])
      if (value(key) !== undefined) block[key] = value(key);
    block.sources = (value("sources") || "")
      .split("\n")
      .filter((s) => s.trim())
      .map((s) => {
        const parts = s.split("|");
        return {
          title: parts.length > 1 ? parts.shift().trim() : "Source",
          url: parts.join("|").trim(),
        };
      });
    if (block.type === "youtube") {
      try {
        const ref = youtubeReference(value("video"));
        if (ref.videoId !== block.videoId || ref.start) {
          block.start = ref.start;
          root.querySelector('[name="start"]').value = ref.start;
        }
        block.videoId = ref.videoId;
      } catch {
        block.videoId = "";
      }
      block.start = Number(value("start"));
    }
    if (block.nodes)
      block.nodes = block.nodes.map((n, i) => ({
        label: value(`node-label-${i}`) ?? n.label,
        detail: value(`node-detail-${i}`) ?? n.detail,
        tag: value(`node-tag-${i}`) ?? n.tag,
      }));
  }
  function useImage(im) {
    block = {
      ...empty("image"),
      title: block.title,
      caption: block.caption,
      width: block.width,
      fileId: im.id,
      alt: im.name,
      pixelWidth: im.width,
      pixelHeight: im.height,
      credit: im.provenance?.credit || "",
      basis: im.provenance?.kind === "ai" ? "illustration" : "reported",
      sources: im.provenance?.source
        ? [
            {
              title: im.provenance.license || "Image source",
              url: im.provenance.source,
            },
          ]
        : [],
    };
    tab = "create";
    render();
  }
  async function upload(file) {
    if (!file || file.size > 8 * 1024 * 1024)
      throw Error("Choose an image under 8 MB.");
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(Error("Could not read image."));
      reader.readAsDataURL(file);
    });
    const im = await request("/api/journal/media/upload", "POST", {
      data,
      name: file.name.slice(0, 200),
      symbol: getDraft().symbol,
    });
    if (alive) useImage(im);
  }
  async function loadJobs() {
    const result = await api("ai");
    if (!alive) return;
    jobs = result.jobs;
    const host = root.querySelector("[data-media-history]");
    if (host) host.innerHTML = historyMarkup();
    const j = jobs.find((j) => j.id === activeJob);
    if (j && !["queued", "running"].includes(j.status)) {
      activeJob = null;
      pendingRequest = null;
      if (j.status === "completed") showResult(j);
      else status(j.error || j.status);
    }
    if (jobs.some((j) => ["queued", "running"].includes(j.status))) {
      clearTimeout(timer);
      timer = setTimeout(
        () => loadJobs().catch((e) => status(e.message)),
        2200,
      );
    }
  }
  function showResult(j) {
    if (!j.result) return status(j.error || j.status);
    status(j.result.summary || "Ready to review");
    if (j.result.image) useImage(j.result.image);
    proposals = j.result.proposals || [];
    root.querySelector("[data-media-proposals]").innerHTML = proposals
      .map(
        (p, i) =>
          `<article class="media-proposal"><p>${esc(p.reason)}</p>${p.placement ? `<small>${esc(p.placement)}</small>` : ""}${p.block ? `${renderMedia(p.block)}<button type="button" data-proposal="${i}">Edit this proposal</button>` : ""}</article>`,
      )
      .join("");
    if (j.prompt)
      root
        .querySelector("[data-media-proposals]")
        .insertAdjacentHTML(
          "beforeend",
          `<details class="media-stored-request"><summary>Request used · ${esc(j.model)}</summary><pre>${esc(j.prompt)}</pre></details>`,
        );
  }
  function payload() {
    const d = getDraft();
    let dataset;
    if (
      ["chart", "table", "statistics"].includes(block.type) &&
      block.rows.some((r) => r.slice(1).some((v) => typeof v === "number"))
    )
      dataset = validateMedia(block);
    return { ...d, task, prompt, aspectRatio: aspect, dataset };
  }
  async function prepare() {
    read();
    const input = payload(),
      key = JSON.stringify(input),
      epoch = ++version;
    const data = await api("ai/preview", "POST", input);
    if (!alive || epoch !== version) return;
    prepared = data;
    preparedKey = key;
    root.querySelector("[data-request-review]").innerHTML =
      `<div class="media-estimate"><b>${esc(data.model)}</b><span>Up to ${price(data.maximum)}</span></div><details><summary>Full request & asset context</summary><pre>${esc(data.prompt)}</pre></details>`;
    root.querySelector('[data-media-action="generate"]').disabled = false;
    status("");
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    status("Working…");
    try {
      await fn();
    } catch (e) {
      status(e.message);
    } finally {
      busy = false;
      if (
        alive &&
        root.querySelector("[data-media-status]").textContent === "Working…"
      )
        status("");
      root.removeAttribute("aria-busy");
    }
  }
  root.oninput = (e) => {
    if (e.target.name === "image-query") imageQuery = e.target.value;
    const cell = e.target.dataset.cell,
      column = e.target.dataset.column;
    if (cell) {
      const [i, j] = cell.split(":").map(Number),
        raw = e.target.value;
      block.rows[i][j] =
        raw === ""
          ? null
          : j && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(raw)
            ? Number(raw)
            : raw;
    }
    if (column !== undefined) block.columns[Number(column)] = e.target.value;
    read();
    invalidate();
    preview();
  };
  root.onchange = (e) => {
    if (e.target.name === "type") {
      const keep = {
        title: block.title,
        caption: block.caption,
        width: block.width,
        sources: block.sources,
        basis: block.basis,
        asOf: block.asOf,
      };
      if (
        ["chart", "table", "statistics"].includes(block.type) &&
        ["chart", "table", "statistics"].includes(e.target.value)
      )
        Object.assign(keep, {
          columns: block.columns,
          rows: block.rows,
          unit: block.unit,
          chart: block.chart,
          transform: block.transform,
          aggregate: block.aggregate,
        });
      if (
        ["diagram", "timeline"].includes(block.type) &&
        ["diagram", "timeline"].includes(e.target.value)
      )
        keep.nodes = block.nodes;
      block = { ...empty(e.target.value), ...keep };
      render();
    }
    if (e.target.name === "task") {
      task = e.target.value;
      prompt = mediaPresets[task];
      invalidate();
      render();
    }
    if (e.target.name === "image-file") run(() => upload(e.target.files[0]));
    if (e.target.name === "csv-file")
      run(async () => {
        const f = e.target.files[0];
        if (!f || f.size > 100000) throw Error("Choose a CSV under 100 KB.");
        const data = parseData(await f.text());
        block = validateMedia({ ...block, ...data });
        render();
        status("");
      });
  };
  root.onpaste = (e) => {
    if (
      !e.target.dataset.cell ||
      !e.clipboardData.getData("text").includes("\t")
    )
      return;
    e.preventDefault();
    try {
      const rows = parseData(
        "x\t" +
          block.columns.slice(1).join("\t") +
          "\n" +
          e.clipboardData.getData("text"),
      ).rows;
      const [start, col] = e.target.dataset.cell.split(":").map(Number);
      if (rows.length + start > 200) throw Error("Use at most 200 rows.");
      rows.forEach((r, i) => {
        block.rows[start + i] ||= block.columns.map(() => null);
        r.forEach((v, j) => {
          if (col + j < block.columns.length)
            block.rows[start + i][col + j] = v;
        });
      });
      invalidate();
      render();
    } catch (err) {
      status(err.message);
    }
  };
  root.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.mediaAction === "toggle-preview") {
      const active = root.classList.toggle("is-previewing");
      b.setAttribute("aria-pressed", String(active));
      b.textContent = active ? "Edit visual" : "Preview visual";
      return;
    }
    if (d.mediaTab) {
      invalidate();
      root.classList.remove("is-previewing");
      const toggle = root.querySelector(".media-mobile-preview");
      toggle.textContent = "Preview visual";
      toggle.setAttribute("aria-pressed", "false");
      read();
      tab = d.mediaTab;
      render();
      if (tab === "library")
        run(async () => {
          images = (await request("/api/journal/media/library")).images;
          render();
          status("");
        });
      if (tab === "ai")
        run(async () => {
          await loadJobs();
          status("");
        });
      return;
    }
    if (d.proposal !== undefined) {
      block = structuredClone(proposals[Number(d.proposal)].block);
      tab = "create";
      invalidate();
      render();
      return;
    }
    if (d.library !== undefined) return useImage(images[Number(d.library)]);
    if (d.job !== undefined)
      return run(async () => {
        const result = await api("ai/" + jobs[Number(d.job)].id);
        if (alive) showResult(result);
      });
    if (
      ![
        "mediaAction",
        "removeRow",
        "removeNode",
        "commons",
        "archive",
        "cancel",
        "cite",
      ].some((key) => Object.hasOwn(d, key))
    )
      return;
    run(async () => {
      read();
      const a = d.mediaAction;
      if (a === "insert") {
        onInsert(validateMedia(block));
        close();
        return;
      }
      if (a === "row" && block.rows.length < 200)
        block.rows.push(block.columns.map(() => null));
      if (a === "column" && block.columns.length < 8) {
        block.columns.push("Series " + block.columns.length);
        block.rows.forEach((r) => r.push(null));
      }
      if (a === "remove-column" && block.columns.length > 2) {
        block.columns.pop();
        block.rows.forEach((r) => r.pop());
      }
      if (d.removeRow !== undefined && block.rows.length > 1)
        block.rows.splice(Number(d.removeRow), 1);
      if (d.removeNode !== undefined && block.nodes.length > 1)
        block.nodes.splice(Number(d.removeNode), 1);
      if (a === "node" && block.nodes.length < 12)
        block.nodes.push({ label: "", detail: "", tag: "" });
      if (a === "scenario") {
        const branch = getDraft().branches?.[0];
        if (!branch) throw Error("Map a scenario in the article first.");
        block.basis = "scenario";
        block.nodes = [
          { label: branch.title, detail: branch.condition, tag: "Condition" },
          {
            label: `${branch.low}–${branch.high} ${branch.currency}`,
            detail: `${branch.horizonDays} days`,
            tag: "Outlook",
          },
          {
            label: "Invalidation",
            detail:
              branch.invalidation ||
              "Add the condition that breaks this scenario.",
            tag: "Review",
          },
        ];
      }
      if (a === "parse")
        block = validateMedia({ ...block, ...parseData(value("csv")) });
      if (a === "upload-tab") {
        block = empty("image");
        tab = "create";
      }
      if (a === "search") {
        matches = (
          await request(
            "/api/journal/media/commons?q=" +
              encodeURIComponent(value("image-query")),
          )
        ).images;
        render();
        status(matches.length ? "" : "No matching images");
        return;
      }
      if (d.commons !== undefined) {
        useImage(
          await request("/api/journal/media/commons", "POST", {
            pageId: matches[Number(d.commons)].id,
            symbol: getDraft().symbol,
          }),
        );
        status("");
        return;
      }
      if (d.archive !== undefined) {
        await request(
          "/api/journal/media/" + images[Number(d.archive)].id,
          "DELETE",
        );
        images.splice(Number(d.archive), 1);
      }
      if (d.cancel !== undefined) {
        await request(
          "/api/research/jobs/" + jobs[Number(d.cancel)].id,
          "DELETE",
        );
        await loadJobs();
        status("Cancelled");
        return;
      }
      if (["sources", "refresh"].includes(a)) {
        sources = (
          await api("sources", "POST", {
            ...assets(),
            asset: value("asset"),
            refresh: a === "refresh",
          })
        ).sources;
        root.querySelector("[data-asset-sources]").innerHTML = sourcesMarkup();
        status(sources.length ? "" : "No stored sources for this asset");
        return;
      }
      if (d.cite !== undefined) {
        const s = sources[Number(d.cite)];
        if (!block.sources.some((x) => x.url === s.url))
          block.sources.push({ title: s.title.slice(0, 200), url: s.url });
      }
      if (a === "prices") {
        const currency = value("currency"),
          data = await api("prices", "POST", {
            ...assets(),
            asset: value("asset"),
            range: value("range"),
            currency,
          });
        const dataset = priceDataset(data);
        block = { ...block, ...dataset, title: block.title || dataset.title };
      }
      if (a === "reset-prompt") {
        prompt = mediaPresets[task];
        invalidate();
        render();
        status("");
        return;
      }
      if (a === "prepare") {
        await prepare();
        return;
      }
      if (a === "generate") {
        if (activeJob)
          throw Error("Wait for the current generation or cancel it.");
        const input = payload();
        if (!prepared || JSON.stringify(input) !== preparedKey)
          throw Error("Review the updated request first.");
        const approved = {
          ...input,
          contextHash: prepared.contextHash,
          model: prepared.model,
          maximum: prepared.maximum,
        };
        if (
          !pendingRequest ||
          pendingRequest.fingerprint !== JSON.stringify(approved)
        )
          pendingRequest = {
            fingerprint: JSON.stringify(approved),
            key: crypto.randomUUID(),
          };
        const job = await api("ai", "POST", {
          ...approved,
          requestKey: pendingRequest.key,
        });
        activeJob = job.id;
        invalidate();
        await loadJobs();
        status("Generating…");
        return;
      }
      invalidate();
      render();
      status("");
    });
  };
  function destroy() {
    alive = false;
    clearTimeout(timer);
    dialog.removeEventListener("close", destroy);
    root.oninput = root.onchange = root.onclick = root.onpaste = null;
  }
  dialog.addEventListener("close", destroy, { once: true });
  render();
  return { destroy };
}
