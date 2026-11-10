"""Build an immutable Linux amd64 Bun-distroless generation for bundle-bun.py."""
import gzip
import hashlib
import json
import os
import shutil
import stat
import tarfile
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
SUPPORT = ROOT / 'bun-app'
ASSETS = ROOT.parent / 'assets/bun/amd64'
IMAGE = 'oven/bun@sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2'
PINS = {
    ASSETS / 'distroless.tar': '6e0c7ba5c87f423422ef4d5cc04f9d089ef9270c602567a8bb06b05902f635f4',
    ASSETS / 'vmlinuz-virt': '8ce908a8cb28d55adcacacf8a16609fa400e07a8826f0084ae5b13b8cb91b9ab',
    ASSETS / 'initramfs-virt': '6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9',
}


def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_record(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(path.parent)


def require_same_filesystem(source, destination):
    if source.stat().st_dev != destination.stat().st_dev:
        raise ValueError('Atomic publication requires project tmp and destination on the same filesystem')


@contextmanager
def project_scratch(prefix, destinations):
    parent = ROOT.parent / 'tmp'
    if parent.is_symlink():
        raise ValueError('Project tmp must not be a symlink')
    parent.mkdir(mode=0o700, exist_ok=True)
    sync_directory(parent.parent)
    scratch = Path(tempfile.mkdtemp(prefix=prefix, dir=parent))
    sync_directory(parent)
    write_record(scratch / 'invocation.json', {
        'schema': 1, 'createdUtc': datetime.now(timezone.utc).isoformat(),
        'pid': os.getpid(), 'destinations': [str(path) for path in destinations],
    })
    try:
        for destination in destinations:
            require_same_filesystem(scratch, destination)
        yield scratch
    except BaseException as error:
        write_record(scratch / 'failure.json', {
            'schema': 1, 'failedUtc': datetime.now(timezone.utc).isoformat(),
            'type': type(error).__name__, 'error': str(error), 'retained': True,
        })
        raise
    else:
        write_record(scratch / 'completed.json', {
            'schema': 1, 'completedUtc': datetime.now(timezone.utc).isoformat(),
            'retained': True,
        })


def publish_file(source, destination):
    require_same_filesystem(source.parent, destination.parent)
    with source.open('rb') as stream:
        os.fsync(stream.fileno())
    source.replace(destination)
    sync_directory(destination.parent)
    sync_directory(source.parent)


def publish_generation(source, destination):
    require_same_filesystem(source.parent, destination.parent)
    for path in source.rglob('*'):
        if path.is_file():
            with path.open('rb') as stream:
                os.fsync(stream.fileno())
    for path in sorted((p for p in source.rglob('*') if p.is_dir()),
                       key=lambda p: len(p.parts), reverse=True):
        sync_directory(path)
    sync_directory(source)
    source.rename(destination)
    sync_directory(destination.parent)
    sync_directory(source.parent)


def unpack_cpio(raw):
    entries, pos = {}, 0
    while pos + 110 <= len(raw):
        header = raw[pos:pos + 110]
        if header[:6] not in (b'070701', b'070702'):
            raise ValueError('Invalid base initramfs cpio')
        fields = [int(header[6 + i * 8:14 + i * 8], 16) for i in range(13)]
        name = raw[pos + 110:pos + 110 + fields[11]].rstrip(b'\0').decode().removeprefix('./')
        start = (pos + 110 + fields[11] + 3) & ~3
        body = raw[start:start + fields[6]]
        pos = (start + fields[6] + 3) & ~3
        if name == 'TRAILER!!!':
            return entries
        entries[name] = (fields[1], fields[2], fields[3], body, fields[9], fields[10])
    raise ValueError('Missing cpio trailer')


def write_cpio(entries, path):
    # Stream into gzip instead of holding another complete rootfs in memory.
    with path.open('wb') as output, gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as stream:
        for ino, (name, (mode, uid, gid, body, major, minor)) in enumerate(entries.items(), 1):
            name = name.encode() + b'\0'
            fields = [ino, mode, uid, gid, 2 if stat.S_ISDIR(mode) else 1, 0, len(body), 0, 0, major, minor, len(name), 0]
            header = b'070701' + ''.join(f'{v:08x}' for v in fields).encode() + name
            stream.write(header + b'\0' * (-len(header) % 4))
            stream.write(body)
            stream.write(b'\0' * (-len(body) % 4))


def package_app(bundle, destination, *, manual_ready=False, runtime_dir=None):
    runtime = Path(runtime_dir) if runtime_dir is not None else ROOT.parent / 'runtime/x86_64'
    for name in ['qemu-system-x86_64.js', 'qemu-system-x86_64.wasm']:
        if not (runtime / name).is_file():
            raise ValueError(f'Missing runtime artifact: {runtime / name}')
    for path, expected in PINS.items():
        if sha(path) != expected:
            raise ValueError(f'Pinned guest asset has changed: {path}')
    destination.mkdir(parents=True, exist_ok=True)
    with project_scratch('package-', [destination]) as scratch:
        stage = scratch / 'generation'
        stage.mkdir(mode=0o700)
        entries = unpack_cpio(gzip.decompress((ASSETS / 'initramfs-virt').read_bytes()))
        entries['init'] = (stat.S_IFREG | 0o755, 0, 0, (SUPPORT / 'init').read_bytes(), 0, 0)
        entries['distroless'] = (stat.S_IFDIR | 0o755, 0, 0, b'', 0, 0)
        with tarfile.open(ASSETS / 'distroless.tar') as tar:
            for member in tar.getmembers():
                relative = PurePosixPath(member.name)
                if relative.is_absolute() or '..' in relative.parts:
                    raise ValueError(f'Invalid image path: {relative}')
                if member.isdir():
                    mode, body = stat.S_IFDIR, b''
                elif member.issym():
                    mode, body = stat.S_IFLNK, member.linkname.encode()
                elif member.isfile():
                    mode, body = stat.S_IFREG, tar.extractfile(member).read()
                else:
                    raise ValueError(f'Unsupported image entry: {member.name}')
                entries['distroless/' + str(relative)] = (mode | (member.mode & 0o7777), member.uid, member.gid, body, 0, 0)
        boot = (SUPPORT / 'boot.mjs').read_bytes()
        if manual_ready:
            boot = boot.removesuffix(b'snapshotReady();\n')
        for name, data in [('app.mjs', bundle.read_bytes()), ('boot.mjs', boot), ('snapshot-ready.mjs', (SUPPORT / 'snapshot-ready.mjs').read_bytes())]:
            entries['distroless/' + name] = (stat.S_IFREG | 0o644, 0, 0, data, 0, 0)
        entries['TRAILER!!!'] = (0, 0, 0, b'', 0, 0)
        write_cpio(entries, stage / 'initramfs.cpio.gz')
        del entries
        shutil.copyfile(bundle, stage / 'app.mjs')
        shutil.copyfile(ASSETS / 'vmlinuz-virt', stage / 'kernel')
        (stage / 'runtime').mkdir()
        for name in ['qemu-system-x86_64.js', 'qemu-system-x86_64.wasm']:
            shutil.copyfile(runtime / name, stage / 'runtime' / name)
        (stage / 'rom').mkdir()
        for name in ['bios-256k.bin', 'kvmvapic.bin', 'linuxboot_dma.bin']:
            shutil.copyfile(ROOT.parent / 'engine/qemu/pc-bios' / name, stage / 'rom' / name)
        artifacts = {str(p.relative_to(stage)): {'sha256': sha(p), 'bytes': p.stat().st_size} for p in sorted(stage.rglob('*')) if p.is_file()}
        spec = {
            'schema': 1, 'os': 'linux', 'architecture': 'amd64', 'image': IMAGE, 'bunVersion': '1.4.4',
            'appSha256': artifacts['app.mjs']['sha256'],
            'vm': {'machine': 'pc,acpi=off', 'cpu': 'max', 'ramMiB': 512, 'smp': 1, 'tbMiB': 128, 'hotLimit': 1500, 'runtimeFlags': 3},
            'snapshot': {'enabled': True, 'protocol': 'com1-ready-v1', 'readyByte': 49, 'readyMode': 'manual' if manual_ready else 'after-module', 'port': '/dev/ttyS0', 'console': '/dev/ttyS1'},
            'artifacts': artifacts,
        }
        compatibility = hashlib.sha256(json.dumps(spec, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        generation = destination / compatibility
        if generation.exists():
            for name, info in artifacts.items():
                if sha(generation / name) != info['sha256']:
                    raise ValueError(f'Existing package generation is damaged: {generation / name}')
        else:
            # Publish the complete immutable generation before switching its manifest.
            publish_generation(stage, generation)
        manifest = {**spec, 'compatibilitySha256': compatibility, 'generation': compatibility}
        temp_manifest = scratch / 'app.json'
        write_record(temp_manifest, manifest)
        temp_manifest.chmod(0o600)
        publish_file(temp_manifest, destination / 'app.json')
        # A matching generation may already exist. Discard only this verified
        # duplicate after successful publication; failed staging is retained.
        if stage.exists():
            shutil.rmtree(stage)
            sync_directory(scratch)
    return destination / 'app.json'
