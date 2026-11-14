import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { openStore, emptyPortfolio } from "../server/store.js";
import { createApp } from "../server/app.js";
import { createSet } from "../server/intelligence/scenarios.js";

test("owner registration and AI controls govern real application routes while free price observation continues", async () => {
  const db = openStore(":memory:");
  let paid = 0,
    quotes = 0,
    macro = 0;
  const now = Date.now();
  const app = await createApp({
    db,
    logger: false,
    disableRateLimit: true,
    origin: "http://localhost:4173",
    marketService: {
      search: async () => ({ results: [] }),
      history: async (symbol, _range, currency) => ({
        symbol,
        currency,
        points: Array.from({ length: 120 }, (_, i) => ({
          time: 1600000000 + i * 86400,
          price: 100 + i,
        })),
        source: "Fixture",
      }),
      quote: async () => {
        quotes++;
        return {
          price: 25,
          originalPrice: 25,
          currency: "USD",
          originalCurrency: "USD",
          time: Date.now() / 1000,
        };
      },
    },
    platform: {
      authorUsernames: "owner",
      workerEnabled: true,
      startWorker: false,
      masterKey: randomBytes(32).toString("base64"),
      macro: {
        snapshot: async () => {
          macro++;
          return { series: [] };
        },
      },
      connectors: {
        status: () => [],
        collect: async () => ({ sources: [], coverage: [] }),
      },
      generate: async () => {
        paid++;
        throw Error("Should remain paused");
      },
    },
  });
  await app.ready();
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    "owner",
    "owner",
    "hash",
    "recovery",
    now,
  );
  db.prepare("INSERT INTO portfolios(user_id,data) VALUES(?,?)").run(
    "owner",
    JSON.stringify(emptyPortfolio()),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    "owner",
    now,
    now,
    now,
    now + 86400000,
  );
  const call = (url, method = "GET", payload, auth = true) =>
    app.inject({
      url,
      method,
      payload,
      headers: {
        origin: "http://localhost:4173",
        "x-reentry-request": "1",
        ...(auth ? { cookie: "reentry_dev=" + token } : {}),
      },
    });
  try {
    for (const path of ["/api/macro", "/api/strategies?symbol=INTC"])
      assert.equal((await call(path, "GET", undefined, false)).statusCode, 401);
    assert.equal(macro, 0);
    assert.equal((await call("/api/macro")).statusCode, 200);
    assert.equal(macro, 1);
    const strategy = await call("/api/strategies?symbol=INTC");
    assert.equal(strategy.statusCode, 200, strategy.body);
    assert.equal(
      (
        await call("/api/admin/settings", "PUT", {
          registrationOpen: false,
          aiPaused: true,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await call("/api/auth/me", "GET", undefined, false)).json().registration,
      false,
    );
    assert.equal(
      (await call("/api/auth/register", "POST", {}, false)).statusCode,
      403,
    );
    assert.equal(
      (await call("/api/admin/settings", "PUT", { registrationOpen: true }))
        .statusCode,
      200,
    );
    assert.equal(
      (await call("/api/auth/me", "GET", undefined, false)).json().registration,
      true,
    );
    assert.equal(
      (await call("/api/auth/register", "POST", {}, false)).statusCode,
      400,
    );
    db.prepare(
      "INSERT INTO ai_jobs(id,user_id,kind,symbol,provider,model,status,input,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "queued",
      "owner",
      "research",
      "INTC",
      "gemini",
      "gemini-4-hydrogen",
      "queued",
      "{}",
      "queued-request",
      now,
    );
    createSet(
      db,
      "owner",
      "INTC",
      "Fixture",
      [
        {
          eventKey: "launch",
          low: 20,
          high: 30,
          currency: "USD",
          horizonDays: 90,
        },
      ],
      null,
      now - 1000,
    );
    const rejected = await call("/api/research/jobs", "POST", {
      symbol: "INTC",
      requestKey: "new-intent",
    });
    assert.equal(rejected.statusCode, 503, rejected.body);
    await app.intelligenceEngine.tick();
    assert.equal(paid, 0);
    assert.equal(quotes, 1);
    assert.equal(
      db.prepare("SELECT status FROM ai_jobs WHERE id='queued'").get().status,
      "queued",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM scenario_observations").get().n,
      1,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_ledger").get().n, 0);
  } finally {
    await app.close();
    db.close();
  }
});
