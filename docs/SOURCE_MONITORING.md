# Private source monitoring

Source monitoring reviews evidence already collected for an asset and compares it with the last successful review. It uses the account's selected Gemini or Claude model and encrypted BYOC credential. It does not fetch arbitrary URLs, execute provider tools, publish content, alter price targets, or verify events.

## User flow

The Research workspace presents a **What changed** feed alongside the asset's sources. A manual review previews its maximum reservation before queuing. **Watch sources** opts the asset into recurring review; the setting starts off. Users can choose the private trees included in the review, inspect cited evidence and previous evidence, open a linked branch, and dismiss or acknowledge suggestions.

A completed review distinguishes reported developments from interpretations and links evidence to a branch as supporting, challenging, invalidating, or contextual. These are AI suggestions, separate from verified observations. Recording an event still requires the account owner to inspect the evidence, supply its occurrence time and source, and explicitly verify it. News attached to a daily-close chart scenario is context only; price observations continue to use the existing chart evaluator.

## Evidence and ownership

- Only the authenticated owner's stored sources and selected private scenario sets for the exact asset enter the prompt. Portfolio quantities and cost basis, credentials, other accounts, and unpublished author content are excluded.
- Published article scenario sets are excluded. A reader's independently created private copy may be selected.
- Eligible source changes include headlines, filings, fundamentals, and private source notes. Quote and technical-snapshot churn does not trigger recurring paid analysis.
- Each job freezes the selected evidence and tree conditions. Citations resolve against this snapshot even after connector history is pruned.
- Comparisons cite the prior snapshot's evidence, not the previous model's opinion. A changed tree scope starts a fresh comparison rather than inventing a source change.
- The schema bounds results to six changes and twelve branch links. Local validation rejects unknown citations, links to unknown branches, unsupported invalidation links, duplicate links, and changes without newly reviewed evidence.

Sources, titles, scenario conditions, and previous model output are untrusted data. The prompt explicitly separates them from instructions. Headline metadata is not represented as a full article, and a publication timestamp is not treated as the event's occurrence time.

## Automation and cost

Automatic review is independent from free connector collection and the existing scheduled full research briefs. It runs at most once every six hours per enabled asset when eligible evidence or selected tree context changes. Unchanged snapshots create no model request. The snapshot identity is stable across polling, restarts, and retrieval timestamps.

Every source-monitor job uses the shared persisted AI queue and cost ledger. The maximum reservation includes the bounded prompt, output schema, and output token ceiling. It counts against the same per-run and monthly limits as research and chart analysis, including outstanding uncertain holds. Default account limits remain $5 per month and $0.25 per run. The account's consent, model, key, settings, and budget are checked again before dispatch.

Valid provider usage is recorded even if the response is malformed or fails evidence validation. Ambiguous dispatched calls retain their reservation. The scheduler does not automatically repeat a failed paid request for the same snapshot. Previously completed reviews remain available when a later review fails, a key is removed, or the budget is exhausted.

Removing an asset with its Research × persists an owner-specific visibility preference, including for portfolio-derived assets. It pauses both paid schedules, cancels queued asset jobs, and blocks undispatched paid calls. Already dispatched requests retain normal usage reconciliation. Holdings, saved chart analyses, sources, scenarios, and completed jobs remain intact; free source collection continues for assets still held. Undo or Find an asset restores visibility without re-enabling either paid schedule. Portfolio × uses a separate confirmation before removing that holding's purchase entries.

Cost values are provider list-price estimates. The ledger cannot observe calls made outside Reentry or reconcile provider-specific credits automatically.

## Provider contract

The feature uses the existing direct provider adapters with an explicit JSON schema and no paid search or other tools. The provider contracts were checked against [Gemini structured outputs](https://aistudio.google.com/docs/structured-output) and [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) on 2026-11-14. Schema compliance is followed by application-level ownership, evidence, and branch validation.

## Operations

New monitoring state is additive to the existing SQLite database. Background jobs use the existing `ENABLE_BACKGROUND_JOBS` switch and owner pause control. A deployment does not enable monitoring for existing accounts. Preserve the existing external Docker volume and AI master key.

Tests cover evidence changes, ownership, published-tree exclusion, snapshot deduplication, budget boundaries, key removal, dispatch interruption, and the separation of suggested links from verified events. Browser QA uses synthetic accounts, sources, prices, and provider responses; it does not spend a user's BYOC budget.
