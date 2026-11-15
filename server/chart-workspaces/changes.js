/** Bounded, account/asset-scoped wakeups; SQLite revisions remain authoritative. */
export function createChartChanges({ timeout = 25000, limit = 16 } = {}) {
  const listeners = new Map();
  let closing = false;
  return {
    wait(owner, symbol, signal) {
      if (closing || signal.aborted) return Promise.resolve();
      const owned = listeners.get(owner) || new Set();
      if (owned.size >= limit)
        throw Object.assign(Error("Too many open chart connections."), {
          statusCode: 429,
        });
      listeners.set(owner, owned);
      return new Promise((resolve) => {
        let timer;
        const entry = {
          symbol,
          finish: () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", entry.finish);
            owned.delete(entry);
            if (!owned.size) listeners.delete(owner);
            resolve();
          },
        };
        owned.add(entry);
        signal.addEventListener("abort", entry.finish, { once: true });
        timer = setTimeout(entry.finish, timeout);
        timer.unref?.();
      });
    },
    publish(owner, symbol) {
      for (const entry of [...(listeners.get(owner) || [])])
        if (entry.symbol === symbol) entry.finish();
    },
    close() {
      closing = true;
      for (const owned of [...listeners.values()])
        for (const entry of [...owned]) entry.finish();
    },
  };
}
