import {
  defaultChartWorkspaceState,
  validateChartWorkspaceState,
} from "../../domain/chart-workspace.js";

const clone = (value) => structuredClone(value);
export const chartStateVersion = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const equal = (a, b) => chartStateVersion(a) === chartStateVersion(b);
const initial = (slot) => defaultChartWorkspaceState("Analysis " + slot);

/** One account/asset journal; independent, serialized writers for its three slots. */
export function createChartAutosave({
  ownerId,
  symbol,
  request,
  storage,
  canWrite = () => true,
  delay = 350,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const storageKey =
    "reentry.chart-drafts.v1:" + JSON.stringify([String(ownerId), symbol]);
  const listeners = new Set();
  const records = [1, 2, 3].map((slot) => ({
    slot,
    revision: 0,
    base: null,
    state: initial(slot),
    attempts: [],
    phase: "saved",
    error: null,
    timer: null,
    flight: null,
    retries: 0,
    exclusive: false,
  }));
  let loaded = false,
    loading = null,
    selected = null,
    journalSafe = true;
  const record = (slot) => {
    if (![1, 2, 3].includes(slot)) throw Error("Choose an analysis slot.");
    return records[slot - 1];
  };
  const changed = (r) => !equal(r.state, r.base || initial(r.slot));
  const pending = (r) => changed(r) || !!r.flight || r.attempts.length > 0;
  const notify = () => listeners.forEach((fn) => fn());
  const cancel = (r) => {
    if (r.timer !== null) clearTimer(r.timer);
    r.timer = null;
  };
  function journal() {
    try {
      storage?.setItem(
        storageKey,
        JSON.stringify({
          selected,
          entries: records.filter(pending).map((r) => ({
            slot: r.slot,
            revision: r.revision,
            base: r.base,
            state: r.state,
            attempts: r.attempts,
          })),
        }),
      );
      journalSafe = !!storage;
    } catch {
      journalSafe = false;
    }
  }
  try {
    const raw = JSON.parse(storage?.getItem(storageKey) || "null");
    if (raw && Array.isArray(raw.entries) && raw.entries.length <= 3) {
      selected = [1, 2, 3].includes(raw.selected) ? raw.selected : null;
      for (const saved of raw.entries) {
        const r = record(saved.slot);
        if (!Number.isSafeInteger(saved.revision) || saved.revision < 0)
          continue;
        const state = validateChartWorkspaceState(saved.state);
        const base =
          saved.base === null ? null : validateChartWorkspaceState(saved.base);
        const attempts = (saved.attempts || [])
          .slice(-8)
          .map(validateChartWorkspaceState);
        Object.assign(r, {
          state,
          base,
          attempts,
          revision: saved.revision,
          phase: "pending",
        });
      }
    }
  } catch {
    /* A damaged browser journal never replaces server state. */
  }
  const path = (slot) =>
    "/api/chart-workspaces/" + encodeURIComponent(symbol) + "/" + slot;
  const options = { keepalive: true, ownerId: String(ownerId) };
  async function read() {
    if (!canWrite())
      throw Object.assign(Error("Account changed. Sign in again."), {
        status: 401,
      });
    return (
      await request(
        "/api/chart-workspaces?symbol=" + encodeURIComponent(symbol),
        "GET",
        undefined,
        { ownerId: String(ownerId) },
      )
    ).slots;
  }
  function adopt(r, remote, keepDraft) {
    const oldRevision = r.revision;
    const safe =
      !keepDraft ||
      (remote.revision === r.revision && equal(remote.state, r.base)) ||
      equal(remote.state, r.base) ||
      equal(remote.state, r.state) ||
      r.attempts.some((attempt) => equal(remote.state, attempt));
    if (!safe) {
      r.phase = "conflict";
      r.error = "Changed on another device. Reload the saved analysis.";
      return false;
    }
    r.revision = remote.revision;
    r.base = clone(remote.state);
    if (!keepDraft) r.state = clone(remote.state || initial(r.slot));
    // Unacknowledged keepalive writes can still arrive after a reload. Retain
    // their snapshots until the server advances, so a subsequent 409 is resolvable.
    if (!keepDraft || remote.revision !== oldRevision) r.attempts = [];
    r.error = null;
    r.phase = changed(r) ? "pending" : "saved";
    return true;
  }
  function schedule(r, wait = delay) {
    // Editing or leaving a chart must not cancel its existing retry backoff.
    if (r.phase === "retrying") return;
    cancel(r);
    if (
      !loaded ||
      !canWrite() ||
      r.exclusive ||
      r.flight ||
      r.phase === "conflict" ||
      r.phase === "error" ||
      !pending(r)
    )
      return;
    r.timer = setTimer(() => {
      r.timer = null;
      void flush(r.slot);
    }, wait);
  }
  function failure(r, error) {
    r.error = error.message || "Connection unavailable.";
    const retryable =
      !error.status ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500;
    r.retries++;
    r.phase = retryable && r.retries <= 5 ? "retrying" : "error";
  }
  async function flush(slot) {
    const r = record(slot);
    if (r.phase === "retrying") return !pending(r);
    cancel(r);
    if (r.flight) {
      await r.flight;
      if (["retrying", "error", "conflict"].includes(r.phase)) return false;
      return flush(slot);
    }
    if (
      !loaded ||
      !canWrite() ||
      r.exclusive ||
      ["conflict", "error", "retrying"].includes(r.phase)
    )
      return !pending(r);
    if (!pending(r)) return true;
    r.phase = "saving";
    const operation = (async () => {
      try {
        // A lost response is not evidence that the write failed. Reconcile it
        // before retrying instead of overwriting a newer device's revision.
        if (r.attempts.length) {
          const remote = (await read())[slot - 1];
          if (!adopt(r, remote, true)) return;
          if (!changed(r) && !r.attempts.length) return;
        }
        if (!canWrite()) {
          r.phase = "pending";
          return;
        }
        const snapshot = clone(r.state),
          revision = r.revision;
        if (!r.attempts.some((a) => equal(a, snapshot)))
          r.attempts.push(snapshot);
        r.attempts = r.attempts.slice(-8);
        journal();
        r.phase = "saving";
        const result = await request(
          path(slot),
          "PUT",
          { revision, state: snapshot },
          options,
        );
        r.base = clone(result.state);
        r.revision = result.revision;
        r.attempts = [];
        r.retries = 0;
        r.error = null;
        r.phase = changed(r) ? "pending" : "saved";
      } catch (error) {
        if (error.status === 409 && canWrite()) {
          try {
            if (adopt(r, (await read())[slot - 1], true) && ++r.retries > 5) {
              r.phase = "error";
              r.error = "Could not synchronize this analysis. Retry.";
            }
          } catch (readError) {
            failure(r, readError);
          }
        } else failure(r, error);
      }
    })();
    r.flight = operation;
    journal();
    notify();
    await operation;
    r.flight = null;
    journal();
    notify();
    if (r.phase === "pending" && canWrite() && !r.exclusive) return flush(slot);
    else if (r.phase === "retrying") {
      const wait = Math.min(15000, 1000 * 2 ** (r.retries - 1));
      if (canWrite())
        r.timer = setTimer(() => {
          r.timer = null;
          r.phase = "pending";
          void flush(slot);
        }, wait);
    }
    return !pending(r);
  }
  const api = {
    async load() {
      if (loading) return loading;
      records.forEach(cancel);
      loaded = false;
      loading = (async () => {
        await Promise.all(records.map((r) => r.flight));
        const remote = await read();
        for (const r of records) adopt(r, remote[r.slot - 1], pending(r));
        selected ||= remote.find((r) => r.state)?.slot || 1;
        loaded = true;
        journal();
        notify();
        records.forEach((r) => schedule(r));
        return api.slots();
      })();
      try {
        return await loading;
      } finally {
        loading = null;
      }
    },
    slots: () =>
      records.map((r) => ({
        slot: r.slot,
        revision: r.revision,
        state: clone(r.base),
      })),
    get(slot) {
      const r = record(slot);
      return {
        slot,
        revision: r.revision,
        state: clone(r.state),
        dirty: pending(r),
        phase: r.phase,
        error: r.error,
        saved: r.base !== null,
      };
    },
    get selected() {
      return selected || 1;
    },
    select(slot) {
      record(slot);
      selected = slot;
      journal();
    },
    update(slot, state) {
      if (!loaded || !canWrite()) return;
      const r = record(slot);
      if (r.exclusive) return;
      const normalized = validateChartWorkspaceState({
        ...state,
        name: state.name.trim() || r.state.name || "Analysis " + slot,
      });
      if (equal(r.state, normalized)) return;
      r.state = clone(normalized);
      if (!["conflict", "error", "retrying"].includes(r.phase))
        r.phase = r.flight ? "saving" : "pending";
      if (!pending(r)) r.phase = "saved";
      journal();
      notify();
      schedule(r);
    },
    flush,
    async flushAll() {
      const results = await Promise.all(
        records.map((r) => {
          if (r.phase === "retrying") r.phase = "pending";
          return flush(r.slot);
        }),
      );
      return results.every(Boolean);
    },
    retry(slot) {
      const r = record(slot);
      if (r.phase === "conflict") return Promise.resolve(false);
      r.retries = 0;
      r.phase = "pending";
      r.error = null;
      return flush(slot);
    },
    async reset(slot, clear = false) {
      const r = record(slot);
      cancel(r);
      r.exclusive = true;
      try {
        await r.flight;
        if (clear && r.phase === "conflict") throw Error(r.error);
        if (!canWrite()) throw Error("Account changed. Sign in again.");
        const remote = clear
          ? await request(
              path(slot),
              "DELETE",
              { revision: r.revision },
              options,
            )
          : (await read())[slot - 1];
        adopt(r, remote, false);
        r.attempts = [];
        r.retries = 0;
        journal();
        notify();
        return api.get(slot);
      } finally {
        r.exclusive = false;
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    pause() {
      records.forEach(cancel);
      journal();
    },
    resume() {
      records.forEach((r) => {
        if (r.phase === "retrying" || r.phase === "error") {
          r.phase = "pending";
          r.retries = 0;
        }
        schedule(r, 0);
      });
    },
    hasPending: () => records.some(pending),
    needsUnloadWarning: () => !journalSafe && records.some(pending),
    canEvict: () => !listeners.size && !records.some(pending),
  };
  return api;
}
