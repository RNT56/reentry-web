import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import { createAdminControls } from "../server/admin/controls.js";
import { registerAdminRoutes } from "../server/admin/routes.js";

test("owner controls persist, validate atomically and do not seed durable settings at startup", () => {
  const db = openStore(":memory:");
  migratePlatform(db);
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    "owner",
    "owner",
    "hash",
    "recovery",
    Date.now(),
  );
  const c = createAdminControls(db, { registration: false });
  assert.deepEqual(c.get(), { aiPaused: false, registrationOpen: false });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_controls").get().n, 0);
  c.set({ aiPaused: true, registrationOpen: true }, "owner");
  assert.deepEqual(createAdminControls(db).get(), {
    aiPaused: true,
    registrationOpen: true,
  });
  assert.throws(() => c.set({ aiPaused: false, unrecognized: true }, "owner"));
  assert.equal(c.get().aiPaused, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_audit").get().n, 1);
  db.close();
});

test("admin routes exclude ordinary users and expose aggregate operations without private records", async () => {
  const db = openStore(":memory:");
  migratePlatform(db);
  for (const name of ["owner", "reader"])
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      name,
      name,
      "secret-password-hash",
      "recovery",
      Date.now(),
    );
  db.prepare(
    "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "queued",
    "reader",
    "research",
    "INTC",
    "gemini",
    "fixture",
    "queued",
    "private research prompt",
    "q",
    1,
  );
  db.prepare(
    "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "running",
    "reader",
    "research",
    "INTC",
    "gemini",
    "fixture",
    "running",
    "private research prompt",
    "r",
    2,
  );
  const app = Fastify();
  app.decorate("requireUser", async (req, reply) => {
    if (!req.headers["x-user"]) return reply.code(401).send({ error: "Login" });
    req.auth = {
      user_id: req.headers["x-user"],
      username: req.headers["x-user"],
    };
  });
  const controls = createAdminControls(db);
  registerAdminRoutes(app, {
    db,
    controls,
    isAuthor: (name) => name === "owner",
    engine: { enabled: true },
    vault: { available: true },
    connectors: { status: () => [] },
  });
  try {
    assert.equal((await app.inject("/api/admin")).statusCode, 401);
    for (const method of ["GET", "PUT"])
      assert.equal(
        (
          await app.inject({
            method,
            url: method === "GET" ? "/api/admin" : "/api/admin/settings",
            headers: { "x-user": "reader" },
            payload: method === "PUT" ? { aiPaused: true } : undefined,
          })
        ).statusCode,
        403,
      );
    const overview = await app.inject({
      url: "/api/admin",
      headers: { "x-user": "owner" },
    });
    assert.equal(overview.statusCode, 200);
    assert.equal(overview.json().counts.accounts, 2);
    assert.ok(
      !overview.body.includes("private research prompt") &&
        !overview.body.includes("secret-password-hash"),
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/queue/cancel",
          headers: { "x-user": "owner" },
          payload: {},
        })
      ).statusCode,
      400,
    );
    const cancelled = await app.inject({
      method: "POST",
      url: "/api/admin/queue/cancel",
      headers: { "x-user": "owner" },
      payload: { confirmed: true },
    });
    assert.equal(cancelled.json().cancelled, 1);
    assert.equal(
      db.prepare("SELECT status FROM ai_jobs WHERE id='running'").get().status,
      "running",
    );
    const changed = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      headers: { "x-user": "owner" },
      payload: { aiPaused: true },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(controls.get().aiPaused, true);
  } finally {
    await app.close();
    db.close();
  }
});
