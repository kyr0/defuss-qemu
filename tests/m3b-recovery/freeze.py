#!/usr/bin/env python3
"""Archive this adapter only; never build, run a guest, or manufacture review.

The frozen implementation/runtime source closure stays an immutable dependency.
Invoke after real host tests and before the independent source-freeze review.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = ('README.md', 'derive.py', 'freeze.py', 'guest.mjs', 'identity.mjs',
         'replay.mjs', 'run.mjs', 'test-replay.mjs')
PREFIX = 'tests/m3b-recovery/'
BASE_MANIFEST_SHA = 'c68689c58c732fd99a858b4e515c3b57934a76c933ca3375600e939fa4e6c1bc'
BASE_REVIEW_SHA = 'f170531cd89c33369f0c2ff803f365677d00adaa3d35883bd3c241c7f0040e39'


def path(value):
    pieces = str(value).split('/')
    assert all(p and p not in ('.', '..') for p in pieces) and not str(value).startswith('/')
    result = ROOT / value
    assert result.resolve() == result, 'Symlink path rejected'
    return result


def identity(data):
    return {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


def sync(directory):
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable(target, data):
    # Every new directory entry, as well as every copied file, is flushed.
    missing = []
    parent = target.parent
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    for directory in reversed(missing):
        directory.mkdir()
        sync(directory.parent)
    with target.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync(target.parent)


def freeze(args):
    out = path(args.output)
    assert out.parent == ROOT / 'artifacts' and not out.exists()
    assert args.test_evidence, 'Retain actual host-test evidence before freeze'
    inventory = {}

    def read(name, expected=None):
        data = path(name).read_bytes()
        actual = identity(data)
        if expected:
            if isinstance(expected, str):
                expected = {'sha256': expected}
            for key in ('sha256', 'bytes'):
                if key in expected:
                    assert actual[key] == expected[key], name
        if name in inventory:
            assert inventory[name] == actual
        inventory[name] = actual
        return data

    manifest_bytes = read(args.base_manifest, {'sha256': BASE_MANIFEST_SHA})
    review_bytes = read(args.base_review, {'sha256': BASE_REVIEW_SHA})
    manifest, review = json.loads(manifest_bytes), json.loads(review_bytes)
    assert manifest['kind'] == 'm3b-implementation-source-freeze'
    assert review['status'] == 'passed' and review['sourceBlockers'] == []
    assert review['sourceManifest']['path'] == args.base_manifest
    assert review['sourceManifest']['sha256'] == BASE_MANIFEST_SHA
    for row in manifest['files']:
        read(row['path'], row)
        read(row['archive'], row)
    for name, expected in manifest['dependencies'].items():
        read(name, expected)
    for name in args.test_evidence:
        assert name.startswith('artifacts/')
        read(name)
    dependencies = dict(inventory)
    authored = [(PREFIX + name, read(PREFIX + name)) for name in NAMES]
    assert sorted(p.name for p in path(PREFIX.rstrip('/')).iterdir() if p.is_file()) == sorted(NAMES)
    out.mkdir()
    sync(out.parent)
    rows = []
    for name, data in authored:
        archive = args.output + '/source/' + name
        durable(path(archive), data)
        rows.append({'path': name, 'archive': archive, **identity(data)})
    # Fail closed if any source/evidence changed during archive publication.
    for name, expected in inventory.items():
        assert identity(path(name).read_bytes()) == expected, name
    result = {'schema': 1, 'kind': 'm3b-recovery-source-freeze', 'status': 'frozen',
              'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'timingEligible': False,
              'baseSourceManifest': {'path': args.base_manifest, **identity(manifest_bytes)},
              'baseSourceReview': {'path': args.base_review, **identity(review_bytes)},
              'files': rows, 'dependencies': dict(sorted(dependencies.items())),
              'testEvidence': [{'path': n, **inventory[n]} for n in args.test_evidence],
              'scope': 'New host adapter only. Runtime and guest image unchanged. Independent review and real runs remain separate.'}
    durable(out / 'manifest.json', (json.dumps(result, indent=2) + '\n').encode())
    print(json.dumps({'manifest': args.output + '/manifest.json', 'files': len(rows),
                      'dependencies': len(dependencies), 'status': 'frozen'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--base-manifest', default='artifacts/m3b-implementation-source-01/manifest.json')
    parser.add_argument('--base-review', default='artifacts/m3b-implementation-source-review-01/review.json')
    parser.add_argument('--test-evidence', action='append', default=[])
    freeze(parser.parse_args())
