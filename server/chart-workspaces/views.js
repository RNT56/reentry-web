import {
  chartViewSurfaces,
  validateChartViewState,
} from "../../src/domain/chart-view.js";
import {
  fail,
  symbol as validateSymbol,
  transaction,
} from "../platform/util.js";
import { createChartChanges } from "./changes.js";

export function registerChartViewRoutes(app, db) {
  const changes = createChartChanges();
  app.addHook("preClose", async () => changes.close());
  const auth = {
    preHandler: async (req) => {
      await app.requireUser(req);
      if (
        req.headers["x-reentry-owner"] !== undefined &&
        req.headers["x-reentry-owner"] !== req.auth.user_id
      )
        throw fail("Account changed. Sign in again.", 401);
    },
  };
  const parameters = (input) => {
    const symbol = validateSymbol(input.symbol),
      surface = input.surface;
    if (!chartViewSurfaces.includes(surface))
      throw fail("Unsupported chart view.");
    return { symbol, surface };
  };
  const select = db.prepare(
    "SELECT revision,state,updated_at FROM chart_views WHERE user_id=? AND symbol=? AND surface=?",
  );
  const read = (owner, symbol, surface) => {
    const row = select.get(owner, symbol, surface);
    return {
      slot: 1,
      revision: row?.revision || 0,
      state: row ? JSON.parse(row.state) : null,
      updatedAt: row?.updated_at || null,
    };
  };
  app.get("/api/chart-views", auth, async (req) => {
    const { symbol, surface } = parameters(req.query);
    return {
      symbol,
      surface,
      slots: [read(req.auth.user_id, symbol, surface)],
    };
  });
  app.get(
    "/api/chart-views/watch",
    { ...auth, config: { rateLimit: { max: 360, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { symbol, surface } = parameters(req.query),
        revision = Number(req.query.revisions);
      if (
        !/^\d+$/.test(req.query.revisions || "") ||
        !Number.isSafeInteger(revision)
      )
        throw fail("Invalid chart revision.");
      const abort = new AbortController(),
        disconnect = () => abort.abort();
      reply.raw.once("close", disconnect);
      try {
        let view = read(req.auth.user_id, symbol, surface);
        if (view.revision === revision) {
          await changes.wait(
            req.auth.user_id,
            symbol + ":" + surface,
            abort.signal,
          );
          if (abort.signal.aborted) return reply;
          await auth.preHandler(req);
          view = read(req.auth.user_id, symbol, surface);
        }
        return { symbol, surface, slots: [view] };
      } finally {
        reply.raw.removeListener("close", disconnect);
      }
    },
  );
  app.put(
    "/api/chart-views/:symbol/:surface",
    { ...auth, bodyLimit: 4096 },
    async (req) => {
      const { symbol, surface } = parameters(req.params),
        owner = req.auth.user_id,
        revision = req.body?.revision;
      if (!Number.isSafeInteger(revision) || revision < 0)
        throw fail("Invalid chart revision.");
      const state = validateChartViewState(req.body?.state, surface);
      const saved = transaction(db, () => {
        const current = read(owner, symbol, surface);
        if (current.revision !== revision)
          throw fail("This chart view changed on another device.", 409);
        db.prepare(
          "INSERT INTO chart_views VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,symbol,surface) DO UPDATE SET revision=excluded.revision,state=excluded.state,updated_at=excluded.updated_at",
        ).run(
          owner,
          symbol,
          surface,
          revision + 1,
          JSON.stringify(state),
          Date.now(),
        );
        return read(owner, symbol, surface);
      });
      changes.publish(owner, symbol + ":" + surface);
      return { symbol, surface, ...saved };
    },
  );
}
