import test from "node:test";
import assert from "node:assert/strict";
import { request } from "../src/shared/http.js";

function reply(t, status, data) {
  t.mock.method(globalThis, "fetch", async () =>
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
