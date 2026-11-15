import {
  MAX_CHART_WORKSPACES,
  validateChartWorkspaceState,
} from "../../src/domain/chart-workspace.js";
import { chartWorkspaceRepository } from "./repository.js";
import { fail, symbol as validateSymbol } from "../platform/util.js";
import { createChartChanges } from "./changes.js";

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
  const changes = createChartChanges();
  app.addHook("preClose", async () => changes.close());
  const auth = {
    preHandler: async (req) => {
      await app.requireUser(req);
      const owner = req.headers["x-reentry-owner"];
      if (owner !== undefined && owner !== req.auth.user_id)
        throw fail("Account changed. Sign in again.", 401);
    },
  };
  app.get("/api/chart-workspaces", auth, async (req) => {
    const symbol = validateSymbol(req.query.symbol);
    return { symbol, slots: repository.list(req.auth.user_id, symbol) };
  });
  app.get(
    "/api/chart-workspaces/watch",
    { ...auth, config: { rateLimit: { max: 360, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const symbol = validateSymbol(req.query.symbol);
      const revisions = String(req.query.revisions || "")
        .split(",")
        .map(Number);
      if (
        revisions.length !== 3 ||
        !/^\d+,\d+,\d+$/.test(req.query.revisions || "") ||
        revisions.some((n) => !Number.isSafeInteger(n))
      )
        throw fail("Invalid chart revisions.");
      const abort = new AbortController();
      const disconnect = () => abort.abort();
      reply.raw.once("close", disconnect);
      try {
        let slots = repository.list(req.auth.user_id, symbol);
        if (slots.every((s, i) => s.revision === revisions[i])) {
          await changes.wait(req.auth.user_id, symbol, abort.signal);
          if (abort.signal.aborted) return reply;
          // Revalidate sessions revoked while this request was waiting.
          await auth.preHandler(req);
          slots = repository.list(req.auth.user_id, symbol);
        }
        return { symbol, slots };
      } finally {
        reply.raw.removeListener("close", disconnect);
      }
    },
  );
  app.put(
    "/api/chart-workspaces/:symbol/:slot",
    { ...auth, bodyLimit: 48 * 1024 },
    async (req) => {
      const { symbol, slot, revision } = parameters(req.params, req.body);
      const state = validateChartWorkspaceState(req.body?.state);
      const saved = {
        symbol,
        ...repository.save(req.auth.user_id, symbol, slot, revision, state),
      };
      changes.publish(req.auth.user_id, symbol);
      return saved;
    },
  );
  app.delete(
    "/api/chart-workspaces/:symbol/:slot",
    { ...auth, bodyLimit: 1024 },
    async (req) => {
      const { symbol, slot, revision } = parameters(req.params, req.body);
      const removed = {
        symbol,
        ...repository.remove(req.auth.user_id, symbol, slot, revision),
      };
      changes.publish(req.auth.user_id, symbol);
      return removed;
    },
  );
}
