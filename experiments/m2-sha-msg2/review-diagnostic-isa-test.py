#!/usr/bin/env python3
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('review', Path(__file__).with_name('review-diagnostic-isa.py'))
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def fixture(enabled, cold):
    # Large initial interpreted-only counts exercise exact subtraction above 2**53.
    cumulative = [2**53 + 17, 0, 0]
    locked = 65540 if enabled else 65539
    r = {'schema': 1, 'status': 'passed', 'exposureContract': 'exact-fixture-v1',
         'expectedInstructionCounts': ['4096'] * 6 + ['8192'], 'enabled': 'on' if enabled else 'off',
         'cold': cold, 'node': 'test-only', 'configuredStatus': 65538 if enabled else 65537,
         'finalStatus': locked, 'executionCounts': True, 'fixturePass': 'MSG2_FIXTURE_PASS checks=28672',
         'faultPass': review.FAULT, 'settings': {'hotLimit': 65535 if cold else 1500,
             'runtimeFlags': 2, 'pressureAdmission': False, 'smp': 1, 'ramMiB': 512, 'tbMiB': 128},
         'gates': [{'kind': -1, 'status': locked, 'counters': list(map(str, cumulative))}]}
    serial = ['MSG2_FIXTURE_START', 'MSG2_GATE:-1']
    for mode, total in enumerate([4096] * 6 + [8192]):
        interpreted = total if cold else 1500
        inline = total - interpreted if enabled else 0
        fallback = total - interpreted if not enabled else 0
        delta = [interpreted + fallback, inline, fallback]
        cumulative = [a + b for a, b in zip(cumulative, delta)]
        r['gates'].append({'kind': mode, 'status': locked, 'counters': list(map(str, cumulative)),
            'delta': list(map(str, delta)), 'exposure': {'contract': 'exact-fixture-v1', 'mode': mode,
                'expectedInstructions': str(total), 'observedInstructions': str(total),
                'interpreted': str(interpreted), 'compiledInline': str(inline), 'compiledFallback': str(fallback)}})
        if mode == 6:
            serial.append(review.FAULT)
        serial.extend([f'MSG2_MODE_PASS:{mode} checks=4096', f'MSG2_GATE:{mode}'])
    serial.extend(['MSG2_FIXTURE_PASS checks=28672', 'FIXTURE_PASS'])
    return r, '\n'.join(serial) + '\n'


class ReplayTests(unittest.TestCase):
    def test_four_modes_and_exact_large_cumulative_counters(self):
        for enabled in [False, True]:
            for cold in [False, True]:
                with self.subTest(enabled=enabled, cold=cold):
                    r, serial = fixture(enabled, cold)
                    result = review.replay(r, serial)
                    self.assertEqual(result['totals']['observedInstructions'], '32768')
                    self.assertEqual(sum(int(result['totals'][k]) for k in
                                         ['interpreted', 'compiledInline', 'compiledFallback']), 32768)
                    if cold:
                        self.assertEqual(result['totals']['interpreted'], '32768')

    def test_extra_missing_duplicated_and_fault_markers_rejected(self):
        r, serial = fixture(True, False)
        for corrupted in [serial.replace('MSG2_GATE:2\n', ''), serial + 'FIXTURE_PASS\n',
                          serial.replace('faults=1', 'faults=2'), serial + 'FIXTURE_FAIL\n']:
            with self.subTest(corrupted=corrupted[-80:]), self.assertRaises(ValueError):
                review.replay(r, corrupted)

    def test_count_mode_and_partition_corruption_rejected(self):
        r, serial = fixture(True, False)
        mutations = [
            lambda x: x['gates'][1]['counters'].__setitem__(0, str(int(x['gates'][1]['counters'][0]) + 1)),
            lambda x: x['gates'][1]['delta'].__setitem__(1, '02596'),
            lambda x: x['gates'][1]['exposure'].__setitem__('observedInstructions', '4097'),
            lambda x: x['gates'][1].__setitem__('status', 65539),
            lambda x: x['gates'][1]['counters'].__setitem__(2, '1'),
            lambda x: x['gates'][1]['counters'].__setitem__(1, str(2**64)),
            lambda x: x['gates'][-1]['exposure'].__setitem__('expectedInstructions', '4096'),
        ]
        for index, mutation in enumerate(mutations):
            value = copy.deepcopy(r)
            mutation(value)
            with self.subTest(index=index), self.assertRaises(ValueError):
                review.replay(value, serial)


if __name__ == '__main__':
    unittest.main()
