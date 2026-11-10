"""Validate raw pressure banks and report named-phase deltas, not speedups."""
import hashlib
import json
from pathlib import Path
import sys

root = Path.cwd()
capture = (root / sys.argv[1]).resolve()
assert capture.parent == root / 'artifacts'
report = json.loads((capture / 'report.json').read_text())
assert report['status'] == 'passed' and report['timingEligible'] is False
assert report['browserResult']['configuration'] == {
    'arm': 'original', 'm3aEnabled': False, 'hotLimit': 1500,
    'runtimeFlags': 7, 'instanceLimit': 12000}
inputs = {}
for path in [capture / 'report.json', capture / 'progress.jsonl', Path(__file__)]:
    data = path.read_bytes()
    inputs[str(path.relative_to(root))] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
for name, expected in report['inputs'].items():
    path = root / name
    with path.open('rb') as stream:
        actual = {'sha256': hashlib.file_digest(stream, 'sha256').hexdigest(), 'bytes': path.stat().st_size}
    assert actual == expected, name
rows = [json.loads(line) for line in (capture / 'progress.jsonl').read_text().splitlines()]
assert len(rows) == 72 and [row['sequence'] for row in rows] == list(range(72))
names = ['instanceAdditions', 'admissionHeldIntervals', 'admissionHeldElapsedUs',
         'capFallbackIntervals', 'capFallbackElapsedUs', 'repBatches', 'repElements']
previous = [0] * 7
phases, started = [], None
for row in rows:
    assert row['status']['running'] is False
    bank = row['pressureCounts']
    assert len(bank) == 7 and all(type(value) is int and 0 <= value <= 0xffffffff for value in bank)
    assert all(value >= old for value, old in zip(bank, previous)), 'Wrapped counter: cannot infer delta'
    previous = bank
    event = row.get('gate', {})
    if event.get('event') in ['warmup-start', 'start']:
        assert started is None
        started = row
    elif event.get('event') in ['warmup-complete', 'result']:
        assert started is not None
        before = started['gate']
        assert before.get('name') == event.get('name') and before.get('sample') == event.get('sample')
        delta = [value - old for value, old in zip(bank, started['pressureCounts'])]
        phases.append({'name': event.get('name', 'warmup'), 'sample': event.get('sample'),
                       'startSequence': started['sequence'], 'endSequence': row['sequence'],
                       'chargedBefore': started['pool']['charged'], 'chargedAfter': row['pool']['charged'],
                       'counters': dict(zip(names, delta))})
        started = None
assert started is None and len(phases) == 13
totals = {name: {key: sum(phase['counters'][key] for phase in phases if phase['name'] == name)
                 for key in names} for name in ['integer', 'json', 'sha256', 'http']}
result = {'schema': 1, 'status': 'passed', 'timingEligible': False, 'inputs': inputs,
          'scope': 'Existing pressure meter only, separate from CPU sampling and timing. Counts prove policy exposure. Instrumented interval clocks include waiting and observer overhead and are not an exclusive cost or speedup estimate.',
          'totalBank': dict(zip(names, rows[-1]['pressureCounts'])),
          'maxCharged': max(row['pool']['charged'] for row in rows),
          'workloads': totals, 'phases': phases}
with (capture / 'analysis.json').open('x') as stream:
    json.dump(result, stream, indent=2)
    stream.write('\n')
print(json.dumps({'status': 'passed', 'totalBank': result['totalBank'], 'workloads': totals}, indent=2))
