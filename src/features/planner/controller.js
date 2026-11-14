import { setAnimatedText, revealChart } from "../../shared/motion.js";
import { $, money, number, esc } from "../../shared/format.js";
import { icon, logo, modal, close } from "../../shared/ui.js";
import { qty, basis } from "../../domain/portfolio.js";
import { calculate, target } from "../../domain/reentry.js";
import { mountChartFullscreen } from "../../shared/chart-fullscreen.js";

export function createPlanner(model, services) {
  const { current, record } = services;
  let fullscreen = null,
    fullscreenRoot = null,
    curveResize = null,
    curveFrame = 0,
    lastResult = null;
  function destroyFullscreen() {
    curveResize?.disconnect();
    curveResize = null;
    fullscreen?.destroy();
    fullscreen = null;
    fullscreenRoot = null;
    lastResult = null;
    cancelAnimationFrame(curveFrame);
    curveFrame = 0;
  }
  function scheduleCurve() {
    cancelAnimationFrame(curveFrame);
    curveFrame = requestAnimationFrame(() => {
      curveFrame = 0;
      if (fullscreenRoot?.isConnected && lastResult)
        refreshCurve(fullscreenRoot, lastResult);
    });
  }
  function mountFullscreen(results) {
    if (fullscreenRoot !== results) {
      destroyFullscreen();
      fullscreenRoot = results;
      fullscreen = mountChartFullscreen(results, {
        label: () => `${current()?.symbol || "Asset"} buyback targets`,
        buttonHost: () => results.querySelector(".curve-label"),
        native: true,
        onChange: scheduleCurve,
      });
      curveResize = new ResizeObserver(scheduleCurve);
      curveResize.observe(results.querySelector(".curve"));
    }
    fullscreen.refresh();
  }
  function refreshCurve(results, r) {
    const previousSVG = results.querySelector(".curve > svg.chart");
    if (!previousSVG) return;
    const nextCurve = document.createElement("template");
    nextCurve.innerHTML = chart(r, results);
    const nextSVG = nextCurve.content.querySelector("svg.chart");
    const previousNodes = [previousSVG, ...previousSVG.querySelectorAll("*")];
    const nextNodes = [nextSVG, ...nextSVG.querySelectorAll("*")];
    if (
      previousNodes.length === nextNodes.length &&
      previousNodes.every((node, i) => node.tagName === nextNodes[i].tagName)
    ) {
      previousNodes.forEach((node, i) => {
        const next = nextNodes[i];
        for (const attribute of [...node.attributes])
          if (!next.hasAttribute(attribute.name))
            node.removeAttribute(attribute.name);
        for (const attribute of next.attributes)
          if (node.getAttribute(attribute.name) !== attribute.value)
            node.setAttribute(attribute.name, attribute.value);
        if (node.tagName.toLowerCase() === "text")
          setAnimatedText(node, next.textContent);
      });
    } else previousSVG.replaceWith(nextSVG);
  }
  function getResult() {
    const h = current(),
      s = model.scenario[model.selected];
    if (h.assetType && h.assetType !== "EQUITY" && !Number.isFinite(h.taxRate))
      throw Error(
        "Set an effective tax rate for this asset in purchase details.",
      );
    return {
      ...calculate(
        h.lots,
        s.q,
        s.price,
        s.sf,
        s.bf,
        current()?.taxRate ?? model.state.settings.rate,
        s.allowance,
        s.losses,
      ),
      precision: h.assetType === "CRYPTOCURRENCY" ? 8 : 2,
    };
  }
  function update() {
    model.scenario[model.selected] = {
      q: Number($("#sellqty").value),
      price:
        $("#sellprice").value === "" ? null : Number($("#sellprice").value),
      sf: Number($("#sf").value),
      bf: Number($("#bf").value),
      allowance: Number($("#allowance").value),
      losses: Number($("#losses").value),
    };
    $("#slider").value =
      (model.scenario[model.selected].q / qty(current())) * 100;
    $("#slider").style.setProperty(
      "--fill",
      Math.min(100, Number($("#slider").value)) + "%",
    );
    document
      .querySelectorAll("[data-portion]")
      .forEach((b) =>
        b.classList.toggle(
          "chosen",
          Math.abs(
            (model.scenario[model.selected].q / qty(current())) * 100 -
              Number(b.dataset.portion),
          ) < 0.001,
        ),
      );
    try {
      const r = getResult(),
        t = target(r, model.percent, model.state.settings.whole);
      services.getChart()?.setLevels({
        buyIn: basis(current()) / qty(current()),
        target: t.price,
        quote: model.quotes[current().symbol],
      });
      const results = $("#results");
      const firstResult = !results.querySelector(".target-price");
      if (firstResult) {
        destroyFullscreen();
        results.innerHTML = `<div class="result-top"><div class="step-label"><span>02</span> Your reentry</div></div><div class="target-choice"><label>Share increase</label><div class="switch">${[0, 5, 10].map((n) => `<button data-gain="${n}" class="${model.percent === n ? "on" : ""}" aria-pressed="${model.percent === n}">${n === 0 ? "Same" : `+${n}%`}</button>`).join("")}<button id="custom" class="${![0, 5, 10].includes(model.percent) ? "on" : ""}">${![0, 5, 10].includes(model.percent) ? "+" + model.percent + "%" : "Custom"}</button></div></div><div class="ceiling"><div class="eyebrow">BUY BACK AT OR BELOW</div><div class="target-price" data-number>${money(t.price)}</div><div class="target-meta"><span>${icon("layers")}<b data-target-qty>${number(t.qty)}</b> shares</span><span class="drop-badge">${icon("arrowDown")}<span class="sr-only">Price drop </span><span data-target-drop>${t.drop.toFixed(2)}%</span></span></div></div>${chart(r)}<div class="settlement"><div><span>Tax estimate</span><b data-target-tax>${money(r.tax)}</b></div><div><span>Available to reinvest</span><b data-target-cash>${money(r.cash)}</b></div></div><button class="primary record-button" id="record"><span>Record sale</span>${icon("arrow")}</button><div class="result-note">${money(r.buyFee)} buyback fee included · ${model.state.settings.whole ? "Whole shares" : "Fractional shares"}</div><div class="mobile-target-dock"><button class="dock-target" id="dock-target"><span><span data-target-label>Target +${model.percent}%</span>${icon("arrow")}</span><b>${money(t.price)}</b><small>${number(t.qty)} shares</small></button><button class="primary" id="dock-record">Record sale ${icon("arrow")}</button></div>`;
      }
      setAnimatedText(results.querySelector(".target-price"), money(t.price));
      setAnimatedText(
        results.querySelector("[data-target-qty]"),
        number(t.qty),
      );
      setAnimatedText(
        results.querySelector("[data-target-drop]"),
        t.drop.toFixed(2) + "%",
      );
      setAnimatedText(results.querySelector("[data-target-tax]"), money(r.tax));
      setAnimatedText(
        results.querySelector("[data-target-cash]"),
        money(r.cash),
      );
      setAnimatedText(
        results.querySelector(".result-note"),
        `${money(r.buyFee)} buyback fee included · ${model.state.settings.whole ? "Whole shares" : "Fractional shares"}`,
        { animate: false },
      );
      setAnimatedText(
        results.querySelector("[data-target-label]"),
        `Target +${model.percent}%`,
        { animate: false },
      );
      setAnimatedText(results.querySelector(".dock-target b"), money(t.price));
      setAnimatedText(
        results.querySelector(".dock-target small"),
        `${number(t.qty)} shares`,
      );
      results.querySelectorAll("[data-gain]").forEach((button) => {
        const selected = model.percent === Number(button.dataset.gain);
        button.classList.toggle("on", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      const custom = results.querySelector("#custom");
      custom.classList.toggle("on", ![0, 5, 10].includes(model.percent));
      custom.textContent = ![0, 5, 10].includes(model.percent)
        ? "+" + model.percent + "%"
        : "Custom";
      mountFullscreen(results);
      lastResult = r;
      refreshCurve(results, r);
      if (firstResult) revealChart(results.querySelector(".chart-line-reveal"));
      document.querySelectorAll("[data-gain]").forEach(
        (b) =>
          (b.onclick = () => {
            model.percent = Number(b.dataset.gain);
            update();
          }),
      );
      $("#custom").onclick = () => {
        modal(
          `<span class="eyebrow">REENTRY TARGET</span><h2>Custom target.</h2><form id="custom-form"><label>Additional shares (%)</label><div class="input-wrap"><input name="gain" type="number" min="0" max="1000" step="any" value="${model.percent}" required><span>%</span></div><div class="actions"><button class="primary">Set target ${icon("arrow")}</button></div></form>`,
        );
        $("#custom-form").onsubmit = (e) => {
          e.preventDefault();
          model.percent = Number(new FormData(e.target).get("gain"));
          close();
          update();
        };
      };
      $("#record").onclick = record;
      if ($("#dock-record")) $("#dock-record").onclick = record;
      if ($("#dock-target"))
        $("#dock-target").onclick = () => $("#custom").click();
    } catch (e) {
      destroyFullscreen();
      services.getChart()?.setLevels({
        buyIn: basis(current()) / qty(current()),
        target: null,
        quote: model.quotes[current().symbol],
      });
      const waiting =
        model.busy &&
        !model.quotes[current().symbol]?.price &&
        $("#sellprice").value === "";
      $("#results").innerHTML = waiting
        ? `<div class="result-top"><div class="step-label"><span>02</span> Your reentry</div></div><div class="target-loading loading-surface" role="status" aria-label="Loading sale quote"><div class="skeleton-line" style="--skeleton-height:44px"></div><div class="skeleton-line" style="--skeleton-width:55%;--skeleton-height:54px"></div><div class="target-loading-chart"></div><div class="skeleton-line" style="--skeleton-height:46px"></div></div>`
        : `<div class="result-top"><div class="step-label"><span>02</span> Your reentry</div></div><div class="result-empty">${logo()}<p>${esc(e.message)}</p></div>`;
    }
  }
  function chart(r, results = null) {
    const expanded = fullscreenRoot === results && fullscreen?.isActive();
    const curve = expanded ? results.querySelector(".curve") : null;
    const curveStyle = curve ? getComputedStyle(curve) : null;
    const horizontalPadding = curveStyle
      ? parseFloat(curveStyle.paddingLeft) + parseFloat(curveStyle.paddingRight)
      : 0;
    const verticalPadding = curveStyle
      ? parseFloat(curveStyle.paddingTop) + parseFloat(curveStyle.paddingBottom)
      : 0;
    const width = curve
      ? Math.max(260, Math.round(curve.clientWidth - horizontalPadding))
      : 400;
    const labelHeight =
      curve?.querySelector(".curve-label")?.getBoundingClientRect().height || 0;
    const height = curve
      ? Math.max(
          150,
          Math.round(curve.clientHeight - verticalPadding - labelHeight - 12),
        )
      : 114;
    const left = expanded ? 70 : 12,
      right = width - (expanded ? 22 : 12),
      top = expanded ? 24 : 14,
      bottom = height - (expanded ? 38 : 26),
      max = Math.max(20, Math.ceil(model.percent / 10) * 10),
      base = target(r, 0, model.state.settings.whole).price,
      low = target(r, max, model.state.settings.whole).price,
      span = Math.max(0.01, base - low),
      px = (g) => left + (g / max) * (right - left),
      py = (g) =>
        top +
        ((base - target(r, g, model.state.settings.whole).price) / span) *
          (bottom - top);
    const points = Array.from({ length: 41 }, (_, i) => {
        const g = (i * max) / 40;
        return `${px(g)},${py(g)}`;
      }),
      cx = px(model.percent),
      cy = py(model.percent),
      grid = [0, 0.5, 1]
        .map((ratio) => {
          const y = top + ratio * (bottom - top);
          return `<path d="M${left} ${y}H${right}" stroke="#ffffff09" stroke-dasharray="3 5"/>${expanded ? `<text x="${left - 12}" y="${y + 4}" fill="#7b9180" font-size="11" text-anchor="end">${esc(money(base - ratio * span))}</text>` : ""}`;
        })
        .join("");
    return `<div class="curve"><div class="curve-label"><span>Buyback price</span><span>Share increase</span></div><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Buyback ceiling by additional shares, with your ${model.percent}% target highlighted"><defs><linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#b9f68b" stop-opacity=".12"/><stop offset="1" stop-color="#b9f68b" stop-opacity="0"/></linearGradient></defs>${grid}<path d="M${points.join(" L")} L${right},${bottom + 4} L${left},${bottom + 4} Z" fill="url(#fade)"/><path class="chart-line-reveal" d="M${points.join(" L")}" fill="none" stroke="#9ab984" stroke-width="1.5"/><path d="M${cx} ${cy}V${bottom + 6}" stroke="#b9f68b55" stroke-dasharray="3 4"/><circle cx="${cx}" cy="${cy}" r="9" fill="#b9f68b16"/><circle cx="${cx}" cy="${cy}" r="4" fill="#c2f797" stroke="#202920" stroke-width="2"/>${[0, max / 4, max / 2, (max * 3) / 4, max].map((g) => `<text x="${px(g)}" y="${height - (expanded ? 10 : 3)}" fill="${g === model.percent ? "#d7f4c1" : "#747b78"}" font-size="${expanded ? 12 : 9}" text-anchor="${g === 0 ? "start" : g === max ? "end" : "middle"}">${g === 0 ? "0%" : "+" + number(g) + "%"}</text>`).join("")}</svg></div>`;
  }

  return { update, getResult, destroyFullscreen };
}
