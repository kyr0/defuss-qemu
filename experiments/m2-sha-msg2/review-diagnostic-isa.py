#!/usr/bin/env python3
"""Independent Python replay of Node MSG2 exact diagnostic ISA evidence."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
COUNTS = [4096] * 6 + [8192]
FIXTURE_SHA = '504497a4a040dad223d6c302563b2131e9458ec71dbefa685d3feb2b9902a636'
FAULT = 'MSG2_FAULT_PASS warmup=4096 faults=1 state=ymm0-2,flags pc=exact address=exact sideEffect=once'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(path):
    data = Path(path).read_bytes()
    return {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


def exact_counts(values):
    require(isinstance(values, list) and len(values) == 3, 'Three counter banks required')
    for value in values:
        require(isinstance(value, str) and re.fullmatch(r'0|[1-9][0-9]*', value), 'Noncanonical unsigned counter')
    numbers = [int(value) for value in values]
    require(all(n < 2**64 for n in numbers), 'Counter exceeds uint64')
    require(numbers[2] <= numbers[0], 'Fallback is not a subset of original helpers')
    return numbers


def replay(report, serial):
    require(report['status'] == 'passed' and report['schema'] == 1, 'Unsuccessful/unknown report')
    require(report['exposureContract'] == 'exact-fixture-v1', 'Wrong exact contract')
    require(report['expectedInstructionCounts'] == list(map(str, COUNTS)), 'Wrong instruction contract')
    require(report['enabled'] in ['on', 'off'] and type(report['cold']) is bool, 'Invalid selection')
    enabled, cold = report['enabled'] == 'on', report['cold']
    require(report['settings'] == {'hotLimit': 65535 if cold else 1500, 'runtimeFlags': 2,
        'pressureAdmission': False, 'smp': 1, 'ramMiB': 512, 'tbMiB': 128}, 'Unexpected fixture settings')
    require(report['configuredStatus'] == (65538 if enabled else 65537), 'Wrong configured status')
    locked = 65540 if enabled else 65539
    require(report['finalStatus'] == locked and report['executionCounts'] is True, 'Wrong final mode/ABI')
    require(report['fixturePass'] == 'MSG2_FIXTURE_PASS checks=28672' and report['faultPass'] == FAULT,
            'Missing exact fixture/fault pass')
    require('failure' not in report, 'Report retains a failure')
    require(not any('FIXTURE_FAIL' in line or 'Kernel panic' in line for line in serial.splitlines()),
            'Failure in raw serial')
    expected = ['MSG2_FIXTURE_START', 'MSG2_GATE:-1']
    for mode in range(7):
        if mode == 6:
            expected.append(FAULT)
        expected += [f'MSG2_MODE_PASS:{mode} checks=4096', f'MSG2_GATE:{mode}']
    expected += ['MSG2_FIXTURE_PASS checks=28672', 'FIXTURE_PASS']
    relevant = [line for line in serial.splitlines() if line.startswith(('MSG2_', 'FIXTURE_'))]
    require(relevant == expected, 'Raw fixture marker sequence differs')
    require(len(report['gates']) == 8, 'Eight stopped gates required')
    previous, rows = None, []
    for index, gate in enumerate(report['gates']):
        require(gate['kind'] == index - 1 and gate['status'] == locked, 'Gate order/mode differs')
        current = exact_counts(gate['counters'])
        if enabled:
            require(current[2] == 0, 'Enabled mode has cumulative compiled fallback')
        else:
            require(current[1] == 0, 'Disabled mode has cumulative compiled inline')
        if cold:
            require(current[1:] == [0, 0], 'Cold mode has compiled exposure')
        if previous is not None:
            delta = [a - b for a, b in zip(current, previous)]
            require(all(n >= 0 for n in delta), 'Counter reset/wrap')
            require(gate['delta'] == list(map(str, delta)), 'Stored delta differs from cumulative banks')
            original, inline, fallback = exact_counts(gate['delta'])
            count = COUNTS[index - 1]
            require(original + inline == count, 'Exact instruction count differs')
            if not cold:
                require((inline if enabled else fallback) > 0, 'No selected compiled path exposure')
            row = {'contract': 'exact-fixture-v1', 'mode': index - 1,
                   'expectedInstructions': str(count), 'observedInstructions': str(original + inline),
                   'interpreted': str(original - fallback), 'compiledInline': str(inline),
                   'compiledFallback': str(fallback)}
            require(gate['exposure'] == row, 'Stored exposure partition differs')
            rows.append(row)
        else:
            require('delta' not in gate and 'exposure' not in gate, 'Initial gate is not an interval')
        previous = current
    totals = {key: str(sum(int(row[key]) for row in rows)) for key in
              ['observedInstructions', 'interpreted', 'compiledInline', 'compiledFallback']}
    require(totals['observedInstructions'] == '32768', 'Wrong whole-fixture instruction total')
    return {'enabled': report['enabled'], 'cold': cold, 'node': report['node'], 'intervals': rows, 'totals': totals}


def review(paths, build, fixture, root=ROOT):
    root = root.resolve()
    identities = {}

    def inside(path):
        result = (root / path).resolve()
        require(result.is_relative_to(root) and result != root, 'Evidence path outside project')
        return result

    def retain(path):
        path = inside(path)
        result = identity(path)
        identities[str(path.relative_to(root))] = result
        return result

    build, fixture = inside(build), inside(fixture)
    build_report = json.loads((build / 'build-report.json').read_text())
    require(build_report['status'] == 'passed', 'Runtime build failed')
    source_check = json.loads((build / 'source-recheck.json').read_text())
    require(source_check['status'] == 'passed' and source_check['sourceFingerprint'] == build_report['sourceFingerprint'],
            'Post-build source fingerprint differs')
    for name, expected in build_report['artifacts'].items():
        require(retain(build / name) == expected, 'Runtime build artifact changed: ' + name)
    fixture_report = json.loads((fixture / 'build-report.json').read_text())
    require(fixture_report['status'] == 'passed', 'Fixture build failed')
    require(retain(fixture / 'guest-fixture.c')['sha256'] == FIXTURE_SHA, 'Unrecognized fixture source')
    require(fixture_report['inputHashes']['experiments/m2-sha-msg2/guest-fixture.c'] == FIXTURE_SHA,
            'Fixture build source differs')
    for name, key in [('fixture', 'binarySha256'), ('initramfs.cpio.gz', 'initramfsSha256')]:
        require(retain(fixture / name)['sha256'] == fixture_report[key], 'Fixture artifact changed')
    for path in [build / 'build-report.json', build / 'source-recheck.json', fixture / 'build-report.json']:
        retain(path)
    mandatory = [build / 'runtime/x86_64/qemu-system-x86_64.js', build / 'runtime/x86_64/qemu-system-x86_64.wasm',
                 fixture / 'initramfs.cpio.gz', fixture / 'guest-fixture.c', fixture / 'build-report.json']
    mandatory += [inside(name) for name in ['assets/bun/amd64/vmlinuz-virt',
        'experiments/m2-sha-msg2/run-guest-exact.mjs', 'experiments/m2-sha-msg2/fixture-check.mjs',
        'experiments/m2-sha-msg2/fixture-check-exact.mjs', 'host/browser/qmp.mjs', 'packaging/bun-app/serial.mjs']]
    mandatory += [inside('engine/qemu/pc-bios/' + name) for name in ['bios-256k.bin', 'kvmvapic.bin', 'linuxboot_dma.bin']]
    runs, combinations = [], set()
    for path in paths:
        path = inside(path)
        report = json.loads(path.read_text())
        require(all(str(p.relative_to(root)) in report['inputHashes'] for p in mandatory), 'Missing required input hash')
        for name, digest in report['inputHashes'].items():
            require(retain(name)['sha256'] == digest, 'Live run input changed: ' + name)
        row = replay(report, path.with_name('serial.log').read_text())
        key = (row['enabled'], row['cold'])
        require(key not in combinations, 'Duplicate selection/temperature is not independent matrix coverage')
        combinations.add(key)
        row.update({'report': str(path.relative_to(root)), 'reportIdentity': retain(path),
                    'serialIdentity': retain(path.with_name('serial.log'))})
        runs.append(row)
    return {'schema': 1, 'status': 'passed', 'kind': 'independent-msg2-exact-isa-review',
        'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'fullMatrix': combinations == {('on', True), ('on', False), ('off', True), ('off', False)},
        'sourceFingerprint': build_report['sourceFingerprint'], 'runs': runs, 'identities': identities,
        'scope': ['Independent Python cumulative-counter arithmetic, exact marker order and full input hash replay.',
                  'Node Emscripten direct execution; flags2 fixture disables pressure admission. Not Chrome Bun production flags3 exposure.',
                  'The source-bound runner checks stopped QMP state and late mode-change rejection; those actions cannot be replayed from raw serial alone.',
                  'All counts include 4096 successful fault-PC warmups. Aggregate counts cannot identify the tier of the single fault.',
                  'Diagnostic evidence establishes tested semantics and selected paths only; it is ineligible for speed claims.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', action='append', required=True)
    parser.add_argument('--build', default='artifacts/m2-msg2-diagnostic-build-01')
    parser.add_argument('--fixture', default='artifacts/m2-msg2-guest-01')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = review(args.report, args.build, args.fixture)
    result['reviewer'] = identity(__file__)
    output = (ROOT / args.output).resolve()
    require(output.is_relative_to(ROOT / 'artifacts'), 'Review outputs belong under artifacts')
    output.mkdir()
    with (output / 'review.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'status': 'passed', 'fullMatrix': result['fullMatrix'], 'runs': len(result['runs']),
                      'identities': len(result['identities']), 'output': str(output)}))


if __name__ == '__main__':
    main()
