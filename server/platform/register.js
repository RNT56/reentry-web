import { registerAdminRoutes } from "../admin/routes.js";
import { createMacroService } from "../macro/service.js";
import { registerMacroRoutes } from "../macro/routes.js";
import { registerStrategyRoutes } from "../strategies/routes.js";
import { registerChartWorkspaceRoutes } from "../chart-workspaces/routes.js";
import { migratePlatform } from "./schema.js";
import { createVault } from "../ai/vault.js";
import { createProviders } from "../ai/providers.js";
import { createConnectors } from "../intelligence/connectors.js";
import { createEngine } from "../ai/engine.js";
import { registerAIRoutes } from "../ai/routes.js";
import { registerChartAnalysisRoutes } from "../ai/chart-routes.js";
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
  const macro = options.macro || createMacroService();
  registerMacroRoutes(app, macro);
  registerStrategyRoutes(app, { market });
  registerChartWorkspaceRoutes(app, db);
  const vault = options.vault || createVault(options.masterKey),
    connectors = options.connectors || createConnectors({ market, macro });
  const engine = createEngine({
    db,
    vault,
    connectors,
    market,
    paused: () => options.controls?.get().aiPaused || false,
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
    controls: options.controls,
  };
  if (options.controls) registerAdminRoutes(app, services);
  registerAIRoutes(app, services);
  registerChartAnalysisRoutes(app, services);
  registerIntelligenceRoutes(app, services);
  registerJournalRoutes(app, services);
  app.decorate("intelligenceEngine", engine);
  app.addHook("onReady", async () => {
    if (options.startWorker !== false) engine.start();
  });
  app.addHook("onClose", async () => engine.stop());
  return engine;
}
