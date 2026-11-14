# Chart analysis calculations

## Research workspace

Each signed-in account has three independent saved analyses per asset. An analysis stores its name, range, EUR/USD currency, linear/log scale, line/candle preference, indicator selection, viewport, and up to 40 drawings. Save persists explicitly; switching slots first saves outstanding changes. Route changes retain account-scoped drafts in memory. Leaving the page warns about the signed-in account's unsaved drafts.

The drawing toolbar provides trend lines, horizontal levels, Fibonacci retracements, measurements, and notes. Click/tap anchors on the chart, or use arrow keys and Enter on the focused chart. Selected anchors can be dragged; Edit provides precise dates, prices, labels, and color. Undo/redo retain 30 steps. Zoom, pan, and Fit control the observed window. Drawing tools and Save pin below Research navigation while scrolling, except in short viewports.

Charts use cached market history and local calculations; these tools consume no AI credits. Candles and volume appear only when genuine source observations exist. Indicator warmup gaps remain empty. Historical currency conversion updates drawing anchors atomically with the data; failed conversions retain the previous state.

Storage uses authenticated `/api/chart-workspaces` endpoints and the additive `chart_workspaces` table. Ownership is enforced in every SQL operation. Revision checks and deletion tombstones prevent concurrent tabs from silently overwriting an analysis. Conflicts preserve the local draft and offer an explicit reload through Manage. Existing portfolio, account, passkey, and AI credential data are not rewritten.

## Indicator definitions

`src/domain/technical-analysis.js` contains pure, aligned indicator series. `technicalIndicators(points)` returns `sma20`, `sma50`, `sma200`, `ema20`, `bollinger: {middle,upper,lower}`, `rsi`, `macd: {line,signal,histogram}`, and `volume`.

Each array index maps to the corresponding supplied bar. Time must increase strictly. A bar uses `price` or `close`; a missing close is an explicit gap. Invalid non-finite or non-positive closes are rejected. Every gap resets the contiguous indicator warmup. Periods count bars, including intraday or weekly bars; they do not imply calendar days. Volume is the supplied raw observation, with missing values kept null.

- SMA uses the trailing arithmetic mean, beginning after a complete period.
- EMA uses smoothing factor `2 / (period + 1)` and starts with a complete-period SMA seed.
- Bollinger uses a trailing 20-bar SMA and two population standard deviations. Rolling central moments avoid the large-number cancellation of `mean(square) - square(mean)`. The lower band can mathematically be below zero; log-scale plotting must omit non-positive values.
- RSI uses Wilder's initial 14-change averages and subsequent `(previous * 13 + latest) / 14` smoothing. It first appears after 15 closes. A fully flat window is represented as neutral 50; gain-only and loss-only windows are 100 and 0.
- MACD uses EMA12 minus EMA26, with an EMA9 of the valid MACD line as the signal. Histogram is line minus signal. The first line needs 26 closes and the first signal/histogram needs 34 closes.

All calculations use current and earlier bars only. They contain no future confirmation, synthetic observations or trade recommendations. EMA/RSI results near the beginning can differ from chart providers which fetch additional hidden warmup history or use another seed.

`fibonacciLevels(a,b)` returns ratios 0, .236, .382, .5, .618, .786 and 1. The drawn A→B move defines direction: 0% sits at B and 100% returns to A. `measureRange(a,b,points?)` reports signed price change and percentage points, absolute elapsed seconds/days, and observed bar intervals between the nearest supplied timestamps when history is provided. Measurements do not infer missing trading days or forecast observations.

Reference definitions: [Fidelity RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi), [Fidelity Bollinger Bands](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/bollinger-bands), [Fidelity MACD](https://www.fidelity.com/webxpress/help/topics_nb/help_definition_m.shtml), [Bollinger's own explanation](https://www.bollingerbands.com/bollinger-bands). Tests verify the classic Wilder numerical example, independent averaging/variance arithmetic, warmup alignment, gap handling, future-data invariance and drawing measurements.

## Drawing currency conversion

`src/domain/chart-currency.js` converts each drawing anchor using the ratio of the asset's target-currency and source-currency closes at an exact common historical bar timestamp. It uses the last common bar at or before the anchor time, so it never applies a future rate. It rejects anchors before common history begins or more than seven calendar days beyond the latest common observation. Converted prices must be positive, finite and at most 10¹². The function returns fresh drawings and anchors; original state, labels, colors and timestamps remain intact. Currency switching should only commit the converted state after both histories succeed.
