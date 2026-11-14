export function registerMarketRoutes(app, service) {
  const options = { preHandler: app.requireUser };
  app.get("/api/search", options, async (req) => service.search(req.query.q));
  app.get("/api/quote", options, async (req) =>
    service.quote(req.query.symbol),
  );
  app.get("/api/history", options, async (req) =>
    service.history(
      req.query.symbol,
      req.query.range,
      req.query.currency || "EUR",
    ),
  );
}
