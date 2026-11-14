import { MAX_CHART_WORKSPACES } from "../../src/domain/chart-workspace.js";
import { transaction } from "../platform/util.js";

const conflict = () =>
  Object.assign(
    Error("This analysis changed on another device. Reload it before saving."),
    { statusCode: 409 },
  );
const unpack = (row) => ({
  slot: row.slot,
  revision: row.revision,
  state: row.state === null ? null : JSON.parse(row.state),
  updatedAt: row.updated_at,
});

export function chartWorkspaceRepository(db) {
  const read = db.prepare(
    "SELECT slot,revision,state,updated_at FROM chart_workspaces WHERE user_id=? AND symbol=? AND slot=?",
  );
  const list = db.prepare(
    "SELECT slot,revision,state,updated_at FROM chart_workspaces WHERE user_id=? AND symbol=? ORDER BY slot",
  );
  const insert = db.prepare(
    "INSERT INTO chart_workspaces(user_id,symbol,slot,revision,state,updated_at) VALUES(?,?,?,1,?,?) RETURNING slot,revision,state,updated_at",
  );
  const update = db.prepare(
    "UPDATE chart_workspaces SET revision=revision+1,state=?,updated_at=? WHERE user_id=? AND symbol=? AND slot=? AND revision=? RETURNING slot,revision,state,updated_at",
  );
  return {
    list(userId, symbol) {
      const rows = new Map(
        list.all(userId, symbol).map((row) => [row.slot, unpack(row)]),
      );
      return Array.from(
        { length: MAX_CHART_WORKSPACES },
        (_, i) =>
          rows.get(i + 1) || {
            slot: i + 1,
            revision: 0,
            state: null,
            updatedAt: null,
          },
      );
    },
    save(userId, symbol, slot, revision, state) {
      return transaction(db, () => {
        const previous = read.get(userId, symbol, slot);
        if (previous ? previous.revision !== revision : revision !== 0)
          throw conflict();
        const body = state === null ? null : JSON.stringify(state);
        const now = Date.now();
        const row = previous
          ? update.get(body, now, userId, symbol, slot, revision)
          : insert.get(userId, symbol, slot, body, now);
        if (!row) throw conflict();
        return unpack(row);
      });
    },
    remove(userId, symbol, slot, revision) {
      return transaction(db, () => {
        const previous = read.get(userId, symbol, slot);
        if (previous ? previous.revision !== revision : revision !== 0)
          throw conflict();
        if (!previous || previous.state === null)
          return previous
            ? unpack(previous)
            : { slot, revision: 0, state: null, updatedAt: null };
        const row = update.get(
          null,
          Date.now(),
          userId,
          symbol,
          slot,
          revision,
        );
        if (!row) throw conflict();
        return unpack(row);
      });
    },
  };
}
