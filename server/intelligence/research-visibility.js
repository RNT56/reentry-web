/** A Research dismissal is a preference, independent of holdings or evidence. */
export function initializeResearchVisibility(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS research_hidden_assets(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,hidden_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,symbol));`);
}

export function researchHidden(db, user, symbol) {
  return !!db
    .prepare(
      "SELECT 1 FROM research_hidden_assets WHERE user_id=? AND symbol=?",
    )
    .get(user, symbol);
}

export function hiddenResearchSymbols(db, user) {
  return new Set(
    db
      .prepare("SELECT symbol FROM research_hidden_assets WHERE user_id=?")
      .all(user)
      .map((row) => row.symbol),
  );
}
