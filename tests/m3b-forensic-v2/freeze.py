#!/usr/bin/env python3
"""Durably freeze this forensic host adapter; no engine/image build or guest."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = ('README.md', 'config.mjs', 'transport.mjs', 'oracle.mjs', 'journal.mjs',
         'guest.mjs', 'run.mjs', 'identity.mjs', 'freeze.py', 'test.mjs',
         'test-transport.mjs', 'trace.mjs', 'test-trace.mjs', 'inspect.mjs')
BASE = 'artifacts/m3b-implementation-source-01/manifest.json'
REVIEW = 'artifacts/m3b-implementation-source-review-01/review.json'
PINS = {BASE: 'c68689c58c732fd99a858b4e515c3b57934a76c933ca3375600e939fa4e6c1bc',
        REVIEW: 'f170531cd89c33369f0c2ff803f365677d00adaa3d35883bd3c241c7f0040e39'}
PRIOR = 'artifacts/m3b-forensic-source-01/manifest.json'
PRIOR_REVIEW = 'artifacts/m3b-forensic-source-review-01/review.json'
PINS.update({PRIOR: '5a400b98706265fb7cb4b5ff6b416e4c354261f4d7482beaf1c2d74d39cd55e7',
             PRIOR_REVIEW: 'ea37061a401a44893b39a46d66f5766ad56f134c5d9017912b1fe5db755f16c6'})


def path(name):
    assert not name.startswith('/') and all(p and p not in ('.', '..') for p in name.split('/'))
    p = ROOT / name
    assert p.resolve() == p
    return p


def identity(data):
    return {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


def sync(p):
    fd = os.open(p, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write(p, data):
    missing, current = [], p.parent
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        directory.mkdir()
        sync(directory.parent)
    with p.open('xb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    sync(p.parent)


def main(args):
    out = path(args.output)
    assert out.parent == ROOT / 'artifacts' and not out.exists()
    assert args.test_evidence
    inventory = {}

    def read(name, expected=None):
        data = path(name).read_bytes()
        actual = identity(data)
        if isinstance(expected, str):
            expected = {'sha256': expected}
        for key in ('sha256', 'bytes'):
            if expected and key in expected:
                assert actual[key] == expected[key], name
        if name in inventory:
            assert inventory[name] == actual
        inventory[name] = actual
        return data

    base = json.loads(read(BASE, PINS[BASE]))
    review = json.loads(read(REVIEW, PINS[REVIEW]))
    assert review['status'] == 'passed' and review['sourceBlockers'] == []
    assert review['sourceManifest']['sha256'] == PINS[BASE]
    for row in base['files']:
        read(row['path'], row)
        read(row['archive'], row)
    for name, expected in base['dependencies'].items():
        read(name, expected)
    prior = json.loads(read(PRIOR, PINS[PRIOR]))
    prior_review = json.loads(read(PRIOR_REVIEW, PINS[PRIOR_REVIEW]))
    assert prior_review['status'] == 'passed' and prior_review['sourceBlockers'] == []
    assert prior_review['sourceManifest']['sha256'] == PINS[PRIOR]
    for row in prior['files']:
        read(row['path'], row)
        read(row['archive'], row)
    for name, expected in prior['dependencies'].items():
        read(name, expected)
    failure_path = 'artifacts/m3b-forensic-on-01/report.json'
    failure = json.loads(read(failure_path))
    assert failure['status'] == 'failed' and failure['oracleFailure'] is None
    assert 'Unacknowledged byte bound' in failure['failure']
    for item in failure['artifacts'].values():
        read('artifacts/m3b-forensic-on-01/' + item['path'], item)
    for name in ['request.json', 'sdk-invocation-complete.json']:
        read('artifacts/m3b-forensic-on-01/' + name)
    for name in ['execution.json', 'process.json', 'stdout.log', 'browser-cleanup.json',
                 'controller.py', 'stderr.log', 'request.json']:
        read('artifacts/m3b-forensic-execution-01/' + name)
    for name in ['artifacts/m3b-fallthrough-on-01/report.json',
                 'artifacts/m3b-fallthrough-on-01/progress.jsonl',
                 'artifacts/m3b-baseline-on-failure-diagnosis-01/review.json',
                 'artifacts/m3b-source-01/source/util/log.c',
                 'artifacts/m3b-source-01/source/accel/tcg/cpu-exec.c',
                 'artifacts/m3b-build-01/runtime/x86_64/qemu-system-x86_64.js',
                 *args.test_evidence]:
        assert name.startswith('artifacts/')
        read(name)
    dependencies = dict(inventory)
    authored = [('tests/m3b-forensic-v2/' + n, read('tests/m3b-forensic-v2/' + n)) for n in NAMES]
    assert sorted(p.name for p in path('tests/m3b-forensic-v2').iterdir() if p.is_file()) == sorted(NAMES)
    out.mkdir()
    sync(out.parent)
    rows = []
    for name, data in authored:
        archive = args.output + '/source/' + name
        write(path(archive), data)
        assert identity(path(archive).read_bytes()) == identity(data), archive
        rows.append({'path': name, 'archive': archive, **identity(data)})
    for name, expected in inventory.items():
        assert identity(path(name).read_bytes()) == expected, name
    result = {'schema': 1, 'kind': 'm3b-forensic-v2-source-freeze', 'status': 'frozen',
              'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'timingEligible': False, 'baseSourceManifest': {'path': BASE, **inventory[BASE]},
              'baseSourceReview': {'path': REVIEW, **inventory[REVIEW]}, 'files': rows,
              'priorAttempt': {'sourceManifest': {'path': PRIOR, **inventory[PRIOR]},
                               'sourceReview': {'path': PRIOR_REVIEW, **inventory[PRIOR_REVIEW]},
                               'report': {'path': failure_path, **inventory[failure_path]},
                               'status': 'failed', 'acceptance': False,
                               'reason': 'Bounded transport overflow before the first warm gate; no oracle failure or acceptance.'},
              'dependencies': dict(sorted(dependencies.items())),
              'testEvidence': [{'path': n, **inventory[n]} for n in args.test_evidence],
              'scope': 'Host diagnostic source only. No causal verdict, engine changes, image changes or relaxed original acceptance.'}
    write(out / 'manifest.json', (json.dumps(result, indent=2) + '\n').encode())
    print(json.dumps({'status': 'frozen', 'manifest': args.output + '/manifest.json', 'files': len(rows)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--test-evidence', action='append', default=[])
    main(parser.parse_args())
