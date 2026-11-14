# Automatic production deployments

Push to `main` in https://github.com/RNT56/reentry-web. GitHub Actions runs the tests/build, then deploys that exact commit to https://reentry.pavé.tech. Pull requests run checks only. You can also use **Actions → Test and deploy Reentry → Run workflow** on `main`.

## What each deployment does

1. Runs JavaScript/authentication/calculation tests, deployment guard tests, and the browser build on GitHub.
2. Connects with a dedicated restricted SSH key. It can request `deploy <commit SHA>` only; interactive shells, port forwarding and arbitrary commands are disabled. The server's SSH host keys are pinned.
3. Takes a deployment lock, confirms the requested commit is the latest `main`, confirms the production container uses `reentry_reentry-data`, and builds the candidate while the existing app remains live.
4. Makes a consistent SQLite backup. Starts the candidate with a private copy of that backup, no network, and no published port. Checks health, SQLite integrity, and unchanged existing durable data, including users, portfolios, passkeys, encrypted API keys, research, costs and published articles. Additive tables and columns are allowed; changing existing field values requires a separately reviewed migration.
5. Takes another backup immediately before replacement. Recreates only the Reentry container using the **same external volume**, environment file, hostname and passkey origin. There is a brief restart window.
6. Checks container health, mounted volume, and the live HTTPS endpoint's commit. If activation fails, reactivates the previous image. It **does not restore an older database automatically**, which would discard newer user writes.

GitHub serializes `main` workflows and the server also locks deployments. Superseded commits are skipped, rather than deploying out of order. Failed builds, tests, backups or preflight checks leave the current release serving users.

## Data and backups

Accounts, passwords, recovery-key hashes, sessions, passkeys, portfolios and intelligence data remain in the existing `reentry_reentry-data` volume. It is declared **external**, with an explicit fixed name. The automation does not run `compose down`, delete/prune volumes, replace `.env`, or initialize a new production database.

Backups are retained both under `/data/backups` in the volume and `/home/deploy/reentry/backups` on the host, with private file permissions. There is no automatic deletion or off-server backup schedule. Copy backups off the VPS as part of your normal backup routine. Deployment refuses to start with less than 3 GiB free. Release images and backups accumulate; review disk space periodically, retaining the current and previous images and useful backups.

The safeguards protect ordinary code deployments, but no deploy system can make arbitrary application changes or destructive schema migrations lossless. Use backward-compatible schema migrations and tests. A startup migration that removes existing durable fields or changes their contents will fail preflight for manual review. The separate AI master key must also be backed up securely; it is not part of a SQLite backup. See [AI operations](../docs/INTELLIGENCE.md).

## Installed control files

- `/home/deploy/.local/lib/reentry-deploy/autodeploy.py`: restricted SSH entry point and deployment runner.
- `/home/deploy/.local/lib/reentry-deploy/compose.yaml`: stable production configuration pinned to the external volume.
- `/home/deploy/.local/lib/reentry-deploy/config.json`: server paths and pinned volume name.
- `/home/deploy/.local/state/reentry-deploy/last-success.json`: current commit/image, previous image, backup location and deployment time.
- `/home/deploy/reentry/.env`: application configuration, kept outside version control.

The runner and production Compose file are intentionally installed outside the code checkout. Pushing an application update cannot replace those safeguards. Changes to these infrastructure files in Git need an explicit server installation step; ordinary application code and Dockerfile changes deploy automatically.

Repository secrets: `REENTRY_DEPLOY_SSH_KEY` and `REENTRY_SSH_KNOWN_HOSTS`. The CI key is dedicated to this repository and does not replace the owner's SSH key. Anyone who can push trusted code/workflows to `main` can affect production; use branch protection/reviews if you add collaborators.

## Status and rollback

The GitHub Actions run is the deployment log. On the VPS:

```sh
cat /home/deploy/.local/state/reentry-deploy/last-success.json
docker inspect reentry-reentry-1 --format '{{.State.Health.Status}}'
curl --fail https://reentry.xn--pav-dma.tech/healthz
```

For a normal rollback, revert the bad commit on `main` and push; it goes through the same checks. To reactivate the previous image immediately, using the saved state without rewinding the database:

```sh
python3 - <<'PY'
import json, os, subprocess
from pathlib import Path
s=json.loads(Path('/home/deploy/.local/state/reentry-deploy/last-success.json').read_text())
env=dict(os.environ,REENTRY_IMAGE=s['previous_image'],REENTRY_REVISION=s['previous_revision'])
subprocess.run(['docker','compose','--project-directory','/home/deploy/reentry','--env-file','/home/deploy/reentry/.env','-p','reentry','-f','/home/deploy/.local/lib/reentry-deploy/compose.yaml','up','-d','--no-build','--pull','never','--wait','reentry'],env=env,check=True)
PY
```

Pause/disable the workflow before manual recovery to avoid racing a queued push. For database recovery, stop the app and follow the README restore procedure only after deciding which backup to restore; do not overwrite live user data casually.

## Verify deployment guards

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

An optional Linux/Docker integration test uses only synthetic account/portfolio/passkey data. Run as UID 1000, matching the deployed container:

```sh
python3 scripts/test-deploy-canary.py --image reentry-reentry
```

It verifies that a healthy candidate preserves the fixture and that a healthy-looking destructive candidate is rejected. It never mounts the production data volume.
