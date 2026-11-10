#!/usr/bin/env python3
"""Small synthetic publication/identity corruption tests; execute in a safe gap.

No prepared engine tree, SDK build, runtime or guest is created. Scratch stays
under the project tmp directory and is retained for crash/debug inspection.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
spec = importlib.util.spec_from_file_location('m3b_provenance', HERE / 'provenance.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class ProvenanceContracts(unittest.TestCase):
    def setUp(self):
        self.scratch = Path(tempfile.mkdtemp(prefix='m3b-prov-', dir=PROJECT / 'tmp'))
        self.root, self.roots, self.dependencies = p.ROOT, p.ROOTS, p.DEPENDENCIES
        p.ROOT = self.scratch
        p.DEPENDENCIES = ()
        for name in ['artifacts', 'tmp', 'src', 'tmp/sdk-case']:
            (self.scratch / name).mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        p.ROOT, p.ROOTS, p.DEPENDENCIES = self.root, self.roots, self.dependencies

    def test_canonical_paths_and_symlinks(self):
        target = self.scratch / 'artifacts/x'
        target.write_text('x')
        self.assertEqual(p.inside('/project/artifacts/x', True), target)
        self.assertEqual(p.inside(str(target), True), target)
        for bad in ['../artifacts/x', '/other/artifacts/x', 'artifacts//x', 'artifacts/./x', 'artifacts/a/../x']:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                p.inside(bad)
        (self.scratch / 'artifacts/link').symlink_to(target)
        with self.assertRaises(ValueError):
            p.inside('artifacts/link')

    def test_publication_never_overwrites(self):
        path = self.scratch / 'artifacts/record.json'
        p.publish(path, {'one': 1})
        before = path.read_bytes()
        with self.assertRaises(FileExistsError):
            p.publish(path, {'one': 2})
        self.assertEqual(path.read_bytes(), before)
        out = self.scratch / 'artifacts/run'
        p.mkdir(out)
        with self.assertRaises(ValueError):
            p.mkdir(out)

    def test_live_archive_and_set_corruptions(self):
        p.ROOTS = ('src',)
        live = self.scratch / 'src/source.c'
        live.write_text('int retained;\n')
        archive = self.scratch / 'artifacts/frozen/source/src/source.c'
        archive.parent.mkdir(parents=True)
        archive.write_bytes(live.read_bytes())
        identity = p.Audit().file('src/source.c')
        manifest = {'schema': 1, 'kind': 'm3b-implementation-source-freeze', 'status': 'frozen',
                    'timingEligible': False, 'files': [{'path': 'src/source.c', 'archive': 'artifacts/frozen/source/src/source.c', **identity}], 'dependencies': {}}
        path = self.scratch / 'artifacts/frozen/manifest.json'
        path.write_text(json.dumps(manifest))
        p.verify_frozen(p.Audit(), p.relative(path))
        p.DEPENDENCIES = ('missing-build-helper.js',)
        with self.assertRaises(ValueError):
            p.verify_frozen(p.Audit(), p.relative(path))
        p.DEPENDENCIES = ()
        archive.write_text('int changed;\n')
        with self.assertRaises(ValueError):
            p.verify_frozen(p.Audit(), p.relative(path))
        archive.write_bytes(live.read_bytes())
        (self.scratch / 'src/extra.c').write_text('int extra;\n')
        with self.assertRaises(ValueError):
            p.verify_frozen(p.Audit(), p.relative(path))

    def test_final_review_is_not_a_draft(self):
        p.ROOTS = ('src',)
        source = self.scratch / 'src/test.c'
        source.write_text('int x;\n')
        out = self.scratch / 'artifacts/freeze'
        (out / 'source/src').mkdir(parents=True)
        (out / 'source/src/test.c').write_bytes(source.read_bytes())
        row = {'path': 'src/test.c', 'archive': 'artifacts/freeze/source/src/test.c', **p.Audit().file(source)}
        m = out / 'manifest.json'
        m.write_text(json.dumps({'schema': 1, 'kind': 'm3b-implementation-source-freeze', 'status': 'frozen', 'timingEligible': False, 'files': [row], 'dependencies': {}}))
        review = self.scratch / 'artifacts/review.json'
        ref = p.Audit().ref(m)
        for status, blockers in [('source-only', []), ('passed', ['open blocker'])]:
            review.write_text(json.dumps({'status': status, 'sourceManifest': ref, 'sourceBlockers': blockers}))
            with self.assertRaises(ValueError):
                p.verify_frozen(p.Audit(), m, review)
        review.write_text(json.dumps({'status': 'passed', 'sourceManifest': ref, 'sourceBlockers': []}))
        p.verify_frozen(p.Audit(), m, review)

    def test_sdk_completed_offline_command_is_exact(self):
        source, build, scratch = 'artifacts/source/source', 'artifacts/build', 'tmp/sdk-case'
        path = scratch + '/invocation.json'
        original = {'schema': 1, 'status': 'passed', 'returncode': 0, 'sdk': p.SDK,
                    'scratch': str(self.scratch / scratch), 'containerScratch': '/project/' + scratch,
                    'command': ['docker', *p.sdk_tail(source, build, 8, scratch)],
                    'startedUtc': '2026-11-07T10:00:00+00:00', 'finishedUtc': '2026-11-07T10:01:00+00:00'}
        p.validate_sdk(original, path, source, build, 8)
        corruptions = [('status', 'running'), ('returncode', False), ('schema', True), ('sdk', 'unpinned'),
                       ('containerScratch', '/tmp'), ('finishedUtc', '2026-11-07T09:00:00+00:00'),
                       ('finishedUtc', '2026-11-07T10:01:00')]
        for field, value in corruptions:
            changed = copy.deepcopy(original)
            changed[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                p.validate_sdk(changed, path, source, build, 8)
        changed = copy.deepcopy(original)
        changed['command'][changed['command'].index('none')] = 'host'
        with self.assertRaises(ValueError):
            p.validate_sdk(changed, path, source, build, 8)
        with self.assertRaises(ValueError):
            p.validate_sdk(original, path, source, build, 4)

    def test_identity_hash_and_mid_audit_mutation_reject(self):
        path = self.scratch / 'src/file.c'
        path.write_bytes(b'first')
        a = p.Audit()
        identity = a.file(path)
        self.assertEqual(identity, {'sha256': hashlib.sha256(b'first').hexdigest(), 'bytes': 5})
        path.write_bytes(b'other')
        with self.assertRaises(ValueError):
            a.file(path, identity)
        with self.assertRaises(ValueError):
            a.stable()

    def test_glue_injected_sources_are_mandatory_dependencies(self):
        text = (PROJECT / 'scripts/expose-profile.py').read_text()
        names = re.findall(r"with_name\('([^']+)'\)\.read_text\(\)", text)
        self.assertTrue(names)
        for name in names:
            self.assertIn('scripts/' + name, self.dependencies)

    def test_module_imports_do_not_treat_wat_comments_as_packages(self):
        text = '''import {a} from './a.mjs';
import './b.mjs';
const c=await import('/src/c.mjs');
// (module (import "env" "pcm" (func)))
'''
        self.assertEqual(p.IMPORTS.findall(text), ['./a.mjs', './b.mjs', '/src/c.mjs'])

    def test_graph_inventory_cannot_omit_raw_observation(self):
        directory = self.scratch / 'artifacts/observation'
        directory.mkdir()
        artifacts = {}
        for name in ['qmp.log', 'qtree.txt', 'serial.log', 'events.jsonl']:
            path = directory / name
            path.write_text('')
            artifacts[name] = p.Audit().file(path)
        (directory / 'preflight.json').write_text('{}')
        observation = directory / 'report.json'
        observation.write_text(json.dumps({'protocol': 'defuss-m3b-device-observation-v3', 'status': 'observed',
                                          'mode': 'off', 'eligibilityEstablished': False, 'inputRecheck': [], 'artifacts': artifacts}))
        live = self.scratch / 'src/source.c'
        live.write_text('int x;')
        archive = self.scratch / 'artifacts/source.c'
        archive.write_bytes(live.read_bytes())
        manifest = self.scratch / 'artifacts/manifest.json'
        manifest.write_text(json.dumps({'files': [{'path': 'src/source.c', 'archive': 'artifacts/source.c', **p.Audit().file(live)}]}))
        source_review = self.scratch / 'artifacts/source-review.json'
        source_review.write_text(json.dumps({'status': 'passed', 'sourceBlockers': [], 'sourceManifest': p.Audit().ref(manifest)}))
        a = p.Audit()
        review = {'observation': a.ref(observation), 'observerSourceManifest': a.ref(manifest),
                  'observerSourceReview': a.ref(source_review),
                  'inventory': [a.ref(path) for path in [*directory.iterdir(), manifest, source_review]]}
        self.assertIn('src/source.c', p.graph_evidence(a, review))
        for omitted in ['qmp.log', 'preflight.json']:
            changed = copy.deepcopy(review)
            changed['inventory'] = [row for row in changed['inventory'] if not row['path'].endswith('/' + omitted)]
            with self.subTest(omitted=omitted), self.assertRaises(ValueError):
                p.graph_evidence(p.Audit(), changed)


if __name__ == '__main__':
    unittest.main()
