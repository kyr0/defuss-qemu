#!/usr/bin/env python3
"""Focused adversarial tests of compositional change provenance."""
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('context_proof', Path(__file__).with_name('proof.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
A, B, C = 'a' * 64, 'b' * 64, 'c' * 64

class CompositionTests(unittest.TestCase):
    def test_existing_patch_preserves_original_before(self):
        inherited = [{'path': 'system/a.c', 'before': A, 'after': B}]
        incremental = [{'path': 'system/a.c', 'before': B, 'after': C}]
        self.assertEqual(m.flatten_changes(inherited, incremental), [{'path': 'system/a.c', 'before': A, 'after': C}])
        self.assertEqual(inherited[0]['after'], B)

    def test_new_parent_file_preserves_absence(self):
        self.assertEqual(m.flatten_changes([{'path': 'a.h', 'before': None, 'after': B}],
           [{'path': 'a.h', 'before': B, 'after': C}]), [{'path': 'a.h', 'before': None, 'after': C}])

    def test_unmodified_and_new_paths_retained_path_order(self):
        rows = m.flatten_changes([{'path': 'headers.h', 'before': A, 'after': B}],
           [{'path': 'headers/one.h', 'before': None, 'after': C}])
        self.assertEqual([r['path'] for r in rows], ['headers/one.h', 'headers.h'])
        self.assertEqual(rows[1]['after'], B)

    def test_wrong_intermediate_identity_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Broken overlay chain'):
            m.flatten_changes([{'path': 'a', 'before': A, 'after': B}], [{'path': 'a', 'before': A, 'after': C}])

    def test_duplicate_paths_rejected_in_either_stage(self):
        row = {'path': 'a', 'before': A, 'after': B}
        for inherited, incremental in [([row, row], []), ([], [row, row])]:
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                m.flatten_changes(inherited, incremental)

    def test_path_escape_and_noncanonical_path_rejected(self):
        for path in ('/a', '../a', 'a/../b', 'a//b', './a', ''):
            with self.subTest(path=path), self.assertRaises(ValueError):
                m.flatten_changes([], [{'path': path, 'before': A, 'after': B}])

    def test_missing_extra_or_short_identity_rejected(self):
        for row in ({'path': 'a', 'after': B}, {'path': 'a', 'before': A, 'after': B, 'extra': 1},
                    {'path': 'a', 'before': A, 'after': 'bad'}):
            with self.assertRaises(ValueError): m.flatten_changes([], [row])

    def test_generic_evidence_symlink_remains_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            m.inside('artifacts/m3b-source-01/source/rust/hw/char/pl011/build.rs')

if __name__ == '__main__': unittest.main(verbosity=2)
