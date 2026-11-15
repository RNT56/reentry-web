# Political disclosures / Capitol

Capitol imports two complementary public datasets with links back to official House,
Senate and executive-branch records. It requires an account, but no data API key or AI
request. Private holdings/watchlist filters never leave Reentry.

## Sources and reconciliation

- [Kadoa Congress Trading Monitor](https://github.com/kadoa-org/congress-trading-monitor)
  supplies a recent rolling window, including OGE executive disclosures. JSON files
  are pinned to one Git commit; conditional revision checks run every 12 hours.
- [NexusTrade congressional archive](https://huggingface.co/datasets/austin-starks/congressional-stock-trades)
  supplies House/Senate history from 2012. Reentry imports `political_trade_events`
  and `political_filings`, not the unreconciled raw-trades table. Its
  [methodology](https://huggingface.co/datasets/austin-starks/congressional-stock-trades/blob/main/METHODOLOGY.md)
  distinguishes economic events, amendments and when records became available.
  The manifest is checked every 12 hours; unchanged yearly shards are reused.
  Upstream publishes on its own schedule, so checks do not imply new disclosures.
- [OptimistFi](https://optimistfi.com/congress/data) was also evaluated. Its free
  House-only current-year feed includes new/amended/deleted source rows. It is not
  combined blindly with the reconciled archive; that would risk double-counting.

Every archive shard must match the manifest's SHA-256 and size. Only audited v2
manifests, bounded Parquet files and fixed HTTPS download hosts are accepted.
Decoding runs in a temporary worker with a bounded heap per yearly partition.
Superseded event versions and future availability are excluded. Real filing dates
come from the filings table, separately from first-publication timestamps.
Invalid identities, URLs, dates and ranges cannot become evidence. An excessive
rejection rate rejects the replacement and retains the last good snapshot.

The reconciled archive takes precedence for overlapping official documents,
including contributor/original documents referenced by amendments. The rolling
source fills newer/uncovered documents and executive reports. Failed/unparsed
archive filings do not suppress otherwise valid rolling-feed evidence. Duplicate
member aliases and House-to-Senate changes resolve to the same Bioguide identity.
No matching records does not establish that a person never traded.

The 15 November 2026 validation imported 182,269 current historical event records,
including 218 Pelosi records. Published snapshot counts and app counts can differ
because superseded events and invalid records are excluded. This is available
history, not a guarantee of complete lifetime trading activity.

## Interpretation

Amounts are **reported USD bands**, not exact execution amounts. Spouse, joint and
dependent ownership remain attached to each filing. Options, bonds, unlisted assets
and unknown tickers retain their original descriptions. Charts can use EUR, but
original disclosure amounts stay in USD.

The Power struggle bar counts distinct filers with at least one purchase or sale
of the selected ticker in the selected **filing-date** window. It retains chamber
and holdings/watchlist scope, while ignoring selected person, transaction-side and
free-text filters so the comparison shows both sides. A filer on both sides counts
once on each side; this overlap is shown. Disclosed transaction counts are separate
from participant counts. Exchanges and unknown actions are excluded from the bar.
It does not show share quantities, executed market volume, or a predictive signal.

Profiles show available-history purchase ranges and sale-proceeds ranges alongside
sourced political base salary. **Sales are not profits.** Disclosures do not provide
complete cost bases, full holdings or lifetime realized gains; no fictional career
return or net-worth figure is generated. Executive salaries are explicitly labeled
2026 role benchmarks, because scheduled pay, actual frozen pay and former
appointment dates can differ. Salary sources: [2026 schedules 5–6](https://uscode.house.gov/us/usc/119-136/t5/s5332/)
and [presidential compensation](https://uscode.house.gov/us/usc/119-136/t3/s102/).
Congress terms and role metadata are attributed to the
[United States project](https://github.com/unitedstates/congress-legislators),
retrieved 15 November 2026. Tenure dates are not used to invent cumulative salary.

## UI and portraits

All matching people are included in the scroll rail. With unrestricted asset/side
scope, matching people with no disclosures in the selected period remain visible
with zero counts. The directory also contains the full merged identity catalog.
Opening a profile preserves filters, page scroll and horizontal rail position;
the pinned back control restores that context.

All 550 distinct people in the verified catalog have bundled real portraits.
Bioguide IDs identify Congress portraits; ambiguous executive names are explicitly
resolved (e.g. CIA director William Burns, FAA administrator Michael Whitaker,
OMB official Jason Miller, and Sara Carter Bailey). No generated faces are used.
The static catalog records source links and licenses. Public portrait credits at
`/people/credits.html` include CC BY-SA attribution where applicable; images are
unaltered and display crops are CSS. Future Congress IDs can use the provider's
strictly allowlisted official-portrait URL until bundled; newly added identities
require source verification before a missing photo is assigned.

## Reliability, data preservation and AI

Both sources refresh automatically every 12 hours. Existing healthy caches adopt
the longer interval on restart. Manual recent-feed checks remain available;
source rate limits and failure backoff still apply. Open pages check cached server
status every 15 minutes and when revisited.

ETags, retry backoff and last successful checks persist in SQLite. Rate-limit
Retry-After is respected. Downloads have time/size/redirect limits. Snapshot
replacement is atomic; source failures serve cached data. Archive partitions that
unexpectedly disappear are rejected. The UI exposes source/coverage status and
keeps current charts/expanded rows intact when updates arrive.

Migration 7 adds only `political_archives`, a replaceable public cache. It changes
no accounts, holdings, chart workspaces, scenarios or watchlists. Background
refresh uses the existing `ENABLE_BACKGROUND_JOBS=true` worker lifecycle; no new
secret is needed. The account-authenticated API scopes private filters to the
signed-in user, and pagination pins the merged snapshot version.

Research receives up to eight recent relevant disclosures as evidence. Existing
AI research and source monitors retain BYOC consent, key isolation and spending
reservations. Importing public data incurs no model charges.

Official-record use restrictions remain applicable, irrespective of a normalized
feed's software license. See the archive's
[data terms](https://huggingface.co/datasets/austin-starks/congressional-stock-trades/blob/main/LICENSE_DATA.md),
[House public access rules](https://ethics.house.gov/manual/retention-of-and-public-access-to-reports/)
and [OGE resources](https://www.oge.gov/web/oge.nsf/publicresources_disclosure-faq).
Kadoa's MIT notice remains in `public/people/KADOA-DATA-LICENSE.txt`.
