import { fail, id, symbol, text, transaction } from "../platform/util.js";

export function ownedList(db, user, listId) {
  const row = db
    .prepare("SELECT * FROM watchlists WHERE user_id=? AND id=?")
    .get(user, listId);
  if (!row) throw fail("Watchlist not found.", 404);
  return { ...row, symbols: JSON.parse(row.symbols) };
}
export function watchlistState(db, user) {
  const lists = db
    .prepare(
      "SELECT id,name,symbols,revision FROM watchlists WHERE user_id=? ORDER BY created_at,id",
    )
    .all(user)
    .map((r) => ({ ...r, symbols: JSON.parse(r.symbols) }));
  const selected = db
    .prepare("SELECT selected_id FROM watchlist_preferences WHERE user_id=?")
    .get(user)?.selected_id;
  return {
    lists,
    selectedId: lists.some((l) => l.id === selected) ? selected : null,
  };
}
export function selectList(db, user, listId) {
  if (listId) ownedList(db, user, listId);
  db.prepare(
    "INSERT INTO watchlist_preferences(user_id,selected_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET selected_id=excluded.selected_id",
  ).run(user, listId || null);
}
export function addToList(db, user, listId, ticker) {
  const list = ownedList(db, user, listId),
    s = symbol(ticker);
  if (list.symbols.includes(s)) return;
  if (list.symbols.length >= 200)
    throw fail("This watchlist is full. Create another list.");
  db.prepare(
    "UPDATE watchlists SET symbols=?,revision=revision+1 WHERE user_id=? AND id=?",
  ).run(JSON.stringify([...list.symbols, s]), user, listId);
}
export function writeListOrder(db, user, listId, body) {
  return transaction(db, () => {
    const list = ownedList(db, user, listId);
    if (!Array.isArray(body.symbols) || body.symbols.length > 200)
      throw fail("Invalid watchlist order.");
    const symbols = body.symbols.map(symbol);
    if (
      body.revision !== list.revision ||
      new Set(symbols).size !== symbols.length ||
      JSON.stringify([...symbols].sort()) !==
        JSON.stringify([...list.symbols].sort())
    )
      throw fail("This watchlist changed elsewhere. Reload its order.", 409);
    db.prepare(
      "UPDATE watchlists SET symbols=?,revision=revision+1 WHERE id=? AND user_id=?",
    ).run(JSON.stringify(symbols), listId, user);
    return { symbols, revision: list.revision + 1 };
  });
}
export function registerWatchlistRoutes(app, db) {
  const auth = { preHandler: app.requireUser, bodyLimit: 16000 };
  app.get("/api/watchlists", auth, async (req) =>
    watchlistState(db, req.auth.user_id),
  );
  app.put("/api/watchlists/selection", auth, async (req) => {
    selectList(db, req.auth.user_id, req.body?.id);
    return watchlistState(db, req.auth.user_id);
  });
  app.post("/api/watchlists", auth, async (req) =>
    transaction(db, () => {
      const user = req.auth.user_id,
        name = text(req.body?.name, 40);
      if (
        db
          .prepare("SELECT COUNT(*) n FROM watchlists WHERE user_id=?")
          .get(user).n >= 20
      )
        throw fail("You can create up to twenty watchlists.");
      if (
        db
          .prepare(
            "SELECT 1 FROM watchlists WHERE user_id=? AND name=? COLLATE NOCASE",
          )
          .get(user, name)
      )
        throw fail("A watchlist with this name already exists.", 409);
      const listId = id();
      db.prepare(
        "INSERT INTO watchlists(id,user_id,name,symbols,revision,created_at) VALUES(?,?,?,'[]',1,?)",
      ).run(listId, user, name, Date.now());
      return ownedList(db, user, listId);
    }),
  );
  app.patch("/api/watchlists/:id", auth, async (req) =>
    transaction(db, () => {
      const user = req.auth.user_id,
        list = ownedList(db, user, req.params.id),
        name = text(req.body?.name, 40);
      if (req.body?.revision !== list.revision)
        throw fail("This watchlist changed elsewhere. Reopen it.", 409);
      if (
        db
          .prepare(
            "SELECT 1 FROM watchlists WHERE user_id=? AND name=? COLLATE NOCASE AND id<>?",
          )
          .get(user, name, list.id)
      )
        throw fail("A watchlist with this name already exists.", 409);
      db.prepare(
        "UPDATE watchlists SET name=?,revision=revision+1 WHERE id=? AND user_id=?",
      ).run(name, list.id, user);
      return ownedList(db, user, list.id);
    }),
  );
  app.delete("/api/watchlists/:id", auth, async (req) =>
    transaction(db, () => {
      const user = req.auth.user_id,
        list = ownedList(db, user, req.params.id);
      if (req.body?.revision !== list.revision)
        throw fail("This watchlist changed elsewhere. Reopen it.", 409);
      db.prepare("DELETE FROM watchlists WHERE user_id=? AND id=?").run(
        user,
        list.id,
      );
      db.prepare(
        "UPDATE watchlist_preferences SET selected_id=NULL WHERE user_id=? AND selected_id=?",
      ).run(user, list.id);
      return { ok: true };
    }),
  );
  app.put("/api/watchlists/:id/assets/:symbol", auth, async (req) =>
    transaction(db, () => {
      const user = req.auth.user_id,
        s = symbol(req.params.symbol);
      ownedList(db, user, req.params.id);
      if (
        !db
          .prepare("SELECT 1 FROM research_assets WHERE user_id=? AND symbol=?")
          .get(user, s)
      )
        throw fail("Add this asset to Research first.");
      addToList(db, user, req.params.id, s);
      return ownedList(db, user, req.params.id);
    }),
  );
  app.delete("/api/watchlists/:id/assets/:symbol", auth, async (req) =>
    transaction(db, () => {
      const user = req.auth.user_id,
        list = ownedList(db, user, req.params.id),
        s = symbol(req.params.symbol);
      // Membership operations are independent; deleting one asset cannot overwrite another tab's additions.
      if (list.symbols.includes(s))
        db.prepare(
          "UPDATE watchlists SET symbols=?,revision=revision+1 WHERE user_id=? AND id=?",
        ).run(
          JSON.stringify(list.symbols.filter((v) => v !== s)),
          user,
          list.id,
        );
      return ownedList(db, user, list.id);
    }),
  );
}
