/** One cancellable long-poll per visible chart; reconnects with revision cursors. */
export function createChartWatch({
  sync,
  request,
  ownerId,
  symbol,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let running = false,
    generation = 0,
    abort = null,
    timer = null,
    failures = 0;
  async function next(epoch) {
    if (!running || epoch !== generation) return;
    abort = new AbortController();
    try {
      const response = await request(
        "/api/chart-workspaces/watch?symbol=" +
          encodeURIComponent(symbol) +
          "&revisions=" +
          sync.revisions().join(","),
        "GET",
        undefined,
        { ownerId, signal: abort.signal, timeout: 35000 },
      );
      if (!running || epoch !== generation) return;
      sync.receive(response.slots);
      if (failures) sync.resume();
      failures = 0;
      sync.connection("live");
      timer = setTimer(() => void next(epoch), 50);
    } catch (error) {
      if (!running || epoch !== generation) return;
      sync.connection("reconnecting");
      if (error.status === 401 || error.status === 403) {
        running = false;
        return;
      }
      timer = setTimer(
        () => void next(epoch),
        Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)),
      );
    }
  }
  return {
    start() {
      if (running) return;
      running = true;
      failures = 0;
      void next(++generation);
    },
    stop() {
      running = false;
      generation++;
      abort?.abort();
      clearTimer(timer);
      timer = null;
    },
  };
}
