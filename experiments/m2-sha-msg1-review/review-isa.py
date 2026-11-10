#!/usr/bin/env python3
"""Independent Python replay of frozen MSG1 diagnostic ISA evidence; no guest execution."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
IMPLEMENTATION = 'artifacts/m2-msg1-implementation-01/manifest.json'
IMPLEMENTATION_SHA = 'b04500ea12e5719bfa3ff317b28fd0d31ddf292f8b4b318303f3517bd987a874'
GUEST_SOURCE = 'artifacts/m2-msg1-guest-source-01/manifest.json'
GUEST_SOURCE_SHA = '792a641b67b3cece367909eabab28e067869a40b9dc9c45147014e6606d34b14'
FIXTURE_SHA = '81aa84cb76008814a73b9e1179920074e7a91387c046a81ca8043b5335ac8dde'
COUNTS = [4096] * 6 + [8192]
FAULT = 'MSG1_FAULT_PASS warmup=4096 faults=1 state=ymm0-2,flags pc=exact address=exact sideEffect=once'
SERIAL_CONTRACT = dict(gates=8, modes=7, checkedInstructions=28672, faultWarmups=4096,
                       faults=1, successfulInstructions=32768)
PROTOCOL = 'defuss-m2-msg1-diagnostic-isa-v1'
ENTRY = 'experiments/m2-sha-msg1/run-guest-exact.mjs'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(path):
    path = Path(path)
    before = path.stat()
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
            size += len(block)
    after = path.stat()
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and size == after.st_size,
            'File changed while hashing: ' + str(path))
    return {'sha256': digest.hexdigest(), 'bytes': size}


def exact_counts(values):
    require(isinstance(values, list) and len(values) == 3, 'Three counter banks required')
    require(all(isinstance(v, str) and re.fullmatch(r'0|[1-9][0-9]*', v) for v in values),
            'Noncanonical unsigned counter')
    numbers = [int(v) for v in values]
    require(all(n < 2**64 for n in numbers), 'Counter exceeds uint64')
    require(numbers[2] <= numbers[0], 'Fallback is not a subset of original helpers')
    return numbers


def selected(numbers, enabled, cold):
    require(numbers[2 if enabled else 1] == 0, 'Forbidden cumulative selected-path count')
    if cold:
        require(numbers[1:] == [0, 0], 'Cold mode has compiled exposure')


def replay(report, serial, request):
    require(type(report['schema']) is int and report['schema'] == 1 and report['status'] == 'passed',
            'Unsuccessful/unknown report')
    require(report['protocol'] == PROTOCOL and report['timingEligible'] is False,
            'Wrong diagnostic protocol/timing eligibility')
    require(report['fixtureContract'] == 'msg1-isa-v1' and
            report['exposureContract'] == 'exact-msg1-fixture-v1', 'Wrong fixture contract')
    require(report['expectedInstructionCounts'] == list(map(str, COUNTS)), 'Wrong instruction contract')
    require(report['enabled'] in ('on', 'off') and type(report['cold']) is bool, 'Invalid selection')
    enabled, cold = report['enabled'] == 'on', report['cold']
    require(report['settings'] == dict(hotLimit=65535 if cold else 1500, runtimeFlags=2,
            pressureAdmission=False, smp=1, ramMiB=512, tbMiB=128), 'Unexpected fixture settings')
    require(request['status'] == 'running' and request['entrypoint'] == ENTRY and
            request['gates'] == request['signals'] == request['stderr'] == [], 'Invalid pre-execution request')
    for key in ('schema', 'protocol', 'timingEligible', 'fixtureContract', 'exposureContract',
                'expectedInstructionCounts', 'enabled', 'cold', 'node', 'settings', 'inputHashes', 'runtimeBuild'):
        require(request[key] == report[key], 'Request/report changed: ' + key)
    require(report['configuredStatus'] == (65538 if enabled else 65537), 'Wrong configured status')
    locked = 65540 if enabled else 65539
    require(report['finalStatus'] == locked and report['executionCounts'] is True and
            report['lateConfigurationResult'] == -1, 'Wrong final mode/ABI/late configuration')
    require(report['fixturePass'] == 'MSG1_FIXTURE_PASS checks=28672' and report['faultPass'] == FAULT,
            'Missing exact fixture/fault pass')
    require(report['signals'] == [71] * 8 and report['serialContract'] == SERIAL_CONTRACT,
            'Gate signal/serial contract differs')
    require('failure' not in report, 'Report retains a failure')
    require('FIXTURE_FAIL' not in serial and 'Kernel panic' not in serial, 'Failure in raw serial')
    expected = ['MSG1_FIXTURE_START', 'MSG1_GATE:-1']
    for mode in range(7):
        if mode == 6:
            expected.append(FAULT)
        expected.extend([f'MSG1_MODE_PASS:{mode} checks=4096', f'MSG1_GATE:{mode}'])
    expected.extend(['MSG1_FIXTURE_PASS checks=28672', 'FIXTURE_PASS'])
    relevant = [line for line in serial.splitlines() if line.startswith(('MSG1_', 'MSG2_', 'FIXTURE_'))]
    require(relevant == expected, 'Raw fixture marker sequence differs')
    require(len(report['gates']) == 8, 'Eight stopped gates required')
    previous, rows = None, []
    for index, gate in enumerate(report['gates']):
        require(type(gate['kind']) is int and gate['kind'] == index - 1 and gate['status'] == locked and
                gate['stopped'] is True, 'Gate order/mode/stop differs')
        pool = gate['pool']
        require(type(pool['charged']) is int and 0 <= pool['charged'] <= 12000 and
                pool['limit'] == 12000 and pool['linearMemoryBytes'] == 2**31, 'Wrong pool/linear memory bound')
        current = exact_counts(gate['counters'])
        selected(current, enabled, cold)
        if previous is not None:
            delta = [a - b for a, b in zip(current, previous)]
            require(all(n >= 0 for n in delta), 'Counter reset/wrap')
            require(gate['delta'] == list(map(str, delta)), 'Stored delta differs from cumulative banks')
            original, inline, fallback = exact_counts(gate['delta'])
            selected([original, inline, fallback], enabled, cold)
            count = COUNTS[index - 1]
            require(original + inline == count, 'Exact instruction count differs')
            if not cold:
                require((inline if enabled else fallback) > 0, 'No selected compiled path exposure')
            row = dict(contract='exact-msg1-fixture-v1', mode=index - 1, expectedInstructions=str(count),
                       observedInstructions=str(original + inline), interpreted=str(original - fallback),
                       compiledInline=str(inline), compiledFallback=str(fallback))
            require(gate['exposure'] == row, 'Stored exposure partition differs')
            rows.append(row)
        else:
            require('delta' not in gate and 'exposure' not in gate, 'Initial gate is not an interval')
        previous = current
    totals = {key: str(sum(int(row[key]) for row in rows)) for key in
              ('observedInstructions', 'interpreted', 'compiledInline', 'compiledFallback')}
    require(totals['observedInstructions'] == '32768', 'Wrong whole-fixture instruction total')
    return dict(enabled=report['enabled'], cold=cold, node=report['node'], intervals=rows, totals=totals,
                initialCounters=report['gates'][0]['counters'], finalCounters=report['gates'][-1]['counters'])


class Evidence:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.identities = {}

    def inside(self, path):
        result = (self.root / path).resolve()
        require(result.is_relative_to(self.root) and result != self.root, 'Evidence path outside project')
        return result

    def relative(self, path):
        return str(self.inside(path).relative_to(self.root))

    def retain(self, path, expected=None):
        path = self.inside(path)
        result = identity(path)
        name = self.relative(path)
        require(name not in self.identities or self.identities[name] == result, 'Input changed during replay: ' + name)
        require(expected is None or result == expected, 'Identity mismatch: ' + name)
        self.identities[name] = result
        return result

    def read_json(self, path):
        self.retain(path)
        result = json.loads(self.inside(path).read_text())
        self.retain(path)
        return result

    def inputs(self, hashes, mandatory):
        require(isinstance(hashes, dict) and set(mandatory) <= set(hashes), 'Missing mandatory run input')
        for path, digest in hashes.items():
            require(self.retain(path)['sha256'] == digest, 'Run input hash mismatch: ' + path)

    def finish(self):
        for name, expected in list(self.identities.items()):
            self.retain(name, expected)


def frozen(evidence, path, digest):
    manifest = evidence.read_json(path)
    require(evidence.retain(path)['sha256'] == digest, 'Frozen manifest changed')
    for name, expected in manifest['files'].items():
        evidence.retain(name, expected)
        evidence.retain(Path(path).parent / name, expected)
    for name, expected in manifest.get('baseInputs', manifest.get('sourceDependencies', {})).items():
        evidence.retain(name, expected)
    return manifest


def review(paths, build, fixture, root=ROOT):
    e = Evidence(root)
    build, fixture = e.inside(build), e.inside(fixture)
    implementation = frozen(e, IMPLEMENTATION, IMPLEMENTATION_SHA)
    frozen(e, GUEST_SOURCE, GUEST_SOURCE_SHA)
    build_path = build / 'build-report.json'
    b = e.read_json(build_path)
    require(b['status'] == 'passed' and b['targets'] == ['x86_64-softmmu'], 'Runtime build failed/wrong target')
    source = e.inside(b['source'].removeprefix('/project/'))
    overlay_path = Path(str(source) + '-m2-msg1-overlay.json')
    overlay = e.read_json(overlay_path)
    require(overlay['experiment'] == 'm2-sha-msg1' and overlay['mode'] == 'diagnostic' and
            overlay['kind'] == 'diagnostic-only' and overlay['configAbi'] == 1 and
            overlay['defaultEnabled'] is False, 'Wrong diagnostic overlay')
    expected_changes = [{'path': x['path'], 'before': x['beforeSha256'], 'after': x['sha256']}
                        for x in implementation['overlayPreview']['diagnostic']]
    require(overlay['changes'] == expected_changes, 'Overlay differs from frozen diagnostic preview')
    for change, preview in zip(overlay['changes'], implementation['overlayPreview']['diagnostic']):
        expected = {'sha256': change['after'], 'bytes': preview['bytes']}
        e.retain(source / change['path'], expected)
        e.retain(Path(IMPLEMENTATION).parent / 'overlay-diagnostic' / change['path'], expected)
    for name, digest in overlay['inputs'].items():
        require(e.retain('experiments/m2-sha-msg1/' + name)['sha256'] == digest, 'Overlay input differs')
    check = e.read_json(build / 'source-recheck.json')
    require(check['status'] == 'passed' and check['sourceFingerprint'] == b['sourceFingerprint'] and
            check['buildReport'] == e.retain(build_path) and check['overlay'] == e.retain(overlay_path) and
            check['frozenImplementation'] == e.retain(IMPLEMENTATION) and check['runtimeArtifacts'] == b['artifacts'],
            'Post-build full-source audit binding differs')
    e.retain(check['inventory']['path'], {k: check['inventory'][k] for k in ('sha256', 'bytes')})
    for name, expected in b['artifacts'].items():
        require(name.startswith('runtime/'), 'Runtime artifact outside runtime directory')
        e.retain(build / name, expected)
    require({e.relative(p) for p in (build / 'runtime').rglob('*') if p.is_file()} ==
            {e.relative(build / p) for p in b['artifacts']}, 'Unrecorded/missing runtime file')
    f = e.read_json(fixture / 'build-report.json')
    require(f['status'] == 'passed' and f['fixtureContract'] == 'msg1-isa-v1' and f['instruction'] == 'sha256msg1' and
            f['modes'] == 7 and f['checksPerMode'] == 4096 and f['totalChecks'] == 28672 and
            f['successfulInstructions'] == 32768 and f['expectedInstructionCounts'] == COUNTS and
            f['memoryFault']['warmup'] == 4096 and f['memoryFault']['faults'] == 1 and
            f['memoryFault']['successfulFaultingInstructions'] == 0, 'Wrong guest fixture/count contract')
    require(f['sdkRequired'] == b['sdk'] and f['compilerTarget'] == 'x86_64-linux-gnu', 'Guest compiler identity differs')
    require(e.retain(fixture / 'guest-fixture.c')['sha256'] == FIXTURE_SHA and
            f['inputHashes']['experiments/m2-sha-msg1/guest-fixture.c'] == FIXTURE_SHA, 'Wrong archived fixture')
    e.inputs(f['inputHashes'], ['experiments/m2-sha-msg1/guest-fixture.c', 'experiments/m2-sha-msg1/build-guest.py',
                             'packaging/bun_app_package.py', 'assets/bun/amd64/initramfs-virt'])
    for name, digest in [('fixture', f['binarySha256']), ('initramfs.cpio.gz', f['initramfsSha256']),
                         ('fixture.disassembly.txt', f['staticInstructions']['disassemblySha256'])]:
        require(e.retain(fixture / name)['sha256'] == digest, 'Guest artifact differs: ' + name)
    disassembly = (fixture / 'fixture.disassembly.txt').read_text()
    sites = [line.strip() for line in disassembly.splitlines() if re.search(r'\bsha256msg1\b', line)]
    require(f['staticInstructions']['sites'] == sites and len(sites) == 8 and
            f['staticInstructions']['sha256msg1'] == 8 and f['staticInstructions']['sha256msg2'] == 0 and
            not re.search(r'\bsha256msg2\b', disassembly), 'Static instruction sites differ')
    mandatory = [build_path, overlay_path, IMPLEMENTATION, ENTRY, 'experiments/m2-sha-msg1/guest-runner.mjs',
                 'experiments/m2-sha-msg1/fixture-check.mjs', 'host/browser/qmp.mjs', 'host/browser/machine.mjs',
                 'packaging/bun-app/serial.mjs', 'assets/bun/amd64/vmlinuz-virt']
    mandatory += [build / name for name in b['artifacts']]
    mandatory += [source / x['path'] for x in overlay['changes']]
    mandatory += ['experiments/m2-sha-msg1/' + name for name in overlay['inputs']]
    mandatory += [fixture / name for name in ('build-report.json', 'guest-fixture.c', 'fixture', 'initramfs.cpio.gz', 'fixture.disassembly.txt')]
    mandatory += list(f['inputHashes'])
    mandatory += ['engine/qemu/pc-bios/' + name for name in ('bios-256k.bin', 'kvmvapic.bin', 'linuxboot_dma.bin')]
    mandatory = {e.relative(p) for p in mandatory}
    runtime_binding = dict(path=e.relative(build_path), sourceFingerprint=b['sourceFingerprint'],
                           overlay=e.relative(overlay_path), mode='diagnostic')
    runs, combinations = [], set()
    for path in paths:
        path = e.inside(path)
        report, request = e.read_json(path), e.read_json(path.with_name('request.json'))
        require(report['runtimeBuild'] == runtime_binding and request['fixture'] == e.relative(fixture) and
                request['runtime'] == e.relative(build / 'runtime/x86_64/qemu-system-x86_64.js'), 'Wrong run build/fixture binding')
        e.inputs(report['inputHashes'], mandatory)
        serial_path = path.with_name('serial.log')
        serial_identity = e.retain(serial_path)
        row = replay(report, serial_path.read_text(), request)
        key = (row['enabled'], row['cold'])
        require(key not in combinations, 'Duplicate matrix selection/temperature')
        combinations.add(key)
        row.update(report=e.relative(path), reportIdentity=e.retain(path), serialIdentity=serial_identity,
                   requestIdentity=e.retain(path.with_name('request.json')))
        runs.append(row)
    require(runs, 'At least one run required')
    e.finish()
    return dict(schema=1, status='passed', kind='independent-msg1-exact-isa-review',
        createdUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        fullMatrix=combinations == {('on', True), ('on', False), ('off', True), ('off', False)},
        sourceFingerprint=b['sourceFingerprint'], runs=runs, identities=e.identities,
        scope=[
            'Independent Python raw marker replay, exact integer counter partitions, request and frozen source/overlay/runtime/fixture identities; inputs rehashed after replay.',
            'The full source inventory is bound to the prior independent post-build audit; this replay rehashes overlay and frozen inputs, not all 10,101 prepared source files.',
            'Stopped QMP reads, exact machine arguments and late configuration rejection are source-bound runner actions; raw serial alone cannot independently observe the host QMP exchange.',
            'Seven forms test register/source alias, YMM upper/source preservation and flags. The fault case checks the complete m128 load while its first word remains readable, exact PC/address, signal state and one preceding side effect.',
            'Counts include 4,096 successful fault-PC warmups; the fault contributes zero successful instructions. Aggregate counters do not identify the execution tier of the individual fault.',
            'Node direct Emscripten flags2, hot1500/cold65535, pressure admission disabled. No Chrome unchanged-Bun production exposure, speed or promotion claim.'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', action='append', required=True)
    parser.add_argument('--build', default='artifacts/m2-msg1-diagnostic-build-01')
    parser.add_argument('--fixture', default='artifacts/m2-msg1-guest-01')
    parser.add_argument('--require-matrix', action='store_true')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = review(args.report, args.build, args.fixture)
    require(not args.require_matrix or result['fullMatrix'], 'Four distinct matrix entries required')
    result['reviewer'] = identity(__file__)
    output = (ROOT / args.output).resolve()
    require(output.is_relative_to(ROOT / 'artifacts') and output != ROOT / 'artifacts', 'Output belongs under artifacts')
    output.mkdir()
    with (output / 'review.json').open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    for directory in (output, output.parent):
        fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    print(json.dumps(dict(status='passed', fullMatrix=result['fullMatrix'], runs=len(result['runs']),
                          identities=len(result['identities']), output=str(output))))


if __name__ == '__main__':
    main()
