import { request } from "../../shared/http.js";
import { esc } from "../../shared/format.js";
const colors = ["#b9f68b", "#83bdf1", "#eeb884", "#bf9ef0"];
const pct = (n) => (n * 100).toFixed(1) + "%";
function structureChart(d, money) {
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
  const right = wave.active ? 780 : 980,
    first = points[0].time,
    last = points.at(-1).time;
  const x = (t) => 20 + ((t - first) / (last - first)) * (right - 20),
    y = (v) => 225 - ((v - low) / (high - low)) * 190;
  const line = (field) =>
    points.map((p) => `${x(p.time)},${y(p[field])}`).join(" ");
  const date = (t) => new Date(t * 1000).toLocaleDateString();
  const markers = wave.pivots
    .map(
      (p) =>
        `<g><circle cx="${x(p.time)}" cy="${y(p.price)}" r="4" fill="#bf9ef0"/><text x="${x(p.time)}" y="${y(p.price) + (p.kind === "high" ? -12 : 20)}" text-anchor="middle">${p.kind === "high" ? "H" : "L"}</text><title>${date(p.time)} · ${money(p.price)} · confirmed ${date(p.confirmedAt)}</title></g>`,
    )
    .join("");
  const projection = wave.active
    ? `<line x1="${right}" x2="${right}" y1="24" y2="225" stroke="#bf9ef0" stroke-dasharray="3 7" opacity=".3"/><rect x="${right + 20}" y="${y(targets[1])}" width="160" height="${y(targets[0]) - y(targets[1])}" fill="#bf9ef0" opacity=".07"/>${targets.map((v, i) => `<path d="M${right} ${y(points.at(-1).price)} L960 ${y(v)}" stroke="#bf9ef0" fill="none" stroke-dasharray="5 5"/><text x="960" y="${y(v) - 8}" text-anchor="end">${i ? "1.618×" : "1×"} · ${esc(money(v))}</text>`).join("")}`
    : "";
  return `<section class="strategy-structure"><div class="section-line"><h3>Asset structure</h3><span>${esc(d.currency)}</span></div><div class="structure-legend"><span>Price</span><span>Power fit</span><span>Confirmed pivots</span>${wave.active ? "<span>Wave 3 · conditional</span>" : ""}</div><svg viewBox="0 0 1000 260" class="structure-chart" role="img" aria-label="Observed asset prices, descriptive window power fit and confirmed high low pivots${wave.active ? ", with conditional wave three levels" : ""}"><path d="M20 35H980 M20 130H980 M20 225H980" stroke="currentColor" opacity=".09"/><polyline points="${line("price")}" fill="none" stroke="#b9f68b" stroke-width="2" vector-effect="non-scaling-stroke"/><polyline points="${line("fit")}" fill="none" stroke="#eeb884" stroke-width="1.5" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>${markers}${projection}<text x="20" y="20">${esc(money(high))}</text><text x="20" y="250">${esc(money(low))}</text></svg><div class="strategy-dates"><span>${date(first)}</span><span>${date(last)}${wave.active ? " / conditional extensions" : ""}</span></div><div class="structure-source">${esc(d.source)} · ${esc(d.symbol)} · ${points.length} samples</div></section>`;
}
export function mountStrategies(root, { symbol, currency = "EUR" } = {}) {
  let disposed = false,
    epoch = 0,
    current = null,
    selected = 0;
  const controls = `<form class="strategy-controls"><label>Capital<input name="capital" type="number" min="100" max="10000000" value="10000" step="100"></label><label>Order fee<input name="fee" type="number" min="0" max="1000" value="1" step="0.1"></label><label>Spread · bp<input name="bps" type="number" min="0" max="500" value="0"></label><label>Currency<select name="currency"><option ${currency === "EUR" ? "selected" : ""}>EUR</option><option ${currency === "USD" ? "selected" : ""}>USD</option></select></label><button class="secondary">Compare ↗</button></form>`;
  root.innerHTML = `<section class="strategy-workspace"><div class="section-line"><h2>Strategies</h2><span>${esc(symbol || "")}</span></div><details class="strategy-parameters"><summary>Parameters <span class="strategy-parameters-summary">10,000 ${esc(currency)}</span></summary>${controls}</details><div class="strategy-output" aria-live="polite">Loading history…</div></section>`;
  const output = root.querySelector(".strategy-output"),
    form = root.querySelector("form");
  function render() {
    if (disposed || !current) return;
    const d = current,
      money = (n) =>
        new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: d.currency,
          maximumFractionDigits: 0,
        }).format(n),
      all = d.strategies.flatMap((s) => s.curve.map((p) => p.value)),
      min = Math.min(...all) * 0.98,
      max = Math.max(...all) * 1.02;
    const line = (s) =>
      s.curve
        .map(
          (p, i) =>
            `${12 + (i / (s.curve.length - 1)) * 976},${220 - ((p.value - min) / (max - min)) * 200}`,
        )
        .join(" ");
    const s = d.strategies[selected];
    const assetPrice = (n) =>
      new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: d.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: Math.abs(n) < 0.01 ? 8 : 2,
      }).format(n);
    output.innerHTML = `<div class="strategy-scoreboard">${d.strategies.map((s, i) => `<button class="strategy-score ${selected === i ? "selected" : ""}" data-strategy="${i}" style="--strategy-color:${colors[i]}"><span>${esc(s.name)}</span><strong>${money(s.value)}</strong><small>${pct(s.return)}</small></button>`).join("")}</div><svg class="strategy-curve" viewBox="0 0 1000 240" role="img" aria-label="Strategy account values including uninvested cash">${d.strategies.map((s, i) => `<polyline points="${line(s)}" fill="none" stroke="${colors[i]}" stroke-width="${selected === i ? 3 : 1.5}" opacity="${selected === i ? 1 : 0.45}" vector-effect="non-scaling-stroke"/>`).join("")}</svg><div class="strategy-dates"><span>${new Date(d.start * 1000).toLocaleDateString()}</span><span>${esc(d.currency)} · ${d.samples} samples</span><span>${new Date(d.end * 1000).toLocaleDateString()}</span></div><div class="strategy-metrics"><div><span>Drawdown</span><b>${pct(s.drawdown)}</b></div><div><span>Cash</span><b>${money(s.cash)}</b></div><div><span>Orders</span><b>${s.trades.length}</b></div><div><span>Fees</span><b>${money(s.fees)}</b></div></div>${structureChart(d, assetPrice)}<div class="strategy-lenses"><section><span class="eyebrow">POWER LAW · LOG FIT</span><strong>R² ${d.power?.r2.toFixed(3) ?? "—"}</strong><span>Fit ${d.power ? assetPrice(d.power.fair) : "—"}</span></section><section><span class="eyebrow">ELLIOTT · WAVE 2 SCAN</span><strong>${d.wave.active ? "Setup detected" : "No active setup"}</strong><span>${d.wave.active ? d.wave.projected.map(assetPrice).join(" → ") : d.wave.pivots.length + " confirmed pivots"}</span></section></div><details class="strategy-method"><summary>Method & data ↗</summary><dl><dt>Source</dt><dd>${esc(d.source)}</dd><dt>Capital</dt><dd>Equal starting cash · ${money(d.capital)}</dd><dt>Timing</dt><dd>Monthly tranches · next sampled close</dd><dt>Cash yield</dt><dd>0%</dd><dt>Costs</dt><dd>${money(d.fee)} / order + ${d.bps} bp</dd><dt>Basis</dt><dd>Pre-tax · price returns · dividends excluded</dd><dt>Power law</dt><dd>Observed-window log price / log elapsed days</dd><dt>Elliott</dt><dd>Wave 2 candidate · 38.2–78.6% retracement</dd><dt>Confirmation</dt><dd>2 later samples / pivot</dd><dt>Extension</dt><dd>1× / 1.618× prior impulse · conditional</dd>${d.conversionUnavailable ? `<dt>FX</dt><dd>${esc(d.requestedCurrency)} unavailable · ${esc(d.currency)} shown</dd>` : ""}</dl><a href="https://www.investor.gov/introduction-investing/investing-basics/glossary/dollar-cost-averaging" target="_blank" rel="noopener noreferrer">DCA ↗</a> · <a href="https://www.elliottwave.com/wave-riffs/questions-we-get-questions/" target="_blank" rel="noopener noreferrer">Wave rules ↗</a></details>`;
    output.querySelectorAll("[data-strategy]").forEach(
      (b) =>
        (b.onclick = () => {
          selected = Number(b.dataset.strategy);
          render();
        }),
    );
  }
  async function load() {
    const id = ++epoch;
    const values = new FormData(form);
    form.querySelector("button").disabled = true;
    try {
      const data = await request(
        "/api/strategies?" +
          new URLSearchParams({ symbol, ...Object.fromEntries(values) }),
        "GET",
        undefined,
        { timeout: 40000 },
      );
      if (!disposed && id === epoch) {
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
      if (!disposed && id === epoch) output.textContent = e.message;
    } finally {
      if (!disposed && id === epoch)
        form.querySelector("button").disabled = false;
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    load();
  };
  if (symbol) load();
  else output.textContent = "Select an asset";
  return {
    destroy() {
      disposed = true;
      epoch++;
    },
    update(next) {
      symbol = next.symbol ?? symbol;
      load();
    },
  };
}
