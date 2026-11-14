import {
  MAX_CHART_WORKSPACES,
  validateChartWorkspaceState,
} from "../../src/domain/chart-workspace.js";
import { chartWorkspaceRepository } from "./repository.js";
import { fail, symbol as validateSymbol } from "../platform/util.js";

function parameters(params, body) {
  const symbol = validateSymbol(params.symbol);
  if (!/^[1-3]$/.test(String(params.slot)))
    throw fail("Choose analysis 1, 2 or 3.");
  const slot = Number(params.slot);
  if (slot > MAX_CHART_WORKSPACES) throw fail("Choose an analysis slot.");
  const revision = body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw fail("Invalid analysis revision.");
  return { symbol, slot, revision };
}

export function registerChartWorkspaceRoutes(app, db) {
  const repository = chartWorkspaceRepository(db);
  const auth = { preHandler: app.requireUser };
  app.get("/api/chart-workspaces", auth, async (req) => {
    const symbol = validateSymbol(req.query.symbol);
    return { symbol, slots: repository.list(req.auth.user_id, symbol) };
  });
  app.put(
    "/api/chart-workspaces/:symbol/:slot",
    { ...auth, bodyLimit: 48 * 1024 },
    async (req) => {
      const { symbol, slot, revision } = parameters(req.params, req.body);
      const state = validateChartWorkspaceState(req.body?.state);
      return {
        symbol,
        ...repository.save(req.auth.user_id, symbol, slot, revision, state),
      };
    },
  );
  app.delete(
    "/api/chart-workspaces/:symbol/:slot",
    { ...auth, bodyLimit: 1024 },
    async (req) => {
      const { symbol, slot, revision } = parameters(req.params, req.body);
      return {
        symbol,
        ...repository.remove(req.auth.user_id, symbol, slot, revision),
      };
    },
  );
}
