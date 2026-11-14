import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMacroService,
  parseObservations,
  transformObservations,
  indicators,
} from "../server/macro/service.js";
test("macro CSV parsing preserves missing observations and computes exact prior-year periods", () => {
  const parsed = parseObservations(
    "observation_date,CPIAUCSL\n2025-01-01,100\n2026-01-01,105\n2026-02-01,.\n2026-03-01,\n2026-01-01,106",
    "CPIAUCSL",
  );
  assert.deepEqual(parsed, [
    { date: "2025-01-01", value: 100 },
    { date: "2026-01-01", value: 106 },
  ]);
  assert.ok(
    Math.abs(transformObservations(parsed, "yoy")[0].value - 6) < 1e-10,
  );
  assert.deepEqual(
    transformObservations([{ date: "2026-01-01", value: 100 }], "yoy"),
    [],
  );
  assert.throws(() =>
    parseObservations("DATE,WRONG\n2026-01-01,2", "CPIAUCSL"),
  );
});
test("macro service bounds concurrency, isolates failures and caches snapshots with source dates", async () => {
  let active = 0,
    max = 0,
    calls = 0;
  const service = createMacroService({
    now: () => Date.parse("2026-11-14"),
    fetcher: async (url, options) => {
      calls++;
      active++;
      max = Math.max(max, active);
      assert.equal(new URL(url).origin, "https://fred.stlouisfed.org");
      assert.equal(options.redirect, "error");
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      const id = new URL(url).searchParams.get("id");
      if (id === "DGS2") throw Error("offline");
      return new Response(
        `observation_date,${id}\n2025-10-01,100\n2026-10-01,105\n2026-11-01,.`,
      );
    },
  });
  const [a, b] = await Promise.all([service.snapshot(), service.snapshot()]);
  assert.deepEqual(a, b);
  assert.equal(calls, indicators.length);
  assert.ok(max <= 3);
  assert.equal(a.indicators.find((i) => i.id === "DGS2").status, "unavailable");
  assert.equal(
    a.indicators.find((i) => i.id === "CPIAUCSL").latest.date,
    "2026-10-01",
  );
  const evidence = await service.getMacroEvidence();
  assert.equal(evidence.length, indicators.length - 1);
  assert.ok(
    evidence.every((e) =>
      e.url.startsWith("https://fred.stlouisfed.org/series/"),
    ),
  );
});
test("macro retains prior observations as stale on connector failure, never as a new release", async () => {
  let time = Date.parse("2026-11-14"),
    offline = false;
  const service = createMacroService({
    now: () => time,
    ttl: 100,
    fetcher: async (url) => {
      if (offline) throw Error("offline");
      const id = new URL(url).searchParams.get("id");
      return new Response(`DATE,${id}\n2025-11-01,100\n2026-11-01,103`);
    },
  });
  const before = await service.snapshot();
  offline = true;
  time += 1000;
  const after = await service.snapshot();
  assert.equal(after.indicators[0].status, "stale");
  assert.deepEqual(after.indicators[0].latest, before.indicators[0].latest);
  assert.equal(after.indicators[0].fetchedAt, before.indicators[0].fetchedAt);
});
