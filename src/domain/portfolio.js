export const defaults = Object.freeze({
  rate: 27,
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
