import { test } from "node:test";
import assert from "node:assert/strict";
import {
  models,
  defaultModels,
  priceFor,
  costFor,
  reservationFor,
  effectiveModel,
} from "../server/ai/catalog.js";
import { preferences } from "../server/ai/billing.js";
import { openStore } from "../server/store.js";
import { migratePlatform } from "../server/platform/schema.js";
import { createProviders } from "../server/ai/providers.js";
test("current model catalog exposes requested models and provider defaults", () => {
  assert.equal(defaultModels.gemini, "gemini-4-hydrogen");
  assert.equal(defaultModels.anthropic, "claude-sonnet-5-5");
  for (const id of [
    "gemini-4-carbon",
    "gemini-4-argon",
    "gemini-4-hydrogen",
    "claude-opus-5-5",
    "claude-fable-5-2",
  ])
    assert.ok(models.some((m) => m.id === id));
  assert.ok(models.every((m) => !m.id.startsWith("gemini-3")));
  assert.equal(
    effectiveModel("gemini", "gemini-3.5-flash-lite"),
    "gemini-4-hydrogen",
  );
  assert.equal(effectiveModel("anthropic", "unsupported"), "claude-sonnet-5-5");
});
test("scheduled Gemini4 prices and expensive model reservations reflect output and cache costs", () => {
  for (const id of ["gemini-4-carbon", "gemini-4-argon"]) {
    assert.equal(priceFor(id, Date.parse("2026-11-30")).input, 2);
    const p = priceFor(id, Date.parse("2026-12-01"));
    assert.equal(p.input, 4);
    assert.equal(p.output, 20);
    assert.equal(p.cached, 0.2);
  }
  const p = priceFor("claude-fable-5-2", Date.parse("2026-11-14"));
  assert.equal(
    costFor(
      {
        input: 100,
        output: 100,
        cached: 100,
        write5m: 100,
        write1h: 100,
        reasoning: 20,
      },
      p,
    ),
    7420,
  );
  assert.ok(reservationFor("x".repeat(10000), p) > 0.25 * 1000000);
});
test("legacy preference projection preserves durable model fields", () => {
  const db = openStore(":memory:");
  migratePlatform(db);
  try {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      "user",
      "owner",
      "hash",
      "recovery",
      1,
    );
    const p = preferences(db, "user");
    assert.equal(p.model, "gemini-4-hydrogen");
    assert.equal(
      db.prepare("SELECT model FROM ai_preferences").get().model,
      "gemini-3.5-flash-lite",
    );
  } finally {
    db.close();
  }
});
test("every current Gemini model uses structured output with bounded low thinking; retired models never dispatch", async () => {
  let calls = 0;
  const generate = createProviders({
    fetcher: async (url, options) => {
      calls++;
      assert.ok(url.includes("gemini-4-"));
      const body = JSON.parse(options.body);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      return new Response(
        JSON.stringify({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: "{}" }] } },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        }),
      );
    },
  });
  for (const model of models.filter((m) => m.provider === "gemini"))
    await generate({
      provider: "gemini",
      model: model.id,
      key: "fixture",
      prompt: "brief",
    });
  assert.equal(calls, 3);
  await assert.rejects(
    generate({
      provider: "gemini",
      model: "gemini-3.8-flash",
      key: "fixture",
      prompt: "brief",
    }),
    /Unsupported/,
  );
  assert.equal(calls, 3);
});
