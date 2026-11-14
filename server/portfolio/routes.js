import { validatePortfolio } from "../../src/domain/portfolio-validation.js";
import { portfolioRepository } from "./repository.js";
export function registerPortfolioRoutes(app, db) {
  const repository = portfolioRepository(db);
  app.get("/api/portfolio", { preHandler: app.requireUser }, async (req) =>
    repository.get(req.auth.user_id),
  );
  app.put(
    "/api/portfolio",
    { preHandler: app.requireUser },
    async (req, reply) => {
      const state = validatePortfolio(req.body?.state),
        revision = req.body?.revision;
      if (!Number.isSafeInteger(revision) || revision < 0)
        return reply.code(400).send({ error: "Invalid revision." });
      const row = repository.save(req.auth.user_id, state, revision);
      if (!row)
        return reply.code(409).send({
          error:
            "Your portfolio changed in another tab or device. Export your changes before reloading.",
        });
      return row;
    },
  );
}
