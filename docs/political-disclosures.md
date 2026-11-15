# Political disclosures / Capitol

Capitol is a free, account-authenticated research surface. It imports the published
rolling dataset from [Kadoa Congress Trading Monitor](https://github.com/kadoa-org/congress-trading-monitor),
which parses House Clerk PTRs, Senate eFD reports, and executive-branch OGE filings.
The feed is not a complete historical archive. At implementation time (15 November
2026), its `trades.json` contained 5,000 rows filed from 18 August to 12 November 2026.
The application calculates and displays its current coverage from the actual rows.
Upstream's complete continuous historical dataset is a separate commercial offering;
Reentry does not claim to provide that coverage.

## Why this connector

- [Capitol Trades](https://www.capitoltrades.com/disclaimer) describes collecting House
  and Senate disclosures. Its site is not used as a scrape or unofficial API.
- [LuxAlgo Market Trackers](https://github.com/LuxAlgo/market-trackers) provides typed,
  primary-source-linked CC0 dumps. The inspected congress snapshot was only 175 rows,
  last ingested 7 September 2026, so it was not chosen as the current feed.
- Kadoa's openly published MIT repository provides a fresher rolling snapshot,
  stable row/member IDs, official filing links, ranges, and a separate filer index.
  No key, paid request, broker connection, or AI processing is needed to import it.

## Semantics

The [House Ethics Committee](https://ethics.house.gov/financial-disclosure/) and
[Senate Ethics Committee](https://www.ethics.senate.gov/public/index.cfm/financialdisclosure)
explain transaction-reporting obligations. Reports are generally due within 30 days
of notification and no later than 45 days after a covered transaction. Filing and
transaction dates are distinct. Filing date is not verified first-publication time,
and we do not label reporting lag alone as an adjudicated violation.

Amounts are disclosed **USD ranges**, never exact execution amounts. No midpoint
portfolio, performance ranking, implied holdings, insider-trading allegation, or
buy recommendation is derived. A row identifies its reported owner where available;
missing owners, tickers, and values remain missing. Equities, funds, options, bonds,
and unlisted assets can all appear. Asset descriptions and comments remain available
with the original filing. Chart prices default to EUR; USD filing bands stay USD to
preserve what was disclosed.

The normalized dataset's MIT license does not override underlying disclosure-use
rules. Official reports restrict uses including commercial uses outside news/media
reporting, credit decisions, and solicitations. This feature reports public filings
for personal research and the platform's informational publishing. Reassess permitted
use before repackaging or selling the records. Source references:
[House public access](https://ethics.house.gov/manual/retention-of-and-public-access-to-reports/),
[OGE public resources](https://www.oge.gov/web/oge.nsf/publicresources_disclosure-faq).

## Reliability and privacy

- Every six hours, one shared server worker fetches the latest data revision. Both
  JSON files are pinned to the same commit. On-demand cold loads use the same job.
- Bounded responses, fixed HTTPS endpoints, strict official-document host allowlist,
  valid date/range checks, stable-ID deduplication, and rejection thresholds protect
  the cache. An invalid replacement never replaces a good snapshot.
- The last validated snapshot persists in SQLite and survives deploys/restarts.
  Outages show cached/unavailable state; old latest-filing dates show delayed state.
- Filtered results and counts are calculated on the server from that snapshot.
  Pagination pins its version and restarts if the snapshot changes.
- Holdings/watchlist scopes use only the authenticated account. Public-source fetches
  do not transmit the user's holdings or list names to Kadoa/GitHub.
- Research automatically receives up to eight matching disclosures as filing evidence.
  Existing AI research/source-monitor workflows still require the account's own BYOC
  key, opt-in, and budget reservations. Importing data itself incurs no AI charges.
- Watchlists are independent account-owned containers. Membership changes commute;
  reorder/rename/delete use revisions. Removing a list never deletes a holding,
  source, scenario, analysis, or research asset. Watchlists are included in export.

## Portraits

Congress photos use the [United States project's public-domain portraits](https://github.com/unitedstates/images),
matched by the provider's Bioguide photo URL. Only its exact photo URL pattern is accepted.
Known executive portraits are bundled from the official sources listed in
`public/people/CREDITS.md`. Missing/unavailable portraits fall back to initials;
identities are never guessed from a name search.

## Operations

`ENABLE_BACKGROUND_JOBS=true` enables the existing worker lifecycle and the shared
political refresh. No new secret/environment variable is required. `political_feed`
is a replaceable public-data cache; `watchlists` and `watchlist_preferences` are durable
private account data. Migration 5 only creates these new tables and an index.
