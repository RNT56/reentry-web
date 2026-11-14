# Reentry

A mobile-first portfolio and after-tax buyback planner. Enter purchases once, choose how much to sell, and see the highest buyback price that buys the same number of shares—or 5%, 10%, or a custom percentage more—with the remaining cash.

Username/password accounts, optional passkeys, independent portfolios, automatic saves, real asset search and logos, indicative EUR quotes, FIFO purchase lots, sale/buyback records, and JSON export/import. No broker login, email server, or paid API key is required for the default setup.

## Hostinger Ubuntu VPS: Docker + existing Caddy

Use a dedicated domain or subdomain, such as `stocks.yourdomain.com`. Point its DNS A record to the VPS (and AAAA only if IPv6 is configured). Keep your existing Caddy installation and other sites.

1. Copy/extract this project to `/opt/reentry` on the VPS, then:

   ```sh
   cd /opt/reentry
   cp .env.example .env
   nano .env
   ```

   Set `APP_ORIGIN=https://stocks.yourdomain.com` **with no trailing slash**. This must exactly match the browser address. Leave `REGISTRATION_OPEN=true` to let people create accounts. Change `APP_PORT` if local port 4173 is occupied.

2. Build and start:

   ```sh
   docker compose up -d --build
   docker compose ps
   curl --fail http://127.0.0.1:4173/healthz
   ```

3. If Caddy runs directly on Ubuntu, append this block to its existing Caddyfile, replacing the domain and, if necessary, port:

   ```caddyfile
   stocks.yourdomain.com {
       encode zstd gzip
       reverse_proxy 127.0.0.1:4173
   }
   ```

   Validate and reload (do not replace your other sites):

   ```sh
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

   Caddy obtains HTTPS certificates. Ports 80/443 must already reach Caddy. The application port is bound only to loopback; do not expose 4173 publicly.

4. Visit the HTTPS domain, create your account, save the one-time recovery key, and add a passkey when prompted. Other people create their own accounts at the same address. Passkeys require HTTPS and are tied to the domain, so choose the final domain before enrolling them.

### If Caddy itself runs in Docker

Set `CADDY_NETWORK` in `.env` to the **existing Docker network your Caddy container uses** (inspect with `docker network ls` / `docker inspect`). Launch with:

```sh
docker compose -f compose.yaml -f compose.caddy-network.yaml up -d --build
```

Use `reverse_proxy reentry:4173` in the Caddy block instead of `127.0.0.1:4173`, then validate/reload Caddy using your existing container setup. Use the same two `-f` options on subsequent Compose operations. `deploy/Caddyfile.example` shows both variants. Use a unique network alias if another container on that network is already called `reentry`.

### Registration and accounts

Registration is open by default and rate-limited. To close new signups after everyone has joined, set `REGISTRATION_OPEN=false` in `.env` and run `docker compose up -d`. Existing accounts still work. There is no email verification, admin account, invitation service, or email recovery. Each account has a one-time recovery key; using it rotates the key and revokes all sessions and passkeys. Without a password, usable passkey, or saved recovery key, there is no self-service recovery.

Passwords must contain 12–128 characters. Usernames contain 3–32 letters, numbers, or underscores and are case-insensitive. Passkeys are optional; passwords remain available. Settings supports adding/removing passkeys, changing passwords, and signing out all devices.

## Data, backups, and updates

SQLite lives in the persistent `reentry-data` Docker volume. Container replacement preserves accounts, sessions, passkeys, and portfolios. **Do not run `docker compose down -v`** unless you intend to delete all data. Keep the same Compose project name/directory when upgrading so the same named volume is used.

Create a transactionally consistent online backup and copy it off the server:

```sh
docker compose exec -T reentry node scripts/backup.mjs /data/backups/reentry.sqlite
mkdir -p backups
docker compose cp reentry:/data/backups/reentry.sqlite ./backups/reentry.sqlite
chmod 600 ./backups/reentry.sqlite
```

Copy `backups/reentry.sqlite` to your secure backup destination. A backup stored only in the same Docker volume does not protect against disk/server loss. Backups contain private portfolios and authentication records; protect them like the production database. User JSON exports contain only that user's portfolio and are not a substitute for server backups.

To restore a server backup, stop the app, retain a backup of the current database, and replace the database **while the app is stopped**:

```sh
docker compose stop reentry
docker compose run --rm --no-deps --user root \
  -v "$PWD/backups:/restore:ro" reentry sh -c \
  'rm -f /data/reentry.sqlite-wal /data/reentry.sqlite-shm && cp /restore/reentry.sqlite /data/reentry.sqlite && chown node:node /data/reentry.sqlite && chmod 600 /data/reentry.sqlite'
docker compose up -d
```

Restoring an older database also restores its session and credential state. After recovery from a security incident, invalidate sessions and credentials according to the incident rather than restoring old access blindly.

For updates: back up first, replace application source (preserving `.env`), then run `docker compose up -d --build`. Inspect `docker compose logs --tail=100 reentry` and `docker compose ps`. The initial schema is version 1; future schema changes need explicit migrations. Keep backup retention and OS/Docker/Caddy updates in your normal VPS maintenance.

## Local development

Node.js 24 or newer:

```sh
npm ci
npm run dev
```

Open `http://localhost:4173`. Local SQLite defaults to `data/reentry.sqlite`. Server changes restart automatically; rerun `npm run build` after browser source changes. Localhost is a secure-context exception for WebAuthn, but individual browsers/platforms may limit passkeys there.

```sh
npm run check
npm test
npm run build
npm audit --omit=dev
```

Optional production-container smoke test (uses disposable containers and volumes, then removes them):

```sh
docker build -t reentry:local .
node scripts/smoke-docker.mjs
```

The tests include FIFO/fees/tax/rounding, account isolation, rejected cross-origin writes, optimistic save conflicts, password recovery and rotation, rate limits, secure cookies, and cryptographically signed WebAuthn registration/authentication with replay/origin/user-verification rejection. Device biometrics and passkey-manager prompts must also be smoke-tested on the final HTTPS domain.

## Market data, asset identity, and calculations

- Search returns actual Yahoo provider tickers, exchange names, and asset types. A curated starter list includes verified ISINs. Exact exchange suffixes are preserved; a listing such as `SAP.DE` is distinct from an ADR. Search provider coverage is not universal; a manual ticker and optional ISIN remain available.
- [Parqet Assets](https://developers.parqet.com/docs/assets/logos) supplies real logos using ISIN where available, otherwise the provider symbol. The required visible attribution is included. Missing or unavailable logos fall back to initials. No service can guarantee a logo for every listed instrument. Logo requests go directly from the browser to Parqet.
- Yahoo's publicly accessible, unofficial endpoints supply search and indicative prices through this server. Quotes cache for 60 seconds; visible portfolios refresh every five minutes. Foreign quotes convert to EUR using an indicative FX quote; subunit currencies are normalized. FX dates and source details are retained. On provider failure, use a manual EUR price. This is not a guaranteed or licensed real-time trading feed. Before offering a public/commercial service, review [Yahoo's terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) and replace the provider with a feed licensed for your intended use. The provider adapter is `src/server.js`.
- The requested 27% estimate is the default, with editable German presets. Ordinary shares use FIFO within each holding/depot. Purchase fees enter the cost basis; sale fees reduce gain. Loss offset and allowance are explicit per-scenario inputs, not an automated tax ledger. Tax is estimated and actual withheld tax can be entered when recording a sale.
- ETFs, funds, crypto and other non-equity assets require an explicit effective rate. Exemptions, holding periods, fund advance taxes, corporate actions, and broker-specific tax adjustments are not inferred. Keep cost bases up to date. Supporting an asset's quote does not imply automatic support for its tax rules.
- Cash = proceeds − sale fee − tax. Buyback ceiling = (cash − buyback fee) / target quantity. **At or below** this maximum price, the remaining cash buys the target quantity; it is not a minimum purchase price. +5% / +10% refer to more shares, not investment return. Stock/ETF ceilings round down to EUR cents; crypto ceilings use eight decimals. Whole-share mode rounds target quantity up. Execution increments and spread depend on the broker.
- Plans do not execute trades. Partial sales remove the corresponding FIFO lots; completed buybacks add a new purchase lot and cost basis. Existing device-only portfolios can be explicitly imported in Settings, or transferred with JSON export/import from the old app. Nothing is imported into a new account automatically.

## Architecture

`src/app.js` + `src/style.css`: responsive client; `src/session.js`: account/passkey UI; `src/engine.js`: calculations; `src/validation.js`: shared data validation; `src/assets.js`: identities/logos; `src/server.js`: market-data adapter; `server/`: Fastify, WebAuthn, sessions, SQLite; `scripts/build.mjs`: esbuild + self-hosted fonts; `scripts/backup.mjs`: online SQLite backups.

The container runs unprivileged with a read-only root filesystem and a writable data volume. Production requires an exact HTTPS origin. Caddy is the single trusted proxy. See `SECURITY.md` for the security model. This Node/SQLite VPS edition is separate from the older browser-local Sites preview; it has not been installed on your VPS automatically.
