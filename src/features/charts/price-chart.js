import { referenceLevels, chartScale } from "../../domain/chart-levels.js";
import { historyRanges } from "../../domain/market-history.js";
import { setAnimatedText, revealChart } from "../../shared/motion.js";
import { renderChartInk, newChartInkId } from "../../shared/chart-ink.js";
import { mountChartFullscreen } from "../../shared/chart-fullscreen.js";
import { icon } from "../../shared/icons.js";
const inkIds = new WeakMap();
const cache = new Map(),
  pending = new Map();
let activeRange = "1mo",
  activeCurrency = "EUR";
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const price = (n) =>
  new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(n) > 0 && Math.abs(n) < 0.1 ? 8 : 2,
  }).format(n);
export async function fetchPriceHistory(symbol, range, currency) {
  const key = symbol + ":" + range + ":" + currency,
    previous = cache.get(key);
  if (previous && Date.now() - previous.at < 60000) return previous.data;
  if (pending.has(key)) return pending.get(key);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 18000);
  const promise = (async () => {
    try {
      const response = await fetch(
        `/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&currency=${currency}`,
        { credentials: "same-origin", signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Price history unavailable.");
      if (cache.size >= 30) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), data });
      return data;
    } finally {
      clearTimeout(timer);
      pending.delete(key);
    }
  })();
  pending.set(key, promise);
  return promise;
}
export function mountPriceChart(root, holding, initialLevels = {}) {
  let data = null,
    levels = initialLevels,
    disposed = false;
  const hidden = new Set();
  root.innerHTML = `<div class="price-history-top"><div class="history-readout"><div class="eyebrow"><button class="history-currency-switch" type="button"></button><span class="history-currency"></span><span class="history-asset-symbol">${escape(holding.symbol)}</span></div><div class="history-price" data-number>—</div><div class="history-change">${escape(holding.symbol)}</div></div><div class="history-chart-actions"><div class="history-ranges" role="group" aria-label="Price history range">${Object.entries(
    historyRanges,
  )
    .map(
      ([key, value]) =>
        `<button type="button" data-history-range="${key}">${value.label}</button>`,
    )
    .join(
      "",
    )}</div><span class="history-expand-host"></span></div></div><div class="history-body" aria-busy="true"><div class="history-placeholder loading-surface" role="status"><span class="sr-only">Loading price history</span><div class="history-skeleton-grid" aria-hidden="true"></div></div></div><div class="history-levels"></div><div class="history-caption"><span>Market price</span><span class="history-hover-hint"></span></div>`;
  const currencyButton = root.querySelector(".history-currency-switch"),
    fullscreen = mountChartFullscreen(root, {
      label: () => `${holding.symbol} · Price history`,
      buttonHost: root.querySelector(".history-expand-host"),
      native: true,
      onChange: (active) => root.classList.toggle("history-fullscreen", active),
    });
  function controls(range, currency) {
    for (const button of root.querySelectorAll("[data-history-range]")) {
      const selected = range === button.dataset.historyRange;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    currencyButton.innerHTML = `${escape(currency)} ${icon("swap")}`;
    currencyButton.setAttribute(
      "aria-label",
      `Chart currency: ${currency}. Switch currency`,
    );
  }
  root.querySelectorAll("[data-history-range]").forEach((button) => {
    button.onclick = () => {
      if (activeRange === button.dataset.historyRange && data) return;
      activeRange = button.dataset.historyRange;
      load();
    };
  });
  currencyButton.onclick = () => {
    activeCurrency = activeCurrency === "EUR" ? "USD" : "EUR";
    load();
  };
  const controller = {
    setLevels(next) {
      levels = next;
      if (data && root.isConnected && !disposed)
        draw(root, data, levels, hidden);
    },
    destroy() {
      disposed = true;
      root.chartGeneration = null;
      fullscreen.destroy();
    },
  };
  function load() {
    const range = activeRange,
      currency = activeCurrency;
    controls(range, data?.currency || currency);
    root.classList.add("history-loading");
    root.querySelector(".history-body").setAttribute("aria-busy", "true");
    if (data)
      root.querySelector(".history-hover-hint").textContent =
        `Updating ${historyRanges[range].label} · ${currency}`;
    // Same-root switches cannot replace newer data with an older response.
    const generation = Symbol();
    root.chartGeneration = generation;
    const valid = () =>
      !disposed && root.isConnected && root.chartGeneration === generation;
    const empty = (text, retry = false) => {
      root.classList.remove("history-loading");
      root.querySelector(".history-body").setAttribute("aria-busy", "false");
      if (data) {
        controls(data.range, data.currency);
        root.querySelector(".history-hover-hint").innerHTML =
          `${escape(text)}${retry ? ` · <button class="link history-retry" type="button">Retry ${icon("arrow")}</button>` : ""}`;
      } else {
        root.querySelector(".history-body").innerHTML =
          `<div class="history-placeholder history-unavailable"><span>${escape(text)}</span>${retry ? `<button class="link history-retry" type="button">Try again ${icon("arrow")}</button>` : ""}</div>`;
        root.querySelector(".history-caption").innerHTML =
          "<span>Market price</span><span></span>";
      }
      const button = root.querySelector(".history-retry");
      if (button) button.onclick = load;
    };
    if (holding.demo) {
      empty("Demo");
      return;
    }
    fetchPriceHistory(holding.symbol, range, currency)
      .then((response) => {
        if (!valid()) return;
        if (!response.points?.length) {
          empty("No observations", true);
          return;
        }
        data = response;
        controls(range, data.currency);
        root.classList.remove("history-loading");
        draw(root, data, levels, hidden);
        revealChart(root.querySelector(".history-market-line"));
      })
      .catch(() => {
        if (valid()) empty("Data unavailable", true);
      });
  }
  load();
  return controller;
}
function draw(root, data, inputs, hidden) {
  const points = data.points,
    last = points.length - 1,
    first = points[0].price,
    latest = points[last].price;
  const rise = latest >= first,
    color = rise ? "#b9f68b" : "#efad9d";
  const references = referenceLevels({
    ...inputs,
    currency: data.currency,
    symbol: data.symbol,
    displayFx: data.referenceFx,
  });
  const visible = references.levels.filter((l) => !hidden.has(l.id));
  const { low, high, y } = chartScale(points, visible);
  const x = (i) => (points.length === 1 ? 500 : 8 + (i / last) * 984);
  if (!inkIds.has(root)) inkIds.set(root, newChartInkId("portfolio"));
  const ink = renderChartInk(points, {
    id: inkIds.get(root),
    x,
    y,
    baseline: 195,
    color: rise ? "#9bd5aa" : "#dca295",
    highlight: rise ? "#dcf1d5" : "#f1c8bb",
    className: "history-market-line",
    endpoint: false,
  });
  const intraday = ["1d", "1wk"].includes(data.range);
  const date = (time, detail = false) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: data.timeZone,
      ...(detail
        ? {
            day: "numeric",
            month: "short",
            year: "numeric",
            ...(intraday
              ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }
              : {}),
          }
        : data.range === "1d"
          ? { hour: "2-digit", minute: "2-digit" }
          : data.range === "5y"
            ? { month: "short", year: "2-digit" }
            : { day: "numeric", month: "short" }),
    }).format(time * 1000);
  root.querySelector(".history-currency").textContent =
    data.conversionUnavailable ? data.currency + " data" : "";
  root.querySelector(".history-body").setAttribute("aria-busy", "false");
  root.querySelector(".history-body").innerHTML =
    `<div class="history-plot" role="slider" tabindex="0" aria-label="Explore ${escape(data.symbol)} price history" aria-valuemin="0" aria-valuemax="${last}" aria-valuenow="${last}"><svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true"><defs>${ink.defs}</defs><path d="M8 12H992 M8 98H992 M8 184H992" class="history-grid"/>${ink.markup}${visible.map((l) => `<line class="history-reference" x1="8" x2="992" y1="${y(l.price)}" y2="${y(l.price)}" stroke="${l.color}" vector-effect="non-scaling-stroke"/>`).join("")}<line class="history-crosshair-horizontal" x1="8" x2="992" y1="${y(latest)}" y2="${y(latest)}"/><line class="history-crosshair" x1="${x(last)}" x2="${x(last)}" y1="5" y2="195"/><path class="history-point-ring" d="M${x(last)} ${y(latest)}h.01" stroke="${color}" stroke-opacity=".14" stroke-width="10" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path class="history-point" d="M${x(last)} ${y(latest)}h.01" stroke="${color}" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>${visible.map((l) => `<span class="history-level-label level-${l.id}" style="top:${y(l.price) / 2}%;--level-color:${l.color}">${escape(l.label)} ${price(l.price)}</span>`).join("")}<span class="history-axis history-axis-high">${price(high)}</span><span class="history-axis history-axis-low">${price(low)}</span></div><div class="history-dates"><span>${date(points[0].time)}</span><span>${date(points[Math.floor(last / 2)].time)}</span><span>${date(points[last].time)}</span></div>`;
  root.querySelector(".history-caption").innerHTML =
    `<span>${escape(data.source)} · ${escape(data.currency)}${data.conversionUnavailable ? " · FX unavailable" : ""}</span><span class="history-hover-hint">Drag to explore</span>`;
  let legend = root.querySelector(".history-levels");
  if (!legend) {
    legend = document.createElement("div");
    legend.className = "history-levels";
    root.querySelector(".history-caption").before(legend);
  }
  legend.innerHTML = references.levels
    .map(
      (l) =>
        `<button type="button" class="level-toggle" data-level="${l.id}" aria-pressed="${!hidden.has(l.id)}" style="--level-color:${l.color}" title="${escape(l.detail)}${references.converted ? " · FX from " + new Date(references.fxTime * 1000).toISOString() : ""}"><i></i><span>${escape(l.label)}</span><b>${price(l.price)} ${escape(data.currency)}</b></button>`,
    )
    .join("");
  legend.querySelectorAll("[data-level]").forEach(
    (button) =>
      (button.onclick = () => {
        const id = button.dataset.level;
        if (hidden.has(id)) hidden.delete(id);
        else hidden.add(id);
        draw(root, data, inputs, hidden);
        root
          .querySelector(`[data-level="${id}"]`)
          ?.focus({ preventScroll: true });
      }),
  );
  const plot = root.querySelector(".history-plot"),
    svg = plot.querySelector("svg"),
    crosshair = plot.querySelector(".history-crosshair"),
    dot = plot.querySelector(".history-point"),
    ring = plot.querySelector(".history-point-ring"),
    horizontal = plot.querySelector(".history-crosshair-horizontal");
  let index = last,
    pressed = false;
  const select = (i, exploring = true) => {
    index = Math.max(0, Math.min(last, i));
    const point = points[index],
      change = point.price - first,
      percent = (change / first) * 100;
    setAnimatedText(root.querySelector(".history-price"), price(point.price));
    const readout = root.querySelector(".history-change");
    readout.className = "history-change " + (change >= 0 ? "up" : "down");
    setAnimatedText(
      readout,
      `${change >= 0 ? "+" : ""}${price(change)} (${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%)`,
    );
    readout.title = "Change from the first plotted price";
    root.querySelector(".history-hover-hint").textContent = exploring
      ? date(point.time, true)
      : `${historyRanges[data.range].label} · ${date(points[last].time, true)}`;
    plot.setAttribute("aria-valuenow", String(index));
    plot.setAttribute(
      "aria-valuetext",
      `${price(point.price)} ${data.currency}, ${date(point.time, true)} (${data.timeZone})`,
    );
    crosshair.setAttribute("x1", x(index));
    crosshair.setAttribute("x2", x(index));
    dot.setAttribute("d", `M${x(index)} ${y(point.price)}h.01`);
    ring.setAttribute("d", `M${x(index)} ${y(point.price)}h.01`);
    horizontal.setAttribute("y1", y(point.price));
    horizontal.setAttribute("y2", y(point.price));
    plot.classList.toggle("exploring", exploring);
  };
  const locate = (e) => {
    const rect = svg.getBoundingClientRect();
    return Math.round(
      ((((e.clientX - rect.left) / rect.width) * 1000 - 8) / 984) * last,
    );
  };
  plot.onpointerdown = (e) => {
    if (e.button !== 0) return;
    pressed = true;
    plot.setPointerCapture(e.pointerId);
    select(locate(e));
  };
  plot.onpointermove = (e) => {
    if (e.pointerType === "mouse" || pressed) select(locate(e));
  };
  plot.onpointerup = () => {
    pressed = false;
  };
  plot.onpointerleave = () => {
    if (!pressed) select(last, false);
  };
  plot.onpointercancel = () => {
    pressed = false;
    select(last, false);
  };
  plot.onkeydown = (e) => {
    const changes = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in changes) {
      e.preventDefault();
      select(index + changes[e.key]);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      select(e.key === "Home" ? 0 : last);
    }
  };
  plot.onblur = () => select(last, false);
  select(last, false);
}
