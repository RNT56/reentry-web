import test from "node:test";
import assert from "node:assert/strict";
import { request } from "../src/shared/http.js";

function reply(t, status, data) {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

test("HTTP requests surface useful Fastify client messages", async (t) => {
  reply(t, 400, {
    statusCode: 400,
    error: "Bad Request",
    message: "Connect a key for the selected provider first.",
  });
  await assert.rejects(request("/api/ai/preferences", "PUT", {}), {
    message: "Connect a key for the selected provider first.",
    status: 400,
  });
});

test("HTTP requests preserve application errors and status", async (t) => {
  reply(t, 409, {
    error: "Your portfolio changed on another device.",
    message: "Conflict",
  });
  await assert.rejects(request("/api/portfolio", "PUT", {}), {
    message: "Your portfolio changed on another device.",
    status: 409,
  });
});

test("HTTP requests never expose server failure details", async (t) => {
  reply(t, 500, {
    error: "SQLITE_CANTOPEN: /private/operator/data.sqlite",
    message: "Secret upstream connection details",
  });
  await assert.rejects(request("/api/research"), {
    message: "The server is unavailable. Please try again.",
    status: 500,
  });
});

test("HTTP requests tolerate malformed client error payloads", async (t) => {
  reply(t, 400, { error: { code: "INVALID" }, message: ["not text"] });
  await assert.rejects(request("/api/ai/preferences"), {
    message: "Request failed.",
    status: 400,
  });
});

test("HTTP requests return successful payloads unchanged", async (t) => {
  reply(t, 200, { saved: true, revision: 2 });
  assert.deepEqual(await request("/api/portfolio", "PUT", {}), {
    saved: true,
    revision: 2,
  });
});

test("bodyless deletion preserves CSRF header without declaring an empty JSON body", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    calls.push(options);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  await request("/api/research/assets/INTC", "DELETE");
  assert.equal(calls[0].headers["X-Reentry-Request"], "1");
  assert.equal(calls[0].headers["Content-Type"], undefined);
  assert.equal(calls[0].body, undefined);
  await request("/api/research/assets", "PUT", { symbol: "INTC" });
  assert.equal(calls[1].headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(calls[1].body).symbol, "INTC");
});

test("chart writes can finish during reload while retaining credentials and CSRF protection", async (t) => {
  let sent;
  t.mock.method(globalThis, "fetch", async (path, options) => {
    sent = { path, ...options };
    return new Response(JSON.stringify({ revision: 2 }), { status: 200 });
  });
  await request(
    "/api/chart-workspaces/INTC/1",
    "PUT",
    {
      revision: 1,
      state: { drawings: [] },
    },
    { keepalive: true },
  );
  assert.equal(sent.keepalive, true);
  assert.equal(sent.credentials, "same-origin");
  assert.equal(sent.headers["X-Reentry-Request"], "1");
  assert.deepEqual(JSON.parse(sent.body).state.drawings, []);
});

test("autosave requests bind the intended account independently of the current cookie", async (t) => {
  let sent;
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    sent = options;
    return new Response(JSON.stringify({ slots: [] }), { status: 200 });
  });
  await request("/api/chart-workspaces?symbol=INTC", "GET", undefined, {
    ownerId: "alice",
  });
  assert.equal(sent.headers["X-Reentry-Owner"], "alice");
  assert.equal(sent.credentials, "same-origin");
});
