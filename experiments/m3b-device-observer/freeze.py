#!/usr/bin/env python3
"""Freeze reviewed OFF observer sources; never execute tests, Lima or a runtime.

Run only in a root-coordinated gap with source authors quiet. See FREEZE.md.
Failed stages and publication locks are retained for explicit inspection.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid

ROOT = Path(__file__).resolve().parents[2]
HERE = 'experiments/m3b-device-observer'
DRAFT = 'artifacts/m3b-device-observer-draft-02/manifest.json'
DRAFT_SHA = '7d74d982fb4a012456b57010014f976952fc625cd9c339f86fa55db90ee84588'
REVIEW = 'artifacts/m3b-current-source-review-01/review.json'
REVIEW_SHA = '97893dcdf86588d7909013f26a446ce8ea4bc08e8e6d6cea9d7fc2da1803aca1'
MAX_FILE, MAX_TOTAL, MAX_FILES = 8 * 1024**2, 32 * 1024**2, 256
LOCAL_HELPERS = [
    'host/browser/qmp.mjs', 'host/browser/machine.mjs',
    'experiments/m3a-region/reader.mjs',
    'benchmarks/harness/m2-sustained-v2/host-condition.mjs',
]
METADATA = {
    'artifacts/m3a-build-01/build-report.json': '86537d2bd206097fb36303a15b0563a96404aca24332c25ac2bc164d387d643c',
    'artifacts/m3a-build-01/source-recheck.json': '078bb8264b4cfb52a32ad2aac29cbc8a2634b4859bf90a863a5ff340b4711099',
    'artifacts/m3a-source-04/source-m3-overlay.json': '382f59faebb37a485a02797475438091546ce5dd3d914794c824a474e018e359',
    'artifacts/m3-region-fixture-02/build-report.json': '1a48e0875417e9616b6febb20985fa59603701d81babae51a22e6ad955f295c6',
    'artifacts/m3-region-fixture-source-05.json': 'f004b82803dd382966842027496ca641e7f69369801c36d89755670bf4e1631c',
    'artifacts/m3-region-on-03/report.json': 'd93f8784feded20469bb79ed7b33cbd1661d8392964502bf0fd2f95f0d75b1d2',
}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def safe_path(root, name):
    p = Path(name)
    require(not p.is_absolute() and p.parts and '..' not in p.parts, 'Relative project path required: ' + str(name))
    path = root / p
    require(path.resolve() == path, 'Symlink or noncanonical path refused: ' + str(name))
    return path


def read_stable(root, name):
    path = safe_path(root, name)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_FILE, 'Regular bounded input required: ' + name)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        require(signature(before) == signature(os.fstat(stream.fileno())), 'Input replaced before read: ' + name)
        data = stream.read(MAX_FILE + 1)
        require(signature(before) == signature(os.fstat(stream.fileno())), 'Input changed during read: ' + name)
    require(len(data) == before.st_size and signature(before) == signature(path.lstat()), 'Input changed/replaced: ' + name)
    return data, signature(before)


def durable_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync_dir(path.parent)


def json_data(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()


def selection(root, evidence):
    """Explicit bounded closure. Parse only local module specifiers, never import."""
    selected = {}

    def add(name, expected=None, role='dependency'):
        data, sig = read_stable(root, name)
        if expected:
            require(digest(data) == expected, 'Pinned input changed: ' + name)
        if name in selected:
            require(selected[name]['data'] == data and selected[name]['signature'] == sig, 'Input drift: ' + name)
        else:
            selected[name] = {'data': data, 'signature': sig, 'role': role}
        require(len(selected) <= MAX_FILES and sum(len(v['data']) for v in selected.values()) <= MAX_TOTAL, 'Freeze selection bounds')
        return data

    draft = json.loads(add(DRAFT, DRAFT_SHA, 'draft-manifest'))
    review = json.loads(add(REVIEW, REVIEW_SHA, 'source-review'))
    require(review['kind'] == 'm3b-current-source-and-off-observer-review', 'Wrong review')
    expected_names = {HERE + '/' + n for n in ['run.mjs', 'browser.mjs', 'graph.mjs', 'test-graph.mjs', 'README.md']}
    require({r['path'] for r in draft['files']} == expected_names and len(draft['files']) == 5, 'Unexpected draft closure')
    for row in draft['files']:
        require(len(add(row['path'], row['sha256'], 'observer-source')) == row['bytes'], 'Draft size mismatch')
        require(add(row['archive'], row['sha256'], 'prior-archive') == selected[row['path']]['data'], 'Draft archive mismatch')
    for row in draft['dependencies']:
        add(row['path'], row['sha256'])
    previous = draft['previousDraft']
    old = json.loads(add(previous['path'], previous['sha256'], 'prior-manifest'))
    for row in old['files']:
        require(len(add(row['archive'], row['sha256'], 'prior-archive')) == row['bytes'], 'Prior archive size mismatch')
    # The review's M3b implementation inventory is historical source context,
    # not a new mutable dependency of this old-runtime OFF observation.
    for name in ['artifacts/m3b-device-lifecycle-review-0' + str(i) + '/review.json' for i in (1, 2, 3)]:
        identity = next(v for v in review['inventory'] if v['path'] == name)
        add(name, identity['sha256'], 'source-review-dependency')
    for name in LOCAL_HELPERS + ['scripts/with-tmp.py', 'package.json', 'package-lock.json']:
        add(name)
    require(digest(selected['experiments/m3a-region/reader.mjs']['data']) == 'e54b4e804d9631039677e097646c766f68892fbec7dcfeb24890db96fae973af', 'Frozen M3 reader changed')
    for name, expected in METADATA.items():
        add(name, expected, 'runtime-metadata')
    for name in ['freeze.py', 'test-freeze.py', 'FREEZE.md']:
        add(HERE + '/' + name, role='freeze-tool-source')
    require(1 <= len(evidence) <= 16 and len(set(evidence)) == len(evidence), 'Supply 1..16 unique retained test evidence files')
    for name in evidence:
        require(Path(name).parts[0] == 'artifacts', 'Test evidence must be retained under artifacts')
        add(name, role='test-evidence')
    imports = []
    for name, row in list(selected.items()):
        if not name.endswith('.mjs') or row['role'] == 'prior-archive':
            continue
        text = row['data'].decode()
        specs = re.findall(r'\bfrom\s*[\'\"]([^\'\"]+)[\'\"]|\bimport\s*[\'\"]([^\'\"]+)[\'\"]|\bimport\s*\(\s*[\'\"]([^\'\"]+)[\'\"]\s*\)', text)
        for match in specs:
            specifier = next(v for v in match if v)
            if specifier.startswith('.') or specifier.startswith('/'):
                target = (root / specifier.lstrip('/')) if specifier.startswith('/') else root / Path(name).parent / specifier
                target = target.resolve().relative_to(root).as_posix()
                require(target in selected, 'Unarchived local import: ' + name + ' -> ' + target)
            else:
                require(specifier.startswith('node:') or specifier == 'playwright', 'Unknown package import: ' + specifier)
                target = None
            imports.append({'source': name, 'specifier': specifier, 'localTarget': target})
    return selected, imports


def publish(root, output, selected, context):
    destination = safe_path(root, output)
    require(destination.parent == root / 'artifacts', 'Output must be a direct fresh artifacts child')
    require(not destination.exists(), 'Output already exists')
    safe_path(root, 'artifacts')
    scratch = safe_path(root, 'tmp')
    require(scratch.is_dir(), 'Project tmp must already exist')
    lock = destination.parent / ('.' + destination.name + '.freeze-lock')
    lock.mkdir(mode=0o700)  # Atomic exclusion; no automatic stale-lock recovery.
    sync_dir(lock.parent)
    stage = scratch / ('m3b-observer-freeze-' + uuid.uuid4().hex)
    stage.mkdir(mode=0o700)
    sync_dir(scratch)
    durable_file(lock / 'owner.json', json_data({'pid': os.getpid(), 'createdUtc': utc(), 'stage': str(stage), 'destination': str(destination)}))
    published = False
    try:
        rows = []
        for name, row in sorted(selected.items()):
            archive = Path('source') / name
            durable_file(stage / archive, row['data'])
            rows.append({'path': name, 'archive': (Path(output) / archive).as_posix(),
                         'sha256': digest(row['data']), 'bytes': len(row['data']), 'role': row['role']})
        for row in rows:
            name = row['path']
            archive = stage / 'source' / name
            saved, _ = read_stable(stage, archive.relative_to(stage).as_posix())
            require(digest(saved) == row['sha256'] and len(saved) == row['bytes'], 'Archive mismatch: ' + name)
            current, sig = read_stable(root, name)
            require(sig == selected[name]['signature'] and current == saved, 'Live input changed during freeze: ' + name)
        manifest = {'schema': 1, 'kind': 'm3b-off-device-observer-source-freeze', 'status': 'source-frozen',
                    'createdUtc': utc(), 'files': rows, **context,
                    'runtimeExecuted': False, 'timingEligible': False, 'eligibilityEstablished': False,
                    'testStatusInferred': False,
                    'scope': 'Verified immutable source closure and retained evidence, not runtime or test acceptance. Test evidence is copied exactly; tests are never executed or inferred by this helper.'}
        encoded_manifest = json_data(manifest)
        durable_file(stage / 'manifest.json', encoded_manifest)
        saved_manifest, _ = read_stable(stage, 'manifest.json')
        require(saved_manifest == encoded_manifest, 'Manifest readback mismatch')
        # Sync every newly created ancestor before the directory is published.
        for folder in sorted((p for p in stage.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            sync_dir(folder)
        sync_dir(stage)
        require(not destination.exists(), 'Destination appeared before publication')
        os.rename(stage, destination)
        published = True
        sync_dir(destination.parent)
        sync_dir(scratch)
        (lock / 'owner.json').unlink()
        lock.rmdir()
        sync_dir(destination.parent)
        return manifest
    except Exception as error:
        retained = destination if published else stage
        raise RuntimeError(f'Freeze failed; retain {retained} and publication lock {lock}: {error}') from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--test-evidence', action='append', required=True)
    args = parser.parse_args()
    selected, imports = selection(ROOT, args.test_evidence)
    context = {'draft': {'path': DRAFT, 'sha256': DRAFT_SHA}, 'sourceReview': {'path': REVIEW, 'sha256': REVIEW_SHA},
               'imports': imports, 'testEvidence': args.test_evidence,
               'externalDependencies': {'playwright': 'package.json and package-lock.json archived; node_modules not copied',
                                        'runtimeAssets': 'Retained build/fixture metadata archived; actual runner rehashes binary inputs',
                                        'chromeAndLima': 'Actual runner requires Chrome path and records/enforces Lima executable identity and builder Stopped'}}
    manifest = publish(ROOT, args.output, selected, context)
    path = ROOT / args.output / 'manifest.json'
    print(json.dumps({'status': manifest['status'], 'manifest': str(path.relative_to(ROOT)),
                      'sha256': digest(path.read_bytes()), 'files': len(manifest['files'])}))


if __name__ == '__main__':
    main()
