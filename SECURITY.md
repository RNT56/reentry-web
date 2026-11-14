# Security model

Reentry is designed for one VPS running one application instance behind Caddy. SQLite, session state, and account data stay in the mounted data volume. Do not run multiple application replicas against this file or expose the app port directly when `TRUST_PROXY=1`.

- Passwords use unique random salts and scrypt (`N=65536`, `r=8`, `p=2`, 64-byte output). Hash work is concurrency-limited. Password comparisons use constant-time comparison.
- Sessions are random 256-bit tokens; only SHA-256 hashes are stored in the database. HTTPS uses host-only `__Host-` cookies with Secure, HttpOnly, SameSite=Strict and Path=/. Sessions expire after 30 days, or seven days idle. Sensitive passkey changes require authentication within ten minutes.
- Unsafe requests require the configured exact Origin, a custom request header and JSON content type (except DELETE). Fetch Metadata is checked where present. API responses are not cached. A restrictive CSP permits only local scripts/fonts and the Parqet image host.
- Passkeys use SimpleWebAuthn, verified challenges, exact origin/RP ID, required user verification and discoverable credentials. Registration challenges bind to a user and session, expire in five minutes, and are single-use. Authentication counters are checked. Password fallback remains available.
- Authentication has IP and account throttles. Password changes revoke sessions; recovery rotates a random recovery key and revokes sessions, passkeys and outstanding user challenges. The recovery key is stored only as a SHA-256 hash.
- Portfolio queries always scope to the authenticated user. Client-provided account IDs are not accepted. Shared validation and revision numbers prevent malformed imports and silent overwrites between devices. The client warns about unsaved changes and offers export/reload when a conflict occurs.
- Request logs omit bodies, redact authentication headers/cookies, and omit search query strings. Fonts are self-hosted. Yahoo sees requested symbols/searches from the server; Parqet sees logo requests from the browser. No broker credentials are collected.

This is application-level account separation, not end-to-end encryption: the VPS operator and anyone with database/backups access can read portfolio data. Protect the host, volumes, backups, SSH access, and domain. No independent security audit is claimed. Native passkey prompts vary by platform; test them on the final HTTPS domain before inviting users.
