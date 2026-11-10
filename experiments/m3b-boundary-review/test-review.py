#!/usr/bin/env python3
"""Bounded retained-fixture corruption tests; no build, browser or guest."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('boundary_review', HERE / 'review.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
ROOT = HERE.parents[1]
ON = json.loads((ROOT / 'artifacts/m3b-boundary-on-01/report.json').read_text())
OFF = json.loads((ROOT / 'artifacts/m3b-boundary-off-01/report.json').read_text())

class ReplayInput:
    """Only for semantic tests: actual identity hashing is covered by --full."""
    def __init__(self, mode, mutate=None):
        self.directory = 'artifacts/m3b-boundary-' + mode + '-01/'
        self.report = copy.deepcopy(ON if mode == 'on' else OFF)
        self.events = [json.loads(x) for x in (ROOT / self.directory / 'progress.jsonl').read_text().splitlines()]
        if mutate: mutate(self.report, self.events)
    def load(self, name, wanted=None):
        if name == self.directory + 'report.json': return self.report
        return json.loads((ROOT / name).read_text())
    def read(self, name, wanted=None):
        if name == self.directory + 'progress.jsonl': return ('\n'.join(json.dumps(x) for x in self.events) + '\n').encode()
        if name == self.directory + 'serial.log': return (ROOT / name).read_bytes()
        return b''

class Tests(unittest.TestCase):
    def test_retained_off_on_semantic_replay(self):
        for mode in ('off', 'on'):
            _, row = r.replay(ReplayInput(mode), mode)
            self.assertEqual(row['guestOracle'], {'schema': 1, 'programs': 2, 'probes': 4, 'gates': 11,
                'calls': 8196, 'checks': 163923, 'digest': 'fe2f670b35c98d95'})
            self.assertEqual(len(row['nativeProbes']), 4 if mode == 'on' else 0)
    def test_denial_must_be_specific_native_policy_error(self):
        def mutate(report, events):
            event = next(x['observation'] for x in events if x['observation']['event'] == 'profile-control-result')
            event['error'] = 'CommandNotFound: ordinary QMP command absence'
        with self.assertRaisesRegex(ValueError, 'Exact native denial'): r.replay(ReplayInput('on', mutate), 'on')
    def test_unexpected_extra_gate_rejected(self):
        def mutate(report, events): report['gates'].append(copy.deepcopy(report['gates'][-1]))
        with self.assertRaisesRegex(ValueError, 'Exact boundary gate count'): r.replay(ReplayInput('on', mutate), 'on')
    def test_uint32_boolean_is_not_word(self):
        raw = copy.deepcopy(ON['boundaryObservations'][0]['bank']['raw']); raw[5] = False
        with self.assertRaisesRegex(ValueError, 'Raw uint32 bank'): r.bank(raw, 256)
    def test_native_probe_state_corruptions(self):
        for index in range(4):
            obs = ON['boundaryObservations'][index]; original = obs['bank']['raw']
            initial = ON['probeInputs'][index]; program = ON['layout']['programs'][initial['program']]
            generation = r.hx(r.pair(original, 10))
            r.native_probe(original, initial, program, generation)
            for word in (23, 25, 28, 29, 160, 224):
                raw = list(original); raw[word] ^= 1
                with self.subTest(index=index, word=word), self.assertRaises(ValueError): r.native_probe(raw, initial, program, generation)
            with self.assertRaisesRegex(ValueError, 'Owner/generation'):
                r.native_probe(original, initial, program, r.hx(int(generation, 16) + 1))
    def test_full_width_lazy_cc_cannot_be_truncated_self_consistently(self):
        for index in (0, 1):
            obs = ON['boundaryObservations'][index]; raw = list(obs['bank']['raw'])
            self.assertNotEqual(raw[96 + 39], 0)
            raw[96 + 39] = raw[160 + 39] = 0
            with self.assertRaisesRegex(ValueError, 'Full-width lazy flags oracle'):
                r.native_probe(raw, ON['probeInputs'][index], ON['layout']['programs'][0], r.hx(r.pair(raw, 10)))
    def test_sdk_network_or_argv_substitution_rejected(self):
        doc = json.loads((ROOT / 'tmp/sdk-5sbqydxg/invocation.json').read_text())
        args = ['--source', 'artifacts/m3b-source-01/source', '--output', 'artifacts/m3b-build-01', '--targets', 'x86_64-softmmu', '--jobs', '4']
        r.sdk_complete(doc, 'tmp/sdk-5sbqydxg/invocation.json', 'scripts/build.py', args)
        for word in ('none', '4'):
            bad = copy.deepcopy(doc); bad['command'][bad['command'].index(word)] = 'host' if word == 'none' else '8'
            with self.assertRaisesRegex(ValueError, 'Exact offline SDK command'):
                r.sdk_complete(bad, 'tmp/sdk-5sbqydxg/invocation.json', 'scripts/build.py', args)

if __name__ == '__main__': unittest.main()
