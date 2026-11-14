import { migrate } from "./db/migrations.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function openStore(filename) {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
export { emptyPortfolio } from "../src/domain/portfolio.js";
export { validatePortfolio } from "../src/domain/portfolio-validation.js";
