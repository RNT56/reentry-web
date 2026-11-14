# Validation — 14 November 2026

- `npm run check`, `npm run build`, `npm test`: passed (10 tests, including multi-step authentication and signed WebAuthn flows).
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at validation time.
- Docker image builds successfully from the lockfile.
- `scripts/smoke-docker.mjs`: production startup with read-only root filesystem, two separate user accounts, saved portfolio, container restart with retained sessions/data, online SQLite backup, integrity check, and restored portfolio all passed. Test containers and volumes were removed afterward.
- Both Compose variants validate; the supplied Caddy example validates with Caddy 2.
- Browser: signup/recovery-key screen, returning login/logout, persistent portfolios, asset search, loaded Apple/Microsoft logos, foreign-currency quote display, shares/invested-amount entry, custom targets, partial sale, completed buyback, and asset settings checked with disposable local test data.
- Responsive layout checked at 320px, 390px, and 1440px widths without horizontal page overflow. No browser console errors in the final review.

## Hostinger production deployment — 14 November 2026

- Deployed from `RNT56/reentry-web` to `/home/deploy/reentry` as SSH user `deploy`.
- Public URL: https://reentry.pavé.tech (ASCII origin: `https://reentry.xn--pav-dma.tech`).
- Added the `reentry` A record in Hostinger, pointing to `179.67.193.45`, TTL 300; verified both authoritative nameservers.
- Existing Caddy container reloaded gracefully with the current host configuration. Let's Encrypt certificate issuance succeeded; public TLS verification and HTTP-to-HTTPS redirect passed.
- Public health and authentication bootstrap returned 200. Unauthenticated portfolio access returned 401; a cross-origin authentication write returned 403. Passkey options used the correct ASCII RP ID, required user verification, and a Secure/HttpOnly/SameSite=Strict challenge cookie.
- App runs as the unprivileged node user with read-only root filesystem, automatic restart policy, and its own persistent volume; Docker health check passed.
- The existing https://pavé.tech project returned 200 before and after deployment.
- Production login and registration screens loaded in the browser. No production user account was pre-created.
- Initial database backup saved in the application volume and copied to `/home/deploy/reentry/backups/reentry-before-launch.sqlite`. This initial on-server backup is not an off-server backup schedule.

Native biometric/passkey-manager enrollment was not automated; server verification was tested with signed authenticator responses. Enroll a passkey after creating your own account on the final HTTPS domain. Unofficial market data and logo coverage remain dependent on the upstream providers.

## Chart reference levels and platform foundation — 14 November 2026

- ESLint checks the complete browser/server/test/script codebase, including restricted domain dependencies. Production build and all 27 Node tests passed; all 5 deployment guard tests passed.
- Added coverage for currency-safe reference lines, FIFO/fees/whole-share changes, invalid targets, save coalescing/conflicts/retries, bounded provider caching, provider replacement, migration rollback/downgrade protection, immutable trade commands, scenario evidence/knowledge time, graph cycles and routes.
- Production dependency audit reported zero vulnerabilities. A rebuilt production image passed account isolation, container-restart persistence, backup integrity and restore smoke checks with disposable containers/volumes.
- Browser verified Apple USD reference conversion, SAP native EUR levels, quantity changes, +10% and custom +17% targets, invalid quantity removing the target, settings save and selected-holding continuity, purchase and sale dialogs, and the linked article/scenario replay.
- Explore is a fictional product preview, not live Intel research. Replay correctly changed from Watching to Condition met; a sampled price observation is separate evidence. Research and journal views are interactive and mobile responsive.
- SQLite schema and portfolio JSON stay at version 1. Existing credentials, holdings and passkeys are not migrated or rewritten by this release. No test trades or accounts were created in production.

- Final UI regression: rapid asset switches during quote refresh, browser back, EUR/USD reference lines, level visibility toggles and 320px/390px layouts passed; the final browser console contained no errors. Screenshots use disposable local portfolio fixtures.
