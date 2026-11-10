#!/usr/bin/env python3
"""Stage the selected candidate runtimes and their corresponding sources for npm."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from runtime_dependencies import stage_dependencies


def identity(path):
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'bytes': path.stat().st_size, 'sha256': digest}


def build():
    scratch = ROOT / 'tmp'
    scratch.mkdir(exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='npm-stage-', dir=scratch))
    package = json.loads((ROOT / 'package.json').read_text())
    baseline = json.loads((ROOT / 'manifests/runtime-selected.json').read_text())
    manifest = {'schema': 1, 'package': package['name'], 'version': package['version'],
                'selection': baseline['selection'], 'configuration': baseline['configuration'],
                'runtimes': {}, 'files': {}}

    def copy(source, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)

    for architecture, runtime in baseline['runtimes'].items():
        manifest['runtimes'][architecture] = {}
        for name, expected in runtime['files'].items():
            source = ROOT / runtime['directory'] / name
            if identity(source) != expected:
                raise ValueError('Runtime differs from selected candidate: ' + name)
            copy(source, stage / 'runtime' / architecture / name)
            data = source.read_bytes()
            manifest['runtimes'][architecture][source.name] = {
                **expected, 'gzipBytes': len(gzip.compress(data, compresslevel=9, mtime=0))}
        stage_dependencies(stage / 'runtime' / architecture, ROOT / 'host/browser', stage / 'runtime')
    for source in (ROOT / 'host/browser').rglob('*'):
        if source.is_file() and source.suffix in {'.mjs', '.wasm'}:
            copy(source, stage / source.relative_to(ROOT))
    for name in ['vm.mjs', 'serial.mjs', 'snapshots.mjs', 'file-store.mjs']:
        copy(ROOT / 'packaging/bun-app' / name, stage / 'packaging/bun-app' / name)
    for name in ['bios-256k.bin', 'kvmvapic.bin', 'linuxboot_dma.bin', 'vgabios-stdvga.bin', 'vgabios-cirrus.bin']:
        copy(ROOT / 'engine/qemu/pc-bios' / name, stage / 'firmware' / name)
    copy(ROOT / 'packaging/npm/index.mjs', stage / 'index.mjs')
    copy(ROOT / 'packaging/npm/README.md', stage / 'README.md')
    for source in (ROOT / 'e2e/licenses').iterdir():
        if source.is_file(): copy(source, stage / 'licenses' / source.name)
    copy(ROOT / 'engine/qemu/pc-bios/README', stage / 'licenses/firmware-README.txt')
    copy(ROOT / 'manifests/runtime-baseline.json', stage / 'runtime-baseline.json')
    copy(ROOT / 'manifests/runtime-selected.json', stage / 'runtime-selected.json')

    # Include the imported source, local build driver, metadata and notices.
    # Git's tracked set includes the explicitly vendored subproject sources.
    names = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT)
    files = sorted(set(os.fsdecode(p) for p in names.split(b'\0') if p))
    archive = stage / 'source.tar.gz'
    with archive.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for name in files:
                path = ROOT / name
                if not path.resolve().is_relative_to(ROOT):
                    raise ValueError('External source link: ' + name)
                info = tar.gettarinfo(str(path), arcname='defuss-qemu/' + name)
                info.mtime = 0
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                if info.isfile():
                    with path.open('rb') as stream: tar.addfile(info, stream)
                else: tar.addfile(info)
    manifest['source'] = {'file': 'source.tar.gz', 'fileCount': len(files), **identity(archive)}
    for path in sorted(stage.rglob('*')):
        if path.is_file(): manifest['files'][path.relative_to(stage).as_posix()] = identity(path)
    manifest['payloadBytes'] = sum(item['bytes'] for item in manifest['files'].values())
    (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    previous = None
    if (ROOT / 'dist').exists():
        previous = Path(tempfile.mkdtemp(prefix='npm-previous-', dir=scratch)) / 'dist'
        (ROOT / 'dist').rename(previous)
    stage.rename(ROOT / 'dist')
    print(json.dumps({'status': 'passed', 'package': package['name'], 'payloadBytes': manifest['payloadBytes'],
                      'runtimes': manifest['runtimes'], 'previous': str(previous) if previous else None}))


if __name__ == '__main__':
    build()
