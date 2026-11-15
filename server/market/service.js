import { historyWindow } from "./history-window.js";
import { convertHistory } from "./history-currency.js";
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
  const historyCache = createRequestCache({ limit: 64, maxPending: 12 }),
    archiveCache = createRequestCache({
      ttl: 24 * 60 * 60 * 1000,
      limit: 64,
      maxPending: 12,
    });
  const rawQuote = (symbol) =>
    cache("raw:" + symbol, () => provider.quote(symbol));
  return {
    returnHistory(symbol) {
      checkSymbol(symbol);
      return provider.returnHistory(symbol);
    },
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
    history(symbol, range = "1mo", targetCurrency, before) {
      validateHistoryInput(symbol, range);
      if (
        targetCurrency !== undefined &&
        !["EUR", "USD"].includes(targetCurrency)
      )
        throw invalid("Invalid chart currency.");
      const window = historyWindow(symbol, range, before),
        cached = window ? archiveCache : historyCache,
        suffix = window ? ":" + window.from + ":" + window.to : "";
      const native = () =>
        cached("history:" + symbol + ":" + range + suffix, () =>
          provider.history(symbol, range, false, window),
        );
      if (!targetCurrency) return native();
      return cached(
        "history:" + symbol + ":" + range + ":" + targetCurrency + suffix,
        async () => {
          const nativeHistory = await native();
          let referenceFx;
          if (targetCurrency === "USD") {
            try {
              const q = await rawQuote("EURUSD=X");
              if (Number.isFinite(q.price) && q.price > 0)
                referenceFx = { rate: q.price, time: q.time };
            } catch {
              /* Reference overlays can remain unavailable independently. */
            }
          }
          const history = { ...nativeHistory, referenceFx };
          if (history.currency === targetCurrency) return history;
          if (!/^[A-Z]{3}$/.test(history.currency || ""))
            return {
              ...history,
              requestedCurrency: targetCurrency,
              conversionUnavailable: true,
            };
          try {
            const pair = history.currency + targetCurrency + "=X";
            const fx = await cached(
              "fxhistory:" + pair + ":" + range + suffix,
              () => provider.history(pair, range, true, window),
            );
            return convertHistory(history, fx, targetCurrency);
          } catch {
            return {
              ...history,
              requestedCurrency: targetCurrency,
              conversionUnavailable: true,
            };
          }
        },
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
