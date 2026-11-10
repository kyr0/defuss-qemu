#!/usr/bin/env python3
"""Select a completed three-target build without replacing historical runtimes."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', type=Path, required=True)
    args = parser.parse_args()
    build = args.build.resolve()
    if not build.is_relative_to(ROOT): parser.error('Build must be inside this project')
    report = json.loads((build / 'build-report.json').read_text())
    candidate = json.loads((ROOT / 'manifests/consolidation-candidate.json').read_text())
    assert report['status'] == 'passed'
    assert report['sourceFingerprint'] == candidate['sourceFingerprint'], 'Wrong candidate source'
    assert set(report['targets']) == {'x86_64-softmmu', 'i386-softmmu', 'aarch64-softmmu'}
    destination = ROOT / 'runtime/current'
    assert not destination.exists(), 'Preserve the prior selection before replacing it'
    history = ROOT / 'manifests/history' / (build.name + '.json')
    build_record = (build / 'build-report.json').read_bytes()
    if history.exists():
        assert history.read_bytes() == build_record, 'Preserve the prior build record; use a fresh build label'
    selected = {'schema': 1, 'selection': 'User-selected newest MSG1 candidate, enabled before translation',
                'sourceFingerprint': report['sourceFingerprint'], 'buildReport': str((build / 'build-report.json').relative_to(ROOT)),
                'configuration': {'msg1': True, 'hotLimit': 1500, 'runtimeFlags': 3}, 'runtimes': {}}
    for architecture in ['x86_64', 'i386', 'aarch64']:
        files = {}
        for suffix in ['js', 'wasm']:
            name = 'qemu-system-' + architecture + '.' + suffix
            path = build / 'runtime' / architecture / name
            with path.open('rb') as f: digest = hashlib.file_digest(f, 'sha256').hexdigest()
            identity = {'bytes': path.stat().st_size, 'sha256': digest}
            assert identity == report['artifacts']['runtime/' + architecture + '/' + name]
            files[name] = identity
        selected['runtimes'][architecture] = {'directory': 'runtime/current/' + architecture, 'files': files}
    shutil.copytree(build / 'runtime', destination)
    (ROOT / 'manifests/runtime-selected.json').write_text(json.dumps(selected, indent=2) + '\n')
    if not history.exists():
        with history.open('xb') as stream:
            stream.write(build_record)
    print(json.dumps({'status': 'passed', 'sourceFingerprint': report['sourceFingerprint'], 'runtimes': selected['runtimes']}))
