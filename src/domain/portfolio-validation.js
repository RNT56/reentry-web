export function validatePortfolio(s) {
  const fail = () => {
    throw Object.assign(Error("Invalid portfolio data."), { statusCode: 400 });
  };
  const str = (v, max = 160) =>
    typeof v === "string" && v.length > 0 && v.length <= max;
  const num = (v, min = 0, max = 1e12) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const date = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.holdings) ||
    s.holdings.length > 2000 ||
    !Array.isArray(s.sales) ||
    s.sales.length > 10000 ||
    !s.settings
  )
    fail();
  for (const k of ["rate", "sellFee", "buyFee"])
    if (!num(s.settings[k], 0, k === "rate" ? 100 : 1e6)) fail();
  if (typeof s.settings.whole !== "boolean") fail();
  const ids = new Set();
  for (const h of s.holdings) {
    if (
      !h ||
      !str(h.id, 80) ||
      ids.has(h.id) ||
      !str(h.name) ||
      !str(h.symbol, 32) ||
      !/^[A-Za-z0-9.^=-]+$/.test(h.symbol) ||
      !["Trade Republic", "Consorsbank", "Other"].includes(h.broker) ||
      !Array.isArray(h.lots) ||
      !h.lots.length ||
      h.lots.length > 10000
    )
      fail();
    ids.add(h.id);
    if (h.taxRate != null && !num(h.taxRate, 0, 100)) fail();
    if (
      h.assetType &&
      ![
        "EQUITY",
        "ETF",
        "MUTUALFUND",
        "CRYPTOCURRENCY",
        "INDEX",
        "OTHER",
      ].includes(h.assetType)
    )
      fail();
    if (h.isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(h.isin)) fail();
    for (const l of h.lots)
      if (
        !l ||
        !str(l.id, 80) ||
        !num(l.qty, 1e-8) ||
        !num(l.price, 1e-8) ||
        !num(l.fee) ||
        !date(l.date)
      )
        fail();
  }
  for (const sale of s.sales) {
    if (
      !sale ||
      !str(sale.id, 80) ||
      ids.has(sale.id) ||
      !str(sale.name) ||
      !str(sale.symbol, 32) ||
      !["Trade Republic", "Consorsbank", "Other"].includes(sale.broker) ||
      !["waiting", "complete"].includes(sale.status) ||
      !date(sale.date)
    )
      fail();
    ids.add(sale.id);
    if (!/^[A-Za-z0-9.^=-]+$/.test(sale.symbol)) fail();
    if (sale.targetGain != null && !num(sale.targetGain, 0, 1000)) fail();
    if (sale.taxRate != null && !num(sale.taxRate, 0, 100)) fail();
    if (sale.precision != null && ![2, 8].includes(sale.precision)) fail();
    if (
      sale.assetType &&
      ![
        "EQUITY",
        "ETF",
        "MUTUALFUND",
        "CRYPTOCURRENCY",
        "INDEX",
        "OTHER",
      ].includes(sale.assetType)
    )
      fail();
    if (sale.isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(sale.isin)) fail();
    for (const k of ["cash", "q", "price", "tax", "buyFee"])
      if (!num(sale[k], k === "q" || k === "price" ? 1e-8 : 0)) fail();
    if (sale.status === "complete")
      for (const k of ["rebuyQty", "rebuyPrice", "leftover"])
        if (!num(sale[k], k === "leftover" ? -0.001 : 1e-8)) fail();
  }
  return s;
}
