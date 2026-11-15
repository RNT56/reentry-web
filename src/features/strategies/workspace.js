import { icon } from "../../shared/ui.js";
import { loadingSurface } from "../../shared/motion.js";
import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
import { mountAssetChart } from "../charts/asset-chart.js";
import { chartWorkspaceSync } from "../charts/chart-sync.js";
import {
  chartInkPaths,
  renderChartInk,
  newChartInkId,
} from "../../shared/chart-ink.js";
const colors = ["#b9f68b", "#83bdf1", "#eeb884", "#bf9ef0"];
const pct = (n) => (n * 100).toFixed(1) + "%";
export function structureChart(
  d,
  money,
  inkId = newChartInkId("structure"),
  { width = 1000, height = 260 } = {},
) {
  const points = d.structure || [],
    wave = d.wave;
  if (!points.length) return "";
  const targets = wave.active ? wave.projected : [],
    values = points
      .flatMap((p) => [p.price, p.fit])
      .filter(Number.isFinite)
      .concat(targets);
  const low = Math.min(...values) * 0.94,
    high = Math.max(...values) * 1.06;
  const right = wave.active ? width * 0.78 : width - 20,
    first = points[0].time,
    last = points.at(-1).time;
  const x = (t) => 20 + ((t - first) / (last - first || 1)) * (right - 20),
    y = (v) => height - 35 - ((v - low) / (high - low || 1)) * (height - 70);
  const priceInk = renderChartInk(points, {
    id: inkId,
    x: (_i, point) => x(point.time),
    y,
    baseline: height - 35,
    color: colors[0],
    className: "structure-price-line chart-line-reveal",
  });
  const fit = chartInkPaths(points, {
    x: (_i, point) => x(point.time),
    y,
    value: (point) => point.fit,
  });
  const date = (t) => new Date(t * 1000).toLocaleDateString();
  const markers = wave.pivots
    .map(
      (p) =>
        `<g><circle cx="${x(p.time)}" cy="${y(p.price)}" r="4" fill="#bf9ef0"/><text x="${x(p.time)}" y="${y(p.price) + (p.kind === "high" ? -12 : 20)}" text-anchor="middle">${p.kind === "high" ? "H" : "L"}</text><title>${date(p.time)} · ${money(p.price)} · confirmed ${date(p.confirmedAt)}</title></g>`,
    )
    .join("");
  const projection = wave.active
    ? `<line x1="${right}" x2="${right}" y1="24" y2="${height - 35}" stroke="#bf9ef0" stroke-dasharray="3 7" opacity=".3"/><rect x="${right + 8}" y="${y(targets[1])}" width="${Math.max(1, width - right - 28)}" height="${y(targets[0]) - y(targets[1])}" fill="#bf9ef0" opacity=".07"/>${targets.map((v, i) => `<path d="M${right} ${y(points.at(-1).price)} L${width - 40} ${y(v)}" stroke="#bf9ef0" fill="none" stroke-dasharray="5 5"/><text x="${width - 40}" y="${y(v) - 8}" text-anchor="end">${i ? "1.618×" : "1×"} · ${esc(money(v))}</text>`).join("")}`
    : "";
  return `<section class="strategy-structure"><div class="section-line"><h3>Asset structure</h3><div class="structure-expand-host"><span>${esc(d.currency)}</span></div></div><div class="strategy-structure-body"><div class="structure-legend"><span>Price</span><span>Power fit</span><span>Confirmed pivots</span>${wave.active ? "<span>Wave 3 · conditional</span>" : ""}</div><svg viewBox="0 0 ${width} ${height}" class="structure-chart" role="img" aria-label="Observed asset prices, descriptive window power fit and confirmed high low pivots${wave.active ? ", with conditional wave three levels" : ""}"><defs>${priceInk.defs}</defs><path d="M20 35H${width - 20} M20 ${height / 2}H${width - 20} M20 ${height - 35}H${width - 20}" stroke="currentColor" opacity=".09"/>${priceInk.markup}<path class="structure-fit-line chart-line-reveal" d="${fit.linePath}" fill="none" stroke="#eeb884" stroke-width="1.3" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>${markers}${projection}<text x="20" y="20">${esc(money(high))}</text><text x="20" y="${height - 10}">${esc(money(low))}</text></svg><div class="strategy-dates"><span>${date(first)}</span><span>${date(last)}${wave.active ? " / conditional extensions" : ""}</span></div><div class="structure-source">${esc(d.source)} · ${esc(d.symbol)} · ${points.length} samples</div></div></section>`;
}
export function strategyCurveInk(
  data,
  selected = 0,
  inkId = newChartInkId("strategies"),
  { width = 1000, height = 240 } = {},
) {
  const values = data.strategies
    .flatMap((strategy) => strategy.curve.map((point) => point.value))
    .filter(Number.isFinite);
  const min = values.length ? Math.min(...values) * 0.98 : 0,
    max = values.length ? Math.max(...values) * 1.02 : 1;
  const start = data.start,
    duration = data.end - start || 1;
  const series = data.strategies.map((strategy, index) => {
    const ink = renderChartInk(strategy.curve, {
      id: `${inkId}-${index}`,
      x: (_i, point) => 12 + ((point.time - start) / duration) * (width - 24),
      y: (value) =>
        height - 20 - ((value - min) / (max - min || 1)) * (height - 40),
      value: (point) => point.value,
      baseline: index === selected ? height - 20 : undefined,
      color: colors[index % colors.length],
      highlight: colors[index % colors.length],
      className: "strategy-account-line chart-line-reveal",
      endpoint: index === selected,
    });
    return { index, ...ink };
  });
  const order = [
    ...series.filter((item) => item.index !== selected),
    ...series.filter((item) => item.index === selected),
  ];
  return {
    defs: series.map((item) => item.defs).join(""),
    markup: order
      .map(
        (item) =>
          `<g class="strategy-series${item.index === selected ? " is-selected" : ""}" data-strategy-series="${item.index}">${item.markup}</g>`,
      )
      .join(""),
  };
}
export function mountStrategies(
  root,
  { symbol, currency = "EUR", ownerId } = {},
) {
  let disposed = false,
    epoch = 0,
    current = null,
    selected = 0,
    comparison = null,
    structure = null,
    currencyRefresh = null;
  const controls = `<form class="strategy-controls"><label>Capital<input name="capital" type="number" min="100" max="10000000" value="10000" step="100"></label><label>Order fee<input name="fee" type="number" min="0" max="1000" value="1" step="0.1"></label><label>Spread · bp<input name="bps" type="number" min="0" max="500" value="0"></label><label>Currency<select name="currency"><option ${currency === "EUR" ? "selected" : ""}>EUR</option><option ${currency === "USD" ? "selected" : ""}>USD</option></select></label><button class="secondary">Compare ${icon("arrow")}</button></form>`;
  root.innerHTML = `<section class="strategy-workspace"><div class="section-line"><h2>Strategies</h2></div><details class="strategy-parameters"><summary>Parameters <span class="strategy-parameters-summary">10,000 ${esc(currency)}</span></summary>${controls}</details><div class="strategy-output" aria-live="polite" aria-busy="true">${loadingSurface("strategies")}</div></section>`;
  const output = root.querySelector(".strategy-output"),
    form = root.querySelector("form");
  function changeCurrency(value) {
    if (currencyRefresh && form.elements.currency.value === value)
      return currencyRefresh;
    form.elements.currency.value = value;
    const pending = load().then(() => {
      if (!disposed && current?.currency !== value)
        throw Error("Currency unavailable");
    });
    currencyRefresh = pending;
    return pending.finally(() => {
      if (currencyRefresh === pending) currencyRefresh = null;
    });
  }
  function render() {
    if (disposed || !current) return;
    const d = current,
      money = (n) =>
        new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: d.currency,
          maximumFractionDigits: 0,
        }).format(n),
      series = d.strategies.map((strategy, i) => ({
        points: strategy.curve.map((p) => ({ time: p.time, price: p.value })),
        color: colors[i],
        primary: i === selected,
      }));
    const s = d.strategies[selected];
    const assetPrice = (n) =>
      new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: current.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: Math.abs(n) < 0.01 ? 8 : 2,
      }).format(n);
    if (!comparison) {
      output.innerHTML =
        '<section class="strategy-comparison"><div class="strategy-comparison-parameters"></div><div class="strategy-comparison-chart"></div><div class="strategy-metrics"></div></section><section class="strategy-structure-chart"></section><div class="strategy-details"></div>';
      output
        .querySelector(".strategy-comparison-parameters")
        .append(root.querySelector(".strategy-parameters"));
      comparison = mountAssetChart(
        output.querySelector(".strategy-comparison-chart"),
        {
          ownerId,
          symbol,
          surface: "strategies",
          label: symbol + " · Strategies",
          readout: false,
          onCurrency: changeCurrency,
          accessory: '<div class="strategy-scoreboard"></div>',
        },
      );
      structure = mountAssetChart(
        output.querySelector(".strategy-structure-chart"),
        {
          ownerId,
          symbol,
          surface: "structure",
          label: symbol + " · Asset structure",
          readout: false,
          onCurrency: changeCurrency,
          accessory:
            '<div class="structure-legend"><span>Price</span><span>Power fit</span><span>Confirmed pivots</span></div>',
          references: () =>
            current.wave.active
              ? current.wave.projected.map((price, i) => ({
                  id: "wave-" + i,
                  label: "Wave 3 · " + (i ? "1.618×" : "1×"),
                  price,
                  color: "#bf9ef0",
                }))
              : [],
          extra: (g) =>
            current.wave.pivots
              .map(
                (p) =>
                  `<g pointer-events="none"><circle cx="${g.timeX(p.time)}" cy="${g.y(p.price)}" r="3" fill="#bf9ef0"/><text class="asset-pivot-label" x="${g.timeX(p.time)}" y="${g.y(p.price) + (p.kind === "high" ? -10 : 18)}" text-anchor="middle">${p.kind === "high" ? "H" : "L"}</text><title>${new Date(p.time * 1000).toLocaleDateString()} · ${esc(assetPrice(p.price))} · confirmed ${new Date(p.confirmedAt * 1000).toLocaleDateString()}</title></g>`,
              )
              .join(""),
        },
      );
    }
    comparison.accessory.querySelector(".strategy-scoreboard").innerHTML =
      d.strategies
        .map(
          (item, i) =>
            `<button class="strategy-score ${selected === i ? "selected" : ""}" data-strategy="${i}" aria-pressed="${selected === i}" style="--strategy-color:${colors[i]}"><span>${esc(item.name)}</span><strong>${money(item.value)}</strong><small>${pct(item.return)}</small></button>`,
        )
        .join("");
    comparison.setData({
      points: series[selected].points,
      series: [
        ...series.filter((s) => !s.primary),
        ...series.filter((s) => s.primary),
      ],
      currency: d.currency,
      source: d.source,
    });
    structure.setData({
      points: d.structure,
      currency: d.currency,
      source: d.source,
      series: [
        { points: d.structure, color: colors[0], primary: true },
        {
          points: d.structure.map((p) => ({ time: p.time, price: p.fit })),
          color: colors[2],
          dashed: true,
        },
      ],
    });
    output.querySelector(".strategy-metrics").innerHTML =
      `<div><span>Drawdown</span><b>${pct(s.drawdown)}</b></div><div><span>Cash</span><b>${money(s.cash)}</b></div><div><span>Orders</span><b>${s.trades.length}</b></div><div><span>Fees</span><b>${money(s.fees)}</b></div>`;
    output.querySelector(".strategy-details").innerHTML =
      `<div class="strategy-lenses"><section><span class="eyebrow">POWER LAW · LOG FIT</span><strong>R² ${d.power?.r2.toFixed(3) ?? "—"}</strong><span>Fit ${d.power ? assetPrice(d.power.fair) : "—"}</span></section><section><span class="eyebrow">ELLIOTT · WAVE 2 SCAN</span><strong>${d.wave.active ? "Setup detected" : "No active setup"}</strong><span>${d.wave.active ? d.wave.projected.map(assetPrice).join(" → ") : d.wave.pivots.length + " confirmed pivots"}</span></section></div><details class="strategy-method"><summary>Method & data ${icon("arrow")}</summary><dl><dt>Source</dt><dd>${esc(d.source)}</dd><dt>Capital</dt><dd>Equal starting cash · ${money(d.capital)}</dd><dt>Timing</dt><dd>Monthly tranches · next sampled close</dd><dt>Cash yield</dt><dd>0%</dd><dt>Costs</dt><dd>${money(d.fee)} / order + ${d.bps} bp</dd><dt>Basis</dt><dd>Pre-tax · price returns · dividends excluded</dd><dt>Power law</dt><dd>Observed-window log price / log elapsed days</dd><dt>Elliott</dt><dd>Wave 2 candidate · 38.2–78.6% retracement</dd><dt>Confirmation</dt><dd>2 later samples / pivot</dd><dt>Extension</dt><dd>1× / 1.618× prior impulse · conditional</dd>${d.conversionUnavailable ? `<dt>FX</dt><dd>${esc(d.requestedCurrency)} unavailable · ${esc(d.currency)} shown</dd>` : ""}</dl><a href="https://www.investor.gov/introduction-investing/investing-basics/glossary/dollar-cost-averaging" target="_blank" rel="noopener noreferrer">DCA ${icon("arrow")}</a> · <a href="https://www.elliottwave.com/wave-riffs/questions-we-get-questions/" target="_blank" rel="noopener noreferrer">Wave rules ${icon("arrow")}</a></details>`;
    output.querySelectorAll("[data-strategy]").forEach(
      (b) =>
        (b.onclick = () => {
          selected = Number(b.dataset.strategy);
          render();
          output
            .querySelector(`[data-strategy="${selected}"]`)
            ?.focus({ preventScroll: true });
        }),
    );
  }
  async function load() {
    const id = ++epoch;
    output.setAttribute("aria-busy", "true");
    const values = new FormData(form);
    root.querySelector(".refresh-problem")?.remove();
    form.querySelector('button[type="submit"],button:not([type])').disabled =
      true;
    try {
      const data = await request(
        "/api/strategies?" +
          new URLSearchParams({ symbol, ...Object.fromEntries(values) }),
        "GET",
        undefined,
        { timeout: 40000 },
      );
      if (!disposed && id === epoch) {
        output.setAttribute("aria-busy", "false");
        current = data;
        root.querySelector(".strategy-parameters-summary").textContent =
          new Intl.NumberFormat("de-DE", {
            style: "currency",
            currency: data.currency,
            maximumFractionDigits: 0,
          }).format(data.capital);
        root.querySelector(".strategy-parameters").open = false;
        render();
      }
    } catch (e) {
      if (!disposed && id === epoch) {
        output.setAttribute("aria-busy", "false");
        if (current) {
          let notice = root.querySelector(".refresh-problem");
          if (!notice) {
            notice = document.createElement("p");
            notice.className = "refresh-problem";
            form.after(notice);
          }
          notice.textContent = e.message;
        } else output.textContent = e.message;
      }
    } finally {
      if (!disposed && id === epoch)
        form.querySelector(
          'button[type="submit"],button:not([type])',
        ).disabled = false;
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    load();
  };
  if (symbol) {
    const saved = chartWorkspaceSync(ownerId, symbol, "strategies");
    void saved
      .load()
      .then(() => {
        if (disposed) return;
        form.elements.currency.value = saved.get(1).state.currency;
        return load();
      })
      .catch((e) => {
        if (!disposed) {
          output.textContent = e.message;
          output.setAttribute("aria-busy", "false");
        }
      });
  } else output.textContent = "Select an asset";
  return {
    destroy() {
      disposed = true;
      epoch++;
      comparison?.destroy();
      structure?.destroy();
    },
    update(next) {
      symbol = next.symbol ?? symbol;
      load();
    },
  };
}
