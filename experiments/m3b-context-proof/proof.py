#!/usr/bin/env python3
"""Compose, freeze and bind the isolated M3b context-census diagnostic build.

Reuses the reviewed v2 evidence/path/SDK/link readers without changing them.
Every output is new and fsynced; failures and project/tmp stages are retained.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
# Execute only these verified in-memory bytes, before trusting imported helpers.
# This also closes the read/hash/import time-of-check gap.
import types
for module_name, filename, digest in (
    ('engine_tree', 'engine_tree.py', '2d2c4d3aaa9a91bcc2623d219ec8a06d0f72a03c6ec3badab2f2e1763167d324'),
    ('m3b_reviewed_proof_v2', 'proof.py', '72109fbfb3be109491ca5359ad86b6f7c34db96381ab911c47b3199c27a67c5c'),
):
    module_path = ROOT / 'experiments/m3b-build-proof-v2' / filename
    if module_path.resolve() != module_path:
        raise ValueError('Reviewed helper symlink refused')
    module_bytes = module_path.read_bytes()
    if hashlib.sha256(module_bytes).hexdigest() != digest:
        raise ValueError('Reviewed helper identity mismatch before import: ' + filename)
    module = types.ModuleType(module_name)
    module.__file__ = str(module_path)
    sys.modules[module_name] = module
    exec(compile(module_bytes, str(module_path), 'exec'), module.__dict__)
p = sys.modules['m3b_reviewed_proof_v2']
require, inside, relative, publish = p.require, p.inside, p.relative, p.publish
HERE = 'experiments/m3b-context-proof'
NATIVE = 'experiments/m3b-context-census'
VARIANT = 'm3b-context-census-v1'
CENSUS_ABI = {'version': 1, 'words': 2400, 'slots': 4}
EXTENSIONS = ['context-entry-census-v1', 'generation-specific-injection-v1']
PARENT_SOURCE = 'artifacts/m3b-source-01/source'
PARENT_FP = 'b458c012278728289c39b971bb0a7d01fc2a15411eebb4124399d3d72d2551b1'
PARENT_MANIFEST = 'artifacts/m3b-implementation-source-01/manifest.json'
PARENT_REVIEW = 'artifacts/m3b-implementation-source-review-01/review.json'
PARENT_BINDING = 'artifacts/m3b-diagnostic-binding-01/binding.json'
PARENT_OVERLAY = 'artifacts/m3b-source-01/source-m3b-overlay.json'
ROOTS = (HERE, NATIVE, 'tests/m3b-context-accounting', 'tests/m3b-context-runner')
PINS = {
 PARENT_MANIFEST: 'c68689c58c732fd99a858b4e515c3b57934a76c933ca3375600e939fa4e6c1bc',
 PARENT_REVIEW: 'f170531cd89c33369f0c2ff803f365677d00adaa3d35883bd3c241c7f0040e39',
 PARENT_BINDING: '5adbc75187943f37f401a3f14e19acab72c7584fe475533e57920a460e85b3c1',
 PARENT_OVERLAY: 'a92fa0a4c79ee09877ac57ddd64c6c9529819cdba9645516561a64922aef4f57',
 'artifacts/m3b-build-proof-v2-source-review-01/review.json': '6723d01056cdd73b0b67c3bf9e0d85a73e8bfc52e72d0614b0fea8cad0e74715',
}


def names():
    rows = sorted(n for root in ROOTS for n in p.tree_names(root))
    require(1 <= len(rows) <= 128 and len(set(rows)) == len(rows), 'New authored closure bound')
    require(all(Path(n).suffix in p.SUFFIXES for n in rows), 'Unexpected authored artifact/cache')
    return rows


def parent(a):
    for path, digest in PINS.items():
        a.file(path, {'sha256': digest})
    frozen = p.verify_frozen(a, PARENT_MANIFEST, PARENT_REVIEW)
    tool_manifest = 'artifacts/m3b-build-proof-v2-source-01/manifest.json'
    p.verify_tool(a, argparse.Namespace(tool_manifest=tool_manifest,
       tool_review='artifacts/m3b-build-proof-v2-source-review-01/review.json'))
    binding = a.read(PARENT_BINDING)
    require(binding['sourceFingerprint'] == PARENT_FP, 'Wrong parent runtime')
    for key in ('buildReport', 'sourceRecheck', 'overlayManifest', 'sourceManifest', 'sourceReview'):
        ref = binding[key]
        a.file(ref['path'], ref)
    return frozen, binding


def close_imports(a, authored, dependencies):
    pending, seen, imports = list(authored) + sorted(dependencies), set(), []
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen.add(name)
        require(len(seen) <= 2048, 'Dependency closure bound')
        a.file(name)
        if name.startswith('artifacts/') or Path(name).suffix not in ('.js', '.mjs'):
            continue
        for specifier in p.IMPORTS.findall(a.bytes(name).decode()):
            if specifier.startswith(('.', '/')):
                target = ROOT / specifier.lstrip('/') if specifier.startswith('/') else ROOT / Path(name).parent / specifier
                local = relative(inside(Path(os.path.abspath(target))))
                imports.append({'source': name, 'specifier': specifier, 'target': local})
                pending.append(local)
                if local not in authored:
                    dependencies.add(local)
            else:
                require(specifier.startswith('node:') or specifier == 'playwright', 'Unreviewed package import')
    return sorted(imports, key=lambda r: (r['source'], r['specifier']))


def freeze(args, out):
    a = p.Audit()
    original, binding = parent(a)
    authored = names()
    dependencies = set(original['dependencies']) | set(PINS) | {
       'experiments/m3b-build-proof-v2/proof.py', 'experiments/m3b-build-proof-v2/engine_tree.py',
       'experiments/m3b-build-proof-v2/test-proof.py', 'experiments/m3b-build-proof-v2/README.md',
       'artifacts/m3b-build-proof-v2-source-01/manifest.json',
       'artifacts/m3b-build-review-02/review.json',
       'artifacts/m3b-context-window-audit-01/review.json',
       'artifacts/m3b-context-window-audit-01/rf-b-supplement.json',
       'artifacts/m3b-context-continuity-review-01/review.json',
    } | set(args.test_evidence) | set(args.dependency)
    require(1 <= len(args.test_evidence) <= 32 and len(set(args.test_evidence)) == len(args.test_evidence), 'Actual test evidence required')
    for name in args.test_evidence:
        inside(name, True)
    imports = close_imports(a, authored, dependencies)
    files = list(original['files'])
    for name in authored:
        data = a.bytes(name)
        archive = out / 'source' / name
        archive.parent.mkdir(parents=True, exist_ok=True)
        publish(archive, data)
        a.file(archive, a.identities[name])
        files.append({'path': name, 'archive': relative(archive), **a.identities[name]})
    require(names() == authored, 'Authored files changed during freeze')
    require(len({r['path'] for r in files}) == len(files), 'Duplicate source row')
    for directory in sorted((q for q in out.rglob('*') if q.is_dir()), key=lambda q: len(q.parts), reverse=True):
        p.sync(directory)
    manifest = {'schema': 1, 'kind': 'm3b-context-census-source-freeze', 'variant': VARIANT,
      'status': 'frozen', 'timingEligible': False, 'files': files,
      'newFiles': authored, 'dependencies': {n: a.identities[n] for n in sorted(dependencies - {r['path'] for r in files})},
      'imports': imports, 'parentManifest': a.ref(PARENT_MANIFEST), 'parentBinding': a.ref(PARENT_BINDING),
      'parentRuntimeFingerprint': PARENT_FP, 'graphContract': original['graphContract'],
      'graphReview': original['graphReview'], 'testEvidence': args.test_evidence,
      'tool': a.ref(HERE + '/proof.py'),
      'scope': 'Original frozen source plus isolated default-off census and typed recovery diagnostic extension. No inferred guest or performance acceptance.'}
    a.stable()
    publish(out / 'manifest.json', manifest)
    return {'manifest': relative(out / 'manifest.json'), 'files': len(files), 'dependencies': len(manifest['dependencies'])}


def frozen(a, args):
    parent(a)
    manifest = a.read(args.manifest)
    require(manifest['schema'] == 1 and manifest['kind'] == 'm3b-context-census-source-freeze' and
      manifest['variant'] == VARIANT and manifest['status'] == 'frozen' and manifest['timingEligible'] is False and
      manifest['parentRuntimeFingerprint'] == PARENT_FP and manifest['newFiles'] == names(), 'Wrong census source freeze')
    old = a.read(PARENT_MANIFEST)
    require(manifest['files'][:len(old['files'])] == old['files'], 'Parent source archive rows changed')
    require([r['path'] for r in manifest['files'][len(old['files']):]] == names(), 'New source closure changed')
    for row in manifest['files']:
        a.file(row['path'], row)
        a.file(row['archive'], row)
        if row['path'] in manifest['newFiles']:
            require(inside(row['archive'], True) == inside(args.manifest).parent / 'source' / row['path'], 'New source archive path')
    for name, identity in manifest['dependencies'].items():
        a.file(name, identity)
    require(manifest['parentManifest'] == a.ref(PARENT_MANIFEST) and manifest['parentBinding'] == a.ref(PARENT_BINDING) and
       manifest['tool'] == a.ref(HERE + '/proof.py'), 'Parent/tool proof changed')
    review = a.read(args.review)
    require(review['status'] == 'passed' and review['sourceBlockers'] == [] and
       all(review['sourceManifest'][k] == a.ref(args.manifest)[k] for k in ('path', 'sha256')), 'Independent source review required')
    return manifest


def flatten_changes(inherited, incremental):
    result = {r['path']: dict(r) for r in inherited}
    require(len(result) == len(inherited), 'Duplicate inherited paths')
    seen = set()
    for row in incremental:
        name = row['path']
        require(name not in seen and name and not name.startswith('/') and all(x not in ('', '.', '..') for x in name.split('/')), 'Duplicate/noncanonical incremental path')
        seen.add(name)
        require(set(row) == {'path', 'before', 'after'} and isinstance(row['after'], str) and len(row['after']) == 64, 'Incremental change schema')
        if name in result:
            require(result[name]['after'] == row['before'], 'Broken overlay chain')
            result[name]['after'] = row['after']
        else:
            result[name] = dict(row)
    return sorted(result.values(), key=lambda r: Path(r['path']))


def deterministic_increment(a, source):
    generator = inside(NATIVE + '/prepare.py')
    generator_bytes = a.bytes(generator)
    module = types.ModuleType('reviewed_context_prepare')
    module.__file__ = str(generator)
    exec(compile(generator_bytes, str(generator), 'exec'), module.__dict__)
    patched = module.patch_files(inside(PARENT_SOURCE))
    expected = [{'path': str(path), 'before': a.file(inside(PARENT_SOURCE) / path)['sha256'],
       'after': hashlib.sha256(text.encode()).hexdigest()} for path, text in patched.items()]
    expected += [{'path': destination, 'before': None, 'after': a.file(NATIVE + '/' + origin)['sha256']}
       for origin, destination in module.COPIES.items()]
    require(len({r['path'] for r in expected}) == len(expected), 'Duplicate native patch/copy')
    return expected


def source_check(a, source, incremental_name):
    incremental = a.read(incremental_name)
    require(incremental['schema'] == 1 and incremental['kind'] == 'm3b-context-census-incremental-overlay' and
       incremental['baseFiles'] == 10111 and incremental['defaultEnabled'] is False and incremental['timingEligible'] is False and
       incremental['diagnosticExtensions'] == EXTENSIONS and incremental['censusAbi'] == CENSUS_ABI and
       inside(incremental['base']) == inside(PARENT_SOURCE) and incremental['baseFingerprint'] == PARENT_FP and
       inside(incremental['source']) == source and incremental['generatorSha256'] == a.file(NATIVE + '/prepare.py')['sha256'], 'Wrong incremental source provenance')
    require(incremental['changes'] == deterministic_increment(a, source), 'Increment differs from reviewed generator')
    inherited = a.read(PARENT_OVERLAY)
    changes = flatten_changes(inherited['changes'], incremental['changes'])
    trees = [p.EngineTree(inside(n), a) for n in (p.BASE, PARENT_SOURCE, relative(source))]
    base, parent_tree, prepared = trees
    p.compare_links(base, parent_tree); p.compare_links(base, prepared)
    require(len(base.files) == 10102 and p.fingerprint(base.files) == p.BASE_SHA, 'M3a source changed')
    require(len(parent_tree.files) == 10111 and p.fingerprint(parent_tree.files) == PARENT_FP, 'Parent M3b source changed')
    rows = {r['path']: r for r in changes}
    require(set(prepared.files) == set(base.files) | {n for n, r in rows.items() if r['before'] is None}, 'Prepared file set differs')
    checked = []
    for name, identity in prepared.files.items():
        if name in rows:
            row = rows[name]
            require(identity['sha256'] == row['after'] and base.files.get(name, {}).get('sha256') == row['before'], 'Prepared change mismatch: ' + name)
            checked.append({**row, 'observedAfter': identity['sha256'], 'passed': True})
        else:
            require(identity == base.files[name], 'Unexpected source modification: ' + name)
    for tree in trees:
        tree.stable()
    return inherited, changes, checked, trees


def compose(args, out):
    a = p.Audit(); frozen(a, args)
    source = inside(args.source, True)
    inherited, changes, checked, trees = source_check(a, source, args.incremental)
    overlay = {**inherited, 'source': relative(source), 'changes': changes, 'variant': VARIANT,
       'generatorSha256': a.file(HERE + '/proof.py')['sha256'], 'tool': a.ref(HERE + '/proof.py'),
       'parentOverlay': a.ref(PARENT_OVERLAY), 'incrementalOverlay': a.ref(args.incremental),
       'sourceManifest': a.ref(args.manifest), 'sourceReview': a.ref(args.review),
       'diagnosticExtensions': EXTENSIONS, 'censusAbi': CENSUS_ABI,
       'guestValidation': 'not-executed-for-this-source', 'sourceFingerprint': p.fingerprint(trees[-1].files)}
    a.stable(); publish(out / 'overlay.json', overlay)
    return {'overlay': relative(out / 'overlay.json'), 'sourceFingerprint': overlay['sourceFingerprint'], 'changes': len(changes)}


def recheck(args, out):
    a = p.Audit(); frozen(a, args)
    source, build = inside(args.source, True), inside(args.build, True)
    require(not (build / 'source-recheck.json').exists(), 'Existing recheck immutable')
    overlay = a.read(args.overlay)
    require(overlay['variant'] == VARIANT and overlay['tool'] == a.ref(HERE + '/proof.py') and
       overlay['sourceManifest'] == a.ref(args.manifest) and overlay['sourceReview'] == a.ref(args.review) and
       overlay['diagnosticExtensions'] == EXTENSIONS and overlay['censusAbi'] == CENSUS_ABI, 'Composed overlay binding mismatch')
    inc = overlay['incrementalOverlay']; a.file(inc['path'], inc)
    inherited, changes, checked, trees = source_check(a, source, inc['path'])
    require(overlay['changes'] == changes and overlay['parentOverlay'] == a.ref(PARENT_OVERLAY), 'Composed changes mismatch')
    fp = p.fingerprint(trees[-1].files)
    require(overlay['sourceFingerprint'] == fp, 'Composed fingerprint drift')
    report = a.read(build / 'build-report.json')
    require(report['schema'] == 1 and report['status'] == 'passed' and report['sdk'] == p.SDK and
       report['targets'] == ['x86_64-softmmu'] and inside(report['source']) == source and report['sourceFingerprint'] == fp and
       report['commands'] == p.expected_commands(relative(source), args.jobs), 'Build source/SDK/command mismatch')
    require([r['step'] for r in report['runs']] == ['configure', 'compile'] and all(type(r['returncode']) is int and r['returncode'] == 0 for r in report['runs']), 'Build steps failed')
    invocation_bytes = a.bytes(args.sdk_invocation)
    p.validate_sdk(json.loads(invocation_bytes), args.sdk_invocation, relative(source), relative(build), args.jobs)
    actual = {str(inside(n).relative_to(build)) for n in p.tree_names(build / 'runtime')}
    require(actual == set(p.RUNTIME) == set(report['artifacts']), 'Exactly seven runtime companions required')
    runtime = {n: {**a.file(build / n, report['artifacts'][n]), 'matchesBuildReport': True} for n in p.RUNTIME}
    a.stable()
    publish(out / 'sdk-invocation-complete.json', invocation_bytes)
    publish(out / 'inventory.json', {'schema': 1, 'identities': a.identities, 'trees': [{
       'path': relative(t.tree), 'files': t.files, 'engineLinks': t.evidence} for t in trees]})
    result = {'schema': 1, 'kind': 'm3b-postbuild-source-recheck', 'variant': VARIANT, 'status': 'passed', 'timingEligible': False,
       'buildReport': a.ref(build / 'build-report.json'), 'overlayManifest': a.ref(args.overlay),
       'sourceManifest': a.ref(args.manifest), 'sourceReview': a.ref(args.review),
       'source': {'path': relative(source), 'fingerprintBeforeBuild': report['sourceFingerprint'], 'fingerprintAfterBuild': fp, 'matches': True, 'files': len(trees[-1].files)},
       'overlayChecks': checked, 'runtimeArtifacts': runtime, 'sdkInvocation': a.ref(out / 'sdk-invocation-complete.json'),
       'sdkOriginal': a.ref(args.sdk_invocation), 'inventory': a.ref(out / 'inventory.json'),
       'tool': a.ref(HERE + '/proof.py'), 'diagnosticExtensions': overlay['diagnosticExtensions'], 'censusAbi': CENSUS_ABI,
       'scope': 'Actual full source/runtime/SDK recheck only. No guest or timing acceptance.'}
    for tree in trees: tree.stable()
    a.stable(); publish(out / 'review.json', result); publish(build / 'source-recheck.json', result)
    return {'status': 'passed', 'sourceFingerprint': fp, 'sourceRecheck': relative(build / 'source-recheck.json')}


def bind(args, out):
    a = p.Audit(); manifest = frozen(a, args)
    build = inside(args.build, True)
    checked = a.read(build / 'source-recheck.json')
    require(checked['status'] == 'passed' and checked['variant'] == VARIANT and checked['tool'] == a.ref(HERE + '/proof.py') and
       checked['sourceManifest'] == a.ref(args.manifest) and checked['sourceReview'] == a.ref(args.review) and
       checked['diagnosticExtensions'] == EXTENSIONS and checked['censusAbi'] == CENSUS_ABI, 'Wrong source recheck')
    for key in ('inventory', 'sdkInvocation', 'sdkOriginal', 'buildReport', 'overlayManifest'):
        ref = checked[key]; a.file(ref['path'], ref)
    header, graph = p.graph_contract(a, manifest['graphReview']['path'])
    require(header == manifest['graphContract'] and graph == manifest['graphReview'], 'Pinned graph changed')
    binding = {'schema': 1, 'kind': 'm3b-differential-runtime-binding-v1', 'variant': VARIANT,
       'status': 'passed', 'timingEligible': False, 'profile': 1,
       'sourceFingerprint': checked['source']['fingerprintAfterBuild'], 'runtime': relative(build / 'runtime/x86_64'),
       'buildReport': a.ref(build / 'build-report.json'), 'overlayManifest': checked['overlayManifest'],
       'sourceRecheck': a.ref(build / 'source-recheck.json'), 'sourceManifest': a.ref(args.manifest), 'sourceReview': a.ref(args.review),
       'graphContract': header, 'graphReview': graph,
       'assets': {n: a.file(n, manifest['dependencies'][n]) for n in p.ASSETS},
       'parentBinding': a.ref(PARENT_BINDING), 'diagnosticExtensions': checked['diagnosticExtensions'], 'censusAbi': CENSUS_ABI, 'tool': a.ref(HERE + '/proof.py')}
    scratch = Path(tempfile.mkdtemp(prefix='m3b-context-bind-', dir=inside('tmp')))
    p.sync(scratch.parent); stage = scratch / 'candidate-binding.json'; publish(stage, binding)
    consumer = inside('tests/m3b-fallthrough/runtime-identity.mjs')
    code = "const m=await import(process.argv[1]);await m.verifyRuntimeBinding(process.argv[2],process.argv[3]);console.log('actual-context-binding-verified');"
    command = ['node', '--input-type=module', '-e', code, consumer.as_uri(), str(ROOT), relative(stage)]
    run = subprocess.run(command, cwd=ROOT, env={**os.environ, 'TMPDIR': str(scratch), 'TMP': str(scratch), 'TEMP': str(scratch)}, capture_output=True, timeout=300)
    publish(scratch / 'verification.json', {'argv': command, 'exitCode': run.returncode, 'stdout': run.stdout.decode(errors='replace'), 'stderr': run.stderr.decode(errors='replace')})
    require(run.returncode == 0 and run.stdout == b'actual-context-binding-verified\n', 'Actual identity consumer refused; scratch retained')
    require(a.bytes(stage) == (json.dumps(binding, indent=2) + '\n').encode(), 'Staged binding changed')
    a.stable(); publish(out / 'binding.json', binding)
    publish(out / 'verification.json', {'schema': 1, 'status': 'passed', 'binding': a.ref(out / 'binding.json'), 'verification': a.ref(scratch / 'verification.json')})
    return {'status': 'passed', 'binding': relative(out / 'binding.json')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    f, c, r, b = [sub.add_parser(n) for n in ('freeze', 'compose', 'recheck', 'bind')]
    for q in (f, c, r, b): q.add_argument('--output', required=True)
    f.add_argument('--test-evidence', action='append', required=True)
    f.add_argument('--dependency', action='append', default=[])
    for q in (c, r, b):
        q.add_argument('--manifest', required=True); q.add_argument('--review', required=True)
    for q in (c, r): q.add_argument('--source', required=True)
    c.add_argument('--incremental', required=True)
    for q in (r, b): q.add_argument('--build', required=True)
    r.add_argument('--overlay', required=True); r.add_argument('--sdk-invocation', required=True)
    r.add_argument('--jobs', type=int, choices=range(1, 65), default=4)
    args = parser.parse_args(); out = inside(args.output, True); p.mkdir(out)
    publish(out / 'started.json', {'schema': 1, 'operation': args.operation, 'argv': sys.argv,
       'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    try:
        result = {'freeze': freeze, 'compose': compose, 'recheck': recheck, 'bind': bind}[args.operation](args, out)
    except BaseException as error:
        publish(out / 'failure.json', {'schema': 1, 'status': 'failed', 'error': repr(error), 'retained': True})
        raise
    print(json.dumps(result))


if __name__ == '__main__': main()
