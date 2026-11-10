#!/usr/bin/env python3
"""Check cold capture and fresh-process continuation for an explicit runtime."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runtime', type=Path)
    parser.add_argument('label')
    args = parser.parse_args()
    if not re.fullmatch('[a-z0-9-]+', args.label): parser.error('Use a fresh lowercase label')
    runtime = args.runtime.resolve()
    if not runtime.is_relative_to(ROOT): parser.error('Runtime must be inside the project')
    out = ROOT / 'artifacts/validation' / args.label
    out.mkdir(parents=True, exist_ok=False)
    report = {'status':'running', 'runtime':str(runtime.relative_to(ROOT)), 'commands':[], 'runs':[]}
    def command(name, argv):
        report['commands'].append(argv)
        with (out/(name+'.log')).open('w') as log:
            subprocess.run(argv,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=240)
    try:
        command('bundle',['python3','packaging/bundle-bun.py','packaging/bun-app/example/automatic.ts',
                         '--project-root','packaging/bun-app/example','--outfile',str(out/'automatic.mjs'),
                         '--runtime-dir',str(runtime)])
        app=out/'automatic.mjs.app'; manifest=json.loads((app/'app.json').read_text())
        assert manifest['snapshot']['readyMode']=='after-module'
        assert manifest['artifacts']['runtime/qemu-system-x86_64.wasm']['sha256']==digest(runtime/'qemu-system-x86_64.wasm')
        cache=out/'cache'; snapshot=cache/manifest['appSha256']/(manifest['compatibilitySha256']+'.snapshot')
        before=None; nonce=None
        for mode in ['cold','restored']:
            command(mode,['node','packaging/bun-app/run.mjs',str(app),'--cache',str(cache),
                          '--until','AUTO_VERIFIED','--report',str(out/(mode+'.json'))])
            result=json.loads((out/(mode+'.json')).read_text())
            assert result['status']=='passed' and result['ready']['mode']==mode
            state=json.loads(next(line[len('AUTO_VERIFIED '):] for line in result['console'].splitlines() if line.startswith('AUTO_VERIFIED ')))
            assert state['file'] and state['http']
            assert ('AUTO_INITIALIZED ' in result['console'])==(mode=='cold')
            identity=(digest(snapshot),snapshot.stat().st_size,snapshot.stat().st_mtime_ns)
            if mode=='cold': before=identity;nonce=state['nonce']
            else: assert identity==before and state['nonce']==nonce
            report['runs'].append({'mode':mode,'state':state,'snapshotSha256':identity[0]})
        report.update(status='passed',compatibilitySha256=manifest['compatibilitySha256'])
    except Exception as error:
        report.update(status='failed',failure=str(error))
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'report':str(out/'report.json'),'failure':report.get('failure')}))
    return report['status']!='passed'


if __name__=='__main__':
    raise SystemExit(main())
