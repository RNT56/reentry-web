import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  randomBytes,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { encodeCBOR } from "@levischuck/tiny-cbor";
import { createApp } from "../server/app.js";
import { openStore, emptyPortfolio } from "../server/store.js";
const origin = "http://localhost:4173",
  password = "test-password-only-123";
function client(app) {
  let cookies = {};
  return {
    cookies,
    async call(url, method = "GET", body, headers = {}) {
      const r = await app.inject({
        url,
        method,
        headers: {
          origin,
          "x-reentry-request": "1",
          ...headers,
          cookie: Object.entries(cookies)
            .map(([k, v]) => k + "=" + v)
            .join("; "),
        },
        payload: body,
      });
      for (const c of r.cookies) {
        if (c.value) cookies[c.name] = c.value;
        else delete cookies[c.name];
      }
      return { status: r.statusCode, body: r.json(), response: r };
    },
  };
}
function fakeAuthenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    }),
    jwk = publicKey.export({ format: "jwk" }),
    id = randomBytes(32),
    rp = createHash("sha256").update("localhost").digest();
  return {
    id: id.toString("base64url"),
    register(options, originValue = origin) {
      const clientData = Buffer.from(
        JSON.stringify({
          type: "webauthn.create",
          challenge: options.challenge,
          origin: originValue,
          crossOrigin: false,
        }),
      );
      const cose = encodeCBOR(
        new Map([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
          [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
        ]),
      );
      const len = Buffer.alloc(2);
      len.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        rp,
        Buffer.from([0x45]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        len,
        id,
        Buffer.from(cose),
      ]);
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString("base64url"),
          attestationObject: Buffer.from(
            encodeCBOR(
              new Map([
                ["fmt", "none"],
                ["attStmt", new Map()],
                ["authData", new Uint8Array(authData)],
              ]),
            ),
          ).toString("base64url"),
          transports: ["internal"],
        },
      };
    },
    login(options, userId, count = 1, originValue = origin, verified = true) {
      const clientData = Buffer.from(
          JSON.stringify({
            type: "webauthn.get",
            challenge: options.challenge,
            origin: originValue,
            crossOrigin: false,
          }),
        ),
        counter = Buffer.alloc(4);
      counter.writeUInt32BE(count);
      const authData = Buffer.concat([
        rp,
        Buffer.from([verified ? 5 : 1]),
        counter,
      ]);
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: sign(
            "sha256",
            Buffer.concat([
              authData,
              createHash("sha256").update(clientData).digest(),
            ]),
            privateKey,
          ).toString("base64url"),
          userHandle: Buffer.from(userId).toString("base64url"),
        },
      };
    },
  };
}
test("accounts, isolation, concurrency, recovery and WebAuthn cryptographic flows", async (t) => {
  const db = openStore(":memory:"),
    app = await createApp({
      db,
      origin,
      logger: false,
      disableRateLimit: true,
    });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  const a = client(app),
    b = client(app),
    anon = client(app);
  assert.equal((await anon.call("/api/portfolio")).status, 401);
  assert.equal(
    (await anon.call("/api/history?symbol=AAPL&range=1mo")).status,
    401,
  );
  assert.equal((await anon.call("/api/quote?symbol=AAPL")).status, 401);
  assert.equal((await anon.call("/api/search?q=apple")).status, 401);
  assert.equal(
    (
      await anon.call(
        "/api/auth/register",
        "POST",
        { username: "blocked", password },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await anon.call(
        "/api/auth/register",
        "POST",
        { username: "blocked", password },
        { "x-reentry-request": "" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await a.call("/api/auth/register", "POST", {
        username: "alice",
        password: "short",
      })
    ).status,
    400,
  );
  const registration = await a.call("/api/auth/register", "POST", {
    username: "Alice",
    password,
  });
  assert.equal(registration.status, 200);
  assert.equal(registration.body.user.username, "alice");
  const userA = registration.body.user;
  const recovery = registration.body.recoveryKey;
  assert.ok(recovery.length >= 40);
  assert.match(registration.response.headers["set-cookie"], /HttpOnly/);
  assert.match(registration.response.headers["set-cookie"], /SameSite=Strict/);
  assert.notEqual(
    db.prepare("SELECT password_hash FROM users WHERE id=?").get(userA.id)
      .password_hash,
    password,
  );
  assert.equal(
    (
      await b.call("/api/auth/register", "POST", {
        username: "alice",
        password,
      })
    ).status,
    409,
  );
  assert.equal(
    (await b.call("/api/auth/register", "POST", { username: "bob", password }))
      .status,
    200,
  );
  const portfolio = emptyPortfolio();
  portfolio.holdings = [
    {
      id: "holding-a",
      symbol: "AAPL",
      name: "Apple",
      broker: "Trade Republic",
      lots: [{ id: "lot-a", qty: 10, price: 100, fee: 1, date: "2025-01-01" }],
    },
  ];
  assert.equal(
    (await a.call("/api/portfolio", "PUT", { state: portfolio, revision: 0 }))
      .status,
    200,
  );
  assert.equal((await b.call("/api/portfolio")).body.state.holdings.length, 0);
  assert.equal(
    (await a.call("/api/portfolio")).body.state.holdings[0].symbol,
    "AAPL",
  );
  assert.equal(
    (await a.call("/api/portfolio", "PUT", { state: portfolio, revision: 0 }))
      .status,
    409,
  );
  const bad = structuredClone(portfolio);
  bad.holdings[0].lots[0].qty = -10;
  assert.equal(
    (await a.call("/api/portfolio", "PUT", { state: bad, revision: 1 })).status,
    400,
  );
  bad.holdings[0].lots[0].qty = 10;
  bad.holdings[0].lots[0].date = "2025-99-99";
  assert.equal(
    (await a.call("/api/portfolio", "PUT", { state: bad, revision: 1 })).status,
    400,
  );
  const authenticator = fakeAuthenticator();
  let options = (
    await a.call("/api/auth/passkeys/register-options", "POST", {})
  ).body;
  assert.equal(
    (
      await a.call("/api/auth/passkeys/register", "POST", {
        credential: authenticator.register(options),
        name: "Test passkey",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await a.call("/api/auth/passkeys/register", "POST", {
        credential: authenticator.register(options),
      })
    ).status,
    400,
  );
  assert.equal((await b.call("/api/auth/passkeys")).body.passkeys.length, 0);
  assert.equal((await a.call("/api/auth/passkeys")).body.passkeys.length, 1);
  const pk = client(app);
  options = (await pk.call("/api/auth/passkeys/login-options", "POST", {}))
    .body;
  const assertion = authenticator.login(options, userA.id);
  let login = await pk.call("/api/auth/passkeys/login", "POST", {
    credential: assertion,
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.id, userA.id);
  assert.equal((await pk.call("/api/portfolio")).body.state.holdings.length, 1);
  assert.equal(
    (
      await pk.call("/api/auth/passkeys/login", "POST", {
        credential: assertion,
      })
    ).status,
    400,
  );
  options = (await anon.call("/api/auth/passkeys/login-options", "POST", {}))
    .body;
  assert.equal(
    (
      await anon.call("/api/auth/passkeys/login", "POST", {
        credential: authenticator.login(
          options,
          userA.id,
          2,
          "https://evil.example",
        ),
      })
    ).status,
    401,
  );
  options = (await anon.call("/api/auth/passkeys/login-options", "POST", {}))
    .body;
  assert.equal(
    (
      await anon.call("/api/auth/passkeys/login", "POST", {
        credential: authenticator.login(options, userA.id, 2, origin, false),
      })
    ).status,
    401,
  );
  options = (await anon.call("/api/auth/passkeys/login-options", "POST", {}))
    .body;
  assert.equal(
    (
      await anon.call("/api/auth/passkeys/login", "POST", {
        credential: authenticator.login(options, userA.id, 1),
      })
    ).status,
    401,
  );
  const attacker = client(app);
  assert.equal(
    (
      await attacker.call("/api/auth/login", "POST", {
        username: "alice",
        password: "wrong",
      })
    ).status,
    401,
  );
  const recovered = await attacker.call("/api/auth/recover", "POST", {
    username: "alice",
    recoveryKey: recovery,
    password: "new-test-password-123",
  });
  assert.equal(recovered.status, 200);
  assert.notEqual(recovered.body.recoveryKey, recovery);
  assert.equal((await a.call("/api/portfolio")).status, 401);
  assert.equal((await pk.call("/api/portfolio")).status, 401);
  assert.equal(
    (await attacker.call("/api/auth/passkeys")).body.passkeys.length,
    0,
  );
  assert.equal(
    (
      await anon.call("/api/auth/recover", "POST", {
        username: "alice",
        recoveryKey: recovery,
        password,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await anon.call("/api/auth/login", "POST", {
        username: "alice",
        password,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await anon.call("/api/auth/login", "POST", {
        username: "alice",
        password: "new-test-password-123",
      })
    ).status,
    200,
  );
  const b2 = client(app);
  assert.equal(
    (await b2.call("/api/auth/login", "POST", { username: "bob", password }))
      .status,
    200,
  );
  assert.equal(
    (
      await b.call("/api/auth/password", "POST", {
        currentPassword: password,
        password: "bob-new-password-123",
      })
    ).status,
    200,
  );
  assert.equal((await b2.call("/api/portfolio")).status, 401);
  assert.equal((await b.call("/api/portfolio")).status, 200);
  assert.equal(
    (await attacker.call("/api/auth/logout-all", "POST", {})).status,
    200,
  );
  assert.equal((await anon.call("/api/portfolio")).status, 401);
});
test("closed registration and authentication throttling", async (t) => {
  const db = openStore(":memory:"),
    app = await createApp({
      db,
      origin,
      registration: false,
      logger: false,
      disableRateLimit: true,
    });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  const c = client(app);
  assert.equal(
    (
      await c.call("/api/auth/register", "POST", {
        username: "closed",
        password,
      })
    ).status,
    403,
  );
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await c.call("/api/auth/login", "POST", {
          username: "missing",
          password: "wrong",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await c.call("/api/auth/login", "POST", {
        username: "missing",
        password: "wrong",
      })
    ).status,
    429,
  );
});
test("HTTPS sessions use secure host-only cookies", async (t) => {
  const db = openStore(":memory:"),
    app = await createApp({
      db,
      origin: "https://stocks.example.com",
      logger: false,
      disableRateLimit: true,
    });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { origin: "https://stocks.example.com", "x-reentry-request": "1" },
    payload: { username: "secure", password },
  });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["set-cookie"], /^__Host-reentry=/);
  assert.match(r.headers["set-cookie"], /; Secure/);
  assert.ok(!r.headers["set-cookie"].includes("Domain="));
});
