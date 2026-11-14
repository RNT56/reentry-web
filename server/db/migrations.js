// Append migrations; never edit a released schema step. Back up before upgrade.
export const migrations = [
  {
    version: 1,
    sql: ` CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,recovery_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS portfolios(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,auth_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
 CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,public_key BLOB NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL,name TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,challenge TEXT NOT NULL,kind TEXT NOT NULL,user_id TEXT,session_hash TEXT,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS throttle(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
`,
  },
];
export function migrate(db, steps = migrations) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  const latest = steps.at(-1)?.version || 0;
  if (version > latest)
    throw Error(
      "Database is newer than this application. Refusing a schema downgrade.",
    );
  for (let i = 0; i < steps.length; i++)
    if (steps[i].version !== i + 1)
      throw Error("Migrations must be consecutive.");
  const pending = steps.filter((s) => s.version > version);
  if (!pending.length) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const step of pending) {
      db.exec(step.sql);
      db.exec("PRAGMA user_version=" + step.version);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
