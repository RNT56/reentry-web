# Capitol return estimates

A **price-return estimate**, not reported profit, total return, net worth, or full-career earnings. Public disclosure records and public market prices only; no AI or account data is used.

## Model

- Use the available corrected disclosure record from 2012 onward, independently of the disclosure-list filters. Stop at the last completed calendar day, or the recorded congressional service end for former members.
- Support listed USD stocks and funds only. Verify the provider's returned symbol, instrument, currency and issuer name against the disclosure. Reject uncertain issuer matches (including reused tickers), options/exercises, debt, transfers, missing symbols and unbounded amounts. A missing amount, exchange/transfer or missing execution price invalidates the affected owner/asset lot chain.
- Fetch daily Yahoo close prices since 2012, not the downsampled chart range. These are split-adjusted closes; dividends are excluded. A non-trading transaction date can use the next available close within four calendar days. Valuation requires a close within seven calendar days of the cutoff. Provider failure does not create synthetic prices or a zero gain.
- Reconstruct FIFO lots independently for each reported owner and ticker; brokerage accounts within that owner are pooled. Purchases acquire `assumed dollars / split-adjusted close` units. Sales consume known FIFO lots. Sales beyond known inventory have no estimated profit and never create short positions. Same-day sales precede same-day purchases because intraday ordering is unknown.
- A declared full sale closes all reconstructed lots at that day's close, rather than leaving phantom shares because of an arbitrary amount midpoint. Other sales use the assumed reported amount. This is a model of remaining holdings, not a claim that those holdings still exist.
- Run three independent scenarios: every transaction at its lower band, midpoint or upper band. These are sensitivity assumptions, **not bounds or confidence intervals**. Aggregate gain can be negative and need not increase with the selected band.
- `gain = matched-sale gain + remaining-lot price gain`. `gainOnBuys` divides by cumulative modeled purchase dollars; it is not annualized, time-weighted or money-weighted. Taxes, fees and dividends are excluded.
- Salary comparison uses the displayed annual role rate multiplied by elapsed modeled days / 365.2425. It is a constant-rate benchmark, not reconstructed historical pay. The officeholder's salary is compared with explicitly reported owners, which can include spouse/dependents. No prior-career income is invented.

## Delivery and reliability

`GET /api/politics/returns?member=...` is authenticated. It returns queued/calculating/ready/partial/stale/unavailable status, progress and the last available result. Only valid directory members may enqueue work. A process-wide queue coalesces viewers, caps queued people at 20 and limits simultaneous historical-price requests to three. Price and result caches are shared public data in two new SQLite tables (migration 8); no existing user tables are changed.

Fresh price histories/results are reused for 12 hours. Changed disclosure inputs invalidate the result; prices remain reusable. Missing prices back off one hour. A complete provider outage retains an older good estimate with a stale label and its original calculation timestamp. Restart loads caches rather than downloading again. The UI polls job status only while calculating, suspends while hidden, and cancels on profile exit. Source feeds retain their existing 12-hour schedule.

The amount controls, gain/salary bars, loss direction, per-asset contributions, price dates, owners, unmatched sales and exclusion counts are inspectable in the profile. Both comparison bars use the same linear USD scale. Empty, pending and cached results never masquerade as completed calculations.

## Primary references

- [House financial-disclosure rules](https://ethics.house.gov/financial-disclosure/): transaction reporting includes reportable family holdings and amount categories; sales disclose proceeds, not gains.
- [Yahoo adjusted-close methodology](https://help.yahoo.com/kb/SLN28256.html): the model deliberately uses close, not dividend-adjusted close.
- [Published pay schedules](https://uscode.house.gov/us/usc/119-136/t5/s5332/): linked individually with the existing salary metadata.

Regression coverage: FIFO, full/partial/unmatched sales, ownership, same-day ordering, losses and all amount assumptions, instrument/price/currency/issuer exclusions, former-member cutoff, daily price normalization, salary period, cache coalescing/restart/corrections/failure backoff, authentication and zero AI spending.
