import { setTimeout as delay } from "node:timers/promises";

// Shared by all callers of one upstream connector, including concurrent HTTP requests.
export function createRequestPacer({
  interval = 160,
  limit = 12,
  now = () => performance.now(),
  wait = delay,
} = {}) {
  let tail = Promise.resolve(),
    next = 0,
    pending = 0;
  return function paced(load) {
    if (pending >= limit) return Promise.reject(Error("Connector is busy."));
    pending++;
    const turn = tail.then(async () => {
      const remaining = next - now();
      if (remaining > 0) await wait(remaining);
      next = now() + interval;
    });
    tail = turn.catch(() => {});
    return turn.then(load).finally(() => pending--);
  };
}
