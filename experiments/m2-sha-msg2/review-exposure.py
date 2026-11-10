#!/usr/bin/env python3
"""Replay diagnostic Bun exposure independently of JavaScript validators."""
import argparse
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(__file__).with_name('review-confirmation.py')
# Reuse only the frozen independent Python protocol/identity implementation.
BASE_SHA = 'd6879475590f594c6c46b37bd6081cf7bcd97414f8d77edbb9ed887bfb23e478'
if hashlib.sha256(BASE.read_bytes()).hexdigest() != BASE_SHA:
    raise ValueError('Frozen Python protocol reviewer changed')
spec = importlib.util.spec_from_file_location('independent_m1', BASE)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
require, same = base.require, base.same
FIELDS = ['originalHelperEntries', 'compiledInlineExecutions', 'compiledFallbackEntries']
PROTOCOL = 'defuss-m2-exposure-v1'


def bank(value):
    require(value.get('schema') == 1, 'Unknown exposure bank schema')
    numbers = []
    for key in FIELDS:
        n = value[key]
        require(isinstance(n, str) and re.fullmatch(r'0|[1-9][0-9]*', n), 'Noncanonical exact counter')
        n = int(n)
        require(n < 2**64, 'Counter outside uint64')
        numbers.append(n)
    require(numbers[2] <= numbers[0], 'Fallback exceeds original helpers')
    return numbers


def delta(begin, end, enabled, compiled=False):
    numbers = [b - a for a, b in zip(bank(begin), bank(end))]
    require(min(numbers) >= 0, 'Counter reset or wrap')
    original, inline, fallback = numbers
    require(fallback <= original, 'Interval fallback exceeds original')
    require((fallback == 0 if enabled else inline == 0), 'Wrong compiled path for selected mode')
    if compiled:
        require((inline if enabled else fallback) > 0, 'No selected compiled exposure in Bun SHA phase')
    return {'schema': 1, **dict(zip(FIELDS, map(str, numbers))),
            'interpretedHelperEntries': str(original - fallback), 'allExecutions': str(original + inline)}


def phases(browser, enabled):
    zero = {'schema': 1, **dict.fromkeys(FIELDS, '0')}
    initial, complete = browser['exposureInitialized'], browser['exposureComplete']
    delta(zero, initial, enabled)
    delta(zero, complete, enabled)
    previous, result = initial, []
    for row in [browser['warmup'], *browser['results']]:
        current = row['exposure']
        delta(previous, current['begin'], enabled)
        d = delta(current['begin'], current['end'], enabled, row['name'] == 'sha256')
        same(current['delta'], d, 'Stored phase partition')
        result.append({k: row[k] for k in ['name', 'sample', 'iterations']} | d)
        previous = current['end']
    same(len(result), 13, 'Warmup plus twelve result intervals')
    delta(previous, complete, enabled)
    return result


class ExposureReviewer(base.Reviewer):
    def run(self, name, enabled):
        path = self.path(name)
        report = self.read(path)
        browser = report['browserResult']
        same(report['protocol'], PROTOCOL, 'Outer diagnostic protocol')
        same(browser['observation'], PROTOCOL, 'Browser diagnostic protocol')
        for value in [report, browser]:
            same(value['timingEligible'], False, 'Timing ineligible')
            same(value['experiment'], {'name': 'sha256msg2-v1', 'enabled': enabled}, 'Selected mode')
        same(browser['msg2Status'], 65540 if enabled else 65539, 'Locked mode')
        same(report['pageErrors'], [], 'Page errors')
        same(report['serverErrors'], [], 'Server errors')
        require(not report.get('deadlineExceeded'), 'Deadline exceeded')
        same(report['executionConfiguration']['aotEnabled'], False, 'AOT disabled')
        same(report['executionConfiguration']['planDisabled'], True, 'Translation plan disabled')
        manifest_path = self.path(report['package']) / 'app.json'
        manifest = self.manifest({'path': report['package'], 'manifest': report['manifest'],
                                  'manifestSha256': report['inputHashes'][str(manifest_path.relative_to(self.root))]})
        same(manifest['appSha256'], '31d28add91e5a78aee775e57a365828f2b75843fc9bbd26b66bfe06e9d4717d5', 'Original bundle')
        same(manifest['artifacts']['initramfs.cpio.gz']['sha256'],
             'd54f7ed772e0249f6e6d52c7d795a9cd566a378555dbc7f7961aed830b3bd2c6', 'Original guest filesystem')
        mandatory = {'benchmarks/harness/m1/protocol.mjs', 'benchmarks/workload/operations.ts',
                     'benchmarks/expected.json', 'manifests/runtime-baseline.json'}
        mandatory.update('benchmarks/harness/m2-exposure/' + n for n in
                         ['run.mjs', 'browser.mjs', 'vm-adapter.mjs', 'exposure.mjs', 'analyze.mjs'])
        mandatory.add(str(manifest_path.relative_to(self.root)))
        mandatory.update(str((self.path(report['package']) / manifest['generation'] / n).relative_to(self.root))
                         for n in manifest['artifacts'])
        require(mandatory <= set(report['inputHashes']), 'Missing critical identities')
        for field in ['inputHashes', 'servedHashes']:
            require(bool(report[field]), 'Missing recorded identities')
            for name, digest in report[field].items():
                self.hash(self.path(name), {'sha256': digest})
        # Bind package bytes to the diagnostic build, not merely to one another.
        build = self.path('artifacts/m2-msg2-diagnostic-build-01')
        build_report = self.read(build / 'build-report.json')
        same(build_report['status'], 'passed', 'Diagnostic runtime build')
        source_check = self.read(build / 'source-recheck.json')
        same(source_check['status'], 'passed', 'Diagnostic source recheck')
        same(source_check['sourceFingerprint'], build_report['sourceFingerprint'], 'Diagnostic source identity')
        for filename in ['qemu-system-x86_64.js', 'qemu-system-x86_64.wasm']:
            expected = build_report['artifacts']['runtime/x86_64/' + filename]
            same(manifest['artifacts']['runtime/' + filename], expected, 'Package diagnostic runtime identity')
            self.hash(build / 'runtime/x86_64' / filename, expected)
        nonce = base.protocol(report)
        serial_path = path.with_name('serial.log')
        self.hash(serial_path)
        serial = serial_path.read_text()
        require('Kernel panic' not in serial and 'BUN_APP_FAILURE:' not in serial, 'Raw guest failure')
        raw = [json.loads(line[10:]) for line in serial.splitlines() if line.startswith('DEFUSS_M1 ')]
        same(len(raw), len(browser['events']), 'Raw event count')
        for original, event in zip(raw, browser['events']):
            if event['event'] in ['initialized', 'maps']:
                maps = event['mapsArtifact']
                same(Path(maps['path']).name, maps['path'], 'Maps sibling path')
                same((maps['sha256'], maps['bytes']), (event['mapsSha256'], event['mapsBytes']), 'Maps metadata')
                self.hash(path.parent / maps['path'], {k: maps[k] for k in ['sha256', 'bytes']})
            for key, value in original.items():
                if key == 'maps':
                    same(value.encode(), (path.parent / event['mapsArtifact']['path']).read_bytes(), 'Raw maps')
                else:
                    same(event.get(key), value, 'Raw event ' + key)
        self.hash(self.path(report['cache']) / manifest['appSha256'] / (manifest['compatibilitySha256'] + '.snapshot'),
                  {k: report['snapshot'][k] for k in ['sha256', 'bytes']})
        return {'path': str(path), 'sha256': self.inventory[str(path.relative_to(self.root))]['sha256'],
                'manifest': manifest, 'nonce': nonce, 'browser': report['browser'], 'host': report['host'],
                'initial': browser['exposureInitialized'], 'complete': browser['exposureComplete'],
                'phases': phases(browser, enabled), 'reportProtocol': PROTOCOL}


def summaries(runs):
    result = {}
    for name in base.NAMES:
        result[name] = {}
        for side, run in runs.items():
            rows = [r for r in run['phases'] if r['name'] == name]
            result[name][side] = {'phases': len(rows), **{key: str(sum(int(r[key]) for r in rows))
                for key in [*FIELDS, 'interpretedHelperEntries', 'allExecutions']}}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--control')
    parser.add_argument('--candidate')
    parser.add_argument('--analysis')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    require(args.control or args.candidate, 'At least one raw report required')
    reviewer = ExposureReviewer()
    reviewer.hash(BASE, {'sha256': BASE_SHA})
    reviewer.hash(Path(__file__))
    runs = {side: reviewer.run(path, side == 'candidate') for side, path in
            [('control', args.control), ('candidate', args.candidate)] if path}
    if len(runs) == 2:
        control, candidate = runs['control'], runs['candidate']
        require(control['nonce'] != candidate['nonce'], 'Independent fresh captures required')
        strip = lambda m: {k: v for k, v in m.items() if k not in ['experiment', 'generation', 'compatibilitySha256']}
        same(strip(control['manifest']), strip(candidate['manifest']), 'Only selected package mode may differ')
        same(control['browser'], candidate['browser'], 'Browser version')
        for key in ['platform', 'arch', 'release', 'logicalCPUs', 'totalMemoryBytes']:
            same(control['host'][key], candidate['host'][key], 'Host identity ' + key)
    total = summaries(runs)
    if args.analysis:
        require(len(runs) == 2, 'Paired published analysis needs both raw runs')
        analysis = reviewer.read(reviewer.path(args.analysis))
        for key, value in {'schema': 1, 'status': 'passed', 'kind': 'diagnostic-msg2-exposure',
                           'timingEligible': False, 'productPromotionEligible': False}.items():
            same(analysis[key], value, 'Published analysis ' + key)
        same(analysis['summaries'], total, 'Published summary recomputation')
        same(analysis['inputs'], list(runs.values()), 'Published raw input replay')
    result = {'schema': 1, 'status': 'passed', 'kind': 'independent-msg2-bun-exposure-review',
        'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'runs': runs,
        'summaries': total, 'identities': reviewer.inventory, 'timingEligible': False,
        'scope': ['Independent Python exact uint64 partitions and unchanged M1 raw protocol/identity replay.',
                  'Every measured SHA phase requires its selected compiled MSG2 path under hot1500/flags3.',
                  'Guest control and stop-delivery tails are included; zero JSON/HTTP exposure is not exclusive CPU-time attribution.',
                  'Diagnostic capture evidence only. No performance ratios or production promotion.']}
    output = reviewer.path(args.output)
    require(output.is_relative_to(ROOT / 'artifacts'), 'Review output belongs under artifacts')
    output.mkdir()
    with (output / 'review.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'status': 'passed', 'runs': len(runs), 'identities': len(reviewer.inventory), 'output': str(output)}))


if __name__ == '__main__':
    main()
