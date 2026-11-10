#!/usr/bin/env python3
"""Derive small real guest acceptance fixtures without changing the original media."""
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'packaging'))
from bun_app_package import unpack_cpio, write_cpio


def identity(path):
    return {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


if __name__ == '__main__':
    output = ROOT / 'assets/acceptance-01'
    output.mkdir()
    source = ROOT / 'assets/freedos/x86BOOT.img'
    disk = output / 'freedos.img'
    shutil.copyfile(source, disk)
    batch = output / 'fdauto.bat'
    batch.write_bytes(b'@ECHO OFF\r\nPATH=A:\\FREEDOS\\BIN\r\nVER\r\nECHO DEFUSS_FREEDOS_READY\r\n')
    config = output / 'fdconfig.sys'
    config.write_bytes(b'DOS=LOW\r\nFILES=20\r\nBUFFERS=20\r\nSHELL=A:\\FREEDOS\\BIN\\COMMAND.COM A:\\FREEDOS\\BIN /E:1024 /P=A:\\FDAUTO.BAT\r\n')
    for file, name in [(batch, 'FDAUTO.BAT'), (config, 'FDCONFIG.SYS')]:
        subprocess.run(['mcopy', '-o', '-i', str(disk), str(file), '::' + name], check=True)
    initramfs = ROOT / 'assets/bun/amd64/initramfs-virt'
    entries = unpack_cpio(gzip.decompress(initramfs.read_bytes()))
    script = b'''#!/bin/busybox sh
/bin/busybox --install -s /bin
mount -t devtmpfs devtmpfs /dev
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mkdir -p /tmp
echo DEFUSS_BUSYBOX_START
busybox | head -n 1
uname -m
printf 'busybox-file-ok\\n' > /tmp/defuss.txt
test "$(cat /tmp/defuss.txt)" = busybox-file-ok || exit 1
echo DEFUSS_BUSYBOX_READY
exec /bin/sh
'''
    entries['init'] = (stat.S_IFREG | 0o755, 0, 0, script, 0, 0)
    for name in ['dev', 'proc', 'sys', 'tmp']:
        entries.setdefault(name, (stat.S_IFDIR | 0o755, 0, 0, b'', 0, 0))
    entries['dev/console'] = (stat.S_IFCHR | 0o600, 0, 0, b'', 5, 1)
    entries['TRAILER!!!'] = (0, 0, 0, b'', 0, 0)
    write_cpio(entries, output / 'busybox.cpio.gz')
    manifest = {'inputs': {str(p.relative_to(ROOT)): identity(p) for p in [source, initramfs]},
                'files': {p.name: identity(p) for p in output.iterdir() if p.is_file()}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'output': str(output)}))
