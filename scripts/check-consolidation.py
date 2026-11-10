#!/usr/bin/env python3
"""Run consolidation validation serially; preserve every log and fresh run label."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('label')
    parser.add_argument('--build', default='artifacts/build-03')
    args = parser.parse_args()
    if not re.fullmatch('[a-z0-9-]+', args.label): parser.error('Use a fresh lowercase label')
    build = (ROOT / args.build).resolve()
    if not build.is_relative_to(ROOT): parser.error('Build must be inside this project')
    build_report = json.loads((build / 'build-report.json').read_text())
    if build_report.get('status') != 'passed': parser.error('A completed clean build is required')
    out = ROOT / 'artifacts/validation' / args.label
    out.mkdir(parents=True, exist_ok=False)
    report = {'schema':1, 'status':'running', 'scope':'Consolidation correctness; no performance claim',
              'label':args.label, 'build':str(build.relative_to(ROOT)),
              'buildSourceFingerprint':build_report['sourceFingerprint'], 'checks':[]}
    def save(): (out / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    def run(name, command, timeout=600):
        print('START ' + name, flush=True); start=time.monotonic()
        record={'name':name,'command':command,'log':str((out/(name+'.log')).relative_to(ROOT))}
        report['checks'].append(record); save()
        try:
            with (out/(name+'.log')).open('w') as log:
                result=subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
            record.update(returncode=result.returncode,seconds=time.monotonic()-start,
                          status='passed' if result.returncode==0 else 'failed'); save()
            if result.returncode: raise RuntimeError(name+' failed; see '+record['log'])
        except Exception as error:
            record.update(status='failed',failure=str(error),seconds=time.monotonic()-start);save();raise
        print('PASS ' + name, flush=True)
    prefix=args.label
    try:
        run('import-identities',['python3','scripts/verify-import.py'])
        run('snapshot-unit',['node','--test','packaging/bun-app/test.mjs'])
        run('assemble-x86',['python3','scripts/sdk.py','as','--32','tests/x86-boot.S','-o','artifacts/x86-boot.o'])
        run('link-x86',['python3','scripts/sdk.py','ld','-m','elf_i386','-Ttext','0x7c00','--oformat','binary','artifacts/x86-boot.o','-o','artifacts/x86-boot.bin'])
        for arch in ['i386','x86_64']:
            runtime=str((build/'runtime'/arch/('qemu-system-'+arch+'.js')).relative_to(ROOT))
            run('boot-'+arch,['node','tests/x86-boot.mjs',runtime,prefix+'-'+arch.replace('_','-')])
        run('automatic-snapshot',['node','packaging/bun-app/test-auto.mjs',prefix+'-automatic'])
        run('manual-snapshot-browser',['node','packaging/bun-app/test-e2e.mjs',prefix+'-snapshots'],timeout=900)
        run('bun-retained',['node','tests/bun-smoke.mjs','runtime/x86_64',prefix+'-bun-retained'])
        run('bun-rebuilt',['node','tests/bun-smoke.mjs',str((build/'runtime/x86_64').relative_to(ROOT)),prefix+'-bun-rebuilt'])
        run('arm-retained',['node','tests/arm64-linux.mjs','runtime/aarch64',prefix+'-arm-retained'])
        run('arm-rebuilt',['node','tests/arm64-linux.mjs',str((build/'runtime/aarch64').relative_to(ROOT)),prefix+'-arm-rebuilt'])
        report['status']='passed'
    except Exception as error:
        report.update(status='failed',failure=str(error))
    finally:
        save()
    print(json.dumps({'status':report['status'],'report':str(out/'validation.json'),'failure':report.get('failure')}),flush=True)
    return report['status']!='passed'


if __name__ == '__main__':
    raise SystemExit(main())
