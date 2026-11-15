import { mountAssetChart } from "../charts/asset-chart.js";
import {
  performanceWindow,
  performanceRanges,
  performanceSeries,
  politicalChartSymbol,
} from "../../domain/political-performance.js";
import { setAnimatedText } from "../../shared/motion.js";
import { esc } from "../../shared/format.js";
const money = (n) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
      }).format(n)
    : "—";
const exact = (n) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(n)
    : "Unavailable";
const date = (t) =>
  new Date(t * 1000).toLocaleDateString(undefined, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export function mountPoliticalPerformance(
  root,
  member,
  { ownerId, performance, variant = "mid" },
) {
  let current = performance,
    assumption = variant,
    range = "all",
    windowData,
    chart;
  const hidden = new Set();
  root.classList.add("political-performance");
  const accessory = `<div class="performance-readings" role="group" aria-label="Performance series">${performanceSeries.map((s) => `<button data-performance-series="${s.id}" aria-pressed="true" style="--performance-color:${s.color}"><span><i></i>${esc(s.label)}</span><strong data-performance-value="${s.id}" data-number>—</strong><small>${esc(s.detail)}</small></button>`).join("")}</div><div class="performance-dates"><span data-performance-period></span><span data-performance-hover role="status"></span></div>`;
  function data(nextRange = range) {
    range = nextRange;
    windowData = performanceWindow(current, assumption, range);
    if (!windowData)
      return { points: [], currency: "USD", source: "Performance unavailable" };
    const shown = windowData.series.filter(
      (s) => s.available && !hidden.has(s.id),
    );
    if (!shown.length) {
      hidden.clear();
      shown.push(...windowData.series.filter((s) => s.available));
    }
    const primary = shown.find((s) => s.id === "gain") || shown[0],
      points = primary?.points || [];
    for (const s of windowData.series) {
      const b = root.querySelector(`[data-performance-series="${s.id}"]`);
      if (!b) continue;
      const visible = !hidden.has(s.id) && s.available;
      b.setAttribute("aria-pressed", String(visible));
      b.disabled = !s.available || (shown.length === 1 && visible);
      b.title = !s.available
        ? "History unavailable for this period"
        : s.partial
          ? "Some daily valuations are unavailable"
          : "Toggle " + s.label;
      b.querySelector("small").textContent = !s.available
        ? "Unavailable"
        : s.partial
          ? s.detail + " · Gaps"
          : s.detail;
    }
    const period = root.querySelector("[data-performance-period]");
    if (period)
      period.textContent =
        date(points[0]?.time || Date.parse(windowData.from) / 1000) +
        " — " +
        date(points.at(-1)?.time || Date.parse(windowData.through) / 1000);
    return {
      points,
      series: shown.map((s) => ({
        ...s,
        primary: s === primary,
        highlight: s.color,
        dashed: s.id === "salary",
      })),
      currency: "USD",
      timeZone: "UTC",
      range,
      source:
        "Matched capital · Price gains" +
        (windowData.clipped ? " · Available period" : ""),
    };
  }
  chart = mountAssetChart(root, {
    ownerId,
    symbol: politicalChartSymbol(member.id),
    surface: "performance",
    label: member.name + " · Performance",
    readout: false,
    ranges: performanceRanges,
    linearOnly: true,
    sampleLimit: 700,
    accessory,
    load: (state) => Promise.resolve(data(state.range)),
    xLabel: (t) =>
      new Date(t * 1000).toLocaleDateString("en-GB", {
        timeZone: "UTC",
        ...(["all", "5y", "1y"].includes(range)
          ? { month: "short", year: "numeric" }
          : { day: "numeric", month: "short" }),
      }),
    yLabel: (n) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n),
    onInspect: ({ index, point, exploring }) => {
      if (!windowData) return;
      const readings = [];
      for (const s of windowData.series) {
        const value = s.points[index]?.price,
          el = root.querySelector(`[data-performance-value="${s.id}"]`);
        setAnimatedText(el, money(value));
        if (el) el.title = exact(value);
        readings.push(`${s.label}: ${exact(value)}`);
      }
      const hover = root.querySelector("[data-performance-hover]");
      if (hover)
        hover.textContent = exploring
          ? date(point.time)
          : "Through " + date(point.time);
      return date(point.time) + ". " + readings.join(". ");
    },
    extra: (g) =>
      g.y(0) >= g.T && g.y(0) <= g.B
        ? `<path class="performance-zero" d="M${g.L} ${g.y(0)}H${g.R}"/>`
        : "",
  });
  const choose = (e) => {
    const button = e.target.closest("[data-performance-series]");
    if (!button || !root.contains(button)) return;
    e.stopPropagation();
    const id = button.dataset.performanceSeries;
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    chart.setData(data(), { resetPrice: true });
  };
  root.addEventListener("click", choose);
  return {
    update(performance, nextVariant) {
      const changed = assumption !== nextVariant;
      current = performance;
      assumption = nextVariant;
      chart.setData(data(), { resetPrice: changed });
    },
    destroy() {
      root.removeEventListener("click", choose);
      chart.destroy();
    },
  };
}
