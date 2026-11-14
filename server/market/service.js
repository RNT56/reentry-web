import { yahooProvider } from "./yahoo.js";
import { createRequestCache } from "./cache.js";
import { featuredAssets } from "../../src/domain/assets.js";
import { validateHistoryInput } from "../../src/domain/market-history.js";
import { currencyUnit } from "../../src/domain/currency.js";
const invalid = (message) => Object.assign(Error(message), { statusCode: 400 });
function checkSymbol(symbol) {
  if (typeof symbol !== "string" || !/^[A-Za-z0-9.^=-]{1,32}$/.test(symbol))
    throw invalid("Invalid symbol.");
}
export function createMarketService({
  provider = yahooProvider(),
  cache = createRequestCache(),
} = {}) {
  const rawQuote = (symbol) =>
    cache("raw:" + symbol, () => provider.quote(symbol));
  return {
    search(query = "") {
      if (typeof query !== "string" || query.length > 80)
        throw invalid("Search is too long.");
      query = query.trim();
      return query.length < 2
        ? { results: featuredAssets }
        : cache("search:" + query, async () => ({
            results: await provider.search(query),
          }));
    },
    history(symbol, range = "1mo") {
      validateHistoryInput(symbol, range); // Validate before consulting a provider or allocating a cache key.
      return cache("history:" + symbol + ":" + range, () =>
        provider.history(symbol, range),
      );
    },
    quote(symbol) {
      checkSymbol(symbol);
      return cache("eur:" + symbol, async () => {
        const raw = await rawQuote(symbol),
          [currency, unit] = currencyUnit(raw.currency);
        if (!/^[A-Z]{3}$/.test(currency || ""))
          throw Error("Unsupported currency. Enter a EUR price.");
        let fxRate = 1,
          fxTime = null;
        if (currency !== "EUR") {
          const fx = await rawQuote(currency + "EUR=X");
          if (!Number.isFinite(fx.price) || fx.price <= 0)
            throw Error("FX quote unavailable.");
          fxRate = fx.price;
          fxTime = fx.time;
        }
        return {
          ...raw,
          originalPrice: raw.price,
          originalCurrency: raw.currency,
          price: raw.price * unit * fxRate,
          currency: "EUR",
          fxRate,
          fxTime,
          converted: currency !== "EUR",
          source: provider.source || "Market provider",
        };
      });
    },
  };
}
