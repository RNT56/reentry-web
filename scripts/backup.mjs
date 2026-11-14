import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, chmod } from "node:fs/promises";
import path from "node:path";
const source = process.env.DATABASE_PATH || "data/reentry.sqlite";
const destination =
  process.argv[2] ||
  `backups/reentry-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
if (path.resolve(source) === path.resolve(destination))
  throw Error("Backup must have a different path.");
await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  await chmod(destination, 0o600);
  console.log(destination);
} finally {
  db.close();
}
