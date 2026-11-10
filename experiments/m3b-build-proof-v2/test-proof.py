#!/usr/bin/env python3
"""Small synthetic proof fixtures; no engine build, browser or guest."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import proof as p
from engine_tree import EngineTree, compare_links, fingerprint


class Contracts(unittest.TestCase):
    def setUp(self):
        self.saved_root = p.ROOT
        self.root = Path(tempfile.mkdtemp(prefix='m3b-proof-v2-', dir=p.ROOT / 'tmp'))
        p.ROOT = self.root
        for name in ('base', 'prepared', 'artifacts', 'tmp'):
            (self.root / name).mkdir()
        self.contract = {'alias.rs': ('real/build.rs', 'real/build.rs', 'file'),
                         'headers-link': ('headers', 'headers', 'directory')}
        for name in ('base', 'prepared'):
            tree = self.root / name
            (tree / 'real').mkdir(); (tree / 'headers').mkdir()
            (tree / 'real/build.rs').write_bytes(b'retained target\n')
            (tree / 'headers/one.h').write_bytes(b'#define ONE 1\n')
            (tree / 'headers.h').write_bytes(b'component ordering sentinel\n')
            (tree / 'alias.rs').symlink_to('real/build.rs')
            (tree / 'headers-link').symlink_to('headers')

    def tearDown(self):
        p.ROOT = self.saved_root

    def tree(self, name='base', audit=None):
        return EngineTree(self.root / name, audit or p.Audit(), self.contract)

    def test_exact_logical_fingerprint_and_directory_target_closure(self):
        a = p.Audit(); base, source = self.tree(audit=a), self.tree('prepared', a)
        compare_links(base, source)
        reference = hashlib.sha256()
        for path in sorted((self.root / 'base').rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                reference.update(path.relative_to(self.root / 'base').as_posix().encode() + b'\0')
                reference.update(hashlib.sha256(path.read_bytes()).digest())
        self.assertEqual(fingerprint(base.files), reference.hexdigest())
        self.assertEqual(set(base.files), {'alias.rs', 'real/build.rs', 'headers/one.h', 'headers.h'})
        self.assertEqual(p.fingerprint(base.files), reference.hexdigest())
        self.assertNotEqual(sorted(base.files), sorted(base.files, key=Path))
        self.assertEqual(base.files['alias.rs'], base.files['real/build.rs'])
        self.assertNotIn('base/alias.rs', a.identities)  # generic reader never follows it
        directory = next(row for row in base.evidence if row['kind'] == 'directory')
        self.assertEqual(set(directory['targetFiles']), {'headers/one.h'})
        self.assertEqual(directory['targetClosureFingerprint'], fingerprint(directory['targetFiles']))
        base.stable(); source.stable(); a.stable()

    def test_external_absolute_and_equivalent_text_rejected(self):
        link = self.root / 'base/alias.rs'
        (self.root / 'external.rs').write_bytes(b'retained target\n')
        for text in ('../external.rs', str(self.root / 'external.rs'), './real/build.rs'):
            link.unlink(); link.symlink_to(text)
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.tree()

    def test_missing_replaced_unexpected_and_directory_kind_rejected(self):
        link = self.root / 'base/alias.rs'
        link.unlink(); link.write_bytes(b'retained target\n')
        with self.assertRaises(ValueError): self.tree()
        link.unlink(); link.symlink_to('real/build.rs')
        extra = self.root / 'base/extra.rs'; extra.symlink_to('real/build.rs')
        with self.assertRaises(ValueError): self.tree()
        extra.unlink()
        target = self.root / 'base/headers/one.h'; target.unlink()
        (self.root / 'base/headers').rmdir(); (self.root / 'base/headers').write_bytes(b'wrong kind')
        with self.assertRaises(ValueError): self.tree()

    def test_target_symlink_chain_or_directory_escape_rejected(self):
        target = self.root / 'base/real/build.rs'
        target.unlink(); target.symlink_to('../../prepared/real/build.rs')
        with self.assertRaises(ValueError): self.tree()
        target.unlink(); target.write_bytes(b'retained target\n')
        (self.root / 'base/headers/escape.h').symlink_to('../../prepared/headers/one.h')
        with self.assertRaises(ValueError): self.tree()

    def test_link_inode_replacement_and_new_target_file_detected(self):
        a = p.Audit(); tree = self.tree(audit=a)
        link = self.root / 'base/alias.rs'
        # Replacing with identical link text still changes retained lstat identity.
        other = self.root / 'base/replacement'; other.symlink_to('real/build.rs')
        os.replace(other, link)
        with self.assertRaises(ValueError): tree.stable()
        tree = self.tree()
        (self.root / 'base/headers/two.h').write_bytes(b'new target descendant')
        with self.assertRaises(ValueError): tree.stable()

    def test_regular_target_mutation_and_generic_paths_remain_strict(self):
        a = p.Audit(); tree = self.tree(audit=a)
        for value in ('base/alias.rs', 'base/headers-link/one.h'):
            with self.subTest(value=value), self.assertRaises(ValueError): a.file(value)
        (self.root / 'base/real/build.rs').write_bytes(b'changed target\n')
        with self.assertRaises(ValueError): a.stable()
        # The logical fingerprint sees target-byte changes through both names.
        changed = self.tree()
        self.assertNotEqual(fingerprint(tree.files), fingerprint(changed.files))

    def test_tool_freeze_and_review_identity_are_mandatory(self):
        saved_sha = p.ORIGINAL_TOOL_SHA
        try:
            original = self.root / p.ORIGINAL_TOOL
            original.parent.mkdir(parents=True); original.write_bytes(b'synthetic frozen original')
            p.ORIGINAL_TOOL_SHA = hashlib.sha256(original.read_bytes()).hexdigest()
            for name in p.TOOL_FILES:
                path = self.root / p.TOOL_HERE / name
                path.parent.mkdir(parents=True, exist_ok=True); path.write_text('synthetic source ' + name)
            for name in ('artifacts/m3b-implementation-source-01/manifest.json',
                         'artifacts/m3b-implementation-source-review-01/review.json',
                         'artifacts/m3b-build-review-01/failure.json', 'artifacts/tests.json'):
                path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('{}')
            out = self.root / 'artifacts/tool-source'; out.mkdir()
            p.tool_freeze(SimpleNamespace(test_evidence=['artifacts/tests.json']), out)
            manifest_name = 'artifacts/tool-source/manifest.json'
            review_name = 'artifacts/tool-review.json'
            ref = p.Audit().ref(manifest_name)
            args = SimpleNamespace(tool_manifest=manifest_name, tool_review=review_name)
            review = {'status': 'passed', 'sourceManifest': ref, 'sourceBlockers': []}
            (self.root / review_name).write_text(json.dumps(review))
            proof = p.verify_tool(p.Audit(), args)
            self.assertEqual(proof['sourceManifest'], ref)
            self.assertEqual(proof['engineTreeReader']['path'], p.TOOL_HERE + '/engine_tree.py')
            for field, value in [('status', 'source-only'), ('sourceBlockers', ['unresolved'])]:
                bad = {**review, field: value}; (self.root / review_name).write_text(json.dumps(bad))
                with self.assertRaises(ValueError): p.verify_tool(p.Audit(), args)
            (self.root / review_name).write_text(json.dumps(review))
            (self.root / p.TOOL_HERE / 'engine_tree.py').write_text('changed after freeze')
            with self.assertRaises(ValueError): p.verify_tool(p.Audit(), args)
            with self.assertRaises(FileExistsError): p.publish(out / 'manifest.json', {})
        finally:
            p.ORIGINAL_TOOL_SHA = saved_sha

    def test_original_schema_tool_attribution_does_not_survive_v2(self):
        text = (self.saved_root / p.TOOL_HERE / 'proof.py').read_text()
        self.assertIn("'tool': a.ref(TOOL_HERE + '/proof.py')", text)
        self.assertIn("rechecked['toolProof'] == tool_proof", text)
        self.assertNotIn("'tool': a.ref(HERE + '/provenance.py')", text)
        self.assertIn('base_tree.stable(); source_tree.stable(); a.stable()', text)


if __name__ == '__main__':
    unittest.main()
