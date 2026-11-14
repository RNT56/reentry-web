import { migratePlatform } from "./schema.js";
import { createVault } from "../ai/vault.js";
import { createProviders } from "../ai/providers.js";
import { createConnectors } from "../intelligence/connectors.js";
import { createEngine } from "../ai/engine.js";
import { registerAIRoutes } from "../ai/routes.js";
import { registerIntelligenceRoutes } from "../intelligence/routes.js";
import { registerJournalRoutes } from "../journal/routes.js";
export function registerPlatform(app, db, market, options = {}) {
  migratePlatform(db);
  const names = (options.authorUsernames ?? process.env.AUTHOR_USERNAMES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isAuthor = (username) => names.includes(username.toLowerCase()),
    authorName = String(
      options.authorName || process.env.AUTHOR_PUBLIC_NAME || "RNT",
    ).slice(0, 80);
  const vault = options.vault || createVault(options.masterKey),
    connectors = options.connectors || createConnectors({ market });
  const engine = createEngine({
    db,
    vault,
    connectors,
    market,
    generate: options.generate || createProviders(),
    enabled:
      options.workerEnabled ?? process.env.ENABLE_BACKGROUND_JOBS === "true",
  });
  const services = {
    db,
    vault,
    connectors,
    market,
    engine,
    isAuthor,
    authorName,
  };
  registerAIRoutes(app, services);
  registerIntelligenceRoutes(app, services);
  registerJournalRoutes(app, services);
  app.decorate("intelligenceEngine", engine);
  app.addHook("onReady", async () => {
    if (options.startWorker !== false) engine.start();
  });
  app.addHook("onClose", async () => engine.stop());
  return engine;
}
