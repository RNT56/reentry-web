import { compareStrategies } from "../../src/domain/strategies.js";
export function registerStrategyRoutes(app, { market }) {
  app.get(
    "/api/strategies",
    {
      preHandler: app.requireUser,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req) => {
      const { symbol, currency = "EUR" } = req.query;
      if (!["EUR", "USD"].includes(currency))
        throw Object.assign(Error("Choose EUR or USD."), { statusCode: 400 });
      const history = await market.history(symbol, "5y", currency);
      if (history.currency !== currency)
        throw Object.assign(Error(currency + " history unavailable."), {
          statusCode: 422,
        });
      try {
        return {
          ...compareStrategies(history.points, {
            capital: Number(req.query.capital ?? 10000),
            fee: Number(req.query.fee ?? 1),
            bps: Number(req.query.bps ?? 0),
          }),
          symbol: history.symbol,
          currency: history.currency,
          requestedCurrency: currency,
          conversionUnavailable: history.conversionUnavailable || false,
          source: history.source || "Yahoo Finance",
          priceBasis: "Sampled closes · cash 0% · pre-tax",
          methodVersion: 1,
        };
      } catch (error) {
        throw Object.assign(error, { statusCode: 400 });
      }
    },
  );
}
