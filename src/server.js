import { featuredAssets, assetInfo } from "./assets.js";
const cache = new Map();
async function yahoo(path) {
  let failure;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const res = await fetch("https://" + host + path, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok)
        throw Error("Market data is unavailable. You can enter a EUR price.");
      return await res.json();
    } catch (e) {
      failure = e;
    }
  }
  throw failure;
}
async function quote(symbol) {
  const key = "raw:" + symbol,
    c = cache.get(key);
  if (c && Date.now() - c.at < 60000) return c.data;
  const d = await yahoo(
      "/v8/finance/chart/" +
        encodeURIComponent(symbol) +
        "?interval=1d&range=1d",
    ),
    m = d.chart?.result?.[0]?.meta;
  if (!m || !Number.isFinite(m.regularMarketPrice) || m.regularMarketPrice <= 0)
    throw Error("No quote found. Enter a EUR price.");
  const data = {
    symbol: m.symbol,
    price: m.regularMarketPrice,
    currency: m.currency,
    time: m.regularMarketTime,
    exchange: m.fullExchangeName || m.exchangeName,
    assetType: m.instrumentType,
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}
export async function api(url) {
  const key = url.pathname + url.search,
    cached = cache.get(key);
  if (cached && Date.now() - cached.at < 60000)
    return Response.json(cached.data);
  try {
    let data;
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length > 80)
        return Response.json({ error: "Search is too long." }, { status: 400 });
      if (q.length < 2) data = { results: featuredAssets };
      else {
        const d = await yahoo(
          "/v1/finance/search?q=" +
            encodeURIComponent(q) +
            "&quotesCount=20&newsCount=0&enableFuzzyQuery=false",
        );
        data = {
          results: (d.quotes || [])
            .filter((q) =>
              ["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY"].includes(
                q.quoteType,
              ),
            )
            .map((q) =>
              assetInfo({
                symbol: q.symbol,
                name: (q.shortname || q.longname || q.symbol)
                  .replace(/\s+I$/, "")
                  .trim(),
                exchange: q.exchDisp || q.exchange,
                assetType: q.quoteType,
                isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(q.isin || "")
                  ? q.isin
                  : undefined,
              }),
            ),
        };
      }
    } else if (url.pathname === "/api/quote") {
      const symbol = url.searchParams.get("symbol") || "";
      if (!/^[a-zA-Z0-9.^=\-]{1,32}$/.test(symbol))
        return Response.json({ error: "Invalid symbol." }, { status: 400 });
      const raw = await quote(symbol);
      let currency = raw.currency,
        unit = 1;
      if (currency === "GBp" || currency === "GBX") {
        currency = "GBP";
        unit = 0.01;
      }
      if (currency === "ILA") {
        currency = "ILS";
        unit = 0.01;
      }
      if (currency === "ZAc") {
        currency = "ZAR";
        unit = 0.01;
      }
      let fxRate = 1,
        fxTime = null;
      if (currency !== "EUR") {
        if (!/^[A-Z]{3}$/.test(currency))
          throw Error("Unsupported quote currency. Enter a EUR price.");
        const fx = await quote(currency + "EUR=X");
        fxRate = fx.price;
        fxTime = fx.time;
      }
      data = {
        ...raw,
        originalPrice: raw.price,
        originalCurrency: raw.currency,
        price: raw.price * unit * fxRate,
        currency: "EUR",
        fxRate,
        fxTime,
        converted: currency !== "EUR",
        source: "Yahoo Finance",
      };
    } else return Response.json({ error: "Not found" }, { status: 404 });
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), data });
    return Response.json(data);
  } catch (e) {
    return Response.json(
      {
        error:
          e.name === "TimeoutError"
            ? "Market data timed out. Enter a EUR price."
            : e.message,
      },
      { status: 502 },
    );
  }
}
