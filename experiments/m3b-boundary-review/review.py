#!/usr/bin/env python3
"""Independent Python replay of retained M3b boundary diagnostics.

--inspect defers files larger than1MiB and cannot publish status passed.
--full is root-serialized and rehashes the complete referenced evidence.
No project JS validator, compiler, browser or guest is executed.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = 'defuss-m3b-boundary-fixture-v1'
U64 = (1 << 64) - 1
U32 = (1 << 32) - 1
M3A = 'published eligiblePublished compiledAttempts selectedEntries fallbackEntries invalidRedispatches staleInstanceMisses instanceInstalls instanceRetires invalidations flushes emittedWasmBytes importBytes descriptorBytes invalidMetadata generationExhaustions extraWorkerRejects watchPcMismatches injectedStaleInstances injectedInvalidDescriptors injectionRejects'.split()
FALLBACK = 'eligible unsupportedTarget multipleContexts unsupportedMode debugOrAccounting temporaryTB planOrAot noWasm missingMetadata'.split()
M3B = 'predecodeAccepted formed cleanRetries entryRejects compiledEntries tciEntries BAttempts BRequested servicePaid debtErrors tciTargetReturns backedgeTciReturns IRRejected emittedOwners'.split()
WATCH = 'compiledEntries tciEntries BAttempts BRequested servicePaid predecodeAccepted IRRejected emittedOwners entryRejects cleanRetries backedgeTciReturns'.split()
DENIED = [('query-block', {}), ('qom-list', {'path': '/machine'}),
          ('human-monitor-command', {'command-line': 'info qtree'}),
          ('object-add', {'qom-type': 'memory-backend-ram', 'id': 'm3b-control-probe', 'size': 4096}),
          ('object-del', {'id': 'm3b-control-probe-absent'}), ('defuss-m3b-unknown-command', {})]
DENIAL = 'GenericError: Command forbidden by frozen M3b diagnostic control surface'


def need(ok, why):
    if not ok:
        raise ValueError(why)


def eq(a, b, why):
    need(json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True), why)


def uint(x):
    return type(x) is int and 0 <= x <= U32


def bank(raw, length):
    need(type(raw) is list and len(raw) == length and all(map(uint, raw)), 'Raw uint32 bank')
    return raw


def pair(w, i):
    return w[i] | w[i + 1] << 32


def h64(x):
    return format(x & U64, '016x')


def hx(x):
    return '0x' + format(x, 'x')


def paused(status, initial=False):
    need(status.get('running') is False and status.get('status') == ('prelaunch' if initial else 'paused'), 'Exact stopped state')


def idle(w):
    bank(w, 256)
    expected = [0] * 256
    for i, value in {0: 0x4d334253, 1: 1, 6: 256, 7: 64}.items(): expected[i] = value
    eq(w, expected, 'Idle boundary bank')


def m3b(raw, enabled):
    w = bank(raw, 128)
    for at, value in {0: 0x4d334231, 1: 1, 2: 63 if enabled else 62, 3: 0, 4: 0,
                      5: 1, 6: 32, 7: 128, 8: 12, 9: 32, 10: 20, 12: 4}.items(): need(w[at] == value, 'M3b header')
    need(all(w[i] == 0 for i in [13, 14, 15, 30, 31, *range(112, 128)]), 'M3b reserved words')
    counters = dict(zip(M3B, w[16:30]))
    need(counters['debtErrors'] == counters['entryRejects'] == 0 and counters['servicePaid'] == counters['BAttempts'] and
         counters['BRequested'] <= counters['BAttempts'], 'M3b service accounting')
    if not enabled: need(not any(counters.values()), 'OFF M3b activity')
    watches = []
    for slot in range(4):
        at = 32 + 20 * slot
        begin, end, last, generation = (pair(w, at + i) for i in (0, 2, 16, 18))
        need((begin == end == 0 or 0x10000 <= begin < end <= 1 << 47) and w[at + 15] == 0, 'Watch bounds')
        row = {'slot': slot, 'begin': hx(begin), 'end': hx(end), **dict(zip(WATCH, w[at + 4:at + 15])),
               'lastSelectedPC': hx(last), 'lastGeneration': hx(generation)}
        need(row['BRequested'] <= row['BAttempts'] == row['servicePaid'] and row['entryRejects'] == 0, 'Watch accounting')
        need(all(row[k] <= counters[k] for k in WATCH), 'Watch exceeds global')
        if row['compiledEntries'] + row['tciEntries']: need(begin <= last < end and generation > 0, 'Selected watch identity')
        else: need(last == generation == 0, 'Unused watch identity')
        if not enabled or begin == end: need(not any(row[k] for k in WATCH), 'Inactive watch activity')
        watches.append(row)
    return {'abi': 1, 'enabled': enabled, 'status': w[2], 'reasons': 0, 'saturated': False,
            'watchEpoch': w[11], 'counters': counters, 'watches': watches, 'raw': raw}


def check_m3a(row, initial):
    w = bank(row['raw'], 96)
    need(w[:5] == [0x4d335231, 1, 1, 0 if initial else 1, 0], 'M3a state')
    need(w[5:11] == [176, 88, 24, 4, 64, 8], 'M3a layout')
    eq(row['counters'], dict(zip(M3A, w[16:37])), 'M3a typed counters')
    eq(row['fallbacks'], dict(zip(FALLBACK, w[40:49])), 'M3a typed fallbacks')
    c = row['counters']
    need(c['compiledAttempts'] == c['selectedEntries'] + c['fallbackEntries'] + c['invalidRedispatches'] and
         c['fallbackEntries'] == sum(row['fallbacks'].values()), 'M3a conservation')
    need(c['watchPcMismatches'] == c['invalidMetadata'] == 0, 'M3a metadata fault')
    for key, value in {'abi': 1, 'enabled': True, 'started': not initial, 'saturated': False,
                       'storageBytes': 384, 'headerBytes': w[5], 'descriptorBytes': w[6],
                       'instanceRecordBytes': w[7], 'watchEpoch': w[11]}.items(): eq(row[key], value, 'M3a field ' + key)
    for slot in range(4):
        at = 64 + 8 * slot
        need(w[at + 7] in (0, 1), 'M3a watch state')
        eq(row['watches'][slot], {'slot': slot, 'begin': hx(pair(w, at)), 'end': hx(pair(w, at + 2)),
                                 'selectedEntries': w[at + 4], 'lastSelectedPC': hx(pair(w, at + 5)),
                                 'enabled': bool(w[at + 7])}, 'M3a watch decode')
    need(w[54] <= 2, 'M3a injection')
    for key, value in {'action': w[54], 'lastPC': hx(pair(w, 50)), 'lastGeneration': hx(pair(w, 52)), 'diagnostic': True}.items():
        eq(row['testInjection'][key], value, 'M3a injection decode')
    if initial: need(not any(c.values()) and not any(row['fallbacks'].values()) and not any(w[50:55]), 'Prelaunch activity')


def reference(layout):
    need(layout['schema'] == 1 and len(layout['programs']) == 2, 'Layout schema')
    stack = int(layout['stackPointer'], 16)
    need(0x10000 <= stack < 1 << 47 and stack % 16 == 0, 'Guest stack')
    codes = ['83f900740a83c03531d083e901ebf1', '4983f900740d4d31ea4983c2114983e901ebed']
    for i, p in enumerate(layout['programs']):
        need(p['name'] == ['mbnd_add32', 'mbnd_add64'][i] and p['width'] == [32, 64][i] and p['codeHex'] == codes[i], 'Exact program bytes')
        a, b, back, side, end = (int(p[k], 16) for k in ('a', 'b', 'back', 'side', 'end'))
        need(0x10000 <= a < b < back < side < end < 1 << 47 and side - a == p['ownerBytes'] == len(bytes.fromhex(codes[i])) and
             a >> 12 == (side - 1) >> 12, 'Program owner layout')
    need(int(layout['programs'][0]['end'], 16) <= int(layout['programs'][1]['a'], 16), 'Program overlap')
    seed, digest, calls, checks = 0x6c7e9241a5d038bf, 0xcbf29ce484222325, 0, 3
    gates, inputs, results, order = [], [], [], []
    def random():
        nonlocal seed
        seed = (seed ^ seed << 13) & U64; seed ^= seed >> 7; seed = (seed ^ seed << 17) & U64
        return seed
    def prepare(width, count):
        regs = [random() for _ in range(16)]; regs[7] = stack
        flags = 0x202 | random() & 0x8d5
        if width == 64: regs[9] = count
        else: regs[2] = random() & 0xffffffff00000000 | count
        return {'gpr': list(map(h64, regs)), 'rflags': h64(flags)}
    def execute(initial, width, count):
        nonlocal calls, checks, digest
        regs = [int(x, 16) for x in initial['gpr']]
        for _ in range(count):
            if width == 32: regs[0] = ((regs[0] & U32) + 53 ^ (regs[3] & U32)) & U32
            else: regs[10] = ((regs[10] ^ regs[13]) + 17) & U64
        regs[2 if width == 32 else 9] = 0
        calls += 1; checks += 20
        for value in [r for i, r in enumerate(regs) if i != 7] + [0x246, calls]: digest = ((digest ^ value) * 0x100000001b3) & U64
        return {'gpr': list(map(h64, regs)), 'rflags': h64(0x246)}
    def gate(program, phase, request, mode, count, bodies):
        g = {'seq': len(gates), 'program': program, 'phase': phase, 'request': request, 'mode': mode,
             'calls': count, 'bodies': bodies, 'checks': checks, 'digest': h64(digest)}
        gates.append(g); order.append({'type': 'gate', 'value': g})
    gate(-1, 'layout', 0, 0, 0, 0)
    for program in range(2):
        width = [32, 64][program]
        for _ in range(4096): execute(prepare(width, 4), width, 4)
        gate(program, 'warm', 0, 0, 4096, 16384)
        for mode in (1, 2):
            request, count = 2 * program + mode, 3 if mode == 1 else 5
            initial = prepare(width, count)
            row = {'request': request, 'program': program, 'mode': mode, 'count': count, 'priorBefore': calls, 'initial': initial}
            inputs.append(row); order.append({'type': 'input', 'value': row}); gate(program, 'before', request, mode, 0, 0)
            prior = calls; observed = execute(initial, width, count)
            result = {'request': request, 'priorBefore': prior, 'priorAfter': calls, 'observed': observed}
            results.append(result); order.append({'type': 'result', 'value': result}); gate(program, 'after', request, mode, 1, count)
    final = {'schema': 1, 'programs': 2, 'probes': 4, 'gates': 11, 'calls': calls, 'checks': checks, 'digest': h64(digest)}
    order.append({'type': 'pass', 'value': final})
    return gates, inputs, results, final, order


def native_probe(raw, input_row, program, generation):
    w = bank(raw, 256); mode = input_row['mode']; request = input_row['request']
    need(w[:8] == [0x4d334253, 1, 3, request, mode, 0, 256, 64], 'Complete boundary header')
    need(pair(w, 8) == int(program['a'], 16) and pair(w, 10) == int(generation, 16) > 0 and
         w[12] == int(program['b'], 16) - int(program['a'], 16) and w[13] == program['ownerBytes'], 'Owner/generation')
    need(w[14:22] == [1 if mode == 1 else 3, mode, 0 if mode == 1 else 2, 1, 3, 1, 1, 1], 'Tier/return/debt/one capture')
    need(w[23] == w[22] + 1 and w[25] == w[24] + 1 and w[27] == w[26] + (mode == 2), 'One service/attempt/request')
    need(w[28:32] == [0, 1, 6, 0] and not any(w[224:]), 'Debt/Normal/reserved boundary')
    before, after, service = w[32:96], w[96:160], w[160:224]
    for snapshot in (before, after, service): need(all(snapshot[i] == 0 for i in (35, 60, 61, 62, 63)), 'Snapshot reserved')
    eq(after, service, 'Exact post-service architectural/lazy state')
    initial = input_row['initial']; regs = [int(x, 16) for x in initial['gpr']]
    need([pair(before, i * 2) for i in range(16)] == regs and pair(before, 32) == int(program['a'], 16), 'Initial native GPR/EIP')
    need(before[34] == int(initial['rflags'], 16) and before[44] == 0 and pair(before, 36) == 0x202 and
         pair(before, 40) == int(initial['rflags'], 16) & 0x8d5 and before[45] == 1, 'Initial materialized flags')
    result = input_row['count'] - (mode == 1)
    raw_result = (regs[2 if program['width'] == 32 else 9] - (mode == 1)) & U64
    if mode == 1:
        if program['width'] == 32:
            regs[0] = ((regs[0] & U32) + 53 ^ (regs[3] & U32)) & U32; regs[2] = result
        else: regs[10] = ((regs[10] ^ regs[13]) + 17) & U64; regs[9] = result
    need([pair(after, i * 2) for i in range(16)] == regs and pair(after, 32) == int(program['a' if mode == 1 else 'b'], 16), 'Actual A/B return state')
    flags = 0x202 | (4 if (result & 255).bit_count() % 2 == 0 else 0)
    need(after[34] == flags and after[44] == (18 if program['width'] == 32 else 19) and
         pair(after, 38) == raw_result and pair(after, 40) == (1 if mode == 1 else 0), 'Full-width lazy flags oracle')
    for at in (36, 37, *range(45, 60)): need(after[at] == before[at], 'Control/base/flags preservation')
    return {'request': request, 'mode': mode, 'generation': generation, 'tier': 'compiled-fused',
            'return': 'IDX1-A' if mode == 1 else 'diagnostic-request-B', 'debtPaidOnce': True,
            'postServiceEqualsPostCall': True, 'raw': raw, 'suspensionObserved': False}


class Audit:
    def __init__(self, full):
        self.full, self.inventory, self.deferred, self.stamps, self.external = full, {}, {}, {}, {}
    def read(self, name, wanted=None):
        p = ROOT / name
        need(not Path(name).is_absolute() and '..' not in Path(name).parts and p.resolve() == p and p.is_file(), 'Canonical evidence path')
        if not self.full and p.stat().st_size > 1024 * 1024:
            need(wanted is not None, 'Large unbound metadata must wait for full review')
            self.deferred[name] = wanted
            return None
        if name in self.inventory:
            if wanted: need(all(self.inventory[name][k] == wanted[k] for k in ('sha256', 'bytes') if k in wanted), 'Conflicting identity')
            stat = p.stat(); need(self.stamps[name] == (stat.st_ino, stat.st_size, stat.st_mtime_ns), 'Previously read input changed')
            return p.read_bytes() if p.stat().st_size <= 8 * 1024 * 1024 else None
        before = p.stat(); data = p.read_bytes(); after = p.stat()
        need((before.st_ino, before.st_size, before.st_mtime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns), 'Input changed during read')
        row = {'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
        if wanted: need(all(row[k] == wanted[k] for k in ('sha256', 'bytes') if k in wanted), 'Identity mismatch: ' + name)
        self.inventory[name] = row
        self.stamps[name] = (after.st_ino, after.st_size, after.st_mtime_ns)
        return data
    def load(self, name, wanted=None):
        data = self.read(name, wanted)
        return None if data is None else json.loads(data)
    def ref(self, ref): return self.load(ref['path'], ref)
    def external_file(self, path, expected):
        p = Path(path); need(p.is_absolute() and p.resolve() == p and p.is_file(), 'External executable path')
        before = p.stat(); h = hashlib.sha256()
        with p.open('rb') as f:
            for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
        after = p.stat(); need((before.st_ino, before.st_size, before.st_mtime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns), 'Executable changed')
        row = {'path': path, 'sha256': h.hexdigest(), 'bytes': after.st_size}
        need(all(row[k] == expected[k] for k in ('sha256', 'bytes')), 'External executable identity')
        self.external[path] = row
    def unchanged(self):
        for path, stamp in self.stamps.items():
            p = ROOT / path; stat = p.stat()
            need(p.resolve() == p and stamp == (stat.st_ino, stat.st_size, stat.st_mtime_ns), 'Evidence changed before publication: ' + path)


def replay(audit, mode):
    enabled = mode == 'on'; directory = 'artifacts/m3b-boundary-' + mode + '-01/'
    r = audit.load(directory + 'report.json')
    need(r['schema'] == 1 and r['protocol'] == PROTOCOL and r['status'] == 'passed' and r['enabled'] is enabled and
         r['timingEligible'] is False and r['inputRecheck'] == [], 'Incomplete/wrong report')
    need(len(r['gates']) == len(r['signals']) == 11, 'Exact boundary gate count')
    for name, identity in r['inputs'].items(): audit.read(name, identity)
    for name, identity in r['served'].items(): eq(identity, r['inputs'][name], 'Served identity')
    raw = {}
    for kind, identity in r['artifacts'].items(): raw[kind] = audit.read(directory + identity['path'], identity)
    need(set(raw) == {'serial', 'progress'}, 'Exact raw evidence closure')
    serial = raw['serial'].decode().replace('\r', '')
    need(not re.search(r'MBND_FAIL:|BUN_APP_FAILURE|Kernel panic', serial), 'Guest failure text')
    layout = r['layout']; gates, inputs, results, final, order = reference(layout)
    records = []
    for line in serial.splitlines():
        if line.startswith('MBND_'):
            match = re.fullmatch(r'MBND_(LAYOUT|INPUT|RESULT|GATE|PASS):(.*)', line)
            need(match is not None, 'Unknown serial marker'); records.append({'type': match[1].lower(), 'value': json.loads(match[2])})
    eq(records, [{'type': 'layout', 'value': layout}, *order], 'Independent raw guest oracle')
    eq(r['probeInputs'], inputs, 'Inputs'); eq(r['probeResults'], results, 'Results')
    env = [json.loads(line) for line in raw['progress'].decode().splitlines()]
    need(len(env) == r['artifacts']['progress']['records'] == (82 if enabled else 74), 'Journal row count')
    for i, row in enumerate(env): need(type(row['schema']) is int and row['schema'] == 1 and type(row['record']) is int and row['record'] == i, 'Journal envelope')
    events = [row['observation'] for row in env]; header = events.pop(0)
    need(header['event'] == 'header' and header['schema'] == 1 and header['protocol'] == PROTOCOL and header['enabled'] is enabled, 'Durable header')
    for key in ('inputs', 'fixtureProvenance', 'hostCondition', 'hostBefore', 'chrome', 'timeoutMs'): eq(header[key], r[key], 'Header ' + key)
    eq(header['binding'], r['runtimeProvenance']['binding'], 'Header runtime binding')
    cursor, epoch, last_clock = 0, 0, 0
    previous = None
    def take(kind):
        nonlocal cursor, last_clock
        need(cursor < len(events) and events[cursor]['event'] == kind, 'Journal order: ' + kind)
        row = events[cursor]; cursor += 1
        for key in ('hostMs', 'readHostMs', 'signalHostMs'):
            if key in row: need(type(row[key]) in (int, float) and math.isfinite(row[key]) and row[key] >= 0, 'Clock type')
        clock = row.get('readHostMs', row.get('hostMs'))
        if clock is not None: need(clock >= last_clock, 'Clock reversed'); last_clock = clock
        return row
    def snapshot(row, initial=False):
        nonlocal previous
        paused(row['status'], initial); check_m3a(row['m3a'], initial); eq(row['m3b'], m3b(row['m3b']['raw'], enabled), 'M3b typed/raw')
        need(row['m3a']['watchEpoch'] == row['m3b']['watchEpoch'] == epoch, 'Watch epoch')
        if previous:
            for family in ('m3a', 'm3b'):
                need(all(value >= previous[family][key] for key, value in row[family]['counters'].items()), 'Lifetime counter decrease')
        previous = {family: row[family]['counters'] for family in ('m3a', 'm3b')}
        pool = row['pool']; need(pool['limit'] == 12000 and type(pool['charged']) is int and 0 <= pool['charged'] <= 12000 and
                                 type(pool['linearMemoryBytes']) is int and pool['linearMemoryBytes'] > 0, 'Hard pool bound')
    def ranges(row, program=None, clear=False):
        for slot in range(4):
            address = int(layout['programs'][program]['a' if slot == 0 else 'b'], 16) if program is not None and slot < 2 else 0
            for family in ('m3a', 'm3b'):
                w = row[family]['watches'][slot]
                need(int(w['begin'], 16) == address and int(w['end'], 16) == (address + 1 if address else 0), 'Exact watch PC')
            w, fused = row['m3a']['watches'][slot], row['m3b']['watches'][slot]
            need(w['enabled'] is bool(address), 'M3a watch enable')
            if w['selectedEntries']: need(int(w['lastSelectedPC'], 16) == address, 'M3a selected PC')
            if clear: need(w['selectedEntries'] == 0 and w['lastSelectedPC'] == '0x0' and not any(fused[k] for k in WATCH) and
                           fused['lastSelectedPC'] == fused['lastGeneration'] == '0x0', 'Cleared watch state')
    start = take('startup'); eq(start, r['startup'], 'Startup raw journal'); snapshot(start, True); ranges(start, clear=True); idle(start['boundaryRaw'])
    zero = [0] * 128
    for i, value in {0: 0x4d334231, 1: 1, 2: 63 if enabled else 62, 5: 1, 6: 32, 7: 128, 8: 12, 9: 32, 10: 20, 12: 4}.items(): zero[i] = value
    eq(start['m3b']['raw'], zero, 'Prelaunch zero counters')
    proof = r['runtimeProvenance']
    for key in ('graph', 'objects'):
        eq(start[key]['text'], proof[key]['text'], 'Native pinned text'); eq(start[key]['raw'], list(proof[key]['text'].encode()), 'Native raw text')
    operations = [{'kind': 'qmp-denial', 'command': c, 'arguments': arg} for c, arg in DENIED]
    operations += [{'kind': 'configure-rejection', 'arguments': arg, 'expected': expected} for arg, expected in
                   [([int(enabled), 1], -2), ([1 - int(enabled), 1], -2), ([0, 0], -2), ([2, 1], -1), ([1, 0], -1)]]
    operations += [{'kind': 'prelaunch-boundary-arm-rejection', 'request': 1, 'mode': 1, 'pc': '0x10000', 'expected': -1}]
    control_rows = []
    for i in range(13):
        row = take('profile-control-readback'); paused(row['status'], True)
        need(row['sequence'] == i and row['phase'] == ('initial' if i == 0 else 'after-operation'), 'Control readback sequence')
        eq(row['readback'], {'m3bWords': zero, 'boundaryWords': start['boundaryRaw'], 'graph': proof['graph']['text'], 'objects': proof['objects']['text']}, 'Unchanged control raw banks')
        if i == 12: break
        operation = operations[i]
        eq(take('profile-control-request'), {'event': 'profile-control-request', 'sequence': i, **operation}, 'Exact attempted control')
        row = take('profile-control-result')
        expected = {'event': 'profile-control-result', 'sequence': i, **operation}
        if i < 6: expected.update(returned=False, error=DENIAL)
        else: expected.update(returned=operation['expected'])
        eq(row, expected, 'Exact native denial'); control_rows.append(row)
    controls = take('profile-controls-complete'); need(controls['schema'] == 1 and controls['status'] == 'passed' and controls['enabled'] is enabled and controls['checks'] == 12, 'Control completion')
    eq(controls['rows'], control_rows, 'Control rows'); eq({k: v for k, v in controls.items() if k != 'event'}, r['controls'], 'Reported controls'); eq(r['controlChecks'], r['controls'], 'Control replay copy')
    boundary, program, probes, last_ack, before_counters = start['boundaryRaw'], None, [], 0, None
    for seq, expected in enumerate(gates):
        row = take('gate'); eq(row['gate'], expected, 'Guest gate oracle'); snapshot(row); need(row['signalHostMs'] >= last_ack and row['readHostMs'] >= row['signalHostMs'], 'Gate/ACK chronology')
        report_gate = r['gates'][seq]; eq({k: v for k, v in report_gate.items() if k not in ('ackHostMs', 'contHostMs')}, row, 'Report/durable gate')
        need(row['signalHostMs'] == r['signals'][seq], 'COM1 signal')
        phase = expected['phase']; ranges(row, program, phase in ('layout', 'before'))
        if phase == 'layout': eq(row['layout'], layout, 'Layout gate')
        if phase == 'before': eq(row['input'], inputs[expected['request'] - 1], 'Probe input gate')
        if phase in ('layout', 'before', 'warm'): eq(row['boundaryRaw'], boundary, 'Unarmed boundary mutation')
        if phase in ('warm', 'after'):
            a, b = row['m3b']['watches'][:2]; oa, ob = row['m3a']['watches'][:2]
            need(oa['selectedEntries'] > 0 and not any(b[k] for k in WATCH), 'Ordinary A/fused B exposure')
            if not enabled: need(not any(a[k] for k in WATCH) and ob['selectedEntries'] > 0, 'OFF exposure'); idle(row['boundaryRaw'])
            else:
                need(a['compiledEntries'] > 0 and a['lastSelectedPC'] == layout['programs'][program]['a'], 'Compiled fused A exposure')
                if phase == 'warm': need(a['predecodeAccepted'] > 0 and a['emittedOwners'] > 0 and ob['selectedEntries'] > 0, 'Warm path evidence')
                else:
                    need(a['BAttempts'] == a['servicePaid'] == expected['bodies'] and a['BRequested'] >= (expected['mode'] == 2), 'Whole probe body/service partition')
                    if a['BRequested']: need(ob['selectedEntries'] > 0, 'Requested ordinary B resumption')
                    parsed = native_probe(row['boundaryRaw'], inputs[expected['request'] - 1], layout['programs'][program], a['lastGeneration'])
                    for at, key in ((22, 'servicePaid'), (24, 'BAttempts'), (26, 'BRequested')):
                        need(row['boundaryRaw'][at] >= before_counters[key] and row['boundaryRaw'][at + 1] <= row['m3b']['counters'][key], 'Snapshot/global counter interval')
                    parsed['bodyPartition'] = {'attempts': a['BAttempts'], 'completedFused': a['BAttempts'] - a['BRequested'],
                                               'resumedOrdinary': a['BRequested'], 'allBodies': expected['bodies'], 'service': a['servicePaid']}
                    probes.append(parsed)
            if phase == 'after': eq(row['result'], results[expected['request'] - 1], 'Probe final result'); boundary = row['boundaryRaw']
        configured = take('configured'); need(configured['seq'] == seq, 'Configured sequence')
        next_program = 0 if phase == 'layout' else expected['program'] + 1 if phase == 'after' and expected['mode'] == 2 else expected['program']
        program = next_program if next_program < 2 else None
        eq(configured['program'], program, 'Next watch program'); epoch += 4; snapshot(configured); ranges(configured, program, True)
        eq(configured['boundaryRaw'], boundary, 'Configuration changed boundary'); before_counters = configured['m3b']['counters']
        if enabled and phase == 'before':
            input_row = inputs[expected['request'] - 1]; pc = layout['programs'][program]['a']
            arm = take('arm-request'); eq({k: v for k, v in arm.items() if k != 'hostMs'}, {'event': 'arm-request', 'seq': seq, 'request': input_row['request'], 'mode': input_row['mode'], 'pc': pc}, 'Exact arm request')
            arm = take('arm-result'); paused(arm['status']); need(arm['seq'] == seq and arm['request'] == input_row['request'] and arm['mode'] == input_row['mode'] and arm['pc'] == pc and type(arm['returnCode']) is int and arm['returnCode'] == 0, 'Arm native result')
            armed = list(start['boundaryRaw']); armed[2:5] = [1, input_row['request'], input_row['mode']]; address = int(pc, 16); armed[8:10] = [address & U32, address >> 32]
            eq(arm['boundaryRaw'], armed, 'Exact armed raw bank'); boundary = armed
        ack = take('ack'); need(ack['seq'] == seq and ack['hostMs'] >= row['readHostMs'], 'ACK ordering'); eq(ack['watchEpoch'], {'m3a': epoch, 'm3b': epoch}, 'ACK epochs')
        need(report_gate['ackHostMs'] == ack['hostMs'] and report_gate['contHostMs'] >= ack['hostMs'], 'Report ACK/cont')
        last_ack = ack['hostMs']
    end = take('complete'); snapshot(end); ranges(end, clear=True); eq(end['boundaryRaw'], boundary, 'Final boundary mutation'); eq(end['validation'], final, 'Final guest oracle'); eq(end, r['final'], 'Final journal/report')
    need(cursor == len(events) and len(probes) == (4 if enabled else 0), 'Extra/incomplete journal')
    for actual, parsed in zip(r['boundaryObservations'], probes):
        need(actual['request'] == parsed['request'] and actual['mode'] == parsed['mode'], 'Reported probe identity')
        eq(actual['bank']['raw'], parsed['raw'], 'Reported native probe raw'); eq(actual['bodyPartition'], parsed['bodyPartition'], 'Reported body partition')
    need(len(r['boundaryObservations']) == len(probes), 'Probe count')
    return r, {'mode': mode, 'gates': 11, 'profileControls': 12, 'nativeProbes': probes, 'guestOracle': final,
               'prelaunchGraphEligible': True, 'finalWatchEpoch': epoch,
               'bootFlushes': r['gates'][0]['m3a']['counters']['flushes'],
               'finalFlushes': end['m3a']['counters']['flushes']}


SDK = 'registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812'
FINGERPRINT = 'b458c012278728289c39b971bb0a7d01fc2a15411eebb4124399d3d72d2551b1'
SOURCE_SHA = 'c68689c58c732fd99a858b4e515c3b57934a76c933ca3375600e939fa4e6c1bc'
BROWSER_SOURCES = ['tests/m3b-boundary/guest.mjs', 'tests/m3b-boundary/reader.mjs', 'tests/m3b-fallthrough/reader.mjs',
                   'tests/m3b-profile/controls.mjs', 'experiments/m3a-region/reader.mjs', 'host/browser/qmp.mjs',
                   'host/browser/machine.mjs', 'packaging/bun-app/serial.mjs']
ARGV = ['-nodefaults', '-machine', 'pc,acpi=off,hpet=off,usb=off', '-cpu', 'max', '-global', 'apic.vapic=off',
        '-accel', 'tcg,tb-size=128', '-smp', 'cpus=1,maxcpus=1', '-m', '512', '-S', '-display', 'none',
        '-monitor', 'none', '-qmp', 'stdio', '-chardev', 'file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1',
        '-serial', 'chardev:fixture-com1', '-serial', 'file:/guest/console.log', '-parallel', 'none', '-no-reboot',
        '-no-shutdown', '-L', '/rom', '-kernel', '/guest/kernel', '-initrd', '/guest/initramfs', '-append',
        'console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on']


def normalized(path):
    for prefix in ('/project/', str(ROOT) + '/'):
        if path.startswith(prefix): path = path[len(prefix):]; break
    need(path.startswith('artifacts/') and '..' not in Path(path).parts and not Path(path).is_absolute(), 'Isolated source root')
    return path


def freeze(audit, doc):
    need(doc['schema'] == 1 and doc['status'] == 'frozen' and doc['timingEligible'] is False, 'Source freeze state')
    need(len({r['path'] for r in doc['files']}) == len(doc['files']), 'Unique frozen files')
    for row in doc['files']:
        audit.read(row['path'], row); audit.read(row['archive'], row)
    for path, row in doc['dependencies'].items(): audit.read(path, {'sha256': row} if type(row) is str else row)


def sdk_complete(doc, source_path, entry, args):
    need(doc['schema'] == 1 and doc['status'] == 'passed' and type(doc['returncode']) is int and doc['returncode'] == 0 and doc['sdk'] == SDK, 'Actual SDK completion')
    need(re.fullmatch(r'tmp/sdk-[A-Za-z0-9_-]+/invocation.json', source_path), 'SDK invocation path')
    scratch = source_path.rsplit('/', 1)[0]; container = '/project/' + scratch
    need(doc['scratch'] == str(ROOT / scratch) and doc['containerScratch'] == container, 'Project-local SDK scratch')
    tail = ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none', '-e', 'TMPDIR=' + container,
            '-e', 'TMP=' + container, '-e', 'TEMP=' + container, '-v', str(ROOT) + ':/project', '-v',
            'qemu-wasm-arm64-sdk-cache:/emsdk/upstream/emscripten/cache', '-w', '/project', SDK, 'python3', entry, *args]
    need(len(doc['command']) > len(tail), 'SDK launcher prefix'); eq(doc['command'][-len(tail):], tail, 'Exact offline SDK command')
    need(datetime.fromisoformat(doc['finishedUtc'].replace('Z', '+00:00')) >= datetime.fromisoformat(doc['startedUtc'].replace('Z', '+00:00')), 'SDK chronology')


def runtime_proof(audit, r):
    b = audit.load('artifacts/m3b-diagnostic-binding-01/binding.json')
    eq(b, r['runtimeProvenance']['binding'], 'Actual binding bytes/report')
    need(b['schema'] == 1 and b['kind'] == 'm3b-differential-runtime-binding-v1' and b['status'] == 'passed' and b['timingEligible'] is False and type(b['profile']) is int and b['profile'] == 1, 'Diagnostic binding state')
    need(b['sourceFingerprint'] == FINGERPRINT == r['runtimeProvenance']['sourceFingerprint'] and b['sourceManifest']['sha256'] == SOURCE_SHA, 'Pinned actual reviewed build')
    build, overlay, recheck, source, review = [audit.ref(b[k]) for k in ('buildReport', 'overlayManifest', 'sourceRecheck', 'sourceManifest', 'sourceReview')]
    need(build['status'] == 'passed' and build['sdk'] == SDK and build['sourceFingerprint'] == FINGERPRINT and build['targets'] == ['x86_64-softmmu'], 'Actual x86 SDK build')
    need(all(type(run['returncode']) is int and run['returncode'] == 0 for run in build['runs']) and [x['step'] for x in build['runs']] == ['configure', 'compile'], 'Actual build steps')
    need(overlay['kind'] == 'm3b-budget1-diagnostic-overlay' and overlay['graphPinned'] is True and overlay['defaultEnabled'] is False and overlay['productionEligible'] is False and overlay['timingEligible'] is False and
         (overlay['budget'], overlay['maximumInstructions'], overlay['maximumBytes']) == (1, 32, 128) and overlay['baseFingerprint'] == 'b517b8d6c23d67db7e74fe4d2d5c4ff421693cb01b86c8666ffba006ca772d49', 'Overlay guard contract')
    source_root = normalized(overlay['source']); need(normalized(build['source']) == source_root == normalized(recheck['source']['path']), 'Prepared source linkage')
    need(recheck['status'] == 'passed' and recheck['kind'] == 'm3b-postbuild-source-recheck' and recheck['timingEligible'] is False and recheck['source']['matches'] is True and
         recheck['source']['fingerprintBeforeBuild'] == recheck['source']['fingerprintAfterBuild'] == FINGERPRINT, 'Actual post-build source proof')
    for key in ('buildReport', 'overlayManifest', 'sourceManifest', 'sourceReview'): eq(recheck[key], b[key], 'Post-build reference ' + key)
    need(review['status'] == 'passed' and review['sourceBlockers'] == [], 'Independent implementation review')
    for key in ('path', 'sha256'): need(review['sourceManifest'][key] == b['sourceManifest'][key], 'Reviewed source identity')
    freeze(audit, source); need(len(source['files']) == 57 and len(source['dependencies']) == 315, 'Original freeze closure')
    for change in overlay['changes']:
        checks = [x for x in recheck['overlayChecks'] if x['path'] == change['path']]
        need(len(checks) == 1 and checks[0]['passed'] is True and checks[0]['after'] == checks[0]['observedAfter'] == change['after'], 'Patched source recheck')
        audit.read(source_root + '/' + change['path'], {'sha256': change['after']})
    eq(recheck['toolProof'], b['toolProof'], 'Actual corrected tool provenance'); eq(recheck['tool'], b['tool'], 'Actual corrected tool identity')
    need(type(recheck['proofVersion']) is int and recheck['proofVersion'] == b['proofVersion'] == 2, 'Corrected proof version')
    for key in ('originalFrozenTool', 'engineTreeReader'): audit.read(b['toolProof'][key]['path'], b['toolProof'][key])
    audit.read(b['tool']['path'], b['tool']); tf = audit.ref(b['toolProof']['sourceManifest']); tr = audit.ref(b['toolProof']['sourceReview']); freeze(audit, tf)
    need(tr['status'] == 'passed' and tr['sourceBlockers'] == [], 'Independent proof-v2 review')
    eq(tr['sourceManifest'], b['toolProof']['sourceManifest'], 'Reviewed proof-v2 freeze')
    inventory = audit.ref(recheck['inventory'])
    need(inventory['schema'] == 1 and len(inventory['sourceFiles']) == recheck['source']['files'] == 10111 and len(inventory['baseFiles']) == overlay['baseFiles'] == 10102, 'Full retained engine inventory counts')
    need(recheck['engineLinks']['baselineCount'] == recheck['engineLinks']['preparedCount'] == 14, 'Explicit internal link contract')
    actual_sdk = audit.ref(recheck['sdkInvocation']); eq(audit.ref(recheck['sdkOriginal']), actual_sdk, 'Original/retained SDK completion')
    sdk_complete(actual_sdk, recheck['sdkOriginal']['path'], 'scripts/build.py', ['--source', source_root, '--output', 'artifacts/m3b-build-01', '--targets', 'x86_64-softmmu', '--jobs', '4'])
    runtime_names = ['runtime/audio/backend.mjs', 'runtime/audio/pcm.mjs', 'runtime/audio/ringbuf.mjs', 'runtime/graphics.mjs', 'runtime/native-counters.mjs', 'runtime/x86_64/qemu-system-x86_64.js', 'runtime/x86_64/qemu-system-x86_64.wasm']
    need(set(build['artifacts']) == set(recheck['runtimeArtifacts']) == set(runtime_names), 'Exactly seven runtime files')
    build_dir = str(Path(b['buildReport']['path']).parent); need(b['runtime'] == build_dir + '/runtime/x86_64', 'Runtime path')
    for name in runtime_names:
        identity = build['artifacts'][name]; checked = recheck['runtimeArtifacts'][name]
        need(checked['matchesBuildReport'] is True, 'Runtime build match'); eq({k: checked[k] for k in ('sha256', 'bytes')}, identity, 'Runtime proof identity')
        path = build_dir + '/' + name; audit.read(path, identity); eq(r['inputs'][path], identity, 'Served runtime input identity')
    header = audit.read(b['graphContract']['path'], b['graphContract']).decode(); need('#define M3B_GRAPH_PINNED 1\n' in header, 'Graph pin active')
    graph_review = audit.ref(b['graphReview']); need(graph_review['status'] == 'passed' and graph_review['sourceBlockers'] == [], 'Actual graph review')
    for identity in graph_review['inventory']: audit.read(identity['path'], identity)
    eq(graph_review['graphContract'], b['graphContract'], 'Graph literal review')
    for key, limit in [('graph', 131072), ('objects', 16384)]:
        found = re.search(r'static const char m3b_expected_' + key + r'\[\]\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*)+);', header)
        need(found is not None, 'C graph/object literal'); text = ''.join(json.loads(x) for x in re.findall(r'"(?:[^"\\]|\\.)*"', found[1])); data = text.encode()
        need(text.endswith('\n') and len(data) <= limit, 'Bounded graph text')
        eq(r['runtimeProvenance'][key], {'text': text, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}, 'Literal/actual native graph identity')
        need(graph_review[key + 'Sha256'] == hashlib.sha256(data).hexdigest(), 'Graph observation hash')
    need(next(x for x in overlay['changes'] if x['path'] == 'system/m3b-graph-contract.h')['after'] == b['graphContract']['sha256'], 'Compiled graph contract identity')
    for path, identity in b['assets'].items(): audit.read(path, identity); eq(r['inputs'][path], identity, 'Kernel/ROM input identity')
    return b


def fixture_proof(audit, r, directory):
    f = r['fixtureProvenance']; path = f['buildReport']; fixture = str(Path(path).parent); b = audit.load(path)
    need(b['schema'] == 1 and b['kind'] == 'm3b-boundary-fixture-image' and b['status'] == 'passed' and b['guestExecuted'] is False and b['timingEligible'] is False and b['hostShapeValidated'] is True and b['sdk'] == SDK, 'Actual ELF/image build')
    keys = ['tests/m3b-boundary/' + n for n in ('build.py', 'fixture.c', 'fixture.S', 'contract.mjs')] + ['experiments/m3b-fallthrough/predecode.h', 'packaging/bun_app_package.py'] + ['scripts/' + n for n in ('sdk.py', 'build.py', 'container_engine.py', 'runtime_dependencies.py')]
    need(set(keys) == set(b['sources']) and b['baseInitramfsSha256'] == '6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9', 'Exact fixture sources/base rootfs')
    for path, digest in b['sources'].items(): audit.read(path, {'sha256': digest}); need(r['inputs'][path]['sha256'] == digest, 'Fixture source runtime binding')
    for name, identity in b['artifacts'].items():
        audit.read(fixture + '/' + name, identity); eq(r['inputs'][fixture + '/' + name], identity, 'Fixture artifact runtime binding')
    eq(f['copiedSources'], b['copiedSources'], 'Copied guest source provenance'); eq(f['tools'], b['tools'], 'Compiler provenance')
    need(set(b['copiedSources']) == {'tests/m3b-boundary/fixture.c', 'tests/m3b-boundary/fixture.S', 'experiments/m3b-fallthrough/predecode.h'}, 'Copied source closure')
    for path, copy in b['copiedSources'].items():
        need(copy['sha256'] == b['sources'][path], 'Copied source hash'); eq(b['artifacts'][copy['artifact']], {k: copy[k] for k in ('sha256', 'bytes')}, 'Copied source bytes')
    need(set(b['tools']) == {'gcc', 'nm', 'objdump'} and re.fullmatch('x86_64.*linux.*', b['compilerTarget']) is not None, 'Compiler target')
    need(re.fullmatch(r'tmp/m3b-boundary-image-[A-Za-z0-9_-]+', b['scratch']), 'Image scratch')
    out, scratch = '/project/' + fixture, '/project/' + b['scratch']; tools = b['tools']
    cmds = [[tools[n]['path'], '--version'] for n in ('gcc', 'nm', 'objdump')]
    cmds += [[tools['gcc']['path'], '-dumpmachine'], [tools['gcc']['path'], '-O2', '-static', '-fno-pie', '-no-pie', '-mno-red-zone', '-fno-tree-vectorize', '-fno-tree-slp-vectorize', out + '/fixture.c', out + '/fixture.S', '-o', out + '/fixture'],
             [tools['nm']['path'], '-n', '--defined-only', out + '/fixture'], [tools['objdump']['path'], '-d', '-w', '--no-show-raw-insn', out + '/fixture'],
             [tools['gcc']['path'], '-std=c11', '-O2', '-I' + out, out + '/shape-probe.c', '-o', scratch + '/shape-probe'], [scratch + '/shape-probe']]
    eq([c['argv'] for c in b['commands']], cmds, 'Exact compiler/probe commands')
    for i, command in enumerate(b['commands']):
        need(type(command['exitCode']) is int and command['exitCode'] == 0 and type(command['stdout']) is str and type(command['stderr']) is str, 'Actual compiler success')
        if i < 3:
            tool = tools[('gcc', 'nm', 'objdump')[i]]
            need(command['stdout'] == tool['version'] and Path(tool['path']).is_absolute() and re.fullmatch('[a-f0-9]{64}', tool['sha256']) and type(tool['bytes']) is int and tool['bytes'] > 0, 'Retained SDK compiler identity')
    need(b['commands'][3]['stdout'].strip() == b['compilerTarget'], 'Actual compiler target output')
    need(b['binarySha256'] == b['artifacts']['fixture']['sha256'] and b['initramfsSha256'] == b['artifacts']['initramfs.cpio.gz']['sha256'], 'ELF/rootfs identity')
    layout = audit.load(fixture + '/layout.json'); need(layout['programs'] == b['layout'] and layout['stackPointer'] == b['stackPointer'] == r['layout']['stackPointer'], 'ELF layout binding')
    eq([{k: p[k] for k in r['layout']['programs'][0]} for p in layout['programs']], r['layout']['programs'], 'ELF/guest layout')
    need(b['sdkInvocation']['startArtifact'] == 'sdk-invocation-start.json' and b['sdkInvocation']['completionRequired'] is True and f['sdkInvocation'] == b['sdkInvocation']['path'], 'Required actual SDK completion')
    start = audit.load(fixture + '/sdk-invocation-start.json'); complete = audit.load(directory + f['sdkCompletion']['path'], f['sdkCompletion'])
    eq(audit.load(f['sdkInvocation']), complete, 'Retained/original fixture SDK completion')
    sdk_complete(complete, f['sdkInvocation'], 'tests/m3b-boundary/build.py', ['--output', fixture])
    need(start['status'] == 'running', 'SDK start recorded while running'); eq({k: v for k, v in complete.items() if k not in ('status', 'returncode', 'finishedUtc')}, {k: v for k, v in start.items() if k != 'status'}, 'SDK start/completion continuity')
    return fixture


def provenance(audit, r, mode):
    directory = 'artifacts/m3b-boundary-' + mode + '-01/'
    eq(r['arguments'], ARGV, 'Exact diagnostic argv')
    eq(r['configuration'], {'enabled': mode == 'on', 'profile': 1, 'phase': 'preRun-before-vCPU', 'returnCode': 0,
                           'status': 11 if mode == 'on' else 10, 'm3aEnabled': True, 'hotLimit': 1500, 'flags': 2,
                           'instanceLimit': 12000, 'global': 'apic.vapic=off'}, 'Exact pre-vCPU configuration')
    need(len(r['startupCpus']) == 1 and r['startupCpus'][0]['cpu-index'] == 0 and r['startupCpus'][0]['target'] == 'x86_64' and r['startupCpus'][0]['qom-type'] == 'max-x86_64-cpu' and r['startupCpus'][0]['qom-path'] == '/machine/unattached/device[0]', 'Actual single CPU startup fence')
    need(type(r['timeoutMs']) is int and r['timeoutMs'] == 1800000, 'Declared diagnostic deadline')
    b = runtime_proof(audit, r); fixture = fixture_proof(audit, r, directory)
    for path in [*BROWSER_SOURCES, *b['assets'], fixture + '/initramfs.cpio.gz', b['runtime'] + '/qemu-system-x86_64.js', b['runtime'] + '/qemu-system-x86_64.wasm']:
        eq(r['served'][path], r['inputs'][path], 'Mandatory served identity')
    hc = r['hostCondition']; need(hc['schema'] == 1 and hc['arguments'] == ['list', 'builder', '--json'] and hc['expected'] == {'name': 'builder', 'status': 'Stopped', 'memory': 12884901888} and hc['environment'] == {'LIMA_HOME': '/Users/admin/.defuss-vm-lima'}, 'Stopped-builder observation contract')
    need(hc['executable'] == str(ROOT.parent / 'native-build/lima/bin/limactl'), 'Actual local builder observer')
    audit.external_file(hc['executable'], hc)
    for key in ('hostBefore', 'hostAfter'):
        h = r[key]; eq(json.loads(h['stdout']), h['status'], 'Retained host raw/typed equality'); need(h['stderr'] == '' and all(h['status'][k] == v for k, v in hc['expected'].items()), 'Builder stopped around guest')
    chrome = r['chrome']; need(chrome['executable'] == chrome['binaryPath'] == '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Explicit actual Chrome'); audit.external_file(chrome['binaryPath'], chrome)
    request = audit.load(directory + 'request.json'); need(request['schema'] == 1 and request['protocol'] == PROTOCOL and request['enabled'] is (mode == 'on') and request['timeoutMs'] == 1800000 and request['binding'] == 'artifacts/m3b-diagnostic-binding-01/binding.json' and request['fixture'] == fixture, 'Durable invocation request')
    return {'runtimeFingerprint': FINGERPRINT, 'runtimeArtifacts': 7, 'sourceFiles': 57, 'sourceDependencies': 315,
            'proofVersion': 2, 'actualImageSdk': r['fixtureProvenance']['sdkInvocation'], 'mandatoryServedInputs': 15,
            'builderStoppedBeforeAfter': True, 'sourceProofScope': 'All authored freeze files/dependencies and changed prepared source files rehashed. Complete 10111-file prepared tree is bound through the independently reviewed proof-v2 full post-build inventory; that tree fingerprint is not recomputed by this replay.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True); mode.add_argument('--inspect', action='store_true'); mode.add_argument('--full', action='store_true')
    parser.add_argument('--output', required=True); args = parser.parse_args()
    need(re.fullmatch(r'artifacts/[A-Za-z0-9_-]+', args.output), 'Fresh artifact output')
    out = ROOT / args.output; out.mkdir()
    audit = Audit(args.full)
    audit.read(str(Path(__file__).relative_to(ROOT)))
    try:
        reports, rows = [], []
        for name in ('off', 'on'):
            report, row = replay(audit, name); reports.append(report); rows.append(row)
        eq(reports[0]['layout'], reports[1]['layout'], 'Pair layout')
        eq(reports[0]['arguments'], reports[1]['arguments'], 'Pair argv')
        eq(reports[0]['runtimeProvenance'], reports[1]['runtimeProvenance'], 'Pair runtime/source/graph')
        provenance_rows = [provenance(audit, r, name) for r, name in zip(reports, ('off', 'on'))] if args.full else []
        broader = audit.load('artifacts/m3b-fallthrough-on-01/report.json')
        need(broader['status'] == 'failed', 'Retain separate broader failed capture')
        audit.unchanged()
        result = {'schema': 1, 'kind': 'm3b-boundary-independent-replay', 'status': 'passed' if args.full else 'raw-replayed-provenance-pending',
                  'createdUtc': datetime.now(timezone.utc).isoformat(), 'rows': rows,
                  'provenance': provenance_rows, 'deferredLargeInputs': audit.deferred, 'inventory': list(audit.inventory.values()),
                  'externalExecutableIdentities': list(audit.external.values()), 'timingEligible': False, 'candidateAccepted': False,
                  'broaderFailedEvidence': {'path': 'artifacts/m3b-fallthrough-on-01/report.json', 'status': broader['status'],
                                            'failure': broader.get('failure'), 'scope': 'Separate 45-gate ON capture remains failed; the boundary-pair pass does not override it or establish general M3b acceptance.'},
                  'supersededDraftStatus': {'reportBytesUnchanged': True, 'text': reports[0]['openGates'][-1],
                                           'currentEvidence': 'Actual graph, reviewed build/image identities and these two boundary captures are complete. The old static unexecuted string is superseded only for those observed cases.'},
                  'scope': ('Independent raw guest/oracle/control/bank replay and bound runtime/image/SDK/source provenance.' if args.full else 'Raw replay only; full provenance remains pending.') +
                           ' Observed Asyncify Normal is not observed suspension. Private forced B-request is not a natural interrupt. Final legacy FP/SSE checks do not cover full XSAVE/YMM state. No pressure/SMC/signal or performance acceptance. The broader 45-gate failure remains open.'}
    except BaseException as error:
        result = {'schema': 1, 'status': 'failed', 'error': repr(error), 'inventory': list(audit.inventory.values())}
        data = (json.dumps(result, indent=2) + '\n').encode()
        with (out / 'failure.json').open('xb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        for path in (out, out.parent):
            fd = os.open(path, os.O_RDONLY); os.fsync(fd); os.close(fd)
        raise
    data = (json.dumps(result, indent=2) + '\n').encode()
    with (out / 'review.json').open('xb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
    for path in (out, out.parent):
        fd = os.open(path, os.O_RDONLY); os.fsync(fd); os.close(fd)
    print(json.dumps({'status': result['status'], 'output': args.output, 'sha256': hashlib.sha256(data).hexdigest()}))


if __name__ == '__main__':
    main()
