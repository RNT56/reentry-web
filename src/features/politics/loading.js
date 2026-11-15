const line = (short = false) =>
  `<i class="capitol-placeholder-line${short ? " is-short" : ""}"></i>`;
const title = (text) =>
  `<div class="capitol-section-title"><h2>${text}</h2></div>`;

/** Use the real layout tracks, so incoming records do not reshape the page. */
export function capitolLoading({ member = "", ticker = "" } = {}) {
  const people = member
    ? `<section class="politician-focus"><span class="political-avatar capitol-placeholder"></span><div class="capitol-placeholder-copy">${line(true)}${line()}${line(true)}</div></section><section class="capitol-placeholder-estimate"></section>`
    : `<section class="politician-section">${title("People")}<div class="politician-rail">${Array.from({ length: 8 }, () => `<div class="politician-card capitol-placeholder"><span class="politician-caption">${line()}${line(true)}</span></div>`).join("")}</div></section>`;
  const assets = ticker
    ? `<section class="capitol-asset-focus">${title("Asset activity")}<div class="capitol-placeholder-chart"></div></section>`
    : `<section class="disclosure-assets">${title("Asset activity")}<div class="disclosure-asset-rail">${Array.from({ length: 8 }, () => `<div class="capitol-placeholder-asset"><span class="capitol-placeholder-mark"></span><span>${line()}${line(true)}</span></div>`).join("")}</div></section>`;
  const rows = Array.from(
    { length: 6 },
    () =>
      `<div class="disclosure-row"><div class="disclosure-person"><span class="political-avatar capitol-placeholder"></span><span>${line()}${line(true)}</span></div><div class="disclosure-asset">${line()}</div><span class="disclosure-side">${line(true)}</span><span class="disclosure-amount">${line()}${line(true)}</span><span class="disclosure-dates">${line()}${line(true)}</span><span class="disclosure-expand"></span></div>`,
  ).join("");
  return `<div class="capitol-loading-layout" role="status" aria-label="Loading disclosures"><div aria-hidden="true">${people}${assets}<section class="disclosure-ledger">${title("Disclosures")}<div class="disclosure-columns"><span>Filer</span><span>Asset</span><span>Action</span><span>Reported value</span><span>Filed</span><span></span></div>${rows}</section></div></div>`;
}

export const filterKeys = Object.freeze([
  "days",
  "chamber",
  "side",
  "scope",
  "q",
  "member",
  "ticker",
]);
export const capitolFilters = (memory) =>
  Object.fromEntries(filterKeys.map((k) => [k, memory[k]]));
export const sameCapitolFilters = (a, b) =>
  !!a && !!b && filterKeys.every((k) => a[k] === b[k]);
