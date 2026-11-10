#!/usr/bin/env python3
"""Read-only derivative check; run only in an authorized host-test interval.

This checks preserved critical host-runner sections against the exact frozen
45-gate runner. It does not generate or modify either file, or validate a VM.
The new recovery oracle and browser adapter require separate source review.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = 'tests/m3b-fallthrough/run.mjs'
BASE_SHA = 'ba162b87d50036a05698224b863a1351d91890df7de0393ed6d6aca3d901d9f3'


def section(text, first, last):
    assert text.count(first) == 1, first
    start = text.index(first)
    assert text.count(last, start) == 1, last
    return text[start:text.index(last, start)]


def check():
    base_bytes = (ROOT / BASE).read_bytes()
    assert hashlib.sha256(base_bytes).hexdigest() == BASE_SHA
    base = base_bytes.decode('utf-8')
    candidate = (ROOT / 'tests/m3b-recovery/run.mjs').read_text()
    sections = [
        ('const read=async', 'function snapshot(', 'function validateEvent('),
        ('const record=async', "await durable('request.json'", "await durable('request.json'"),
        (' const fixture=relative(', ' expectedLayout=', ' expectedLayout='),
        (' const raw=report.serial', " for(const path of [...browserSources", ' assert.deepEqual(report.injections'),
        ("}catch(e){report.status='failed';report.failure=String(e.stack??e);}",
         ' report.fixtureProvenance=', ' report.recoveryProvenance='),
    ]
    for first, old_end, new_end in sections:
        assert section(base, first, old_end) == section(candidate, first, new_end), first
    guest = (ROOT / 'tests/m3b-recovery/guest.mjs').read_text()
    assert "export {args} from '../m3b-fallthrough/guest.mjs';" in guest
    assert "import {args} from '../m3b-fallthrough/guest.mjs';" in guest
    assert 'injectM3Region(api,action,0,BigInt(pc))' in guest
    assert "returnCode=mod._defuss_m3_test_inject(...args);return returnCode;" in guest
    assert ' validateFixtureClosure(build);' in candidate
    return {'schema': 1, 'status': 'passed', 'scope': 'Host derivative source check only',
            'base': {'path': BASE, 'sha256': BASE_SHA}, 'preservedSections': len(sections)}


if __name__ == '__main__':
    print(json.dumps(check(), indent=2))
