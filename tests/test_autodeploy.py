import importlib.util
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('autodeploy', Path(__file__).parents[1] / 'deploy/autodeploy.py')
auto = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auto)


class DeploymentTests(unittest.TestCase):
    def test_detects_account_portfolio_or_passkey_loss(self):
        with tempfile.TemporaryDirectory() as folder:
            dbfile = Path(folder) / 'fixture.sqlite'
            db = sqlite3.connect(dbfile)
            db.executescript('''CREATE TABLE users(id TEXT PRIMARY KEY, password_hash TEXT);
                CREATE TABLE portfolios(user_id TEXT PRIMARY KEY, data TEXT, revision INTEGER);
                CREATE TABLE passkeys(id TEXT PRIMARY KEY, public_key BLOB);
                INSERT INTO users VALUES('alice','hash');
                INSERT INTO portfolios VALUES('alice','{"holdings":[{"symbol":"AAPL"}]}',3);
                INSERT INTO passkeys VALUES('credential',X'0123');''')
            db.commit()
            original = auto.database_fingerprint(dbfile)
            for table in ('users', 'portfolios', 'passkeys'):
                db.execute(f'DELETE FROM {table}')
                db.commit()
                self.assertNotEqual(original, auto.database_fingerprint(dbfile))
                # Restore a fresh fixture for the next independent deletion.
                if table == 'users': db.execute("INSERT INTO users VALUES('alice','hash')")
                elif table == 'portfolios': db.execute('INSERT INTO portfolios VALUES(?,?,?)', ('alice','{"holdings":[{"symbol":"AAPL"}]}',3))
                else: db.execute("INSERT INTO passkeys VALUES('credential',X'0123')")
                db.commit()
                self.assertEqual(original, auto.database_fingerprint(dbfile))
            db.execute("UPDATE portfolios SET data='{}'")
            db.commit()
            self.assertNotEqual(original, auto.database_fingerprint(dbfile))
            db.close()

    def test_protects_research_keys_costs_and_publications_across_additive_migrations(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'platform.sqlite'
            db = sqlite3.connect(file)
            db.executescript("""CREATE TABLE users(id TEXT); CREATE TABLE portfolios(id TEXT); CREATE TABLE passkeys(id TEXT);
                CREATE TABLE ai_credentials(user_id TEXT, provider TEXT, encrypted TEXT);
                CREATE TABLE ai_ledger(id TEXT, cost INTEGER); CREATE TABLE article_revisions(id TEXT, body TEXT);
                INSERT INTO ai_credentials VALUES('alice','gemini','encrypted-secret');
                INSERT INTO ai_ledger VALUES('call',123); INSERT INTO article_revisions VALUES('article','published original');""")
            db.commit()
            manifest = auto.preservation_manifest(file)
            before = auto.database_fingerprint(file, manifest)
            db.execute('CREATE TABLE new_module(id TEXT)')
            db.execute('ALTER TABLE ai_ledger ADD COLUMN new_metadata TEXT')
            db.commit()
            self.assertEqual(before, auto.database_fingerprint(file, manifest))
            for table in ('ai_credentials', 'ai_ledger', 'article_revisions'):
                saved = list(db.execute(f'SELECT * FROM {table}'))
                db.execute(f'DELETE FROM {table}')
                db.commit()
                self.assertNotEqual(before, auto.database_fingerprint(file, manifest))
                for row in saved: db.execute(f'INSERT INTO {table} VALUES(' + ','.join('?' for _ in row) + ')', row)
                db.commit()
                self.assertEqual(before, auto.database_fingerprint(file, manifest))
            db.close()

    def test_wrong_volume_is_rejected(self):
        with patch.object(auto, 'inspect', return_value={'Mounts':[{'Destination':'/data','Name':'brand-new-empty-volume'}]}):
            with self.assertRaises(auto.DeploymentError):
                auto.require_volume('app','reentry_reentry-data')

    def test_restricted_ssh_rejects_shell_and_injection(self):
        for command in ('whoami','deploy main','deploy ' + 'a'*40 + '; id','deploy '+ 'a'*39,'deploy '+ 'a'*41,''):
            result = subprocess.run([sys.executable, spec.origin], env={'SSH_ORIGINAL_COMMAND':command}, capture_output=True)
            self.assertEqual(result.returncode,64)

    def test_failed_public_health_rolls_back_image(self):
        config = {'volume': 'protected-volume'}
        with patch.object(auto, 'compose') as compose, patch.object(auto, 'require_volume') as volume, patch.object(auto, 'public_health', side_effect=[auto.DeploymentError('bad release'),None]) as health:
            with self.assertRaises(auto.DeploymentError):
                auto.switch_image(config,'candidate','new','rollback-image','old','https://example.com','container')
            self.assertEqual(compose.call_args_list[0].args,(config,'candidate','new'))
            self.assertEqual(compose.call_args_list[1].args,(config,'rollback-image','old'))
            self.assertEqual(volume.call_count,2)
            self.assertEqual(health.call_args_list[-1].args,('https://example.com',))

    def test_corrupt_database_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder)/'bad.sqlite'
            file.write_bytes(b'not a database')
            with self.assertRaises(sqlite3.DatabaseError): auto.database_fingerprint(file)


if __name__ == '__main__':
    unittest.main()
