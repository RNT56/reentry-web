# Reentry engineering boundaries

This release refactors the existing application in place. Portfolio JSON remains **version 1**, the SQLite core remains **schema 1** with additive, independently versioned intelligence tables, and existing API/account contracts are preserved. There is no data rewrite, account reset, ticker remapping or change of persistent volume.

## Module map

| Layer | Location | Responsibility |
| --- | --- | --- |
| Composition | `src/app.js`, `src/app/` | Boot, authenticated workspace, feature wiring, routes, selection, quote refresh |
| Domain | `src/domain/` | FIFO/tax/targets, validated immutable trade commands, portfolio contract, assets, currencies, reference levels, scenario evaluation |
| Features | `src/features/` | Portfolio/purchases, planner, activity, identity, settings, charts, intelligence workspace and author studio |
| Shared browser infrastructure | `src/shared/` | Bounded-time HTTP, serialized save queue, formatting, dialog and icon primitives |
| Visual system | `src/styles/` | Component foundations, responsive rules, identity/workspace, charts, Explore; bundled by esbuild |
| HTTP composition | `server/app.js` | Origin/CSRF boundary, auth, feature route registration, static assets, errors, health |
| Identity | `server/identity/` | Passwords, recovery, sessions, throttles, WebAuthn |
| Portfolio persistence | `server/portfolio/` | Owner-scoped repository and optimistic revision writes |
| Market integration | `server/market/` | Replaceable provider contract, input validation, bounded single-flight cache, Yahoo adapter/normalizer, authenticated routes |
| Database lifecycle | `server/db/migrations.js`, `server/store.js` | Ordered transactional upgrades; reject unsupported newer schemas |
| Delivery | `.github/workflows/`, `deploy/`, `scripts/` | CI, image build, database-copy canary, persistent volume, backups, health/revision checks, image rollback |

Dependency direction is composition → features → domain/shared. Domain modules must not import features, HTTP servers, browser APIs, or fetch; ESLint enforces those restrictions. Feature controllers receive workspace state and named services explicitly. They do not import another feature's controller or reach into its DOM to make calculations. The chart accepts `{buyIn,target,quote}` through `setLevels()`; it never reads planner input controls. Cross-feature composition belongs in the workspace.

The app remains framework-light and bundled. A feature can be replaced without requiring a new SPA framework, changing the finance engine or migrating user data. The current account module remains cohesive; publishing authorization is composed separately from identity in `server/platform/register.js`.

## Chart contract

- History is in the normalized native listing currency. GBp/GBX, ILA and ZAc become their major currency units once in the provider adapter.
- Buy-in is the average of **all current lots including purchase fees**, not the FIFO basis of only the selected sale. Its label/tooltip makes that distinction.
- Buyback is the engine's rounded, affordable ceiling for current quantity, fees, tax, allowance, loss offset, additional shares and whole-share settings.
- EUR levels divide by the matching listing's FX-to-EUR rate for a non-EUR chart. Reject mismatched symbols/currencies, failed quotes, nonpositive FX, or FX older than seven days. Label the conversion and retain its timestamp. This does not reconstruct historical EUR prices or historical purchase FX.
- Include visible levels in the Y extent, even far outside recent market prices. Users can hide individual levels to inspect the price curve. Invalid inputs remove the target; they never retain an old valid target.
- Range changes reuse cached market data; changing a planner input does not issue another market request. Component disposal and generation tokens reject stale range/asset responses. No private cost or target goes to the market provider.

## Save semantics

`createSaveQueue` clones snapshots, serializes writes, coalesces later edits, and advances the server revision after acknowledgement. Multiple flush calls await the same in-flight operation. A failed write retains the newest local snapshot. Network failures allow retry; 401 and 409 pause automatic writes until explicit session/conflict resolution. Before-unload protects pending writes, and sign-out waits for the queue. Users can export unsaved edits before reloading newer server data.

Portfolio saving is not an offline-first database: unsaved portfolio edits remain in memory and can be lost if the browser process is killed. Research charts have a separate account/asset/slot autosave queue with tab-session draft recovery, bounded retries and revision-conflict protection; see [chart analysis](CHART_ANALYSIS.md). Neither path guarantees durable offline storage.

`recordSale` and `recordBuyback` are pure commands: clone → apply rules → validate → return. Failed trades leave the original state untouched. A completed buyback cannot be completed twice. New acquisition lots preserve FIFO history and proportionate fees. Server-side validation and revision checks remain the final boundary.

Quote refresh deduplicates symbols, limits client concurrency to four and rejects results from an earlier account/portfolio generation. Provider requests time out and try a second Yahoo host. Market caches bound entries and concurrent work, share matching in-flight requests, expire data and never retain failures. Public-feed failures do not affect persisted portfolios.

## Replacing a market provider

Inject `createMarketService({provider})`, or provide `marketService` to `createApp()` for a different service/test double. A provider implements:

- `source`: human-readable provenance.
- `search(query)` → normalized assets with exact listing symbols.
- `quote(symbol)` → `{symbol,price,currency,time,exchange,assetType}` in listing units.
- `history(symbol,range)` → `{symbol,range,currency,timeZone,exchange,source,interval,points:[{time,price}]}` in major currency units.

Only the Yahoo adapter knows Yahoo URLs or payloads. The service applies caching, validation and EUR quote conversion; the browser consumes the same DTOs. Move to a feed licensed for the intended public/commercial use before treating the current unofficial endpoints as production research infrastructure. Provider substitution must include contract tests for units, currencies, stale data, splits, symbol aliases, deadlines and missing bars.

## Database and deployment invariants

Never edit a released migration. Append consecutive versions; each upgrade runs in a transaction. On failure, rollback the schema transaction and close the database. A binary that sees a newer core schema fails startup instead of silently rewriting `user_version`. Intelligence modules separately declare a compatible-writer floor: additive upgrades can retain compatibility with older images; an unknown or incompatible floor fails startup.

For future schema changes, prefer additive, backward-compatible expansion first. The deployment runner snapshots all existing durable tables and columns (including portfolios, credentials, costs, research and published revisions), then compares them before/after startup against a copied production database. Session/challenge/throttle and module-version bookkeeping are excluded. New tables and columns may be added; existing durable fields must remain intact. The canary explicitly disables background jobs and has no network. A migration intentionally changing those records needs a separately reviewed migration and updated canary assertions. Do not simply weaken the guard. Rollback replaces the image, **not** the live database; destructively incompatible migrations need a planned maintenance/recovery path.

The installed runner stays outside the Git checkout. Keep its external volume name `reentry_reentry-data`, existing origin, credentials, Caddy configuration and restricted deploy key. Do not run `compose down -v`, delete credentials, restore an old database over newer writes, or include `.env`/data in Git. On-server backups do not replace off-server backups.

## Adding a product slice

1. Define the domain contract and invariants, including privacy, units, identity and time semantics.
2. Add pure functions in `src/domain/` with meaningful tests for failure cases.
3. Add a feature directory; inject services at the composition root. Reuse UI primitives and CSS tokens.
4. Add authenticated or deliberately public routes under a dedicated server module. Keep SQL owner-scoped in a repository.
5. If persistence changes, append a migration and prove existing accounts/data survive it; keep published revisions immutable.
6. Register navigation deliberately. Do not add a top-level tab for every new tool.
7. Run `npm run check`, `npm test`, `npm run build`, deployment tests, and relevant desktop/mobile browser checks. The deployment pipeline repeats the checks and verifies the exact live revision.

The `server/ai`, `server/intelligence`, `server/journal` and `server/platform` modules now own credentials, billing, research, observations, published revisions and durable jobs. [Their contracts and operational requirements](INTELLIGENCE.md) are documented separately. Do not append those growing datasets to the private version-1 portfolio JSON blob. Canonical instrument/listing identities and a public projection are prerequisites for cross-asset research and publishing. See [the platform vision](PLATFORM-VISION.md) for the product and navigation plan.

## Deliberate limits

The current engine estimates one sale/buyback scenario from the entered lots; it is not an audited multi-currency ledger. Before adding cash balances, dividends, corporate actions and performance reporting, introduce explicit decimal/tick policies and an append-only trade/cash ledger with reconciliation. Do not infer those histories from current holdings. The present mutable purchase forms retain the existing validated version-1 contract; financial sale/buyback commands have been isolated for deterministic testing. A view-level recovery screen provides retry, portfolio navigation and data export if a future feature fails to render.
