#!/usr/bin/env python3
"""Independent MSG1 Bun diagnostic replay; never a timing acceptance decision."""
import argparse
import copy
import datetime as dt
import gzip
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import struct
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'experiments/m2-sha-msg2/review-confirmation.py'
BASE_SHA = 'd6879475590f594c6c46b37bd6081cf7bcd97414f8d77edbb9ed887bfb23e478'
if hashlib.sha256(BASE.read_bytes()).hexdigest() != BASE_SHA:
    raise ValueError('Frozen independent M1 protocol primitive changed')
spec = importlib.util.spec_from_file_location('frozen_msg1_m1_protocol', BASE)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
require = base.require
FIELDS = ['originalHelperEntries', 'compiledInlineExecutions', 'compiledFallbackEntries']
OUTER = 'defuss-m2-msg1-exposure-v1'
SOURCE = 'artifacts/m2-msg1-exposure-source-01/manifest.json'
SOURCE_SHA = 'a0b30ec572a9faf54a75c9958a79f4fb15a7e07a0621c80df8fd3f391939f52c'
SOURCE_REVIEW = 'artifacts/m2-msg1-exposure-source-review-01/review.json'
SOURCE_REVIEW_SHA = '93719e47628b0c73059b844ebddb010f6b6c51f7ab6c5b29eb12b53e98e23350'
TOOL_FREEZE = 'artifacts/m2-msg1-exposure-review-source-01/manifest.json'
CONTRACT = {
    'runtime': 'artifacts/m2-msg1-diagnostic-build-01/runtime/x86_64',
    'build': 'artifacts/m2-msg1-diagnostic-build-01/build-report.json',
    'buildSha256': 'eadae6f19d99c9992b4777ec2b2b1c1173ad81fa3289cec64d3ec5baf99cdfb8',
    'recheck': 'artifacts/m2-msg1-diagnostic-build-01/source-recheck.json',
    'recheckSha256': 'b8025568de878e0c63c3e1ea939e40b35dfa07770a2de0ce30b53732cc5d983b',
    'sourceFingerprint': '2b7a8b44cff517fd8a02c30151a47bbc6b1776a4f617ef5d1db952c2a218efa3',
    'implementation': 'artifacts/m2-msg1-implementation-01/manifest.json',
    'implementationSha256': 'b04500ea12e5719bfa3ff317b28fd0d31ddf292f8b4b318303f3517bd987a874',
    'sourceReview': 'artifacts/m2-msg1-source-review-01/review.json',
    'sourceReviewSha256': 'b01c960c7b5d430639d8ea9ddd871ea0a6b36a35cc01499ed341f61eae30318d',
    'isaReview': 'artifacts/m2-msg1-diagnostic-review-01/review.json',
    'isaReviewSha256': '10c9ad6c8c601fbf2859a261269d2fbfd177f4a399f2ec2c2d31e344670201aa',
    'jsSha256': '632df56970e2cd5969e54b661dcd251ab1fe4e645fbdb40ca6c6af323fc672cf',
    'wasmSha256': '9246a4e3b659d7ca77260e8d293ec0a968cecff89255ec1e87ba65ecc3a1cd42',
}
WORKLOAD = {
    'artifacts/m1-baseline-01/app.mjs.app/app.json': '39b212c4442de8fecaa620f70ac0c5e6d8a41f6d272c2dc28ba4c506177617c1',
    'benchmarks/harness/m1/driver.ts': '429c08005a3e36ed81d7098240c93b5b5c78aedd2f2dcc8df5e66dd5c6bdeb6c',
    'benchmarks/harness/m1/protocol.mjs': 'fa9423577d8ac4b189f3b96d2f98de0a84a9b8ace909c9a93cc98d89f0b6aaad',
    'benchmarks/workload/operations.ts': '12df6a72cf79cd0e2b9cfd826cf45c9d9322917524cd91d9844b84914c46b498',
    'benchmarks/expected.json': 'e0f1f4a96c2f5d3066695d9e26ab9980f97527a94b987ffc98947a61c2f84288',
}
BROWSER = ['benchmarks/harness/m2-msg1-exposure/' + n for n in ['browser.mjs', 'vm-adapter.mjs', 'exposure.mjs']] + [
    'benchmarks/harness/m1/protocol.mjs', 'host/browser/qmp.mjs', 'host/browser/machine.mjs',
    'packaging/bun-app/serial.mjs', 'packaging/bun-app/snapshots.mjs']
HOST_FIELDS = {'hostMs', 'pairedHostMs', 'signalHostMs', 'stopRequestHostMs', 'stoppedHostMs',
               'stoppedStatus', 'msg1', 'readCompleteHostMs', 'stoppedReadMs', 'ackHostMs', 'contReplyHostMs', 'mapsArtifact'}
PROGRESS_SCOPE = 'Partial stopped observations only; not acceptance or resumable. Require a separate complete immutable report.'
PARTITION_SCOPE = 'Boot is zero→initialized; each gap is prior phase end→next phase start; tail is last phase end→complete. Inclusive stopped boundaries include guest control/stop-delivery. No execution or timing attribution beyond these observed intervals.'
IDENTITY_SCOPE = 'Frozen MSG1 source/build and independent arbitrary-input hot/cold ISA matrix are prerequisites; their counts are not Bun exposure measurements.'


def same(actual, expected, label):
    """JSON type identity except int/float, which are one JSON number kind."""
    def eq(a, b):
        if type(a) in (int, float) and type(b) in (int, float):
            return math.isfinite(a) and math.isfinite(b) and a == b
        if type(a) is not type(b):
            return False
        if isinstance(b, dict):
            return a.keys() == b.keys() and all(eq(a[k], v) for k, v in b.items())
        if isinstance(b, (list, tuple)):
            return len(a) == len(b) and all(eq(x, y) for x, y in zip(a, b))
        return a == b
    require(eq(actual, expected), label + ': values/types differ')


def parse(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    def nonfinite(value):
        raise ValueError('Nonfinite JSON number: ' + value)
    return json.loads(data, object_pairs_hook=pairs, parse_constant=nonfinite)


def bank(row):
    require(type(row) is dict and type(row.get('schema')) is int and row['schema'] == 1, 'Counter schema')
    numbers = []
    for key in FIELDS:
        value = row[key]
        require(type(value) is str and re.fullmatch(r'0|[1-9][0-9]*', value), 'Noncanonical uint64')
        number = int(value)
        require(number < 2**64, 'Counter exceeds uint64')
        numbers.append(number)
    require(numbers[2] <= numbers[0], 'Fallback exceeds original helper entries')
    return numbers


def delta(before, after, enabled, compiled=False):
    require(type(enabled) is bool, 'Selected mode must be boolean')
    values = [b - a for a, b in zip(bank(before), bank(after))]
    require(min(values) >= 0, 'Counter reset or wrap')
    original, inline, fallback = values
    require(fallback <= original, 'Interval fallback exceeds original')
    require(fallback == 0 if enabled else inline == 0, 'Forbidden compiled path')
    if compiled:
        require((inline if enabled else fallback) > 0, 'Missing selected compiled SHA exposure')
    return dict(schema=1, **dict(zip(FIELDS, map(str, values))),
                interpretedHelperEntries=str(original-fallback), allExecutions=str(original+inline))


def partition(browser, enabled):
    zero = dict(schema=1, **dict.fromkeys(FIELDS, '0'))
    previous = browser['exposureInitialized']
    boot = delta(zero, previous, enabled)
    rows = [browser['warmup'], *browser['results']]
    require(len(rows) == 13, 'Expected thirteen intervals')
    gaps, phases = [], []
    for i, row in enumerate(rows):
        same(row['counters'], None, 'Generic profiling disabled')
        require('codeCapture' not in row, 'Code inspection disabled')
        before, after = row['exposure']['begin'], row['exposure']['end']
        gaps.append(dict(beforePhase=i, startSeq=rows[i-1]['endSeq'] if i else None,
                         endSeq=row['startSeq'], **delta(previous, before, enabled)))
        observed = delta(before, after, enabled, row['name'] == 'sha256')
        same(row['exposure']['delta'], observed, 'Recorded phase delta')
        phases.append({k: row[k] for k in ['name', 'sample', 'iterations', 'startSeq', 'endSeq']} | observed)
        previous = after
    tail = delta(previous, browser['exposureComplete'], enabled)
    total = delta(zero, browser['exposureComplete'], enabled)
    for key in FIELDS:
        same(int(total[key]), sum(int(r[key]) for r in [boot, *gaps, *phases, tail]), 'Whole bank conservation')
    return dict(boot=boot, gaps=gaps, tail=tail, total=total, phases=phases, scope=PARTITION_SCOPE)


def protocol_evidence(report, serial, progress, enabled):
    """Pure replay after the caller restores and hashes maps text."""
    b = report['browserResult']; events = b['events']; gates = events[2:]
    for scope in [report, b]:
        require(type(scope['schema']) is int and scope['schema'] == 1, 'Report schema')
        same(scope['timingEligible'], False, 'Timing eligibility')
        same(scope['captureCode'], False, 'Code capture')
        same(scope['experiment'], dict(name='sha256msg1-v1', enabled=enabled), 'Experiment')
    same(b['ready']['snapshotSaved'], True, 'Saved snapshot')
    require(type(report['transport']['publications']) is int and report['transport']['publications'] == 1, 'Snapshot publications')
    if 'deadlineExceeded' in report:
        same(report['deadlineExceeded'], False, 'Deadline exceeded')
    for event in events:
        same(event['heap'], True, 'Heap identity'); same(event['file'], True, 'File identity')
        for key in ['pid', 'heapLength', 'heapChecksum', 'ordinal', 'seq', 'index', 'sample', 'iterations']:
            if key in event:
                require(base.integer(event[key]), 'Integer guest identity: ' + key)
    for event in events[:2]:
        same(event['parameters'], base.PARAMETERS, 'Workload parameters'); same(event['orders'], base.ORDERS, 'Workload order')
    nonce = base.protocol(report)
    require('Kernel panic' not in serial and 'BUN_APP_FAILURE' not in serial, 'Fatal guest serial marker')
    raw = [parse(line[10:]) for line in serial.splitlines() if line.startswith('DEFUSS_M1 ')]
    same(raw, [{k: v for k, v in e.items() if k not in HOST_FIELDS} for e in events], 'Exact raw serial fields')
    same(progress[0], dict(protocol=OUTER, experiment=report['experiment'], package=report['package'],
                          inputs=report['inputHashes'], runtimeIdentity=report['runtimeIdentity'],
                          schema=1, kind='partial-progress-header', scope=PROGRESS_SCOPE), 'Complete progress header')
    same(report['partialProgress'], dict(path='progress.jsonl', rows=69, scope=PROGRESS_SCOPE), 'Progress metadata')
    require(len(progress) == 70 and len(gates) == 69, 'Progress record count')
    previous = dict(schema=1, **dict.fromkeys(FIELDS, '0'))
    for i, event in enumerate(gates):
        same(event['stoppedStatus']['running'], False, 'Stopped running state')
        same(event['stoppedStatus']['status'], 'paused', 'Stopped status')
        delta(previous, event['msg1'], enabled); previous = event['msg1']
        expected = {k: v for k, v in event.items() if k not in {'ackHostMs', 'contReplyHostMs', 'mapsArtifact'}}
        same(progress[i+1], dict(sequence=i, event=expected, schema=1, kind='stopped-gate'), 'Durable pre-ACK row')
    same(b['exposureInitialized'], gates[0]['msg1'], 'Initial gate bank')
    same(b['exposureComplete'], gates[-1]['msg1'], 'Complete gate bank')
    by_seq = {e['seq']: e for e in gates}; used = set()
    for index, row in enumerate([b['warmup'], *b['results']]):
        require(base.integer(row['startSeq'], 1, 69) and base.integer(row['endSeq'], 1, 69), 'Integer phase boundaries')
        require(row['startSeq'] < row['endSeq'] and not ({row['startSeq'], row['endSeq']} & used), 'Phase boundary overlap')
        used.update([row['startSeq'], row['endSeq']])
        start, end = by_seq[row['startSeq']], by_seq[row['endSeq']]
        if index == 0:
            same((row['name'], row['sample'], row['iterations']), ('warmup', None, None), 'Warmup row identity')
            same(row['guestMs'], None, 'Warmup guest clock absence')
        else:
            require(base.integer(row['sample'], 0, 2) and type(row['iterations']) is int, 'Measured row integer metadata')
            same((row['name'], row['sample'], row['iterations']), (end['name'], end['sample'], 100), 'Measured row identity')
            same(row['guestMs'], end['guestMs'], 'Measured row guest clock')
        same(row['exposure']['begin'], start['msg1'], 'Begin raw bank')
        same(row['exposure']['end'], end['msg1'], 'End raw bank')
    return nonce, partition(b, enabled)


def snapshot_envelope(path, manifest):
    """Bounded streaming replay of compressed and decompressed identities."""
    with path.open('rb') as stream:
        header = stream.read(12)
        require(len(header) == 12 and header[:8] == b'BWSNAP01', 'Snapshot magic')
        length = struct.unpack('<I', header[8:])[0]
        require(0 < length <= 16384, 'Snapshot header size')
        m = parse(stream.read(length))
        for k, v in dict(schema=1, encoding='gzip', appSha256=manifest['appSha256'], compatibilitySha256=manifest['compatibilitySha256']).items():
            same(m[k], v, 'Snapshot identity ' + k)
        require(base.integer(m['bytes'], 1, 1024**3) and base.integer(m['compressedBytes'], 1, 1024**3), 'Snapshot bounds')
        h = hashlib.sha256(); size = 0
        for chunk in iter(lambda: stream.read(1024**2), b''):
            size += len(chunk); h.update(chunk)
        same((size, h.hexdigest()), (m['compressedBytes'], m['compressedSha256']), 'Compressed snapshot')
        stream.seek(12 + length); h = hashlib.sha256(); size = 0
        with gzip.GzipFile(fileobj=stream) as raw:
            for chunk in iter(lambda: raw.read(1024**2), b''):
                size += len(chunk); require(size <= m['bytes'], 'Snapshot expansion bound'); h.update(chunk)
        same((size, h.hexdigest()), (m['bytes'], m['sha256']), 'Raw snapshot')
        return m


class Reviewer(base.Reviewer):
    def read(self, path):
        self.hash(path)
        return parse(Path(path).read_bytes())

    def prerequisites(self):
        self.hash(BASE, {'sha256': BASE_SHA}); self.hash(Path(__file__))
        tool = self.read(self.path(TOOL_FREEZE))
        same(tool['kind'], 'independent-msg1-exposure-review-source-freeze', 'Reviewer source freeze')
        same({row['path'] for row in tool['files']},
             {'experiments/m2-msg1-exposure-review/'+n for n in ['review.py', 'test-review.py', 'README.md']}, 'Reviewer source closure')
        for row in tool['files']:
            for key in ['path', 'archive']:
                self.hash(self.path(row[key]), {k: row[k] for k in ['sha256', 'bytes']})
        self.hash(self.path(SOURCE), {'sha256': SOURCE_SHA})
        frozen = self.read(self.path(SOURCE))
        for row in frozen['files']:
            for key in ['path', 'archive']:
                self.hash(self.path(row[key]), {k: row[k] for k in ['sha256', 'bytes']})
        self.hash(self.path(SOURCE_REVIEW), {'sha256': SOURCE_REVIEW_SHA})
        review = self.read(self.path(SOURCE_REVIEW)); same(review['status'], 'passed', 'Source review')
        for path, identity in review['inventory'].items():
            self.hash(self.path(path), identity)
        docs, hashes = {}, {}
        for name in ['build', 'recheck', 'implementation', 'sourceReview', 'isaReview']:
            path, digest = CONTRACT[name], CONTRACT[name+'Sha256']
            self.hash(self.path(path), {'sha256': digest}); hashes[path] = digest; docs[name] = self.read(self.path(path))
        build, audit, isa = docs['build'], docs['recheck'], docs['isaReview']
        for doc in [build, audit, isa]:
            same(doc['status'], 'passed', 'MSG1 prerequisite'); same(doc['sourceFingerprint'], CONTRACT['sourceFingerprint'], 'MSG1 source fingerprint')
        same(isa['fullMatrix'], True, 'Complete hot/cold ISA prerequisite')
        same(isa['kind'], 'independent-msg1-exact-isa-review', 'ISA prerequisite kind')
        same(audit['runtimeArtifacts'], build['artifacts'], 'Actual runtime build')
        same(audit['buildReport']['sha256'], CONTRACT['buildSha256'], 'Audited build')
        same(audit['frozenImplementation']['sha256'], CONTRACT['implementationSha256'], 'Audited implementation')
        for path, identity in isa['identities'].items():
            self.hash(self.path(path), identity); hashes[path] = identity['sha256']
        artifacts = []
        require(len(build['artifacts']) == 7, 'Runtime artifact closure')
        for name, identity in build['artifacts'].items():
            path = str(Path(CONTRACT['build']).parent / name)
            self.hash(self.path(path), identity); hashes[path] = identity['sha256']
            artifacts.append(dict(name=name, path=path, **identity))
        for name, digest in WORKLOAD.items():
            self.hash(self.path(name), {'sha256': digest})
        self.runtime = dict(status='verified', contract=CONTRACT, artifacts=artifacts, inputHashes=hashes, scope=IDENTITY_SCOPE)
        self.source_files = {r['path']: r['sha256'] for r in frozen['files']}

    def run(self, argument, enabled, timeout_ms=1800000):
        path = self.path(argument); require(path.is_relative_to(self.root/'artifacts'), 'Only retained artifact reports')
        r = self.read(path); b = r['browserResult']
        same(r['protocol'], OUTER, 'Outer protocol'); same(b['observation'], OUTER, 'Browser protocol')
        for key in ['pageErrors', 'serverErrors', 'inputRecheck']:
            same(r[key], [], 'No retained failure: '+key)
        same(r['timeoutMs'], timeout_ms, 'Declared diagnostic deadline')
        require(base.integer(r['timeoutMs'], 1000, 1800000), 'Deadline bound')
        same(r['samplePeriod'], 257, 'Fixed sample period')
        same(r['executionConfiguration']['aotEnabled'], False, 'AOT disabled')
        same(r['executionConfiguration']['planDisabled'], True, 'Translation plan disabled')
        same(b['msg1Status'], 65540 if enabled else 65539, 'Locked MSG1 choice')
        same(b['configuration'], dict(before=65536, chosen=65538 if enabled else 65537, enabled=enabled,
                                     phase='preRun-before-vCPU', diagnostic=True), 'One-time MSG1 choice')
        manifest_path = self.path(r['package'])/'app.json'
        manifest = self.manifest(dict(path=r['package'], manifest=r['manifest'],
                                     manifestSha256=r['inputHashes'][str(manifest_path.relative_to(self.root))]))
        same(manifest['experiment'], dict(name='sha256msg1-v1', enabled=enabled), 'Package choice')
        same(manifest['vm'], base.VM, 'Production flags/hot limit')
        original = self.read(self.path(next(iter(WORKLOAD))))
        def original_spec(m):
            value = copy.deepcopy(m)
            for k in ['experiment', 'generation', 'compatibilitySha256']:
                value.pop(k, None)
            for k in ['runtime/qemu-system-x86_64.js', 'runtime/qemu-system-x86_64.wasm']:
                value['artifacts'].pop(k)
            return value
        same(original_spec(manifest), original_spec(original), 'Unchanged original M1 package')
        for extension in ['js', 'wasm']:
            actual = manifest['artifacts']['runtime/qemu-system-x86_64.'+extension]
            source = next(a for a in self.runtime['artifacts'] if a['name'] == 'runtime/x86_64/qemu-system-x86_64.'+extension)
            same(actual, {k: source[k] for k in ['sha256', 'bytes']}, 'Exact diagnostic runtime substitution')
        provenance_path = self.path(r['package'])/'configuration-provenance.json'
        provenance = self.read(provenance_path)
        same(provenance['kind'], 'msg1-exposure-package-v1', 'Package provenance')
        same(provenance['baseManifestSha256'], next(iter(WORKLOAD.values())), 'Original base manifest')
        same(provenance['experiment'], manifest['experiment'], 'Package mode provenance')
        same(provenance['compatibilitySha256'], manifest['compatibilitySha256'], 'Package compatibility provenance')
        same(provenance['runtimeIdentity'], self.runtime, 'Package actual runtime proof')
        same(r['runtimeIdentity'], self.runtime, 'Report runtime proof'); same(r['packageProvenance'], provenance, 'Report package proof')
        mandatory = {**WORKLOAD, **self.runtime['inputHashes'], **self.source_files,
                     str(provenance_path.relative_to(self.root)): self.inventory[str(provenance_path.relative_to(self.root))]['sha256']}
        # README is frozen/reviewed but the host hashes only executable/JSON inputs.
        mandatory.pop('benchmarks/harness/m2-msg1-exposure/README.md', None)
        for name, digest in mandatory.items():
            same(r['inputHashes'][name], digest, 'Required recorded source '+name)
        served = [*BROWSER, *[r['package']+'/'+manifest['generation']+'/'+n for n in manifest['artifacts']]]
        for name in served:
            same(r['servedHashes'][name], r['inputHashes'][name], 'Required served identity '+name)
        for category in ['inputHashes', 'servedHashes']:
            require(bool(r[category]), 'Empty identity map')
            for name, digest in r[category].items():
                require(type(digest) is str and re.fullmatch('[a-f0-9]{64}', digest), 'Invalid identity digest')
                self.hash(self.path(name), {'sha256': digest})
        h = r['hostCondition']; config = h['configuration']
        executable = self.root.parent/'native-build/lima/bin/limactl'
        tool = self.hash(executable)
        same(config, dict(schema=1, executable=str(executable), **tool, environment={'LIMA_HOME': '/Users/admin/.defuss-vm-lima'},
                          arguments=['list', 'builder', '--json'], expected=dict(name='builder', status='Stopped', memory=12884901888),
                          rule='Check before and after every fresh run; do not start compiler/build/other owned heavy work during the campaign.'), 'Host condition configuration')
        for edge in ['before', 'after']:
            same(parse(h[edge]['stdout']), h[edge]['status'], 'Raw builder status')
            for key, value in config['expected'].items():
                same(h[edge]['status'][key], value, 'Stopped builder '+key)
            same(h[edge]['status'].get('errors', []), [], 'Builder errors')
        working = copy.deepcopy(r)
        for e in working['browserResult']['events']:
            if e['event'] in ['initialized', 'maps']:
                info = e['mapsArtifact']; same(Path(info['path']).name, info['path'], 'Sibling maps path')
                require(base.integer(info['bytes'], 1, 2097152), 'Maps bound')
                same((e['mapsSha256'], e['mapsBytes']), (info['sha256'], info['bytes']), 'Maps metadata')
                self.hash(path.parent/info['path'], {k: info[k] for k in ['sha256', 'bytes']})
                e['maps'] = (path.parent/info['path']).read_text()
        serial_path = path.with_name('serial.log'); self.hash(serial_path, {'sha256': r['serialSha256']})
        require(serial_path.stat().st_size <= 16777216, 'Serial bound')
        progress_path = path.with_name('progress.jsonl'); self.hash(progress_path)
        require(progress_path.stat().st_size <= 70*1048576, 'Progress file bound')
        lines = progress_path.read_bytes().splitlines(); require(all(0 < len(x) <= 1048576 for x in lines), 'Progress row bound')
        nonce, result = protocol_evidence(working, serial_path.read_text(), [parse(x) for x in lines], enabled)
        snapshot = self.path(r['cache'])/manifest['appSha256']/(manifest['compatibilitySha256']+'.snapshot')
        self.hash(snapshot, {k: r['snapshot'][k] for k in ['sha256', 'bytes']})
        self.snapshot_metadata[str(path)] = snapshot_envelope(snapshot, manifest)
        return dict(path=str(path), sha256=self.inventory[str(path.relative_to(self.root))]['sha256'], manifest=manifest,
                    nonce=nonce, browser=r['browser'], host=r['host'], initial=b['exposureInitialized'], complete=b['exposureComplete'],
                    phases=result['phases'], partition=result, reportProtocol=OUTER)


def summaries(runs):
    return {name: {side: dict(phases=len(rows), **{key: str(sum(int(row[key]) for row in rows))
                    for key in [*FIELDS, 'interpretedHelperEntries', 'allExecutions']})
                  for side, run in runs.items() for rows in [[row for row in run['phases'] if row['name'] == name]]}
            for name in base.NAMES}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--control', required=True); p.add_argument('--candidate', required=True)
    p.add_argument('--analysis'); p.add_argument('--expected-timeout-ms', type=int, default=1800000)
    p.add_argument('--output', required=True); args = p.parse_args()
    reviewer = Reviewer(); reviewer.snapshot_metadata = {}
    output = reviewer.path(args.output)
    require(output.is_relative_to(ROOT/'artifacts'), 'Output must belong to project artifacts')
    require(1000 <= args.expected_timeout_ms <= 1800000, 'Diagnostic deadline range')
    output.mkdir()
    result = dict(schema=1, status='failed', kind='independent-msg1-bun-exposure-review',
                  createdUtc=dt.datetime.now(dt.timezone.utc).isoformat(), timingEligible=False,
                  productPromotionEligible=False, expectedTimeoutMs=args.expected_timeout_ms)
    try:
        reviewer.prerequisites()
        runs = {side: reviewer.run(path, side == 'candidate', args.expected_timeout_ms)
                for side, path in [('control', args.control), ('candidate', args.candidate)]}
        c, t = runs['control'], runs['candidate']; require(c['nonce'] != t['nonce'], 'Distinct fresh nonces')
        strip = lambda m: {k: v for k, v in m.items() if k not in ['experiment', 'generation', 'compatibilitySha256']}
        same(strip(c['manifest']), strip(t['manifest']), 'Only bound selected mode differs')
        require(c['manifest']['compatibilitySha256'] != t['manifest']['compatibilitySha256'], 'Mode-separated snapshots')
        same(c['browser'], t['browser'], 'Browser identity')
        for key in ['platform', 'arch', 'release', 'logicalCPUs', 'totalMemoryBytes']:
            same(c['host'][key], t['host'][key], 'Host identity '+key)
        total = summaries(runs)
        if args.analysis:
            a = reviewer.read(reviewer.path(args.analysis))
            for k, v in dict(schema=1, status='passed', kind='diagnostic-msg1-exposure', timingEligible=False, productPromotionEligible=False).items():
                same(a[k], v, 'Published analysis '+k)
            same(a['inputs'], list(runs.values()), 'Published full raw-input replay')
            same(a['summaries'], total, 'Published independent summary')
        for name, identity in list(reviewer.inventory.items()):
            reviewer.hash(Path(name) if Path(name).is_absolute() else reviewer.path(name), identity)
        result.update(status='passed', runs=runs, summaries=total, snapshots=reviewer.snapshot_metadata,
                      scope=['Independent Python uint64/raw serial/pre-ACK protocol, source/build/package and streamed snapshot replay.',
                             'Every SHA phase requires selected compiled MSG1 under hot1500/flags3; non-SHA, boot/gap/tail exposure is retained.',
                             'Inclusive diagnostic boundaries include control/stop work, not exclusive library attribution or elapsed CPU fractions.',
                             'No timing comparison, causal optimization/deoptimization or production promotion.'])
    except Exception as error:
        result['failure'] = type(error).__name__ + ': ' + str(error)
    result['inventory'] = reviewer.inventory
    result['reviewerSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    with (output/'review.json').open('x') as stream:
        json.dump(result, stream, indent=2, allow_nan=False); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    for directory in [output, output.parent]:
        fd = os.open(directory, os.O_RDONLY); os.fsync(fd); os.close(fd)
    print(json.dumps(dict(status=result['status'], output=str(output), identities=len(reviewer.inventory), failure=result.get('failure'))))
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
