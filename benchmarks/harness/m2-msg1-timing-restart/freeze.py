"""Bind a fresh administrative restart to the original immutable protocol."""
import ast
import datetime
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'artifacts/m2-msg1-timing-plan-02'


def ident(path):
    return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}


if __name__ == '__main__':
    original = ROOT / 'artifacts/m2-msg1-timing-plan-01/plan.json'
    plan = json.loads(original.read_text())
    assert plan['status'] == 'frozen' and plan['blocks'] == 6 and len(plan['steps']) == 18
    for name, identity in plan['inputs'].items():
        assert ident(ROOT / name) == identity, name
    interrupted = ROOT / 'artifacts/m2-msg1-interruption-01/report.json'
    prior = json.loads(interrupted.read_text())
    assert prior['status'] == 'administratively-interrupted' and len(prior['capturedReports']) == 4
    assert prior['oldPlan'] == ident(original)
    for name, identity in prior['capturedReports'].items():
        assert ident(ROOT / name) == identity
    for name in ['campaign.py', 'analyze.py']:
        expected = (ROOT / 'benchmarks/harness/m2-msg1-timing' / name).read_text()
        expected = expected.replace('artifacts/m2-msg1-timing-plan-01', 'artifacts/m2-msg1-timing-plan-02').replace('artifacts/m2-msg1-timing-analysis-01', 'artifacts/m2-msg1-timing-analysis-02').replace('artifacts/m2-msg1-timing-01', 'artifacts/m2-msg1-timing-02')
        assert (HERE / name).read_text() == expected
        ast.parse(expected)
    for p in [original, interrupted, *sorted(HERE.iterdir())]:
        if p.is_file():
            plan['inputs'][str(p.relative_to(ROOT))] = ident(p)
    for step in plan['steps']:
        step['capture'] = step['capture'].replace('m2-msg1-timing-01/', 'm2-msg1-timing-02/')
        step['execution'] = step['execution'][:-2] + '02'
        assert not (ROOT / step['capture']).exists() and not (ROOT / step['execution']).exists()
    plan['createdUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    plan['kind'] = 'Fresh full six-block study after administrative interruption; no pooling'
    plan['measurementProtocolPlan'] = str(original.relative_to(ROOT))
    plan['interruptionRecord'] = str(interrupted.relative_to(ROOT))
    OUT.mkdir()
    with (OUT / 'plan.json').open('x') as f:
        json.dump(plan, f, indent=2)
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())
    print(json.dumps({'status': 'frozen', 'steps': len(plan['steps']), 'inputs': len(plan['inputs'])}))
