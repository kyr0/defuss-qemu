#!/usr/bin/env python3
"""Durable M3b source freeze, full post-build recheck and real-evidence binding.

Run only in a root-authorized safe interval. No builds, browsers or guests are
launched. bind invokes the reviewed Node identity consumer before publication.
Failed/incomplete outputs and project/tmp staging are deliberately retained.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
HERE = 'experiments/m3b-fallthrough'
BASE = 'artifacts/m3a-source-04/source'
BASE_SHA = 'b517b8d6c23d67db7e74fe4d2d5c4ff421693cb01b86c8666ffba006ca772d49'
SDK = 'registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812'
ROOTS = (HERE, 'tests/m3b-fallthrough', 'tests/m3b-boundary', 'tests/m3b-profile')
SUFFIXES = {'.py', '.mjs', '.js', '.h', '.c', '.S', '.inc', '.md'}
RUNTIME = (
    'runtime/audio/backend.mjs', 'runtime/audio/pcm.mjs', 'runtime/audio/ringbuf.mjs',
    'runtime/graphics.mjs', 'runtime/native-counters.mjs',
    'runtime/x86_64/qemu-system-x86_64.js', 'runtime/x86_64/qemu-system-x86_64.wasm',
)
ASSETS = ('assets/bun/amd64/vmlinuz-virt', 'engine/qemu/pc-bios/bios-256k.bin',
          'engine/qemu/pc-bios/kvmvapic.bin', 'engine/qemu/pc-bios/linuxboot_dma.bin')
DEPENDENCIES = (
    'scripts/sdk.py', 'scripts/build.py', 'scripts/container_engine.py',
    'scripts/runtime_dependencies.py', 'scripts/fix-emscripten-poll.py',
    'scripts/expose-profile.py', 'scripts/helper-profile-runtime.js',
    'scripts/native-unwind-runtime.js', 'scripts/with-tmp.py', 'packaging/bun_app_package.py',
    'assets/bun/amd64/initramfs-virt', *ASSETS,
    'host/browser/audio/backend.mjs', 'host/browser/audio/pcm.mjs',
    'host/browser/audio/ringbuf.mjs', 'host/browser/graphics.mjs',
    'host/browser/native-counters.mjs', 'package.json', 'package-lock.json',
    'node_modules/playwright/package.json', 'node_modules/playwright-core/package.json',
    'docs/decisions/m3b-fallthrough-design.md',
    'docs/decisions/m3b-fallthrough-budget1-01.md',
    'artifacts/m3b-feasibility-review-01/review.json',
    'artifacts/m3b-post-repeat03-execution-01/execution.json',
    'artifacts/m3a-source-04/source-m3-overlay.json',
    'artifacts/m3a-build-01/source-recheck.json',
    BASE + '/tcg/wasm64.c',
)
IMPORTS = re.compile(r'''(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']''', re.M)


def require(value, message):
    if not value:
        raise ValueError(message)


def inside(value, artifact=False):
    """Canonical project paths only; no symlink or unrecognized SDK root."""
    value = str(value)
    if value.startswith('/project/'):
        value = value[9:]
    elif value.startswith(str(ROOT) + '/'):
        value = value[len(str(ROOT)) + 1:]
    parts = value.split('/')
    require(parts and all(p and p not in ('.', '..') for p in parts) and
            not value.startswith('/'), 'Noncanonical project path: ' + value)
    path = ROOT / value
    require(path.resolve() == path, 'Symlink input/output refused: ' + value)
    if artifact:
        require(parts[0] == 'artifacts' and len(parts) > 1, 'Isolated artifact required')
    return path


def relative(path):
    return str(path.relative_to(ROOT))


def stamp(path):
    s = path.stat()
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def sync(directory):
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def mkdir(path):
    require(not path.exists(), 'Existing evidence is immutable: ' + str(path))
    # Callers select a fresh direct child of an existing artifact directory.
    require(path.parent.is_dir(), 'Create/review the parent directory first')
    path.mkdir()
    sync(path.parent)


def publish(path, value):
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)


class Audit:
    def __init__(self):
        self.identities, self.stamps = {}, {}

    def file(self, value, expected=None):
        path = inside(value)
        before = stamp(path)
        require(path.is_file(), 'Not a regular file: ' + str(path))
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        after = stamp(path)
        require(before == after, 'Changed while hashing: ' + str(path))
        record = {'sha256': digest, 'bytes': after[2]}
        name = relative(path)
        require(name not in self.identities or self.identities[name] == record,
                'Identity changed during audit: ' + name)
        if expected is not None:
            require(type(expected.get('bytes', 0)) is int and
                    all(record[k] == expected[k] for k in ('sha256', 'bytes') if k in expected),
                    'Identity mismatch: ' + name)
        self.identities[name], self.stamps[path] = record, after
        return record

    def bytes(self, value, expected=None):
        path = inside(value)
        record = self.file(path, expected)
        require(record['bytes'] <= 16 * 1024 * 1024, 'Bounded metadata/source read required')
        data = path.read_bytes()
        require(len(data) == record['bytes'] and hashlib.sha256(data).hexdigest() == record['sha256'],
                'Changed during read: ' + str(path))
        self.file(path, record)
        return data

    def read(self, value, expected=None):
        return json.loads(self.bytes(value, expected))

    def ref(self, value):
        return {'path': relative(inside(value)), **self.file(value)}

    def stable(self):
        for path, before in self.stamps.items():
            require(stamp(path) == before, 'Input changed during audit: ' + str(path))


def tree_names(directory):
    directory = inside(directory)
    result = []
    for path in sorted(directory.rglob('*')):
        require(not path.is_symlink(), 'Source tree symlink refused: ' + str(path))
        if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
            result.append(relative(path))
    return result


def authored_names():
    names = sorted(name for directory in ROOTS for name in tree_names(directory))
    require(1 <= len(names) <= 128 and len(set(names)) == len(names), 'Authored source closure bound')
    require(all(Path(name).suffix in SUFFIXES for name in names), 'Unexpected generated/cache file in source closure')
    return names


def graph_contract(a, review_name):
    header = HERE + '/graph-contract.h'
    text = a.bytes(header).decode()
    require(re.search(r'^#define M3B_GRAPH_PINNED 1$', text, re.M), 'Observed reviewed graph must be pinned first')
    values = {}
    for name, limit, rows in [('graph', 131072, 128), ('objects', 16384, 32)]:
        match = re.search(r'static const char m3b_expected_' + name + r'\[\]\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*)+);', text)
        require(match, 'Missing graph/object literals')
        value = ''.join(json.loads(x) for x in re.findall(r'"(?:[^"\\]|\\.)*"', match[1]))
        require(value.endswith('\n') and len(value.encode()) <= limit and len(value.splitlines()) <= rows,
                'Graph/object literal bounds')
        values[name] = hashlib.sha256(value.encode()).hexdigest()
    review = a.read(review_name)
    require(review['status'] == 'passed' and review['graphContract']['sha256'] == a.file(header)['sha256'] and
            review['graphSha256'] == values['graph'] and review['objectsSha256'] == values['objects'],
            'Graph review does not bind the actual pinned header/strings')
    return a.ref(header), a.ref(review_name)


def verify_frozen(a, manifest_name, review_name=None):
    manifest = a.read(manifest_name)
    require(type(manifest['schema']) is int and manifest['schema'] == 1 and manifest['kind'] == 'm3b-implementation-source-freeze' and
            manifest['status'] == 'frozen' and manifest['timingEligible'] is False, 'Wrong source freeze')
    names = [row['path'] for row in manifest['files']]
    require(names == authored_names(), 'Authored source file set changed since freeze')
    require(set(DEPENDENCIES) <= set(names) | set(manifest['dependencies']), 'Mandatory source/build dependency omitted')
    for row in manifest['files']:
        a.file(row['path'], row)
        archive = inside(row['archive'], artifact=True)
        require(archive == inside(manifest_name).parent / 'source' / row['path'], 'Unexpected source archive location')
        a.file(archive, row)
    for name, identity in manifest['dependencies'].items():
        a.file(name, identity)
    if review_name:
        review = a.read(review_name)
        ref = a.ref(manifest_name)
        require(review['status'] == 'passed' and review['sourceBlockers'] == [] and
                all(review['sourceManifest'][k] == ref[k] for k in ('path', 'sha256')),
                'Independent final source review required; draft reviews do not qualify')
    return manifest


def graph_evidence(a, review):
    """Retain the actual OFF observation and independently reviewed observer.

    The graph reviewer owns this inventory and the three named references.
    No observer success or final source-review pass is synthesized here.
    """
    inventory = review['inventory']
    require(type(inventory) is list and 1 <= len(inventory) <= 512, 'Nonempty bounded graph-review inventory required')
    rows = {row['path']: row for row in inventory}
    require(len(rows) == len(inventory), 'Duplicate graph-review inventory paths')
    names = set(rows)
    for name, row in rows.items():
        require(type(row.get('bytes')) is int and row['bytes'] >= 0 and re.fullmatch(r'[a-f0-9]{64}', row['sha256']), 'Complete graph evidence identity required')
        a.file(name, row)
    def bound(ref):
        require(ref['path'] in rows and all(rows[ref['path']][k] == ref[k] for k in ('sha256', 'bytes')), 'Graph reference absent from inventory')
        return a.read(ref['path'], ref)
    observation = bound(review['observation'])
    manifest = bound(review['observerSourceManifest'])
    source_review = bound(review['observerSourceReview'])
    require(observation['protocol'] == 'defuss-m3b-device-observation-v3' and
            observation['status'] == 'observed' and observation['mode'] == 'off' and
            observation['eligibilityEstablished'] is False and observation['inputRecheck'] == [],
            'Only the successful actual v3 OFF observation qualifies')
    require(source_review['status'] == 'passed' and source_review['sourceBlockers'] == [] and
            all(source_review['sourceManifest'][k] == review['observerSourceManifest'][k] for k in ('path', 'sha256')),
            'Final independent observer source review required')
    directory = inside(review['observation']['path'], True).parent
    require(set(observation['artifacts']) == {'qmp.log', 'qtree.txt', 'serial.log', 'events.jsonl'}, 'Exact actual observer artifact closure required')
    for name, identity in observation['artifacts'].items():
        path = relative(directory / name)
        require(path in rows and all(rows[path][k] == identity[k] for k in ('sha256', 'bytes')), 'Raw observer artifact omitted or changed: ' + path)
        a.file(path, identity)
    require(relative(directory / 'preflight.json') in rows, 'Observer preflight identity omitted')
    require(type(manifest['files']) is list and manifest['files'], 'Observer source archive missing')
    for row in manifest['files']:
        for key in ('path', 'archive'):
            a.file(row[key], row)
            names.add(row[key])
    for name, identity in manifest.get('dependencies', {}).items():
        a.file(name, {'sha256': identity} if isinstance(identity, str) else identity)
        names.add(name)
    return names


def freeze(args, out):
    a = Audit()
    names = authored_names()
    header, graph = graph_contract(a, args.graph_review)
    dependencies = set(DEPENDENCIES) | set(args.dependency) | set(args.test_evidence) | {graph['path']}
    require(1 <= len(args.test_evidence) <= 32 and len(set(args.test_evidence)) == len(args.test_evidence),
            'Supply 1..32 unique actual retained test evidence paths')
    for name in args.test_evidence:
        inside(name, artifact=True)
    graph_review = a.read(graph['path'])
    dependencies.update(graph_evidence(a, graph_review))
    pending = list(names) + sorted(dependencies)
    seen, imports = set(), []
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen.add(name)
        require(len(seen) <= 1024, 'Source/dependency closure exceeds 1024 files')
        a.file(name)
        if name.startswith('artifacts/') or Path(name).suffix not in ('.mjs', '.js'):
            continue
        for specifier in IMPORTS.findall(a.bytes(name).decode()):
            if specifier.startswith(('.', '/')):
                target = ROOT / specifier.lstrip('/') if specifier.startswith('/') else ROOT / Path(name).parent / specifier
                # Normalize ../ imports lexically, then reject symlinked paths;
                # resolving first would erase the evidence of a symlink.
                target = Path(os.path.abspath(target))
                local = relative(inside(target))
                imports.append({'source': name, 'specifier': specifier, 'target': local})
                pending.append(local)
                if local not in names:
                    dependencies.add(local)
            else:
                require(specifier.startswith('node:') or specifier == 'playwright', 'Unreviewed package import: ' + specifier)
    require(sum(a.identities[n]['bytes'] for n in names) <= 8 * 1024 * 1024, 'Authored source byte bound')
    files = []
    for name in names:
        data = a.bytes(name)
        archive = out / 'source' / name
        archive.parent.mkdir(parents=True, exist_ok=True)
        publish(archive, data)
        a.file(archive, a.identities[name])
        files.append({'path': name, 'archive': relative(archive), **a.identities[name]})
    require(authored_names() == names, 'Source set changed during freeze')
    a.stable()
    for path in sorted((p for p in out.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        sync(path)
    manifest = {'schema': 1, 'kind': 'm3b-implementation-source-freeze', 'status': 'frozen',
                'timingEligible': False, 'files': files,
                'dependencies': {n: a.identities[n] for n in sorted(dependencies - set(names))},
                'graphContract': header, 'graphReview': graph, 'imports': sorted(imports, key=lambda x: (x['source'], x['specifier'])),
                'testEvidence': args.test_evidence, 'baseFingerprintContract': BASE_SHA,
                'scope': 'Actual source bytes archived; test files retained without synthesizing test or independent-review success.'}
    publish(out / 'manifest.json', manifest)
    return {'manifest': relative(out / 'manifest.json'), 'files': len(files), 'dependencies': len(manifest['dependencies'])}


def fingerprint(files):
    result = hashlib.sha256()
    for name, row in sorted(files.items()):
        result.update(name.encode() + b'\0')
        result.update(bytes.fromhex(row['sha256']))
    return result.hexdigest()


def sdk_tail(source, build, jobs, scratch):
    container_scratch = '/project/' + scratch
    return ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none',
            '-e', 'TMPDIR=' + container_scratch, '-e', 'TMP=' + container_scratch, '-e', 'TEMP=' + container_scratch,
            '-v', str(ROOT) + ':/project', '-v', 'qemu-wasm-arm64-sdk-cache:/emsdk/upstream/emscripten/cache',
            '-w', '/project', SDK, 'python3', 'scripts/build.py', '--source', source,
            '--output', build, '--targets', 'x86_64-softmmu', '--jobs', str(jobs)]


def expected_commands(source, jobs):
    link = ['-pthread', '-msimd128', '-sASYNCIFY=1', '-sPROXY_TO_PTHREAD=1',
            '-sFORCE_FILESYSTEM', '-sALLOW_TABLE_GROWTH', '-sTOTAL_MEMORY=2GB',
            '-sWASM_BIGINT', '-sEXPORT_ES6=1', '-sASYNCIFY_IMPORTS=ffi_call_js',
            '-sEXPORTED_RUNTIME_METHODS=addFunction,removeFunction,TTY,FS',
            '-sSTACK_SIZE=1048576', '-sDEFAULT_PTHREAD_STACK_SIZE=1048576', '-sSTACK_OVERFLOW_CHECK=2']
    return [['emconfigure', '/project/' + source + '/configure', '--static', '--cpu=wasm64',
             '--target-list=x86_64-softmmu', '--disable-werror', '--disable-docs', '--disable-tools',
             '--disable-rust', '--disable-guest-agent', '--disable-plugins', '--disable-download',
             '--without-default-features', '--enable-tcg', '--disable-tcg-interpreter', '--with-coroutine=wasm',
             '-Dc_args=-pthread -msimd128', '-Dc_link_args=' + ' '.join(link), '-Doptimization=2'],
            ['ninja', '-j' + str(jobs), 'qemu-system-x86_64.js']]


def validate_sdk(invocation, invocation_name, source, build, jobs):
    invocation_name = inside(invocation_name)
    require(re.fullmatch(r'tmp/sdk-[A-Za-z0-9_-]+/invocation.json', relative(invocation_name)), 'SDK completion must be original project scratch record')
    scratch = relative(invocation_name.parent)
    tail = sdk_tail(source, build, jobs, scratch)
    require(type(invocation['schema']) is int and invocation['schema'] == 1 and
            invocation['status'] == 'passed' and type(invocation['returncode']) is int and
            invocation['returncode'] == 0 and invocation['sdk'] == SDK and invocation['scratch'] == str(invocation_name.parent) and
            invocation['containerScratch'] == '/project/' + scratch and type(invocation['command']) is list and
            all(type(x) is str and x for x in invocation['command']) and len(invocation['command']) > len(tail) and
            invocation['command'][-len(tail):] == tail, 'Wrong/uncompleted offline SDK invocation')
    start = datetime.datetime.fromisoformat(invocation['startedUtc'])
    finish = datetime.datetime.fromisoformat(invocation['finishedUtc'])
    require(start.tzinfo is not None and finish.tzinfo is not None and finish >= start,
            'SDK timestamps must be ordered timezone-aware values')


def recheck(args, out):
    a = Audit()
    verify_frozen(a, args.manifest, args.review)
    source, build = inside(args.source, True), inside(args.build, True)
    require(not (build / 'source-recheck.json').exists(), 'Existing postbuild proof is immutable')
    overlay_name = source.parent / (source.name + '-m3b-overlay.json')
    overlay = a.read(overlay_name)
    require(type(overlay['schema']) is int and overlay['schema'] == 1 and overlay['kind'] == 'm3b-budget1-diagnostic-overlay' and
            inside(overlay['base']) == inside(BASE) and inside(overlay['source']) == source and
            overlay['baseFingerprint'] == BASE_SHA and overlay['baseFiles'] == 10102 and
            overlay['graphPinned'] is True and overlay['defaultEnabled'] is False and
            overlay['productionEligible'] is False and overlay['timingEligible'] is False and
            all(type(overlay[k]) is int for k in ('budget', 'maximumInstructions', 'maximumBytes')) and
            (overlay['budget'], overlay['maximumInstructions'], overlay['maximumBytes']) == (1, 32, 128),
            'Wrong prepared overlay contract')
    generator = inside(HERE + '/prepare.py')
    require(a.file(generator)['sha256'] == overlay['generatorSha256'], 'Prepared generator differs from reviewed source')
    spec = importlib.util.spec_from_file_location('reviewed_m3b_prepare', generator)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    patched = module.patch_files(inside(BASE))
    expected = [{'path': str(path), 'before': a.file(inside(BASE) / path)['sha256'],
                 'after': hashlib.sha256(text.encode()).hexdigest()} for path, text in patched.items()]
    expected += [{'path': destination, 'before': None, 'after': a.file(HERE + '/' + origin)['sha256']}
                 for origin, destination in module.COPIES.items()]
    require(overlay['changes'] == expected, 'Overlay changes differ from reviewed deterministic generator')
    changes = {row['path']: row for row in expected}
    require(len(changes) == len(expected), 'Duplicate overlay paths')
    base_names, source_names = tree_names(BASE), tree_names(source)
    base_files = {str(inside(n).relative_to(inside(BASE))): a.file(n) for n in base_names}
    source_files = {str(inside(n).relative_to(source)): a.file(n) for n in source_names}
    require(len(base_files) == 10102 and fingerprint(base_files) == BASE_SHA, 'Frozen base changed')
    require(set(source_files) == set(base_files) | {n for n, row in changes.items() if row['before'] is None}, 'Prepared source file set differs')
    checked = []
    for name, identity in source_files.items():
        if name in changes:
            row = changes[name]
            require(identity['sha256'] == row['after'] and base_files.get(name, {}).get('sha256') == row['before'], 'Prepared change mismatch: ' + name)
            checked.append({**row, 'observedAfter': identity['sha256'], 'passed': True})
        else:
            require(identity == base_files[name], 'Unexpected prepared modification: ' + name)
    current_fingerprint = fingerprint(source_files)
    report = a.read(build / 'build-report.json')
    require(type(report['schema']) is int and report['schema'] == 1 and report['status'] == 'passed' and report['sdk'] == SDK and
            report['targets'] == ['x86_64-softmmu'] and inside(report['source']) == source and
            report['sourceFingerprint'] == current_fingerprint and report['commands'] == expected_commands(relative(source), args.jobs),
            'Build report source/SDK/commands/status mismatch')
    require([r['step'] for r in report['runs']] == ['configure', 'compile'] and
            all(type(r['returncode']) is int and r['returncode'] == 0 for r in report['runs']), 'Unsuccessful build steps')
    invocation_name = inside(args.sdk_invocation)
    invocation_bytes = a.bytes(invocation_name)
    invocation = json.loads(invocation_bytes)
    validate_sdk(invocation, invocation_name, relative(source), relative(build), args.jobs)
    actual_runtime = {str(inside(n).relative_to(build)) for n in tree_names(build / 'runtime')}
    require(actual_runtime == set(RUNTIME) == set(report['artifacts']), 'Runtime must contain exactly seven companion files')
    runtime = {n: {**a.file(build / n, report['artifacts'][n]), 'matchesBuildReport': True} for n in RUNTIME}
    require(base_names == tree_names(BASE) and source_names == tree_names(source), 'Source list changed during recheck')
    a.stable()
    publish(out / 'sdk-invocation-complete.json', invocation_bytes)
    publish(out / 'inventory.json', {'schema': 1, 'identities': a.identities, 'baseFiles': base_files, 'sourceFiles': source_files})
    result = {'schema': 1, 'kind': 'm3b-postbuild-source-recheck', 'status': 'passed', 'timingEligible': False,
              'buildReport': a.ref(build / 'build-report.json'), 'overlayManifest': a.ref(overlay_name),
              'sourceManifest': a.ref(args.manifest), 'sourceReview': a.ref(args.review),
              'source': {'path': relative(source), 'fingerprintBeforeBuild': report['sourceFingerprint'],
                         'fingerprintAfterBuild': current_fingerprint, 'matches': True, 'files': len(source_files)},
              'overlayChecks': checked, 'runtimeArtifacts': runtime,
              'sdkInvocation': a.ref(out / 'sdk-invocation-complete.json'), 'sdkOriginal': a.ref(invocation_name),
              'inventory': a.ref(out / 'inventory.json'), 'tool': a.ref(HERE + '/provenance.py'),
              'scope': 'Actual full source/overlay/runtime/SDK evidence recheck only. No guest, generated-code or performance acceptance.'}
    a.stable()
    publish(out / 'review.json', result)
    publish(build / 'source-recheck.json', result)
    return {'status': 'passed', 'sourceFingerprint': current_fingerprint, 'sourceRecheck': relative(build / 'source-recheck.json')}


def bind(args, out):
    a = Audit()
    manifest = verify_frozen(a, args.manifest, args.review)
    header, graph = graph_contract(a, args.graph_review)
    require(manifest['graphContract'] == header and manifest['graphReview'] == graph, 'Graph proof changed since source freeze')
    build = inside(args.build, True)
    rechecked = a.read(build / 'source-recheck.json')
    require(rechecked['kind'] == 'm3b-postbuild-source-recheck' and rechecked['status'] == 'passed' and
            rechecked['sourceManifest'] == a.ref(args.manifest) and rechecked['sourceReview'] == a.ref(args.review) and
            rechecked['tool'] == a.ref(HERE + '/provenance.py'), 'Recheck is not bound to the final reviewed source/tool')
    for key in ('inventory', 'sdkInvocation', 'buildReport', 'overlayManifest'):
        ref = rechecked[key]
        a.file(ref['path'], ref)
    assets = {name: a.file(name, manifest['dependencies'][name]) for name in ASSETS}
    binding = {'schema': 1, 'kind': 'm3b-differential-runtime-binding-v1', 'status': 'passed',
               'timingEligible': False, 'profile': 1, 'sourceFingerprint': rechecked['source']['fingerprintAfterBuild'],
               'runtime': relative(build / 'runtime/x86_64'), 'buildReport': a.ref(build / 'build-report.json'),
               'overlayManifest': rechecked['overlayManifest'], 'sourceRecheck': a.ref(build / 'source-recheck.json'),
               'sourceManifest': a.ref(args.manifest), 'sourceReview': a.ref(args.review),
               'graphContract': header, 'graphReview': graph, 'assets': assets}
    temporary = inside('tmp')
    require(temporary.is_dir(), 'Project tmp must exist')
    scratch = Path(tempfile.mkdtemp(prefix='m3b-bind-', dir=temporary))
    sync(temporary)
    stage = scratch / 'candidate-binding.json'
    publish(stage, binding)
    consumer = inside('tests/m3b-fallthrough/runtime-identity.mjs')
    code = "const m=await import(process.argv[1]);await m.verifyRuntimeBinding(process.argv[2],process.argv[3]);console.log('actual-runtime-binding-verified');"
    command = ['node', '--input-type=module', '-e', code, consumer.as_uri(), str(ROOT), relative(stage)]
    result = subprocess.run(command, cwd=ROOT, env={**os.environ, 'TMPDIR': str(scratch), 'TMP': str(scratch), 'TEMP': str(scratch)},
                            capture_output=True, timeout=300)
    publish(scratch / 'verification.json', {'argv': command, 'exitCode': result.returncode,
                                          'stdout': result.stdout.decode(errors='replace'), 'stderr': result.stderr.decode(errors='replace')})
    require(result.returncode == 0 and result.stdout == b'actual-runtime-binding-verified\n', 'Reviewed fixture identity consumer rejected binding; scratch retained')
    require(a.bytes(stage) == (json.dumps(binding, indent=2) + '\n').encode(), 'Staged binding changed')
    a.stable()
    publish(out / 'binding.json', binding)
    publish(out / 'verification.json', {'schema': 1, 'status': 'passed', 'binding': a.ref(out / 'binding.json'),
                                       'verification': a.ref(scratch / 'verification.json'), 'scope': 'Identity acceptance only; no guest executed.'})
    return {'binding': relative(out / 'binding.json'), 'status': 'passed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    f = sub.add_parser('freeze')
    f.add_argument('--output', required=True)
    f.add_argument('--graph-review', required=True)
    f.add_argument('--test-evidence', action='append', required=True)
    f.add_argument('--dependency', action='append', default=[])
    r = sub.add_parser('recheck')
    b = sub.add_parser('bind')
    for p in (r, b):
        for name in ('output', 'manifest', 'review', 'build'):
            p.add_argument('--' + name, required=True)
    r.add_argument('--source', required=True)
    r.add_argument('--sdk-invocation', required=True)
    r.add_argument('--jobs', type=int, choices=range(1, 65), default=8)
    b.add_argument('--graph-review', required=True)
    args = parser.parse_args()
    out = inside(args.output, True)
    mkdir(out)
    publish(out / 'started.json', {'schema': 1, 'operation': args.operation,
                                 'argv': sys.argv, 'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    try:
        result = {'freeze': freeze, 'recheck': recheck, 'bind': bind}[args.operation](args, out)
    except BaseException as error:
        publish(out / 'failure.json', {'schema': 1, 'status': 'failed', 'error': repr(error), 'retained': True})
        raise
    print(json.dumps(result))


if __name__ == '__main__':
    main()
