/* Values change immediately. Motion acknowledges the change without inventing intermediates. */
const running = new WeakMap();
const numeric = new WeakMap();
let installed = false;
const numberSelector =
  "[data-number],.history-price,.history-change,.target-price,.target-meta > span,.settlement b,.dock-target b,.holding-values b,.overview-secondary strong,.macro-large > span,.macro-reading strong,.strategy-score strong,.strategy-score small,.strategy-metrics b,.strategy-lenses strong,.budget-display strong,.budget-breakdown b,.owner-census strong,.owner-queue strong,.owner-runtime dd,.node-range,.history-targets b";
const reduced = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
function acknowledge(element) {
  if (
    !element?.isConnected ||
    reduced() ||
    !element.animate ||
    element.closest('[aria-busy="true"]')
  )
    return;
  const previous = running.get(element),
    now = performance.now();
  // Hovered charts can change every frame; keep the readout crisp during a fast scrub.
  if (previous && now - previous.at < 90) return;
  previous?.animation?.cancel();
  const animation = element.animate(
    [
      { opacity: 0.56, transform: "translateY(2px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 180, easing: "cubic-bezier(.2,.65,.3,1)" },
  );
  running.set(element, { animation, at: now });
}
export function setAnimatedText(element, value, { animate = true } = {}) {
  if (!element) return;
  const next = String(value ?? "");
  if (element.textContent === next) return;
  element.textContent = next;
  numeric.set(element, next);
  if (animate) acknowledge(element);
}
export const animateNumber = setAnimatedText;
export function revealChart(element) {
  if (!element || reduced()) return;
  const paths = element.matches?.("path,polyline,line")
    ? [element]
    : [
        ...element.querySelectorAll(
          "path[data-reveal],polyline[data-reveal],.chart-line-reveal",
        ),
      ];
  for (const path of paths) {
    if (!path.animate) continue;
    path.setAttribute("pathLength", "1");
    path.animate(
      [
        { strokeDasharray: "1", strokeDashoffset: "1", opacity: 0.25 },
        { strokeDasharray: "1", strokeDashoffset: "0", opacity: 1 },
      ],
      { duration: 520, easing: "cubic-bezier(.2,.65,.3,1)" },
    );
  }
}
export function installMotion(root = document) {
  if (installed) return;
  installed = true;
  const visit = (element, initial = false) => {
    if (!(element instanceof Element)) return;
    const targets = element.matches(numberSelector) ? [element] : [];
    targets.push(...element.querySelectorAll(numberSelector));
    for (const target of targets) {
      if (
        target.closest('input,textarea,[contenteditable="true"],.select-menu')
      )
        continue;
      const next = target.textContent;
      const previous = numeric.get(target);
      numeric.set(target, next);
      if (!initial && previous !== next && /\d/.test(next)) acknowledge(target);
    }
  };
  visit(root === document ? document.documentElement : root, true);
  const changed = new Set();
  let pending = false;
  new MutationObserver((records) => {
    for (const record of records) {
      const target =
        record.target.nodeType === Node.TEXT_NODE
          ? record.target.parentElement
          : record.target;
      const number = target?.closest?.(numberSelector);
      if (number) changed.add(number);
      for (const node of record.addedNodes)
        if (node.nodeType === Node.ELEMENT_NODE) changed.add(node);
    }
    if (pending || !changed.size) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      for (const element of changed) if (element.isConnected) visit(element);
      changed.clear();
    });
  }).observe(root === document ? document.body : root, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

export function loadingSurface(kind = "research") {
  const line = (width = "100%", height = 12) =>
    `<span class="skeleton-line" style="--skeleton-width:${width};--skeleton-height:${height}px"></span>`;
  if (kind === "strategies")
    return `<div class="strategy-loading loading-surface" role="status" aria-label="Loading strategy history"><div class="strategy-scoreboard" aria-hidden="true">${Array.from({ length: 4 }, () => `<div class="strategy-score">${line("65%")}${line("80%", 30)}${line("35%", 10)}</div>`).join("")}</div><div class="strategy-curve-slot" aria-hidden="true"></div><div class="strategy-metrics" aria-hidden="true">${Array.from({ length: 4 }, () => `<div>${line("65%")}${line("50%", 24)}</div>`).join("")}</div></div>`;
  if (kind === "settings")
    return `<div class="ai-loading loading-surface" role="status" aria-label="Loading intelligence settings"><div class="section-line" aria-hidden="true">${line("160px", 24)}</div><div class="ai-settings-grid" aria-hidden="true"><section class="panel ai-budget">${line("90px")}${line("60%", 46)}${line()}${line()}</section><section class="panel ai-connections">${line("160px", 24)}${line("90%", 44)}${line("90%", 44)}</section><section class="panel ai-controls">${line("120px", 24)}<div class="form-row">${Array.from({ length: 4 }, () => `<div class="field">${line("65px", 10)}${line("100%", 46)}</div>`).join("")}</div>${line("130px", 44)}</section></div></div>`;
  if (kind === "owner")
    return `<section class="owner-console owner-loading-surface loading-surface" role="status" aria-label="Loading owner controls"><div class="owner-heading" aria-hidden="true">${line("180px")}</div><div class="owner-shortcuts" aria-hidden="true">${line("250px", 32)}</div><div class="owner-census" aria-hidden="true">${Array.from({ length: 7 }, () => `<div>${line("50px", 36)}${line("65px", 10)}</div>`).join("")}</div><div class="owner-split" aria-hidden="true">${Array.from({ length: 2 }, () => `<section class="owner-section">${line("150px", 24)}${line("90%", 44)}${line("90%", 44)}${line("90%", 44)}</section>`).join("")}</div></section>`;
  if (kind === "macro")
    return `<div class="macro-loading loading-surface" role="status" aria-label="Loading market indicators"><header class="macro-heading"><h1>Markets</h1></header><nav class="macro-filters" aria-hidden="true">${["All", "Prices", "Risk", "Credit", "Rates", "Growth", "Liquidity", "Global"].map((name) => `<button disabled>${name}</button>`).join("")}</nav><div class="macro-board" aria-hidden="true"><div class="macro-stage"><div class="macro-focus">${line("100px")}${line("200px", 26)}${line("150px", 60)}${line("110px")}</div><div class="macro-chart"><div class="skeleton-chart"></div></div></div><div class="macro-tape">${Array.from({ length: 8 }, () => `<div class="macro-row">${line("70%", 24)}</div>`).join("")}</div></div></div>`;
  return `<div class="surface-skeleton loading-surface" role="status" aria-label="Loading research"><div class="skeleton-heading skeleton-line" aria-hidden="true"></div><div class="skeleton-rail" aria-hidden="true"></div><div class="skeleton-content" aria-hidden="true">${line("28%", 26)}${line("44%", 14)}<div class="skeleton-chart"></div></div></div>`;
}
