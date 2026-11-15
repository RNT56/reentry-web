import { readMarketJSON } from "./read-json.js";
import { withHistoryPaging } from "./history-window.js";
import { historyPath, normalizeHistory } from "./yahoo-history.js";
import { assetInfo } from "../../src/domain/assets.js";
import { returnHistoryPath, normalizeReturnHistory } from "./return-history.js";
// Provider-specific symbols, payloads and URLs terminate at this boundary.
export function yahooProvider({ fetcher = fetch } = {}) {
  async function get(path) {
    for (const host of [
      "query1.finance.yahoo.com",
      "query2.finance.yahoo.com",
    ]) {
      try {
        const response = await fetcher("https://" + host + path, {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
          signal: AbortSignal.timeout(6000),
          redirect: "error",
        });
        if (!response.ok) continue;
        return await readMarketJSON(response);
      } catch {
        /* Try the alternate provider host within the same deadline. */
      }
    }
    throw Object.assign(Error("Market data is temporarily unavailable."), {
      statusCode: 502,
    });
  }
  return {
    source: "Yahoo Finance",
    async returnHistory(symbol) {
      return normalizeReturnHistory(
        await get(returnHistoryPath(symbol)),
        symbol,
      );
    },
    async search(query) {
      const payload = await get(
        "/v1/finance/search?q=" +
          encodeURIComponent(query) +
          "&quotesCount=20&newsCount=0&enableFuzzyQuery=false",
      );
      return (payload.quotes || [])
        .slice(0, 20)
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
        );
    },
    async quote(symbol) {
      const payload = await get(
        "/v8/finance/chart/" +
          encodeURIComponent(symbol) +
          "?interval=1d&range=1d",
      );
      const m = payload.chart?.result?.[0]?.meta;
      if (
        !m ||
        !Number.isFinite(m.regularMarketPrice) ||
        m.regularMarketPrice <= 0 ||
        !Number.isFinite(m.regularMarketTime)
      )
        throw Object.assign(Error("No quote found. Enter a EUR price."), {
          statusCode: 502,
        });
      return {
        symbol,
        price: m.regularMarketPrice,
        currency: m.currency,
        time: m.regularMarketTime,
        exchange: m.fullExchangeName || m.exchangeName,
        assetType: m.instrumentType,
      };
    },
    async history(symbol, range, padded = false, window = null) {
      return withHistoryPaging(
        normalizeHistory(
          await get(historyPath(symbol, range, padded, window)),
          symbol,
          range,
        ),
        window,
      );
    },
  };
}
