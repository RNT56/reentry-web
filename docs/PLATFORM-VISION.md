# Reentry: the asset is the workspace

Reentry connects what you own, what you think could happen, and what actually happens. The buyback calculator is the first decision tool inside that workspace. The wider product is a visual research and personal-finance platform with a public, accountable investment journal.

**Shipped now:** private portfolios, acquisition lots, after-tax planning, price history with live buy-in/target overlays, trade records, accounts/passkeys, private asset research, source collection, BYOC Gemini/Claude jobs with cost controls, sentiment samples, conditional scenario maps, author editing and immutable public journal editions. See [the implementation contract](INTELLIGENCE.md) for ownership boundaries, coverage, and operational limits.

**Next products:** historical replay, corporate-action adjustment, composite condition graphs, alerts, wider licensed data coverage and portfolio performance attribution. The shipped scenario evaluator uses sampled prices and human-verified events; AI proposes event matches for review. There is no autonomous trading. The former fictional Explore preview has been removed.

## The experience

An asset page brings five views into one persistent context:

| View | What dominates the screen | The useful action |
| --- | --- | --- |
| Overview | Price, event markers, thesis ranges, position context | See what changed since the last visit |
| Research | Source-backed metric cards, trend lines, sentiment distributions | Inspect the evidence behind a claim |
| Scenarios | Branching conditional outcomes over a price/time chart | Compare possible paths with observed reality |
| Journal | Short original articles and dated follow-ups | Read the reasoning and jump to its branch |
| Position | Your lots, allocation, exposure, tax-aware planner | Apply a thesis to your own position privately |

The selected listing and currency remain visible. An issuer's thesis may apply to several listings, but portfolio cost basis and chart prices always belong to a specific listing/currency. An Intel article must not silently mix an EUR holding with a USD forecast.

The chart is the common visual language: price is a solid line; conditional futures are dashed branches and ranges; evidence is a dated event marker; your cost is blue; a buyback ceiling is green. Observed, disputed, invalidated, and unresolved paths have labels and shapes as well as colors. Do not imply statistically calibrated probabilities with the width of a decorative cone.

## Navigation, now and as the platform grows

Today: **Portfolio · Buybacks · Research · Settings**. Research contains asset briefs, scenario maps, the RNT journal, and an author-only studio. The public journal also has independent, server-rendered `/journal` pages. Hash routes and holding IDs support reloads, browser back/forward, and direct links; the existing `#/explore` route now opens Research.

As activity and finance features expand, evolve toward four primary destinations:

- **Portfolio** — private overview, depots, holdings, cash and allocation. Open a holding to its asset workspace; the Reentry planner lives in Position. Grow into net worth, contributions, dividends, tax lots, performance and concentration here rather than adding unrelated top-level tabs.
- **Explore** — universal asset search, watchlists, research and catalyst radar. Open any asset, even if you do not own it. Scenarios are an asset view, not a second disconnected asset database.
- **Journal** — the owner's public articles, strategies, and follow-ups. Reading needs no account. Publishing controls are visible only to explicitly authorized authors. A personal private notebook can reuse the editor with a different visibility boundary.
- **Activity** — completed trades, pending buybacks, followed-thesis changes and evidence requiring review. Use a clear Trade/Research filter, without mixing orders with notifications.

Settings moves behind the account avatar and an accessible account menu on mobile. The four primary destinations fit a bottom bar; desktop uses the same information architecture. Asset tabs sit inside the page. Contextual actions belong beside the chart or in a bottom sheet, not in an expanding global menu.

Suggested canonical URLs once server-rendered public pages ship: `/assets/:listingId/scenarios`, `/journal/:slug`, `/journal/:slug/revisions/:revisionId`, `/portfolio`, `/activity`, `/studio`. Old planner links continue to resolve. Public articles and their public scenario projections must never require loading the private workspace state.

## Your Intel example, made concrete

1. Write a short article that says: if a specified launch is delayed, a downside range becomes plausible within a defined horizon. The article links sources and states an invalidation condition.
2. Select the passage. A **Map this thought** action opens a structured card: asset/listing, IF conditions, THEN range and currency, time window, evidence requirements, invalidation rule, and optional author-assigned confidence. The system can propose these fields; you approve the mapping.
3. Publish one immutable article revision and its scenario revision together. The chart now displays the range, the trigger, and the deadline. Readers can inspect the exact passage that created it.
4. New observations arrive. A price touch satisfies only a price observation. It does not prove that the predicted cause occurred. Verified event evidence may activate a branch; contradictory evidence may invalidate it. Missing coverage stays unknown.
5. Write a follow-up: a verified design win **and** available capacity would enable another range. That adds a dated branch or a superseding revision; it does not rewrite the earlier thesis into a successful forecast.
6. Drag the **knowledge-time replay** to a prior date. See only what had been published or ingested then, with the contemporaneous price path. Compare the original hypothesis, later revisions, and observed outcomes.

The current implementation covers writing, explicit mapping review, immutable publication and present-day evidence evaluation. A future historical replay must hide unpublished revisions entirely and preserve the distinction between event time and knowledge time.

## Distinctive controls worth building

**Thesis scrubber:** slide through knowledge time; branches, article revisions, event markers and price observations move together. A “today / then” split lets a reader compare the evidence available at publication with later knowledge.

**Sentence → branch:** select a passage and drag its linked condition card onto the chart. The extraction remains a draft until the author verifies every structured field. Tap any graph node to return to the exact sentence and revision.

**Evidence drawer:** tap an event marker to reveal source, excerpt, event time, ingestion time, confidence and correction history. Start with two lines; expand for detail. Never put a wall of generated text above the chart.

**Scenario lens:** compare downside/base/upside, reveal only the conditions that differ, and overlay your private position or planned entry without publishing it. A branch can be active at the same time as another unless the author explicitly defines them as mutually exclusive.

**What changed:** show a compact visual diff between research runs. Two new sources, one disputed claim, one revised range. Link to the changes, not a regenerated essay.

**Exposure lens:** group shared scenario risks across a portfolio: currencies, counterparties, sector concentration, macro conditions. Keep hypothetical portfolio impacts distinct from historical performance and expected returns.

## Research and sentiment

A provider-independent research job collects licensed price/fundamental/event/news data, normalizes asset identities, and persists source snapshots. AI proposes a structured research draft with citations to those snapshots. A validator rejects unsupported numbers, bad units and missing dates; publication requires author review. Untrusted source text is data, never executable instructions or permission to use tools.

Sentiment should be shown as **distribution + change + coverage + disagreement**, separately for filings, professional news and social sources. Include language, source mix, observation window and deduplication. “No coverage” is not a neutral score; a large number of reposts is not independent corroboration. Do not invent an all-knowing buy/sell score.

AI confidence, an author's subjective probability, and a statistically calibrated forecast are different things. Label them separately. Only display branch probabilities if an explicit model or author supplied them, with provenance; do not derive them from sentiment or decorative chart geometry.

## Domain model and accountability

| Aggregate | Stable identity and key information |
| --- | --- |
| Asset / listing | Issuer or instrument ID; listing ID; venue; currency; provider aliases; split/corporate-action history |
| Portfolio | Owner ID; depot; lots; trade ledger; cash; version; private permissions |
| Article | Author; slug; draft/public visibility; immutable published revisions; source references |
| Claim | Article revision + passage anchor; structured statement; units; citations |
| Scenario graph | Asset; revision; DAG nodes and edges; conditional groups; publication time |
| Branch | Conditions; target range + currency; horizon; invalidations; optional probability provenance |
| Observation | External deduplication ID; asset; source; event/price type; occurrence time; recorded time; verification/correction state |
| Evaluation | Branch revision; evidence IDs; evaluator version; as-of time; state transitions |
| Research run | Source snapshots; provider/model/prompt versions; budgets; citations; reviewer; execution status |

Use append-only article/scenario revisions and evaluation transitions. Corrections point to superseded observations. Published content does not mutate to match later reality. A price gap can cross a range without an observed trade inside it; a single sampled close cannot prove a touch or a sustained floor. Explicitly distinguish “observed close in range”, “intraday touch”, “sustained threshold” and “no qualifying observation”. Adjust splits and currencies consistently before comparing events with target ranges.

Proposed states: draft → watching → triggered → observed. Invalidated is evidence-driven. An elapsed deadline produces “needs review” when coverage cannot establish an outcome. Unknown, stale, and disputed observations remain visible. Graphs can merge multiple conditions; the UI looks like a tree, but the underlying structure is a directed acyclic graph.

## Public/private boundary

The public blog is **your** publication, not a publishing privilege automatically granted to every registered user. Add explicit author/editor roles or an owner allowlist through an intentional deployment configuration. Existing users retain private portfolio accounts without gaining publishing rights. Never silently designate the first account as administrator.

Publish a deliberately projected article/scenario DTO, not a serialized user or portfolio object. Public readers may see thesis ranges and public evidence; they never receive quantities, acquisition lots, account identifiers, private notes, or private planner targets. Public pages need server rendering, canonical URLs and metadata; private responses remain authenticated and `no-store`. Markdown needs a restricted renderer, URL policy and server-side sanitation before accepting user-authored rich content.

## Product progression

1. **Foundation — shipped:** chart overlays, feature modules, pure financial commands, safe saves, injectable market adapter, numbered migrations and navigation.
2. **Asset hub + journal — shipped foundation:** canonical asset/listing records, watchlists, author roles, draft editor, source links, immutable revisions, public reading pages. No AI needed to make the core publishing loop useful.
3. **Scenario authoring — shipped conditional branches, composite DAGs and replay to come:** structured conditional editor, passage anchors, revisioned DAGs, public graph projection, evaluation records, manual evidence review and replay.
4. **Observation worker — shipped bounded jobs and sampled prices:** durable idempotent job table without automatic retries after billable dispatch; future work includes licensed feed adapters, corporate actions, event deduplication, explicit coverage, alerts and source corrections. Observe price conditions automatically; event claims require well-defined verification.
5. **AI research + sentiment — shipped:** citation-backed drafts, provider/model adapters, budgets and cancellation, evaluations for extraction accuracy, approval before publication. AI is a replaceable research contributor, never the authority that silently edits published claims.
6. **Finance platform:** cash ledger, dividends, contributions, portfolio return decomposition, exposure and risk views, imports and exports, additional private decision tools. Do not derive audited performance from the current holdings snapshot alone.

Start as one modular application and one durable worker on the existing VPS. Extract services only when measured workloads or operational isolation justify them. Research jobs must not run inside HTTP request handlers or block sign-in, saves, or the calculator.
