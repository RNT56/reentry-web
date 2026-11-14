import { fail, transaction, audit } from "../platform/util.js";
export function createAdminControls(db, { registration = true } = {}) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS admin_controls(name TEXT PRIMARY KEY,value INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
  );
  function get() {
    const saved = Object.fromEntries(
      db
        .prepare("SELECT name,value FROM admin_controls")
        .all()
        .map((r) => [r.name, !!r.value]),
    );
    return {
      aiPaused: saved.aiPaused ?? false,
      registrationOpen: saved.registrationOpen ?? registration,
    };
  }
  return {
    get,
    set(patch, user) {
      const keys = Object.keys(patch || {});
      if (
        !keys.length ||
        keys.some(
          (k) =>
            !["aiPaused", "registrationOpen"].includes(k) ||
            typeof patch[k] !== "boolean",
        )
      )
        throw fail("Invalid platform control.");
      return transaction(db, () => {
        for (const name of keys)
          db.prepare(
            "INSERT INTO admin_controls VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
          ).run(name, Number(patch[name]), Date.now());
        audit(db, user, "platform-controls-updated", patch);
        return get();
      });
    },
  };
}
