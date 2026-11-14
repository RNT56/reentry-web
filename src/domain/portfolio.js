export const taxPresets = Object.freeze(
  [
    { rate: 27.99511, label: "27.9951% · 9% church tax" },
    { rate: 27.818627, label: "27.8186% · 8% church tax" },
    { rate: 26.375, label: "26.375% · No church tax" },
  ].map(Object.freeze),
);
export const defaults = Object.freeze({
  rate: taxPresets[0].rate,
  sellFee: 1,
  buyFee: 1,
  whole: false,
});
export const emptyPortfolio = () => ({
  version: 1,
  holdings: [],
  sales: [],
  settings: { ...defaults },
});
export const qty = (h) => h.lots.reduce((s, l) => s + l.qty, 0);
export const basis = (h) =>
  h.lots.reduce((s, l) => s + l.qty * l.price + l.fee, 0);
