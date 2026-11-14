// Provider identifiers are exact Yahoo Finance symbols. Logos resolve by ISIN where known.
export const featuredAssets = [
  {
    symbol: "AAPL",
    name: "Apple",
    assetType: "EQUITY",
    exchange: "NASDAQ",
    isin: "US0378331005",
  },
  {
    symbol: "MSFT",
    name: "Microsoft",
    assetType: "EQUITY",
    exchange: "NASDAQ",
    isin: "US5949181045",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA",
    assetType: "EQUITY",
    exchange: "NASDAQ",
    isin: "US67066G1040",
  },
  {
    symbol: "AMZN",
    name: "Amazon",
    assetType: "EQUITY",
    exchange: "NASDAQ",
    isin: "US0231351067",
  },
  {
    symbol: "GOOGL",
    name: "Alphabet",
    assetType: "EQUITY",
    exchange: "NASDAQ",
    isin: "US02079K3059",
  },
  {
    symbol: "META",
    name: "Meta",
    assetType: "EQUITY",
    exchange: "NASDAQ",
    isin: "US30303M1027",
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    assetType: "EQUITY",
    exchange: "NASDAQ",
    isin: "US88160R1014",
  },
  {
    symbol: "SAP.DE",
    name: "SAP",
    assetType: "EQUITY",
    exchange: "XETRA",
    isin: "DE0007164600",
  },
  {
    symbol: "SIE.DE",
    name: "Siemens",
    assetType: "EQUITY",
    exchange: "XETRA",
    isin: "DE0007236101",
  },
  {
    symbol: "ALV.DE",
    name: "Allianz",
    assetType: "EQUITY",
    exchange: "XETRA",
    isin: "DE0008404005",
  },
  {
    symbol: "ASML.AS",
    name: "ASML",
    assetType: "EQUITY",
    exchange: "Amsterdam",
    isin: "NL0010273215",
  },
  {
    symbol: "VWCE.DE",
    name: "Vanguard FTSE All-World",
    assetType: "ETF",
    exchange: "XETRA",
    isin: "IE00BK5BQT80",
  },
  {
    symbol: "EUNL.DE",
    name: "iShares Core MSCI World",
    assetType: "ETF",
    exchange: "XETRA",
    isin: "IE00B4L5Y983",
  },
  {
    symbol: "SXR8.DE",
    name: "iShares Core S&P 500",
    assetType: "ETF",
    exchange: "XETRA",
    isin: "IE00B5BMR087",
  },
  {
    symbol: "BTC-EUR",
    name: "Bitcoin",
    assetType: "CRYPTOCURRENCY",
    exchange: "Crypto",
  },
  {
    symbol: "ETH-EUR",
    name: "Ethereum",
    assetType: "CRYPTOCURRENCY",
    exchange: "Crypto",
  },
];
export function assetInfo(asset) {
  const known = featuredAssets.find((a) => a.symbol === asset.symbol);
  return { ...known, ...asset, isin: asset.isin || known?.isin };
}
export function logoURL(asset) {
  const a = assetInfo(asset);
  if (a.demo) return null;
  if (a.isin && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(a.isin))
    return `https://assets.parqet.com/logos/isin/${a.isin}?format=png&size=128`;
  if (a.assetType === "CRYPTOCURRENCY")
    return `https://assets.parqet.com/logos/crypto/${encodeURIComponent(a.symbol.split("-")[0])}?format=png&size=128`;
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(a.symbol)}?format=png&size=128`;
}
export const assetTypeLabel = (t) =>
  ({
    EQUITY: "Stock",
    ETF: "ETF",
    MUTUALFUND: "Fund",
    CRYPTOCURRENCY: "Crypto",
    INDEX: "Index",
    OTHER: "Asset",
  })[t] || "Stock";
