export function registerMacroRoutes(app, service) {
  app.get("/api/macro", { preHandler: app.requireUser }, async () =>
    service.snapshot(),
  );
}
