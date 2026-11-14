export function portfolioRepository(db) {
  const read = db.prepare(
    "SELECT data,revision FROM portfolios WHERE user_id=?",
  );
  const write = db.prepare(
    "UPDATE portfolios SET data=?,revision=revision+1 WHERE user_id=? AND revision=? RETURNING revision",
  );
  return {
    get(userId) {
      const row = read.get(userId);
      return row
        ? { state: JSON.parse(row.data), revision: row.revision }
        : null;
    },
    save(userId, state, revision) {
      return write.get(JSON.stringify(state), userId, revision);
    },
  };
}
