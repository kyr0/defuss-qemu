#!/usr/bin/env python3
"""Verify the declared original-runtime confirmation with the frozen reconstructor.

No new serial/counter oracle and no assumption of positive exposure. This driver
binds the single follow-up plan, original runtime, controller and raw capture.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import traceback

ROOT = Path(__file__).resolve().parents[2]


def need(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    h = hashlib.sha256()
    size = 0
    with path.open('rb') as f:
        while b := f.read(1024 * 1024):
            h.update(b)
            size += len(b)
    return {'sha256': h.hexdigest(), 'bytes': size}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    out = ROOT / args.output
    need(out.resolve().is_relative_to(ROOT / 'artifacts'), 'Artifact output')
    out.mkdir()
    inventory = {}
    report = {'schema': 1, 'status': 'failed', 'timingEligible': False,
              'candidatePromotion': False, 'inventory': inventory,
              'authorship': 'Same root agent. Driver reuses the frozen separate Python reconstructor; not an external source audit.'}

    def check(name, expected=None):
        path = ROOT / name
        need(path.resolve() == path and path.is_relative_to(ROOT), 'Canonical input')
        if name not in inventory:
            inventory[name] = digest(path)
        if expected:
            need(inventory[name] == {k: expected[k] for k in ('sha256', 'bytes')}, 'Identity ' + name)
        return path

    def read(name):
        path = check(name)
        need(path.stat().st_size <= 32 * 1024 * 1024, 'Metadata bound')
        return json.loads(path.read_bytes())

    def reference(ref):
        return check(ref['path'], ref)

    def freeze(name):
        value = read(name)
        for item in value['files']:
            reference(item)
            check(item['archive'], item)
        reference(value['hostTests'])
        need(read(value['hostTests']['path'])['status'] == 'passed', 'Frozen tests')
        for path, expected in value.get('dependencies', {}).items():
            check(path, expected)
        return value

    try:
        check(str(Path(__file__).relative_to(ROOT)))
        reviewer = freeze('artifacts/m3b-bun-exposure-review-source-01/manifest.json')
        source = 'experiments/m3b-bun-exposure-review/review.py'
        need(any(f['path'] == source for f in reviewer['files']), 'Bound reconstructor')
        spec = importlib.util.spec_from_file_location('frozen_exposure_review', ROOT / source)
        oracle = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(oracle)
        harness = freeze('artifacts/m3b-bun-exposure-source-01/manifest.json')
        plan = read('artifacts/m3b-original-confirmation-plan-01/plan.json')
        need(plan['timingEligible'] is False and plan['candidatePromotion'] is False, 'Diagnostic plan')
        need(plan['runs'] == [{'enabled': True, 'output': 'artifacts/m3b-bun-exposure-on-02',
                              'execution': 'artifacts/m3b-bun-exposure-execution-on-02',
                              'timeoutMs': 1800000, 'outerDeadlineSeconds': 2100}], 'One declared run')
        for key in ('controller', 'derivedFromController', 'parentRuntimeBinding',
                    'originalZeroExposure', 'admissionObserverPositiveReview'):
            reference(plan[key])
        check('artifacts/m3b-original-confirmation-plan-01/controller.py', plan['controller'])
        base = plan['runs'][0]['output'] + '/'
        capture = read(base + 'report.json')
        need(capture['status'] == 'passed' and capture['enabled'] is True and
             capture['protocol'] == oracle.PROTOCOL, 'Capture acceptance')
        need(capture['timingEligible'] is False and capture['candidatePromotion'] is False and
             capture['productionDefaultEnabled'] is False, 'No promotion')
        need(capture['coldOnly'] is True and capture['snapshots'] == 0 and
             capture['inputsStable'] is True and capture['timeoutMs'] == 1800000, 'Cold diagnostic')
        need(capture['recordCount'] == 72 and not capture['pageErrors'] and
             not capture['serverErrors'], 'Complete clean capture')
        need(capture['inputs'][oracle.BINDING]['sha256'] == oracle.BINDING_SHA ==
             plan['parentRuntimeBinding']['sha256'], 'Original runtime binding')
        need(read(base + 'inputs.json')['inputs'] == capture['inputs'], 'Prelaunch identities')
        for path, expected in capture['inputs'].items():
            check(path, expected)
        for item in harness['files']:
            need(capture['inputs'][item['path']] == {k: item[k] for k in ('sha256', 'bytes')}, 'Original frozen harness')
        for path, expected in capture['served'].items():
            need(capture['inputs'][path] == expected, 'Served identity')
        binding = read(oracle.BINDING)
        contract = reference(binding['graphContract']).read_text()
        for key, symbol in [('graph', 'm3b_expected_graph'), ('objects', 'm3b_expected_objects')]:
            match = re.search(r'static const char ' + symbol + r'\[\]\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*)+);', contract)
            need(match is not None, 'Native graph literal')
            value = ''.join(json.loads(x) for x in re.findall(r'"(?:[^"\\]|\\.)*"', match.group(1)))
            need(capture[key] == {'text': value, 'sha256': hashlib.sha256(value.encode()).hexdigest(), 'bytes': len(value.encode())}, 'Native graph identity')
        raw = check(base + 'progress.jsonl').read_bytes()
        need(raw.endswith(b'\n') and len(raw) < 32 * 1024 * 1024, 'Complete journal')
        rows = [json.loads(line) for line in raw.splitlines()]
        need(all('admissionRaw' not in row for row in rows), 'Original observer-free bank')
        summary, serial = oracle.reconstruct(rows, True, capture['graph']['text'], capture['objects']['text'])
        need(serial == check(base + 'serial.log').read_bytes().decode('utf-8') == capture['browserResult']['serial'], 'Exact raw serial')
        for key, value in summary.items():
            need(capture['summary'][key] == value, 'Reconstructed ' + key)
        offline = read('artifacts/m3b-bun-exposure-inspection-on-02/review.json')
        need(offline['status'] == 'passed' and offline['summary'] == capture['summary'], 'Offline JS agreement')
        for path, expected in offline['inputs'].items():
            check(path, expected)
        execution = plan['runs'][0]['execution'] + '/'
        request = read(execution + 'request.json')
        result = read(execution + 'execution.json')
        need(result['returncode'] == 0 and result['timedOut'] is False and
             result['error'] is None and result['cleanupError'] is None and
             result['request'] == request, 'Completed controller')
        need(request['controllerSha256'] == plan['controller']['sha256'], 'Planned controller')
        check(execution + 'controller.py', plan['controller'])
        need(request['argv'][1:] == ['benchmarks/harness/m3b-exposure/run.mjs', '--enabled', '1', '--timeout', '1800000', '--output', base[:-1]], 'Declared command')
        need(request['outerDeadlineSeconds'] == 2100 and Path(request['scratch']).resolve().is_relative_to(ROOT / 'tmp'), 'Deadline and scratch')
        need(datetime.datetime.fromisoformat(plan['createdUtc']) < datetime.datetime.fromisoformat(request['startedUtc']), 'Plan predates launch')
        cleanup = read(execution + 'browser-cleanup.json')
        need(cleanup['status'] == 'passed' and not cleanup['remainingProfileProcesses'] and
             cleanup['ownedScratch'] == request['scratch'], 'Owned browser cleanup')
        for old in ('m3b-bun-exposure-on-01', 'm3b-bun-exposure-off-01', 'm3b-bun-admission-on-01', 'm3b-bun-admission-off-01'):
            need(read('artifacts/' + old + '/report.json')['summary']['nonce'] != summary['nonce'], 'Fresh guest')
        report['summary'] = summary
        report['status'] = 'passed'
    except Exception:
        report['failure'] = traceback.format_exc()
    report['completedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (out / 'review.json').open('x') as f:
        json.dump(report, f, indent=2)
        f.write('\n'); f.flush(); os.fsync(f.fileno())
    with (out / 'review.py').open('xb') as f:
        f.write(Path(__file__).read_bytes()); f.flush(); os.fsync(f.fileno())
    print(json.dumps({'status': report['status'], 'identities': len(inventory), 'failure': report.get('failure')}))
    return report['status'] != 'passed'


if __name__ == '__main__':
    raise SystemExit(main())
