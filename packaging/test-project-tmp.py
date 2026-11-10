#!/usr/bin/env python3
"""Tiny publication fixtures and fake-container argv checks; no image/VM build."""
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[1]
ARCHIVE = PROJECT / 'artifacts/build-host/packaging-before-project-tmp'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PackagingTmpTests(unittest.TestCase):
    def setUp(self):
        parent = PROJECT / 'tmp'
        parent.mkdir(exist_ok=True)
        self.work = Path(tempfile.mkdtemp(prefix='packaging-test-', dir=parent))
        self.root = self.work / 'fixture'
        self.packaging = self.root / 'packaging'
        self.support = self.packaging / 'bun-app'
        self.assets = self.root / 'assets/bun/amd64'
        self.runtime = self.root / 'runtime/x86_64'
        self.rom = self.root / 'engine/qemu/pc-bios'
        for directory in (self.support, self.assets, self.runtime, self.rom):
            directory.mkdir(parents=True)
        for name, data in {'init': b'#!/bin/sh\n', 'boot.mjs': b'boot();\nsnapshotReady();\n',
                           'snapshot-ready.mjs': b'export const ready=1;\n'}.items():
            (self.support / name).write_bytes(data)
        for name in ('bios-256k.bin', 'kvmvapic.bin', 'linuxboot_dma.bin'):
            (self.rom / name).write_bytes(name.encode())
        (self.runtime / 'qemu-system-x86_64.js').write_bytes(b'export default 1;\n')
        (self.runtime / 'qemu-system-x86_64.wasm').write_bytes(b'\0asm\1\0\0\0')
        (self.assets / 'vmlinuz-virt').write_bytes(b'fake-kernel')
        with tarfile.open(self.assets / 'distroless.tar', 'w') as archive:
            member = tarfile.TarInfo('usr/local/bin/bun')
            data = b'fake-bun'; member.size = len(data); member.mode = 0o755
            archive.addfile(member, io.BytesIO(data))
        self.new = load('new_package', PROJECT / 'packaging/bun_app_package.py')
        self.old = load('old_package', ARCHIVE / 'bun_app_package.py')
        self.new.write_cpio({'TRAILER!!!': (0, 0, 0, b'', 0, 0)}, self.assets / 'initramfs-virt')
        for module in (self.old, self.new):
            module.ROOT = self.packaging; module.SUPPORT = self.support; module.ASSETS = self.assets
            module.PINS = {path: module.sha(path) for path in self.assets.iterdir()}
        self.bundle = self.root / 'app.mjs'; self.bundle.write_bytes(b'export const answer=42;\n')

    def test_package_bytes_and_manifest_are_identical_to_archived_implementation(self):
        old_path = self.old.package_app(self.bundle, self.root / 'old', manual_ready=True)
        new_path = self.new.package_app(self.bundle, self.root / 'new', manual_ready=True)
        self.assertEqual(old_path.read_bytes(), new_path.read_bytes())
        manifest = json.loads(new_path.read_bytes())
        for name in manifest['artifacts']:
            self.assertEqual((old_path.parent / manifest['generation'] / name).read_bytes(),
                             (new_path.parent / manifest['generation'] / name).read_bytes())
        self.assertEqual(stat.S_IMODE(new_path.stat().st_mode), stat.S_IMODE(old_path.stat().st_mode))
        scratch, = (self.root / 'tmp').iterdir()
        self.assertTrue((scratch / 'completed.json').exists())
        self.assertFalse((scratch / 'generation').exists())
        self.new.package_app(self.bundle, self.root / 'new', manual_ready=True)
        self.assertEqual(old_path.read_bytes(), new_path.read_bytes())
        self.assertEqual(len(list((self.root / 'new').iterdir())), 2)

    def test_failed_manifest_publication_retains_staging_and_prior_manifest(self):
        destination = self.root / 'new'
        original = self.new.package_app(self.bundle, destination).read_bytes()
        self.bundle.write_bytes(b'export const answer=43;\n')
        before = set((self.root / 'tmp').iterdir())
        with patch.object(self.new, 'publish_file', side_effect=OSError('injected publication failure')):
            with self.assertRaisesRegex(OSError, 'injected'):
                self.new.package_app(self.bundle, destination)
        self.assertEqual((destination / 'app.json').read_bytes(), original)
        scratch, = set((self.root / 'tmp').iterdir()) - before
        self.assertTrue((scratch / 'failure.json').exists())
        self.assertTrue((scratch / 'app.json').exists())
        new_manifest = json.loads((scratch / 'app.json').read_bytes())
        self.assertTrue((destination / new_manifest['generation'] / 'app.mjs').exists())

    def test_atomic_publications_use_project_scratch_and_fail_closed_across_filesystems(self):
        calls = []
        rename, replace = Path.rename, Path.replace
        def record_rename(source, destination):
            calls.append(('generation', source, destination)); return rename(source, destination)
        def record_replace(source, destination):
            calls.append(('manifest', source, destination)); return replace(source, destination)
        with patch.object(Path, 'rename', record_rename), patch.object(Path, 'replace', record_replace):
            self.new.package_app(self.bundle, self.root / 'new')
        self.assertEqual([row[0] for row in calls], ['generation', 'manifest'])
        for _, source, destination in calls:
            self.assertTrue(source.is_relative_to(self.root / 'tmp'))
            self.assertTrue(destination.is_relative_to(self.root / 'new'))
        with patch.object(Path, 'stat', side_effect=[SimpleNamespace(st_dev=1), SimpleNamespace(st_dev=2)]):
            with self.assertRaisesRegex(ValueError, 'same filesystem'):
                self.new.require_same_filesystem(self.root, self.root)

    def test_failed_generation_publication_retains_complete_unpublished_generation(self):
        destination = self.root / 'new'
        original = self.new.package_app(self.bundle, destination).read_bytes()
        self.bundle.write_bytes(b'export const answer=44;\n')
        before = set((self.root / 'tmp').iterdir())
        with patch.object(self.new, 'publish_generation', side_effect=OSError('injected generation failure')):
            with self.assertRaisesRegex(OSError, 'injected'):
                self.new.package_app(self.bundle, destination)
        scratch, = set((self.root / 'tmp').iterdir()) - before
        self.assertEqual((destination / 'app.json').read_bytes(), original)
        self.assertEqual((scratch / 'generation/app.mjs').read_bytes(), self.bundle.read_bytes())
        self.assertTrue((scratch / 'failure.json').exists())

    def fake_bundle(self, failure=False):
        fake = self.work / 'fake-container.py'
        fake.write_text('''import json,os,sys
from pathlib import Path
args=sys.argv[1:]
mounts=[args[i+1] for i,x in enumerate(args) if x=='-v']
envs=[args[i+1] for i,x in enumerate(args) if x=='-e']
assert all(x in envs for x in ['TMPDIR=/scratch','TMP=/scratch','TEMP=/scratch'])
out=Path(next(x.rsplit(':',1)[0] for x in mounts if x.endswith(':/out')))
scratch=Path(next(x.rsplit(':',1)[0] for x in mounts if x.endswith(':/scratch')))
assert out.parent==scratch.parent
assert all(os.environ[x]==str(out.parent/'host') for x in ['TMPDIR','TMP','TEMP'])
(scratch/'container-marker').write_text('retained')
(out/Path(args[args.index('--outfile')+1]).name).write_bytes(b'export const fakeBundle=1;\\n')
print('fake builder stdout');print('fake builder stderr',file=sys.stderr)
sys.exit(37 if os.environ.get('FAKE_FAILURE') else 0)
''')
        environment = dict(os.environ, DEFUSS_VM_DOCKER_COMMAND=json.dumps([sys.executable, '-B', str(fake)]),
                           TMPDIR=str(self.work), TMP=str(self.work), TEMP=str(self.work))
        if failure:
            environment['FAKE_FAILURE'] = '1'
        output = self.work / 'bundle.mjs'
        manifest = self.work / 'bundle.build.json'
        output.write_bytes(b'prior bundle'); manifest.write_bytes(b'prior manifest')
        before = set((PROJECT / 'tmp').glob('bundle-*'))
        result = subprocess.run([sys.executable, '-B', str(PROJECT / 'packaging/bundle-bun.py'),
            str(self.bundle), '--project-root', str(PROJECT), '--outfile', str(output),
            '--manifest', str(manifest), '--bundle-only'], cwd=PROJECT, env=environment,
            text=True, capture_output=True)
        scratch, = set((PROJECT / 'tmp').glob('bundle-*')) - before
        return result, output, manifest, scratch

    def test_fake_container_receives_writable_scratch_and_publishes_bundle(self):
        result, output, manifest, scratch = self.fake_bundle()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output.read_bytes(), b'export const fakeBundle=1;\n')
        self.assertEqual(json.loads(manifest.read_bytes())['sha256'], self.new.sha(output))
        self.assertTrue((scratch / 'completed.json').exists())
        self.assertEqual((scratch / 'container/container-marker').read_text(), 'retained')
        self.assertIn('fake builder stdout', (scratch / 'stdout.log').read_text())

    def test_failed_fake_container_keeps_prior_outputs_and_retains_scratch(self):
        result, output, manifest, scratch = self.fake_bundle(failure=True)
        self.assertEqual(result.returncode, 37, result.stderr)
        self.assertEqual(output.read_bytes(), b'prior bundle')
        self.assertEqual(manifest.read_bytes(), b'prior manifest')
        self.assertTrue((scratch / 'failure.json').exists())
        self.assertTrue((scratch / 'bundle/bundle.mjs').exists())
        self.assertIn('fake builder stderr', (scratch / 'stderr.log').read_text())


if __name__ == '__main__':
    unittest.main()
