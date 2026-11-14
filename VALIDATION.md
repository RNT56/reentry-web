# Validation — 14 November 2026

- `npm run check`, `npm run build`, `npm test`: passed (10 tests, including multi-step authentication and signed WebAuthn flows).
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at validation time.
- Docker image builds successfully from the lockfile.
- `scripts/smoke-docker.mjs`: production startup with read-only root filesystem, two separate user accounts, saved portfolio, container restart with retained sessions/data, online SQLite backup, integrity check, and restored portfolio all passed. Test containers and volumes were removed afterward.
- Both Compose variants validate; the supplied Caddy example validates with Caddy 2.
- Browser: signup/recovery-key screen, returning login/logout, persistent portfolios, asset search, loaded Apple/Microsoft logos, foreign-currency quote display, shares/invested-amount entry, custom targets, partial sale, completed buyback, and asset settings checked with disposable local test data.
- Responsive layout checked at 320px, 390px, and 1440px widths without horizontal page overflow. No browser console errors in the final review.

The actual VPS, DNS and HTTPS certificate were not accessed or deployed. Native biometric/passkey-manager enrollment was not automated; server verification was tested with signed authenticator responses. Perform a native passkey enrollment/login on the final HTTPS domain. Unofficial market data and logo coverage remain dependent on the upstream providers.
