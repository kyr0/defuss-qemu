"""Summarize observed leaf samples per isolate, without elapsed-cost claims."""
import collections
import hashlib
import json
from pathlib import Path
import sys

root = Path.cwd()
capture = (root / sys.argv[1]).resolve()
assert capture.parent == root / 'artifacts'
report = json.loads((capture / 'report.json').read_text())
assert report['status'] == 'passed' and report['timingEligible'] is False
profiles = report.get('cpuProfiles', report.get('profiles'))
assert not profiles['errors']
inputs = {}


def read(name):
    path = capture / name
    data = path.read_bytes()
    inputs[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    return json.loads(data)


def category(frame):
    name, url = frame['functionName'], frame['url']
    if name in ['(idle)', '(garbage collector)', '(program)', '(root)']:
        return name
    if url.startswith('wasm:') or '.wasm' in url:
        return 'wasm'
    if url:
        return 'javascript'
    return 'unmapped'


read('report.json')
summaries = []
for segment in profiles['segments']:
    for target in segment['targets']:
        assert 'error' not in target and target.get('file')
        profile = read(target['file'])
        nodes = {node['id']: node for node in profile['nodes']}
        samples = profile.get('samples', [])
        deltas = profile.get('timeDeltas', [])
        assert len(samples) == len(deltas)
        assert all(sample in nodes for sample in samples)
        counts = collections.Counter(samples)
        categories = collections.Counter()
        frames = collections.Counter()
        parents = {}
        for node in nodes.values():
            for child in node.get('children', []):
                assert child not in parents
                parents[child] = node['id']
        for node_id, count in counts.items():
            frame = nodes[node_id]['callFrame']
            categories[category(frame)] += count
            key = (frame['functionName'], frame['url'], frame['lineNumber'], frame['columnNumber'])
            frames[key] += count
        top = []
        for key, count in frames.most_common(40):
            top.append({'functionName': key[0], 'url': key[1], 'lineNumber': key[2],
                        'columnNumber': key[3], 'leafSamples': count})
        stacks = []
        for node_id, count in counts.most_common(12):
            stack, current, seen = [], node_id, set()
            while current is not None:
                assert current not in seen
                seen.add(current)
                stack.append(nodes[current]['callFrame'])
                current = parents.get(current)
            stacks.append({'leafSamples': count, 'leafToRoot': stack})
        summaries.append({'segment': segment['label'], 'segmentId': segment['id'],
                          'target': target, 'sampleCount': len(samples),
                          'profileSpanMicroseconds': profile['endTime'] - profile['startTime'],
                          'sumSampleDeltasMicroseconds': sum(deltas),
                          'categories': dict(categories), 'topLeafFrames': top,
                          'topStacks': stacks})

result = {'schema': 1, 'status': 'passed', 'timingEligible': False,
          'scope': 'Raw leaf-sample counts per observed isolate and phase. Sampling perturbs execution; gaps, idle samples and background threads prevent exclusive whole-process or guest elapsed-cost attribution. No measured tier claim.',
          'capture': str(capture.relative_to(root)), 'inputs': inputs,
          'analysisScript': {'path': str(Path(__file__).relative_to(root)),
                             'sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
          'samplingIntervalMicroseconds': profiles['samplingIntervalMicroseconds'],
          'profiles': summaries}
with (capture / 'sample-analysis.json').open('x') as stream:
    json.dump(result, stream, indent=2)
    stream.write('\n')
print(json.dumps({'status': 'passed', 'capture': result['capture'], 'profiles': len(summaries),
                  'samples': sum(row['sampleCount'] for row in summaries)}))
