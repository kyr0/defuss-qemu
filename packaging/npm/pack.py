#!/usr/bin/env python3
"""Build an immutable local npm tarball and record its actual published file sizes."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]


def pack():
    label = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]
    output = ROOT / 'output/npm' / label
    output.mkdir(parents=True)
    env = dict(os.environ, npm_config_cache=str(ROOT / 'tmp/npm-cache'))
    with (output / 'build.log').open('w') as log:
        subprocess.run([sys.executable, '-B', str(ROOT / 'packaging/npm/build.py')], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    result = subprocess.run(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', str(output)], cwd=ROOT, env=env, text=True, capture_output=True, check=True)
    packed = json.loads(result.stdout)[0]
    (output / 'npm-pack.json').write_text(json.dumps(packed, indent=2) + '\n')
    manifest = json.loads((ROOT / 'dist/manifest.json').read_text())
    report = {'status': 'passed', 'label': label, 'tarball': str((output / packed['filename']).relative_to(ROOT)),
              'packageBytes': packed['size'], 'unpackedBytes': packed['unpackedSize'], 'fileCount': packed['entryCount'],
              'integrity': packed['integrity'], 'runtimes': manifest['runtimes']}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    (ROOT / 'output/npm/latest.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    print(json.dumps(pack()))
