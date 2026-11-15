# Asset charts and contextual readers

Research, Portfolio, Buybacks and selected Capitol assets share the same read-only asset-context reader. The compact dock does no work until a reader opens. Its native dialog owns focus and scroll; closing it restores the underlying chart and page. Published Journal snapshots are public; research jobs and private scenario sets remain scoped to the authenticated account. Re-rendering a workspace retains the dock and its reader when the selected asset is unchanged. Reading never starts an AI job or spends a BYOC budget.

## Historical navigation

Display ranges are independent of loaded history. The existing Yahoo chart connector supports a validated `before` cursor on `/api/history`. A request returns at most 2,500 real observations, with a strictly descending next cursor. Batch sizes are five days of 5-minute bars, 21 days of 15-minute bars, five years of daily bars, and 20 years of weekly bars. The daily and weekly maximum depends on the listing's actual available history; intraday requests stop at a conservative 59-day retention boundary. No quotes, candles or dates are fabricated to fill unavailable periods.

EUR/USD conversion uses historical completed FX observations for the entire OHLC bar. An earlier page whose currency or resolution differs from the displayed data is rejected rather than appended. FX availability can restrict the depth available in a converted currency; the native supported currency may have more history. Candlestick mode falls back to real closing prices when OHLC is unavailable. Modeled buyback curves, strategy outcomes and return comparisons remain lines.

The shared history browser backfills near the left boundary or via **Earlier**. A pending page waits until an active drag or drawing edit ends. Its merge uses the then-current timestamp viewport, never the viewport captured at request time. Changed assets, ranges, slots and destroyed charts invalidate pending results. Restoring an older saved view fills contiguous pages before displaying it. Views, including chart style, continue using the existing per-account CAS/live-sync mechanism. Fit on expanded data saves explicit bounds; selecting a range returns to its recent window.

A view is bounded to 30,000 observations and restoration to 24 sequential pages. Initial data has a one-minute cache; historical batches have a one-day cache. Client caches retain 48 entries and server history caches retain 64 entries each, with bounded concurrent requests. Lines render at most roughly 1,200 sampled real points while crosshairs retain full resolution. Candles use four batched SVG paths instead of one DOM node per bar. The vertical automatic scale uses visible data and reference levels.

## Security and verification

Market URLs are fixed provider hosts; symbols, ranges, currencies and cursors are validated before I/O. Redirects are rejected. Timeouts, a 4 MiB streamed JSON limit and observation limits bound upstream work. Source links are restricted to credential-free HTTP(S), including legacy records rendered in scenario evidence. API authorization, origin checks, account scoping and spending controls are unchanged and covered by the broader integration tests.

`tests/history-pagination.test.js` covers retention/inception, empty pages, cursor validation, FX window matching, chronological merges, restoring old windows, delayed pages during gestures, stale responses, honest candles, visible scales, byte limits and source-link protocols. Existing chart-sync and context-reader suites cover account isolation, concurrent edits, published snapshots and stale reader requests.
