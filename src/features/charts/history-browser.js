import { fetchPriceHistory, mergeHistory } from "./history-data.js";
import { observationTime } from "../../domain/chart-viewport.js";

export const historyBrowserMarkup =
  '<span class="chart-history"><button type="button" data-chart-earlier aria-label="Load earlier price history">Earlier</button><span data-chart-history-status role="status"></span></span>';

/** Backfill never replaces the chart, cancels a gesture, or reuses a stale viewport. */
export function mountHistoryBrowser(
  root,
  { read, apply, fetchHistory = fetchPriceHistory },
) {
  const button = root.querySelector("[data-chart-earlier]"),
    status = root.querySelector("[data-chart-history-status]");
  let disposed = false,
    pending = null,
    loading = false,
    failure = "",
    requestId = 0,
    source = null,
    sourceKey = null;
  function paint() {
    const current = read(),
      paging = current.data?.paging;
    button.disabled = loading || current.busy || !paging?.before;
    button.hidden = false;
    button.textContent = loading ? "Loading…" : failure ? "Retry" : "Earlier";
    button.title = failure || "Load earlier prices without changing this view";
    status.textContent = failure ? "Unavailable" : "";
    if (paging && !paging.before) {
      button.textContent = "Limit";
      button.title = paging.boundary || "Start of available history";
    }
  }
  function update(auto = true) {
    if (disposed) return;
    const current = read();
    if (source !== current.data || sourceKey !== current.key) {
      source = current.data;
      sourceKey = current.key;
      pending = null;
      loading = false;
      failure = "";
      requestId++;
    }
    if (pending && !current.busy && !current.interacting) {
      const page = pending;
      pending = null;
      try {
        const viewport = current.state.viewport || {
          from: observationTime(current.data.points, current.geometry.start),
          to: observationTime(current.data.points, current.geometry.end),
        };
        const merged = mergeHistory(current.data, page);
        source = merged;
        apply(merged, viewport);
      } catch (e) {
        failure = e.message;
      }
    }
    paint();
    const { data, state, geometry, busy, interacting } = read();
    if (
      auto &&
      !failure &&
      !loading &&
      !pending &&
      !busy &&
      !interacting &&
      data?.paging?.before &&
      state.viewport &&
      geometry &&
      geometry.end < data.points.length - 2 &&
      geometry.start < Math.max(2, (geometry.end - geometry.start) * 0.12)
    )
      void earlier();
  }
  async function earlier() {
    const current = read();
    if (
      disposed ||
      loading ||
      current.busy ||
      !current.geometry ||
      !current.data?.paging?.before
    )
      return;
    source = current.data;
    sourceKey = current.key;
    const requestedData = source,
      requestedKey = sourceKey;
    const id = ++requestId,
      cursor = source.paging.before;
    loading = true;
    failure = "";
    paint();
    try {
      const page = await fetchHistory(
        source.symbol,
        source.range,
        current.state.currency,
        cursor,
      );
      if (
        disposed ||
        id !== requestId ||
        read().data !== requestedData ||
        read().key !== requestedKey
      )
        return;
      if (page.paging?.before >= cursor)
        throw Error("Earlier history is temporarily unavailable.");
      pending = page;
    } catch (e) {
      if (id === requestId) failure = e.message;
    } finally {
      if (!disposed && id === requestId) {
        loading = false;
        update(false);
      }
    }
  }
  button.onclick = (event) => {
    event.stopPropagation();
    void earlier();
  };
  paint();
  return {
    update,
    destroy() {
      disposed = true;
      requestId++;
      pending = null;
      button.onclick = null;
    },
  };
}
