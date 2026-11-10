"""Bind raw profiles to the original linker map; preserve unresolved frames."""
import collections
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import urlparse

root = Path.cwd()
capture, symbol_dir, output = [(root / value).resolve() for value in sys.argv[1:]]
assert all(path.parent == root / 'artifacts' for path in [capture, symbol_dir, output])
assert not output.exists()
inputs = {}


def read(path):
    data = path.read_bytes()
    inputs[str(path.relative_to(root))] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    return data


report = json.loads(read(capture / 'report.json'))
assert report['status'] == 'passed' and report['timingEligible'] is False
symbol_report = json.loads(read(symbol_dir / 'report.json'))
assert symbol_report['status'] == 'passed'
for name, identity in symbol_report['inputs'].items():
    read(symbol_dir / name)
    assert inputs[str((symbol_dir / name).relative_to(root))] == identity
runtime_path = 'runtime/x86_64/qemu-system-x86_64.wasm'
assert report['inputs'][runtime_path] == symbol_report['runtimeIdentities'][str(root / runtime_path)]
symbols = dict(line.split(':', 1) for line in read(symbol_dir / 'qemu-system-x86_64.js.symbols').decode().splitlines())
for index, entry in symbol_report['exportAliasesOrMissing'].items():
    if index not in symbols and len(entry['exports']) == 1:
        symbols[index] = 'export:' + entry['exports'][0]


def label(frame):
    match = re.fullmatch(r'wasm-function\[(\d+)\]', frame['functionName'])
    if match and urlparse(frame['url']).path == '/' + runtime_path:
        return symbols.get(match[1], frame['functionName'])
    return frame['functionName'] + (' @ ' + frame['url'] if frame['url'].startswith('wasm:') else '')


profiles, cpu_targets = [], set()
for segment in report['cpuProfiles']['segments']:
    for target in segment['targets']:
        profile = json.loads(read(capture / target['file']))
        nodes = {node['id']: node for node in profile['nodes']}
        parents = {child: node['id'] for node in nodes.values() for child in node.get('children', [])}
        names = {index: label(node['callFrame']) for index, node in nodes.items()}
        if 'cpu_tb_exec' in names.values():
            cpu_targets.add(target['targetId'])
        leaf, load_stacks = collections.Counter(), collections.Counter()
        for index in profile.get('samples', []):
            name = names[index]
            leaf[name] += 1
            if name in ['mmu_lookup', 'mmu_lookup1']:
                current, stack = index, []
                while current is not None:
                    stack.append(names[current])
                    current = parents.get(current)
                load_stacks[tuple(stack)] += 1
        profiles.append({'segment': segment['label'], 'target': target,
                         'samples': sum(leaf.values()), 'leafCounts': dict(leaf.most_common()),
                         'mmuLeafStacks': [{'samples': count, 'leafToRoot': list(stack)}
                                           for stack, count in load_stacks.most_common(12)]})

workloads = {}
for name in ['integer', 'json', 'sha256', 'http']:
    selected = [row for row in profiles if row['segment'].startswith(name + '-') and row['target']['targetId'] in cpu_targets]
    combined = collections.Counter()
    for row in selected:
        combined.update(row['leafCounts'])
    workloads[name] = {'profiles': len(selected), 'samples': sum(combined.values()),
                       'leafCounts': dict(combined.most_common()),
                       'batchRows': [{'segment': row['segment'], 'samples': row['samples'],
                                      'leafCounts': row['leafCounts']} for row in selected]}
output.mkdir()
shutil.copyfile(symbol_dir / 'qemu-system-x86_64.js.symbols', output / 'linker-map.txt')
shutil.copyfile(__file__, output / 'symbolize.py')
result = {'schema': 1, 'status': 'passed', 'timingEligible': False, 'inputs': inputs,
          'analysisScript': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'scope': 'Leaf samples in observed isolates, including waiting frames. Not elapsed-time fractions or exclusive CPU utilization. Dynamic module hashes remain unresolved; main-runtime names use the originating linker map.',
          'cpuTargetEvidence': {'criterion': 'profile contains exact-mapped cpu_tb_exec', 'targets': sorted(cpu_targets)},
          'workloads': workloads, 'profiles': profiles}
(output / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'cpuTargets': sorted(cpu_targets),
                  'workloadSamples': {name: value['samples'] for name, value in workloads.items()}}))
