#!/usr/bin/env python3
"""Small freezer contracts; execute only in a root-authorized safe gap."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('observer_freeze', Path(__file__).with_name('freeze.py'))
freeze = importlib.util.module_from_spec(spec)
spec.loader.exec_module(freeze)


class FreezeContracts(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='observer-freeze-test-', dir=ROOT / 'tmp')).resolve()
        for name in ['artifacts', 'tmp', 'source']:
            (self.root / name).mkdir()
        self.path = self.root / 'source/a.mjs'
        self.path.write_text('export const value = 1;\n')
        data, sig = freeze.read_stable(self.root, 'source/a.mjs')
        self.selected = {'source/a.mjs': {'data': data, 'signature': sig, 'role': 'test-source'}}

    def test_publish_exact_and_refuse_overwrite(self):
        result = freeze.publish(self.root, 'artifacts/freeze', self.selected, {})
        self.assertEqual(result['status'], 'source-frozen')
        self.assertEqual((self.root / 'artifacts/freeze/source/source/a.mjs').read_bytes(), self.path.read_bytes())
        self.assertFalse((self.root / 'artifacts/.freeze.freeze-lock').exists())
        with self.assertRaisesRegex(ValueError, 'already exists'):
            freeze.publish(self.root, 'artifacts/freeze', self.selected, {})

    def test_changed_input_preserves_stage_and_lock(self):
        self.path.write_text('export const value = 2;\n')
        with self.assertRaisesRegex(RuntimeError, 'Live input changed'):
            freeze.publish(self.root, 'artifacts/freeze', self.selected, {})
        self.assertFalse((self.root / 'artifacts/freeze').exists())
        self.assertEqual(len(list((self.root / 'tmp').glob('m3b-observer-freeze-*'))), 1)
        self.assertTrue((self.root / 'artifacts/.freeze.freeze-lock/owner.json').is_file())
        with self.assertRaises(FileExistsError):
            freeze.publish(self.root, 'artifacts/freeze', self.selected, {})

    def test_symlink_and_external_paths_refused(self):
        (self.root / 'source/link.mjs').symlink_to(self.path)
        for name in ['source/link.mjs', '../external', str(self.path)]:
            with self.assertRaises(ValueError):
                freeze.read_stable(self.root, name)

    def test_corrupt_archive_never_publishes(self):
        original = freeze.durable_file
        def corrupt(path, data):
            original(path, data + b'bad' if path.name == 'a.mjs' else data)
        freeze.durable_file = corrupt
        try:
            with self.assertRaisesRegex(RuntimeError, 'Archive mismatch'):
                freeze.publish(self.root, 'artifacts/freeze', self.selected, {})
        finally:
            freeze.durable_file = original
        self.assertFalse((self.root / 'artifacts/freeze').exists())


if __name__ == '__main__':
    unittest.main()
