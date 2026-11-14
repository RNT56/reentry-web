# Private AI chart analysis

Research has a separate AI analysis layer beside the three manual analysis slots. Gemini or Claude receives a bounded snapshot of the selected asset's completed daily bars and computed indicators. Results remain private to the requesting account. AI overlays are stored in `ai_jobs.result`; manual drawings stay in `chart_workspaces`. A completed analysis with scenarios creates a private `scenario_sets` record with `provenance.kind = 'ai-chart'`, its job ID, model, and chart snapshot hash. Author articles and public scenarios are never changed by this workflow.

## Context and validation

`server/ai/chart-contract.js` builds 1M, 3M, or 1Y snapshots in EUR or USD from server-fetched market history. At least 20 and at most 260 completed daily bars are required. The provider receives genuine available OHLC/volume, the latest trailing technical indicators, source, exchange timezone, observation times, coverage, and a SHA-256 hash. Missing observations are never fabricated. Current market-local-day bars are excluded; unavailable exchange zones use a conservative 48-hour completion delay.

The prompt contains chart evidence only: no holdings, account data, user drawings, articles, private notes, credentials, or research sources. Provider output is a strict bounded JSON contract: at most eight overlays and four scenarios. Anchor timestamps must match supplied historical bars; prices must stay within finite, proportionate bounds. Scenario/overlay references must be reciprocal. Trigger and invalidation conditions are normalized from numeric daily-close thresholds, rather than executable model-authored prose. Invalid output creates neither partial overlays nor a partial tree.

## Request and cost lifecycle

1. `POST /api/chart-analysis/estimate` accepts `{symbol, range, currency}` and returns an immutable account-bound five-minute preview with the exact model, snapshot summary, budget, and maximum cost. It makes no paid provider call and creates no ledger hold.
2. `POST /api/chart-analysis` accepts `{quoteId, requestKey}`. A preview is consumed once. Repeating the same key and quote returns the original job; reusing either for a different request is rejected.
3. The existing worker dispatches the pinned provider/model with the account's encrypted BYOC credential. It uses the quoted snapshot without refetching it. Disabled AI, removed keys, changed model settings, a snapshot older than fifteen minutes, scenario capacity, or reduced spending limits stop dispatch.
4. Before dispatch, the worker reserves a conservative maximum covering prompt bytes, structured-output schema bytes, provider overhead, and the output-token bound. Current per-run and monthly limits are rechecked transactionally. Pricing increases above the preview's maximum require a new preview.
5. Confirmed usage is settled before refusal, truncation, JSON parsing, or content validation. Unconfirmed usage retains its hold for reconciliation. Paid calls are never retried automatically.

Money fields use integer micro-USD. The account's existing usage ledger includes chart jobs alongside research and article mapping. Creating or viewing overlays, toggling layers, and tracking scenario outcomes require no additional model calls.

## API

All endpoints require the account session and inherit private `no-store` responses. Mutations require the existing same-origin request protection.

| Endpoint                              | Result                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/chart-analysis?symbol=INTC` | Latest twelve account-owned chart jobs and current readiness, model, and budget |
| `POST /api/chart-analysis/estimate`   | Quoted snapshot and maximum cost                                                |
| `POST /api/chart-analysis`            | Queued job ID and status                                                        |
| `GET /api/chart-analysis/:id`         | Exact snapshot, validated result, linked set ID, and usage ledger               |
| `DELETE /api/research/jobs/:id`       | Cancels an account-owned queued job before dispatch                             |
| `GET /api/scenarios/:id`              | Account-owned scenario set, including sets outside the latest-sixty list        |

## Tracking and practical limits

`server/intelligence/chart-observations.js` checks exact completed daily closes in the branch currency. Intraday quotes and current session candles cannot trigger or invalidate a chart scenario. Occurrence is recorded at the next market-local midnight, a conservative bound for a known-complete session; the publication session is skipped to avoid presenting an earlier close as a later outcome. Without an exchange timezone, completion waits forty-eight hours. Automatic checks use market history and retain occurrence time separately from the time the system learned the observation.

Analysis describes the supplied historical window. It does not receive screenshots, intraday order books, news, fundamentals, or earlier private analyses. Historical FX availability controls whether a requested EUR/USD snapshot can be created; a mismatched native-currency series is rejected. Indicators with insufficient warmup retain null values. Provider pattern interpretations and conditional target ranges remain distinguishable from subsequently observed daily-close outcomes.

Integration tests cover account isolation, direct scenario ownership, immutable preview consumption, idempotency, spending changes, cancelled jobs, revoked credentials, stale snapshots, both provider schemas, invalid paid output, preserved manual drawings, and uncertain usage without paid retries.
