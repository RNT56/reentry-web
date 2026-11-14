"""Optional Linux/Docker integration check. Uses only synthetic data and disposable containers."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--image', default='reentry:local')
parser.add_argument('--helper', default=str(Path(__file__).parents[1] / 'deploy/autodeploy.py'))
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('autodeploy', args.helper)
auto = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auto)
root = Path(tempfile.mkdtemp(prefix='reentry-canary-test-'))
bad_tag = 'reentry-canary-negative:' + root.name.rsplit('-',1)[-1]
try:
    fixture = root/'fixture'
    fixture.mkdir(mode=0o700)
    initialize = """import {openStore,emptyPortfolio} from './server/store.js';
const db=openStore('/data/reentry.sqlite');
db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('fixture-user','fixture','not-a-real-password','not-a-real-key',1);
const state=emptyPortfolio();state.holdings=[{id:'fixture-holding',symbol:'AAPL',name:'Synthetic fixture',broker:'Other',lots:[{id:'lot',qty:5,price:100,date:'2025-01-01',fee:1}]}];
db.prepare('INSERT INTO portfolios VALUES(?,?,?)').run('fixture-user',JSON.stringify(state),7);
db.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?,?,?)').run('fixture-key','fixture-user',Buffer.from([1,2,3]),2,'[]','Synthetic passkey',1);db.close();"""
    auto.run('docker','run','--rm','--network','none','--user','1000:1000','-v',str(fixture)+':/data',args.image,'node','--input-type=module','-e',initialize)
    snapshot=fixture/'reentry.sqlite'
    original=auto.database_fingerprint(snapshot)
    auto.canary(args.image,snapshot,'https://reentry.xn--pav-dma.tech','fixture',root)
    context=root/'bad-image'
    context.mkdir()
    destructive="import {DatabaseSync} from 'node:sqlite';import {createServer} from 'node:http';const db=new DatabaseSync('/data/reentry.sqlite');db.exec('DELETE FROM users');db.close();createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({ok:true}))}).listen(4173,'0.0.0.0');"
    (context/'Dockerfile').write_text('FROM '+args.image+'\nCMD '+json.dumps(['node','--input-type=module','-e',destructive])+'\n')
    auto.run('docker','build','-q','-t',bad_tag,str(context))
    try:
        auto.canary(bad_tag,snapshot,'https://reentry.xn--pav-dma.tech','fixture',root)
    except auto.DeploymentError as exc:
        assert 'changed stored' in str(exc), str(exc)
        print('PASS: healthy-looking destructive candidate was rejected.')
    else:
        raise AssertionError('Destructive candidate was accepted')
    assert original==auto.database_fingerprint(snapshot)
    print('PASS: original accounts, portfolio, and passkey fixture are untouched.')
finally:
    subprocess.run(['docker','image','rm',bad_tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    shutil.rmtree(root)
