#!/usr/bin/env python3
"""Verify consolidated QEMU import and retained runtime/guest identities."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    if path.is_symlink() and path.is_dir():
        return hashlib.sha256(str(path.readlink()).encode()).hexdigest()
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    imported = json.loads((ROOT / 'manifests/qemu-import.json').read_text())
    errors = []
    for name, info in imported['files'].items():
        path = ROOT / 'engine/qemu' / name
        expected = imported['metadataEdits'].get(name, info)['sha256']
        if not path.exists() or sha(path) != expected:
            errors.append('Source identity mismatch: ' + name)
        if path.is_symlink() and not path.resolve().is_relative_to(ROOT / 'engine/qemu'):
            errors.append('External source symlink: ' + name)
    for name in imported['excluded']:
        if (ROOT / 'engine/qemu' / name).exists():
            errors.append('Excluded source reintroduced: ' + name)
    retained = json.loads((ROOT / 'manifests/imported-artifacts.json').read_text())
    pins = {name: info for name, info in retained.items()
            if name.startswith(('runtime/', 'assets/', 'benchmarks/', 'docs/evidence/',
                                'manifests/history/', 'tests/fixtures/'))}
    for name, info in pins.items():
        if not (ROOT / name).is_file() or sha(ROOT / name) != info['sha256']:
            errors.append('Retained artifact mismatch: ' + name)
    baseline = ROOT / 'manifests/runtime-baseline.json'
    baseline_count = 0
    if baseline.exists():
        for runtime in json.loads(baseline.read_text())['runtimes'].values():
            for name, info in runtime['files'].items():
                baseline_count += 1
                if not (ROOT / name).is_file() or sha(ROOT / name) != info['sha256']:
                    errors.append('Runtime baseline mismatch: ' + name)
    for directory in ['packaging', 'tests', 'host/browser']:
        for path in (ROOT / directory).rglob('*'):
            if path.suffix not in {'.py', '.mjs', '.js', '.ts'}: continue
            text = path.read_text()
            if 'qemu-wasm-win9x-v0.6.8/' in text or 'native-build/' in text or '.browser-tools/' in text:
                errors.append('Old workspace dependency: ' + str(path.relative_to(ROOT)))
    result = {'status':'failed' if errors else 'passed', 'qemuFilesChecked':len(imported['files']),
              'excludedPathsChecked':len(imported['excluded']), 'retainedArtifactsChecked':len(pins),
              'runtimeBaselineFilesChecked':baseline_count,
              'errors':errors, 'importTotals':imported['totals']}
    print(json.dumps(result, indent=2))
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
