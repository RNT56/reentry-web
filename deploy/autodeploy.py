#!/usr/bin/env python3
"""Installed outside the app checkout; a restricted SSH key can only request main deployments."""
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request


class DeploymentError(RuntimeError):
    pass


def run(*args, capture=False, env=None, timeout=1200):
    process = subprocess.Popen(args, stdout=subprocess.PIPE if capture else None,
                               text=True, env=env, start_new_session=True)
    try:
        out, _ = process.communicate(timeout=timeout)
        if process.returncode:
            raise DeploymentError(f'{args[0]} failed with exit code {process.returncode}')
        return (out or '').strip()
    except BaseException:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        raise


def inspect(container):
    return json.loads(run('docker', 'inspect', container, capture=True))[0]


# Session/challenge/throttle rows are ephemeral; every other app table is durable.
EPHEMERAL_TABLES = {'sessions', 'challenges', 'throttle', 'module_migrations', 'module_compatibility'}


def preservation_manifest(filename):
    db = sqlite3.connect(Path(filename).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                  if not r[0].startswith('sqlite_') and r[0] not in EPHEMERAL_TABLES]
        if not {'users', 'portfolios', 'passkeys'}.issubset(tables):
            raise DeploymentError('Required account tables are missing')
        return {table: [r[1] for r in db.execute('PRAGMA table_info("' + table.replace('"', '""') + '")')]
                for table in tables}
    finally:
        db.close()


def database_fingerprint(filename, manifest=None):
    """Hash every existing durable field without logging private data or key ciphertext."""
    manifest = manifest if manifest is not None else preservation_manifest(filename)
    db = sqlite3.connect(Path(filename).resolve().as_uri() + '?mode=ro', uri=True)
    quote = lambda s: '"' + s.replace('"', '""') + '"'
    try:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise DeploymentError('Database integrity check failed')
        digest = hashlib.sha256()
        for table, columns in sorted(manifest.items()):
            digest.update(json.dumps([table, columns]).encode())
            selected = ','.join(quote(c) for c in columns)
            # Composite owner/provider keys need deterministic ordering too.
            for row in db.execute(f'SELECT {selected} FROM {quote(table)} ORDER BY {selected}'):
                encoded = [value.hex() if isinstance(value, bytes) else value for value in row]
                digest.update(json.dumps(encoded, ensure_ascii=True).encode())
        return digest.hexdigest()
    except sqlite3.DatabaseError as exc:
        raise DeploymentError('Durable database fields changed incompatibly') from exc
    finally:
        db.close()


def require_volume(container, expected):
    mounts = [m for m in inspect(container)['Mounts'] if m['Destination'] == '/data']
    if len(mounts) != 1 or mounts[0].get('Name') != expected:
        raise DeploymentError('Refusing deployment: live database volume does not match the pinned volume')


def backup(container, backups, label):
    name = f'autodeploy-{time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())}-{label}.sqlite'
    destination = backups / name
    run('docker', 'exec', container, 'node', 'scripts/backup.mjs', '/data/backups/' + name)
    run('docker', 'cp', container + ':/data/backups/' + name, str(destination))
    destination.chmod(0o600)
    database_fingerprint(destination)
    return destination


def canary(image, snapshot, origin, revision, runtime):
    """Start the exact candidate with an isolated database copy, no network and no published port."""
    directory = Path(tempfile.mkdtemp(prefix='canary-', dir=runtime))
    name = 'reentry-canary-' + directory.name.split('-')[-1]
    try:
        shutil.copy2(snapshot, directory / 'reentry.sqlite')
        manifest = preservation_manifest(directory / 'reentry.sqlite')
        before = database_fingerprint(directory / 'reentry.sqlite', manifest)
        run('docker', 'run', '-d', '--name', name, '--user', '1000:1000',
            '--network', 'none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges:true', '--memory=768m', '--cpus=2',
            '--pids-limit=128', '--tmpfs', '/tmp:size=32m,mode=1777',
            '-e', 'NODE_ENV=production', '-e', 'HOST=0.0.0.0', '-e', 'PORT=4173',
            '-e', 'DATABASE_PATH=/data/reentry.sqlite', '-e', 'APP_ORIGIN=' + origin,
            '-e', 'REENTRY_REVISION=' + revision, '-e', 'ENABLE_BACKGROUND_JOBS=false',
            '-v', str(directory) + ':/data', image, capture=True)
        for _ in range(30):
            state = inspect(name)['State']
            if not state['Running']:
                raise DeploymentError('Candidate exited before becoming healthy')
            if state.get('Health', {}).get('Status') == 'healthy':
                break
            time.sleep(2)
        else:
            raise DeploymentError('Candidate health check timed out')
        # Check the endpoint independently of an image-supplied health check.
        run('docker', 'exec', name, 'node', '-e',
            "fetch('http://127.0.0.1:4173/healthz').then(async r=>{if(!r.ok||!(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))")
        run('docker', 'stop', '-t', '20', name, capture=True)
        if database_fingerprint(directory / 'reentry.sqlite', manifest) != before:
            raise DeploymentError('Candidate changed existing durable data during startup; manual migration review required')
        print('Candidate passed health and database-preservation checks.', flush=True)
    finally:
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(directory)


def compose(config, image, revision):
    env = dict(os.environ, REENTRY_IMAGE=image, REENTRY_REVISION=revision)
    run('docker', 'compose', '--project-directory', config['repo'],
        '--env-file', str(Path(config['repo']) / '.env'), '-p', 'reentry',
        '-f', config['compose'], 'up', '-d', '--no-build', '--pull', 'never',
        '--wait', '--wait-timeout', '90', 'reentry', env=env, timeout=180)


def public_health(origin, revision=None):
    error = None
    for _ in range(12):
        try:
            with urllib.request.urlopen(origin + '/healthz', timeout=10) as response:
                data = json.load(response)
            if data.get('ok') and (revision is None or data.get('revision') == revision):
                return
            error = 'Unexpected release from public health endpoint'
        except Exception as exc:
            error = str(exc)
        time.sleep(2)
    raise DeploymentError('Public HTTPS health check failed: ' + str(error))


def switch_image(config, image, revision, rollback_image, previous_revision, origin, container):
    try:
        print('Switching app image; retaining the existing database volume.', flush=True)
        compose(config, image, revision)
        require_volume(container, config['volume'])
        public_health(origin, revision)
    except BaseException:
        print('Deployment failed; restoring previous app image WITHOUT rewinding user data.', flush=True)
        compose(config, rollback_image, previous_revision)
        require_volume(container, config['volume'])
        public_health(origin)
        raise


def deploy(config, revision):
    repo, runtime = Path(config['repo']), Path(config['runtime'])
    backups = Path(config['backups'])
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    backups.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (runtime / 'deploy.lock').open('w') as lock:
        print('Waiting for deployment lock...', flush=True)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if shutil.disk_usage(runtime).free < 3 * 1024**3:
            raise DeploymentError('Less than 3 GiB free; refusing to risk the database disk')
        if run('git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=no', capture=True):
            raise DeploymentError('Server checkout has local changes; resolve them before deployment')
        run('git', '-C', str(repo), 'fetch', 'https://github.com/RNT56/reentry-web.git',
            '+refs/heads/main:refs/remotes/origin/main')
        head = run('git', '-C', str(repo), 'rev-parse', 'refs/remotes/origin/main', capture=True)
        if head != revision:
            print('Skipped superseded push; only the latest main commit can deploy.', flush=True)
            return
        container = 'reentry-reentry-1'
        require_volume(container, config['volume'])
        old = inspect(container)
        if old['State'].get('Health', {}).get('Status') != 'healthy':
            raise DeploymentError('Current app is not healthy; refusing unattended replacement')
        origin = next(v.split('=', 1)[1] for v in old['Config']['Env'] if v.startswith('APP_ORIGIN='))
        previous_revision = next((v.split('=', 1)[1] for v in old['Config']['Env'] if v.startswith('REENTRY_REVISION=')), 'initial')
        image = 'reentry-release:' + revision
        rollback_image = 'reentry-rollback:' + time.strftime('%Y%m%dT%H%M%S', time.gmtime())
        run('docker', 'tag', old['Image'], rollback_image)
        release = Path(tempfile.mkdtemp(prefix='release-', dir=runtime))
        try:
            archive = subprocess.check_output(['git', '-C', str(repo), 'archive', revision])
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                tar.extractall(release, filter='data')
            print('Building commit ' + revision, flush=True)
            run('docker', 'build', '--label', 'org.opencontainers.image.revision=' + revision,
                '-t', image, str(release))
            snapshot = backup(container, backups, revision[:12] + '-preflight')
            canary(image, snapshot, origin, revision, runtime)
            # Recheck after the build: a newer main push must not be overtaken.
            latest = run('git', 'ls-remote', 'https://github.com/RNT56/reentry-web.git', 'refs/heads/main', capture=True).split()[0]
            if latest != revision:
                print('Skipped: main changed while building.', flush=True)
                return
            final_backup = backup(container, backups, revision[:12] + '-before-switch')
            switch_image(config, image, revision, rollback_image, previous_revision, origin, container)
            state = {'revision': revision, 'image': image, 'previous_image': rollback_image,
                     'previous_revision': previous_revision, 'backup': str(final_backup),
                     'volume': config['volume'], 'completed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            temporary = runtime / 'last-success.tmp'
            temporary.write_text(json.dumps(state, indent=2) + '\n')
            temporary.chmod(0o600)
            temporary.replace(runtime / 'last-success.json')
            # Fast-forward only; .env and backups are ignored and never replaced.
            run('git', '-C', str(repo), 'merge', '--ff-only', revision)
            print('DEPLOYED ' + revision, flush=True)
        finally:
            shutil.rmtree(release)


def main():
    match = re.fullmatch(r'deploy ([0-9a-f]{40})', os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if not match:
        print('Only deploy <40-character commit SHA> is permitted.', file=sys.stderr)
        return 64
    os.umask(0o077)
    def interrupted(signum, frame):
        raise DeploymentError('Deployment interrupted by signal ' + str(signum))
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, interrupted)
    try:
        config = json.loads(Path(__file__).with_name('config.json').read_text())
        deploy(config, match[1])
        return 0
    except Exception as exc:
        print('DEPLOYMENT FAILED: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
