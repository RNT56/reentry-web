import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import serveStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore, validatePortfolio } from "./store.js";
import { registerAuth } from "./auth.js";
import { api } from "../src/server.js";
export async function createApp(options = {}) {
  const origin =
    options.origin || process.env.APP_ORIGIN || "http://localhost:4173";
  const u = new URL(origin);
  if (
    u.origin !== origin ||
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password
  )
    throw Error(
      "APP_ORIGIN must be an exact origin, without a trailing slash.",
    );
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:")
    throw Error("Production APP_ORIGIN must use HTTPS.");
  const config = {
    origin,
    rpId: u.hostname,
    registration:
      options.registration ?? process.env.REGISTRATION_OPEN !== "false",
  };
  const db =
    options.db || openStore(process.env.DATABASE_PATH || "data/reentry.sqlite");
  const app = Fastify({
    logger: options.logger ?? {
      level: "info",
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        'res.headers["set-cookie"]',
      ],
      serializers: {
        req: (r) => ({ method: r.method, url: r.url.split("?")[0] }),
      },
    },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === "1" ? 1 : false,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://assets.parqet.com"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: u.protocol === "https:" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: u.protocol === "https:" ? { maxAge: 31536000 } : false,
  });
  await app.register(rateLimit, {
    max: 180,
    timeWindow: "1 minute",
    allowList: options.disableRateLimit ? () => true : undefined,
  });
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        req.headers.origin !== origin ||
        req.headers["x-reentry-request"] !== "1" ||
        (req.headers["sec-fetch-site"] &&
          !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))
      )
        return reply.code(403).send({ error: "Request origin not allowed." });
      if (
        req.method !== "DELETE" &&
        !req.headers["content-type"]?.startsWith("application/json")
      )
        return reply.code(415).send({ error: "JSON required." });
    }
  });
  await registerAuth(app, db, config);
  app.get("/api/portfolio", { preHandler: app.requireUser }, async (req) => {
    const r = db
      .prepare("SELECT data,revision FROM portfolios WHERE user_id=?")
      .get(req.auth.user_id);
    return { state: JSON.parse(r.data), revision: r.revision };
  });
  app.put(
    "/api/portfolio",
    { preHandler: app.requireUser },
    async (req, reply) => {
      const data = validatePortfolio(req.body?.state),
        revision = req.body?.revision;
      if (!Number.isSafeInteger(revision) || revision < 0)
        return reply.code(400).send({ error: "Invalid revision." });
      const row = db
        .prepare(
          "UPDATE portfolios SET data=?,revision=revision+1 WHERE user_id=? AND revision=? RETURNING revision",
        )
        .get(JSON.stringify(data), req.auth.user_id, revision);
      if (!row)
        return reply.code(409).send({
          error:
            "Your portfolio changed in another tab or device. Export your changes before reloading.",
        });
      return row;
    },
  );
  app.get(
    "/api/search",
    { preHandler: app.requireUser },
    async (req, reply) => {
      const response = await api(new URL(req.url, origin));
      return reply.code(response.status).send(await response.json());
    },
  );
  app.get("/api/quote", { preHandler: app.requireUser }, async (req, reply) => {
    const response = await api(new URL(req.url, origin));
    return reply.code(response.status).send(await response.json());
  });
  app.get("/healthz", async () => {
    db.prepare("SELECT 1").get();
    return { ok: true, revision: process.env.REENTRY_REVISION || null };
  });
  const root =
    options.staticRoot ||
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../dist/public",
    );
  await app.register(serveStatic, { root, maxAge: 0, index: "index.html" });
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || 500;
    if (status >= 500)
      req.log.error(
        { err: { name: err.name, message: err.message } },
        "Request failed",
      );
    reply.code(status).send({
      error:
        status >= 500 ? "Something went wrong. Please try again." : err.message,
    });
  });
  app.addHook("onClose", async () => {
    if (!options.db) db.close();
  });
  return app;
}
