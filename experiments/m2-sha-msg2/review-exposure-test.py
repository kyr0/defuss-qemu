#!/usr/bin/env python3
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('review', Path(__file__).with_name('review-exposure.py'))
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def bank(original, inline=0, fallback=0):
    return {'schema': 1, **dict(zip(review.FIELDS, map(str, [original, inline, fallback])))}


class CounterReplayTests(unittest.TestCase):
    def test_exact_uint64_partition(self):
        begin = bank(2**53 + 9, 2**53 + 3)
        end = bank(2**53 + 14, 2**53 + 16)
        self.assertEqual(review.delta(begin, end, True, True), {
            'schema': 1, 'originalHelperEntries': '5', 'compiledInlineExecutions': '13',
            'compiledFallbackEntries': '0', 'interpretedHelperEntries': '5', 'allExecutions': '18'})
        off = review.delta(bank(100, 0, 20), bank(110, 0, 26), False, True)
        self.assertEqual(off['allExecutions'], '10')
        self.assertEqual(off['interpretedHelperEntries'], '4')

    def test_invalid_banks_modes_and_missing_exposure(self):
        failures = [
            (bank(2), bank(1), True, False),
            (bank(0), bank(1, 0, 2), False, False),
            (bank(0), bank(1, 0, 1), True, False),
            (bank(0), bank(1, 1), False, False),
            (bank(0), bank(10), True, True),
            (bank(0), bank(2**64), False, False),
            (bank(0), dict(bank(1), originalHelperEntries='01'), False, False),
        ]
        for index, arguments in enumerate(failures):
            with self.subTest(index=index), self.assertRaises(ValueError):
                review.delta(*arguments)

    def test_hidden_boot_or_between_phase_path_rejected(self):
        browser = {'exposureInitialized': bank(0), 'exposureComplete': bank(13, 13), 'results': []}
        rows = []
        for i in range(13):
            start, end = bank(i, i), bank(i + 1, i + 1)
            rows.append({'name': 'warmup' if i == 0 else 'sha256', 'sample': None if i == 0 else i,
                'iterations': None if i == 0 else 100,
                'exposure': {'begin': start, 'end': end, 'delta': review.delta(start, end, True)}})
        browser['warmup'], browser['results'] = rows[0], rows[1:]
        self.assertEqual(len(review.phases(browser, True)), 13)
        for key in ['exposureInitialized', 'exposureComplete']:
            modified = copy.deepcopy(browser)
            modified[key]['compiledFallbackEntries'] = '1'
            if key == 'exposureInitialized':
                modified[key]['originalHelperEntries'] = '1'
            with self.subTest(key=key), self.assertRaises(ValueError):
                review.phases(modified, True)
        modified = copy.deepcopy(browser)
        modified['results'][0]['exposure']['begin']['compiledInlineExecutions'] = '0'
        with self.assertRaises(ValueError):
            review.phases(modified, True)


if __name__ == '__main__':
    unittest.main()
