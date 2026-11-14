import { calculate } from "./reentry.js";
import { validatePortfolio } from "./portfolio-validation.js";
import { qty } from "./portfolio.js";

// Commands build and validate a new portfolio before any UI or save can observe it.
export function recordSale(state, input) {
  const next = structuredClone(state),
    h = next.holdings.find((h) => h.id === input.holdingId);
  if (!h) throw Error("This holding no longer exists.");
  if (!Number.isFinite(input.tax) || input.tax < 0)
    throw Error("Enter the actual tax withheld.");
  const actual = calculate(
    h.lots,
    input.quantity,
    input.price,
    input.sellFee,
    input.buyFee,
    h.taxRate ?? state.settings.rate,
  );
  const cash = actual.proceeds - input.sellFee - input.tax;
  if (cash <= input.buyFee)
    throw Error("Tax and fees exceed the sale proceeds.");
  next.sales.unshift({
    id: input.id,
    holdingId: h.id,
    name: h.name,
    symbol: h.symbol,
    broker: h.broker,
    assetType: h.assetType,
    isin: h.isin,
    taxRate: h.taxRate,
    demo: !!h.demo,
    q: input.quantity,
    precision: h.assetType === "CRYPTOCURRENCY" ? 8 : 2,
    targetGain: input.targetGain,
    price: input.price,
    tax: input.tax,
    cash,
    buyFee: input.buyFee,
    date: input.date,
    status: "waiting",
  });
  h.lots = actual.remaining;
  next.holdings = next.holdings.filter((h) => qty(h) > 1e-8);
  return validatePortfolio(next);
}

export function recordBuyback(state, input) {
  const next = structuredClone(state),
    sale = next.sales.find((s) => s.id === input.saleId);
  if (!sale || sale.status !== "waiting")
    throw Error("This buyback is no longer awaiting reentry.");
  const { quantity, price, fee } = input,
    cost = quantity * price + fee;
  if (
    ![quantity, price, fee].every(Number.isFinite) ||
    quantity <= 0 ||
    price <= 0 ||
    fee < 0
  )
    throw Error("Check your shares, price and fee.");
  if (cost > sale.cash + 0.001)
    throw Error("This exceeds your available cash. Reduce quantity or price.");
  if (input.date < sale.date)
    throw Error("The buyback cannot precede the sale.");
  let h = next.holdings.find(
    (h) =>
      h.symbol === sale.symbol &&
      h.broker === sale.broker &&
      !!h.demo === !!sale.demo,
  );
  if (!h) {
    h = {
      id: input.holdingId,
      name: sale.name,
      symbol: sale.symbol,
      broker: sale.broker,
      assetType: sale.assetType,
      isin: sale.isin,
      taxRate: sale.taxRate,
      demo: sale.demo,
      lots: [],
    };
    next.holdings.push(h);
  }
  h.lots.push({ id: input.lotId, qty: quantity, price, fee, date: input.date });
  Object.assign(sale, {
    status: "complete",
    rebuyQty: quantity,
    rebuyPrice: price,
    leftover: sale.cash - cost,
  });
  return validatePortfolio(next);
}
