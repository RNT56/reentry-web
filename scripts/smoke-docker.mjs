import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
const image = process.argv[2] || "reentry:local";
const name = `reentry-smoke-${process.pid}`,
  volume = name + "-data";
const directory = mkdtempSync(path.join(tmpdir(), "reentry-smoke-"));
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const origin = "https://stocks.example.com";
let base;
async function ready() {
  base = "http://" + docker("port", name, "4173/tcp");
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(base + "/healthz")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(docker("logs", name));
  throw Error("Container did not become ready");
}
function client() {
  let cookie = "";
  return async (url, method = "GET", body) => {
    const r = await fetch(base + url, {
      method,
      headers: {
        Origin: origin,
        "X-Reentry-Request": "1",
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Host-reentry="));
    if (set) cookie = set.split(";")[0];
    return { status: r.status, data: await r.json() };
  };
}
try {
  docker("volume", "create", volume);
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--memory=768m",
    "--tmpfs",
    "/tmp:size=32m",
    "-e",
    "APP_ORIGIN=" + origin,
    "-v",
    volume + ":/data",
    "-p",
    "127.0.0.1::4173",
    image,
  );
  base = "http://" + docker("port", name, "4173/tcp");
  await ready();
  const a = client(),
    b = client();
  assert.equal(
    (
      await a("/api/auth/register", "POST", {
        username: "test_alice",
        password: "disposable-password-123",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await b("/api/auth/register", "POST", {
        username: "test_bob",
        password: "disposable-password-456",
      })
    ).status,
    200,
  );
  const { data: p } = await a("/api/portfolio");
  p.state.holdings.push({
    id: "aapl",
    symbol: "AAPL",
    name: "Apple",
    broker: "Trade Republic",
    lots: [{ id: "lot", qty: 12, price: 100, fee: 1, date: "2025-01-01" }],
  });
  assert.equal((await a("/api/portfolio", "PUT", p)).status, 200);
  assert.equal((await b("/api/portfolio")).data.state.holdings.length, 0);
  docker("restart", name);
  await ready();
  assert.equal(
    (await a("/api/portfolio")).data.state.holdings[0].lots[0].qty,
    12,
  );
  docker(
    "exec",
    name,
    "node",
    "scripts/backup.mjs",
    "/data/backups/check.sqlite",
  );
  const backup = path.join(directory, "check.sqlite");
  docker("cp", name + ":/data/backups/check.sqlite", backup);
  const db = new DatabaseSync(backup, { readOnly: true });
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 2);
  db.close();
  const current = (await a("/api/portfolio")).data;
  current.state.holdings = [];
  assert.equal((await a("/api/portfolio", "PUT", current)).status, 200);
  docker("stop", name);
  docker(
    "run",
    "--rm",
    "--user",
    "root",
    "-v",
    volume + ":/data",
    image,
    "sh",
    "-c",
    "rm -f /data/reentry.sqlite-wal /data/reentry.sqlite-shm && cp /data/backups/check.sqlite /data/reentry.sqlite && chown node:node /data/reentry.sqlite && chmod 600 /data/reentry.sqlite",
  );
  docker("start", name);
  await ready();
  assert.equal(
    (await a("/api/portfolio")).data.state.holdings[0].lots[0].qty,
    12,
  );
  assert.equal((await b("/api/portfolio")).data.state.holdings.length, 0);
  console.log(
    "PASS: production container, account isolation, restart persistence, online backup, database integrity, restore.",
  );
} finally {
  try {
    docker("rm", "-f", name);
  } catch {}
  try {
    docker("volume", "rm", volume);
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
