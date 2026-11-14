import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { emptyPortfolio } from "./store.js";
const scrypt = promisify(scryptCb),
  digest = (v) => createHash("sha256").update(v).digest("hex"),
  token = () => randomBytes(32).toString("base64url");
const error = (code, msg) => Object.assign(Error(msg), { statusCode: code });
let hashing = 0;
async function derive(password, salt) {
  if (hashing >= 3) throw error(429, "Please try again in a moment.");
  hashing++;
  try {
    return await scrypt(password, salt, 64, {
      N: 65536,
      r: 8,
      p: 2,
      maxmem: 96 * 1024 * 1024,
    });
  } finally {
    hashing--;
  }
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
async function checkPassword(password, stored) {
  const [, salt, hash] = stored.split(":");
  return timingSafeEqual(
    await derive(password, salt),
    Buffer.from(hash, "hex"),
  );
}
function passwordInput(p) {
  if (typeof p !== "string" || p.length < 12 || p.length > 128)
    throw error(400, "Use a password with 12–128 characters.");
  return p;
}
function usernameInput(u) {
  if (typeof u !== "string" || !/^[a-zA-Z0-9_]{3,32}$/.test(u.trim()))
    throw error(400, "Use 3–32 letters, numbers or underscores.");
  return u.trim().toLowerCase();
}
export async function registerAuth(app, db, config) {
  const secure = config.origin.startsWith("https:"),
    cookieName = secure ? "__Host-reentry" : "reentry_dev",
    challengeName = secure
      ? "__Host-reentry_challenge"
      : "reentry_challenge_dev";
  const options = { path: "/", httpOnly: true, secure, sameSite: "strict" };
  const dummy = await hashPassword(token());
  const run = (sql, ...p) => db.prepare(sql).run(...p),
    get = (sql, ...p) => db.prepare(sql).get(...p);
  function purge() {
    const now = Date.now();
    run(
      "DELETE FROM sessions WHERE expires_at < ? OR last_seen < ?",
      now,
      now - 7 * 86400000,
    );
    run("DELETE FROM challenges WHERE expires_at < ?", now);
    run("DELETE FROM throttle WHERE expires_at < ?", now);
  }
  function throttle(key, max = 10, window = 15 * 60000) {
    const now = Date.now();
    const r = db
      .prepare(
        `INSERT INTO throttle(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count`,
      )
      .get(digest(key), now + window, now, now);
    if (r.count > max)
      throw error(429, "Too many attempts. Please try again later.");
  }
  async function session(req) {
    const t = req.cookies[cookieName];
    if (typeof t !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(t)) return null;
    const row = get(
      `SELECT s.*,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen>?`,
      digest(t),
      Date.now(),
      Date.now() - 7 * 86400000,
    );
    if (row) {
      if (Date.now() - row.last_seen > 60000)
        run(
          "UPDATE sessions SET last_seen=? WHERE token_hash=?",
          Date.now(),
          row.token_hash,
        );
      return row;
    }
    return null;
  }
  async function requireUser(req) {
    req.auth = await session(req);
    if (!req.auth) throw error(401, "Please sign in.");
    return req.auth;
  }
  function recent(req) {
    if (Date.now() - req.auth.auth_at > 10 * 60000)
      throw error(403, "Verify your password to continue.");
  }
  function newSession(req, reply, userId) {
    if (req.cookies[cookieName])
      run(
        "DELETE FROM sessions WHERE token_hash=?",
        digest(req.cookies[cookieName]),
      );
    const t = token(),
      now = Date.now();
    run(
      "INSERT INTO sessions VALUES(?,?,?,?,?,?)",
      digest(t),
      userId,
      now,
      now,
      now,
      now + 30 * 86400000,
    );
    reply.setCookie(cookieName, t, { ...options, maxAge: 30 * 86400 });
  }
  function userResult(user) {
    return { id: user.id || user.user_id, username: user.username };
  }
  const authLimit = { rateLimit: { max: 12, timeWindow: "15 minutes" } };
  const registerLimit = { rateLimit: { max: 5, timeWindow: "1 hour" } };
  app.decorate("requireUser", requireUser);
  app.get("/api/auth/me", async (req) => {
    const u = await session(req);
    return {
      user: u ? userResult(u) : null,
      registration: config.registration,
    };
  });
  app.post(
    "/api/auth/register",
    { config: registerLimit },
    async (req, reply) => {
      if (!config.registration) throw error(403, "Registration is closed.");
      purge();
      throttle("register:" + req.ip, 5, 3600000);
      const username = usernameInput(req.body?.username),
        password = passwordInput(req.body?.password),
        passwordHash = await hashPassword(password),
        id = randomUUID(),
        recoveryKey = token();
      try {
        db.exec("BEGIN IMMEDIATE");
        run(
          "INSERT INTO users VALUES(?,?,?,?,?)",
          id,
          username,
          passwordHash,
          digest(recoveryKey),
          Date.now(),
        );
        run(
          "INSERT INTO portfolios(user_id,data) VALUES(?,?)",
          id,
          JSON.stringify(emptyPortfolio()),
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        if (e.message.includes("UNIQUE"))
          throw error(409, "Choose a different username.");
        throw e;
      }
      newSession(req, reply, id);
      return { user: { id, username }, recoveryKey };
    },
  );
  app.post("/api/auth/login", { config: authLimit }, async (req, reply) => {
    purge();
    const username = usernameInput(req.body?.username);
    throttle("login:" + username);
    const p = req.body?.password;
    if (typeof p !== "string" || p.length > 128)
      throw error(401, "Username or password is incorrect.");
    const user = get("SELECT * FROM users WHERE username=?", username);
    const ok = await checkPassword(p, user?.password_hash || dummy);
    if (
      !user ||
      !ok ||
      !get(
        "SELECT id FROM users WHERE id=? AND password_hash=?",
        user.id,
        user.password_hash,
      )
    )
      throw error(401, "Username or password is incorrect.");
    newSession(req, reply, user.id);
    return { user: userResult(user) };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const u = await session(req);
    if (u) run("DELETE FROM sessions WHERE token_hash=?", u.token_hash);
    reply.clearCookie(cookieName, options);
    return { ok: true };
  });
  app.post(
    "/api/auth/logout-all",
    { preHandler: requireUser },
    async (req, reply) => {
      run("DELETE FROM sessions WHERE user_id=?", req.auth.user_id);
      reply.clearCookie(cookieName, options);
      return { ok: true };
    },
  );
  app.post(
    "/api/auth/verify-password",
    { preHandler: requireUser, config: authLimit },
    async (req) => {
      throttle("verify:" + req.auth.user_id);
      const p = req.body?.password,
        u = get("SELECT password_hash FROM users WHERE id=?", req.auth.user_id);
      if (
        typeof p !== "string" ||
        p.length > 128 ||
        !(await checkPassword(p, u.password_hash))
      )
        throw error(401, "Password is incorrect.");
      run(
        "UPDATE sessions SET auth_at=? WHERE token_hash=?",
        Date.now(),
        req.auth.token_hash,
      );
      return { ok: true };
    },
  );
  app.post(
    "/api/auth/password",
    { preHandler: requireUser, config: authLimit },
    async (req, reply) => {
      throttle("password:" + req.auth.user_id);
      const u = get("SELECT * FROM users WHERE id=?", req.auth.user_id),
        p = req.body?.currentPassword;
      passwordInput(req.body?.password);
      if (
        typeof p !== "string" ||
        p.length > 128 ||
        !(await checkPassword(p, u.password_hash))
      )
        throw error(401, "Current password is incorrect.");
      const hash = await hashPassword(req.body.password);
      const changed = run(
        "UPDATE users SET password_hash=? WHERE id=? AND password_hash=?",
        hash,
        u.id,
        u.password_hash,
      );
      if (changed.changes !== 1)
        throw error(409, "Account changed. Please sign in again.");
      run("DELETE FROM sessions WHERE user_id=?", u.id);
      newSession(req, reply, u.id);
      return { ok: true };
    },
  );
  app.post(
    "/api/auth/recover",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const username = usernameInput(req.body?.username);
      throttle("recover:" + username, 5, 3600000);
      const p = passwordInput(req.body?.password),
        key = req.body?.recoveryKey,
        u = get("SELECT * FROM users WHERE username=?", username);
      if (
        typeof key !== "string" ||
        key.length > 200 ||
        !u ||
        !timingSafeEqual(
          Buffer.from(digest(key.trim())),
          Buffer.from(u.recovery_hash),
        )
      )
        throw error(401, "Username or recovery key is incorrect.");
      const hash = await hashPassword(p),
        recoveryKey = token();
      db.exec("BEGIN IMMEDIATE");
      try {
        const changed = run(
          "UPDATE users SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?",
          hash,
          digest(recoveryKey),
          u.id,
          u.recovery_hash,
        );
        if (changed.changes !== 1)
          throw error(401, "Recovery key has already been used.");
        run("DELETE FROM sessions WHERE user_id=?", u.id);
        run("DELETE FROM passkeys WHERE user_id=?", u.id);
        run("DELETE FROM challenges WHERE user_id=?", u.id);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      newSession(req, reply, u.id);
      return { user: userResult(u), recoveryKey };
    },
  );
  app.get("/api/auth/passkeys", { preHandler: requireUser }, async (req) => ({
    passkeys: db
      .prepare(
        "SELECT id,name,created_at FROM passkeys WHERE user_id=? ORDER BY created_at DESC",
      )
      .all(req.auth.user_id),
  }));
  function storeChallenge(
    req,
    reply,
    challenge,
    kind,
    userId = null,
    sessionHash = null,
  ) {
    purge();
    if (req.cookies[challengeName])
      run(
        "DELETE FROM challenges WHERE id=?",
        digest(req.cookies[challengeName]),
      );
    const id = token();
    run(
      "INSERT INTO challenges VALUES(?,?,?,?,?,?)",
      digest(id),
      challenge,
      kind,
      userId,
      sessionHash,
      Date.now() + 300000,
    );
    reply.setCookie(challengeName, id, { ...options, maxAge: 300 });
  }
  function takeChallenge(req, reply, kind) {
    const id = req.cookies[challengeName];
    reply.clearCookie(challengeName, options);
    if (!id) throw error(400, "Passkey request expired. Please try again.");
    const row = db
      .prepare("DELETE FROM challenges WHERE id=? RETURNING *")
      .get(digest(id));
    if (!row || row.kind !== kind || row.expires_at < Date.now())
      throw error(400, "Passkey request expired. Please try again.");
    return row;
  }
  app.post(
    "/api/auth/passkeys/register-options",
    { preHandler: requireUser, config: authLimit },
    async (req, reply) => {
      recent(req);
      const keys = db
        .prepare("SELECT id,transports FROM passkeys WHERE user_id=?")
        .all(req.auth.user_id);
      if (keys.length >= 10) throw error(400, "Remove an old passkey first.");
      const opts = await generateRegistrationOptions({
        rpName: "Reentry",
        rpID: config.rpId,
        userName: req.auth.username,
        userID: Buffer.from(req.auth.user_id),
        attestationType: "none",
        supportedAlgorithmIDs: [-7, -257],
        excludeCredentials: keys.map((k) => ({
          id: k.id,
          transports: JSON.parse(k.transports),
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });
      storeChallenge(
        req,
        reply,
        opts.challenge,
        "register",
        req.auth.user_id,
        req.auth.token_hash,
      );
      return opts;
    },
  );
  app.post(
    "/api/auth/passkeys/register",
    { preHandler: requireUser, config: authLimit },
    async (req, reply) => {
      recent(req);
      const c = takeChallenge(req, reply, "register");
      if (
        c.user_id !== req.auth.user_id ||
        c.session_hash !== req.auth.token_hash
      )
        throw error(403, "Passkey request belongs to another session.");
      let result;
      try {
        result = await verifyRegistrationResponse({
          response: req.body?.credential,
          expectedChallenge: c.challenge,
          expectedOrigin: config.origin,
          expectedRPID: config.rpId,
          requireUserVerification: true,
          supportedAlgorithmIDs: [-7, -257],
        });
      } catch {
        throw error(400, "Passkey verification failed. Please try again.");
      }
      if (!result.verified) throw error(400, "Passkey verification failed.");
      const k = result.registrationInfo.credential,
        name =
          typeof req.body.name === "string"
            ? req.body.name.trim().slice(0, 60)
            : "My passkey";
      try {
        run(
          "INSERT INTO passkeys VALUES(?,?,?,?,?,?,?)",
          k.id,
          req.auth.user_id,
          Buffer.from(k.publicKey),
          k.counter,
          JSON.stringify(k.transports || []),
          name || "My passkey",
          Date.now(),
        );
      } catch {
        throw error(409, "This passkey is already registered.");
      }
      return { ok: true };
    },
  );
  app.post(
    "/api/auth/passkeys/login-options",
    { config: authLimit },
    async (req, reply) => {
      const opts = await generateAuthenticationOptions({
        rpID: config.rpId,
        userVerification: "required",
      });
      storeChallenge(req, reply, opts.challenge, "login");
      return opts;
    },
  );
  app.post(
    "/api/auth/passkeys/login",
    { config: authLimit },
    async (req, reply) => {
      const c = takeChallenge(req, reply, "login"),
        response = req.body?.credential;
      const k =
        typeof response?.id === "string"
          ? get("SELECT * FROM passkeys WHERE id=?", response.id)
          : null;
      if (!k) throw error(401, "Passkey not recognized.");
      if (
        response.response?.userHandle !==
        Buffer.from(k.user_id).toString("base64url")
      )
        throw error(401, "Passkey account does not match.");
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: c.challenge,
          expectedOrigin: config.origin,
          expectedRPID: config.rpId,
          credential: {
            id: k.id,
            publicKey: new Uint8Array(k.public_key),
            counter: k.counter,
            transports: JSON.parse(k.transports),
          },
          requireUserVerification: true,
        });
      } catch {
        throw error(401, "Passkey verification failed.");
      }
      if (!result.verified) throw error(401, "Passkey verification failed.");
      const changed = run(
        "UPDATE passkeys SET counter=? WHERE id=? AND counter=?",
        result.authenticationInfo.newCounter,
        k.id,
        k.counter,
      );
      if (changed.changes !== 1) throw error(409, "Please retry sign-in.");
      const u = get("SELECT id,username FROM users WHERE id=?", k.user_id);
      newSession(req, reply, k.user_id);
      return { user: userResult(u) };
    },
  );
  app.delete(
    "/api/auth/passkeys/:id",
    { preHandler: requireUser, config: authLimit },
    async (req) => {
      recent(req);
      run(
        "DELETE FROM passkeys WHERE id=? AND user_id=?",
        req.params.id,
        req.auth.user_id,
      );
      return { ok: true };
    },
  );
}
