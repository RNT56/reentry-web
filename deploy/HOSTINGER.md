# This VPS deployment

Live as of 14 November 2026. HTTPS, private API protection, and the existing apex site were verified after deployment.

- Public URL: https://reentry.pavé.tech
- Exact application origin / ASCII DNS name: `https://reentry.xn--pav-dma.tech`
- Source: https://github.com/RNT56/reentry-web
- SSH: `ssh deploy@179.67.193.45`
- Application directory: `/home/deploy/reentry`
- Caddy container: `pave-company-caddy-1`
- Existing Caddyfile: `/home/deploy/pave/infra/Caddyfile`
- Shared proxy network: `pave-company_default`
- Database: separate `reentry_reentry-data` Docker volume

DNS needs an A record named `reentry` in the `pavé.tech` zone pointing to `179.67.193.45`. The existing apex record and project stay in place.

## Run or update

On the VPS:

```sh
cd /home/deploy/reentry
git pull --ff-only
# First install only: cp deploy/hostinger.env.example .env
docker compose -p reentry -f compose.yaml -f compose.caddy-network.yaml up -d --build
docker compose -p reentry -f compose.yaml -f compose.caddy-network.yaml ps
```

The Reentry block from `deploy/reentry.Caddyfile` must be appended once to the existing Caddyfile. Validate before a graceful reload:

```sh
docker exec -i pave-company-caddy-1 caddy validate --config - --adapter caddyfile < /home/deploy/pave/infra/Caddyfile
docker exec -i pave-company-caddy-1 caddy reload --config - --adapter caddyfile < /home/deploy/pave/infra/Caddyfile
```

These commands read the current host file directly. The running Caddy container has a single-file bind mount that held an older inode during deployment; reading `/etc/caddy/Caddyfile` inside that existing container would load the old config. A newly created container mounts the current host file.

The Caddyfile is part of the other project's source checkout. Preserve this additional block during that project's updates or move it into that project's maintained configuration. Do not overwrite its existing route.

## Backup

```sh
cd /home/deploy/reentry
docker compose -p reentry -f compose.yaml -f compose.caddy-network.yaml exec -T reentry node scripts/backup.mjs /data/backups/reentry.sqlite
mkdir -p backups
docker compose -p reentry -f compose.yaml -f compose.caddy-network.yaml cp reentry:/data/backups/reentry.sqlite ./backups/reentry.sqlite
chmod 600 ./backups/reentry.sqlite
```

Copy the backup off the VPS. See the main README for restore procedures; use the same `-p reentry -f compose.yaml -f compose.caddy-network.yaml` options with each Compose command on this installation. Never remove the data volume during an update.

Create your own account at the public URL and save the recovery key. No production account is pre-created. Enroll your passkey on this final domain. To close public signup later, set `REGISTRATION_OPEN=false` in `.env` and re-run `docker compose ... up -d`.
