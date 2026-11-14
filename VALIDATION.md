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
