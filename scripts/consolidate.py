#!/usr/bin/env python3
"""One-time, audited import from the retained experiment workspace.

Normal builds do not use this importer or the original workspace.
Refuse to overwrite a previously imported source tree.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    if path.is_symlink() and path.is_dir():
        return hashlib.sha256(str(path.readlink()).encode()).hexdigest()
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace', type=Path)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    source = workspace / 'native-build/qemu-11.1.3-wasm'
    overlay = workspace / 'native-build/bun-inline/rnds2/source'
    destination = ROOT / 'engine/qemu'
    if destination.exists():
        parser.error('engine/qemu already exists; preserve the existing import')
    report = {'schema': 1, 'source': str(source), 'overlay': str(overlay),
              'selection': 'Validated RNDS2 production overlay, including direct PSHUFB',
              'files': {}, 'excluded': {}, 'metadataEdits': {}}
    arches = {p.name for p in (source / 'target').iterdir() if p.is_dir()}
    unsupported = arches - {'arm', 'i386'}
    hw_unsupported = unsupported | {'sparc64'}
    user_keep = {'aarch64', 'arm', 'i386', 'x86_64', 'include'}
    user_arches = {p.name for p in (source / 'linux-user').iterdir()
                   if p.is_dir() and p.name not in user_keep}
    native_tcg = {p.name for p in (source / 'tcg').iterdir()
                  if p.is_dir() and p.name not in {'wasm64', 'tci'}}
    firmware_removed = {
        'openbios-sparc32', 'openbios-sparc64', 'openbios-ppc', 'QEMU,tcx.bin',
        'QEMU,cgthree.bin', 's390-ccw.img', 'slof.bin', 'skiboot.lid',
        'pnv-pnor.bin', 'palcode-clipper', 'u-boot.e500', 'u-boot-sam460.bin',
        'qemu_vga.ndrv', 'hppa-firmware.img', 'hppa-firmware64.img',
        'opensbi-riscv32-generic-fw_dynamic.bin',
        'opensbi-riscv64-generic-fw_dynamic.bin', 'vof.bin', 'vof-nvram.bin',
        'qemu-nsis.bmp',
    }

    def exclusion(rel):
        parts = rel.parts
        if any(p in {'.git', '__pycache__', '.pytest_cache', '.DS_Store'} for p in parts):
            return 'VCS or local cache'
        if parts[0] in {'.github', '.gitlab', '.gitlab-ci.d'}:
            return 'Upstream CI infrastructure'
        if parts[0] == 'roms' and len(parts) > 2:
            return 'External firmware project source; prebuilt selected blobs retained'
        if parts[0] == 'target' and len(parts) > 1 and parts[1] in unsupported:
            if rel.name == 'Kconfig':
                return None
            return 'Unsupported guest ISA'
        if parts[0] == 'hw' and len(parts) > 1 and parts[1] in hw_unsupported:
            if rel.name == 'Kconfig':
                return None  # Shared device symbols still reference this metadata.
            return 'Unsupported machine architecture (Kconfig symbols retained)'
        if parts[0] == 'tcg' and len(parts) > 1 and parts[1] in native_tcg:
            return 'Native host TCG backend; execution target is WASM'
        if parts[0] == 'bsd-user' and rel.name != 'meson.build':
            return 'BSD user personality outside product scope'
        if parts[0] == 'linux-user' and len(parts) > 1 and parts[1] in user_arches:
            return 'Unsupported Linux guest ABI'
        if parts[:2] == ('tests', 'tcg') and len(parts) > 2 and parts[2] in unsupported:
            return 'Tests for unsupported guest ISA'
        if parts[:2] == ('tests', 'lcitool'):
            return 'Upstream multi-platform CI provisioning'
        if parts[0] == 'pc-bios':
            if len(parts) > 1 and parts[1] == 'dtb':
                return 'Device trees for removed machine architectures'
            if rel.name in firmware_removed or any(x in rel.name for x in ('riscv', 'loongarch')):
                return 'Firmware for unsupported guest architecture'
        return None

    for original in sorted(source.rglob('*')):
        if not original.is_file() and not original.is_symlink():
            continue
        rel = original.relative_to(source)
        reason = exclusion(rel)
        if reason:
            report['excluded'][str(rel)] = {'reason': reason, 'bytes': original.lstat().st_size}
            continue
        selected = overlay / rel if (overlay / rel).is_file() else original
        target = destination / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if selected.is_symlink():
            resolved = selected.resolve(strict=True)
            if not resolved.is_relative_to(source.resolve()) or exclusion(resolved.relative_to(source.resolve())):
                report['excluded'][str(rel)] = {'reason': 'Link to excluded source', 'bytes': selected.lstat().st_size}
                continue
            target.symlink_to(selected.readlink())
        else:
            shutil.copy2(selected, target)
        report['files'][str(rel)] = {
            'origin': str(selected.relative_to(workspace)), 'sha256': sha(selected),
            'bytes': selected.lstat().st_size,
            **({'symlink': str(selected.readlink())} if selected.is_symlink() else {}),
            **({'baseSha256': sha(original)} if selected != original else {}),
        }

    def edit(name, transform):
        path = destination / name
        before = path.read_text()
        after = transform(before)
        if before != after:
            path.write_text(after)
            report['metadataEdits'][name] = {'importedSha256': report['files'][name]['sha256'],
                                           'sha256': sha(path)}

    edit('target/meson.build', lambda s: re.sub(r"^subdir\('(.*?)'\).*$", lambda m:
         m[0] if m[1] in {'arm', 'i386'} else '', s, flags=re.M))
    edit('hw/meson.build', lambda s: re.sub(r"^subdir\('(.*?)'\).*$", lambda m:
         '' if m[1] in hw_unsupported else m[0], s, flags=re.M))
    def prune_trace_list(s):
        excluded = {f'hw/{arch}' for arch in hw_unsupported} | {f'target/{arch}' for arch in unsupported}
        lines = []
        for line in s.splitlines():
            match = re.fullmatch(r"\s*'([^']+)',?\s*", line)
            if match and any(match[1] == prefix or match[1].startswith(prefix + '/') for prefix in excluded):
                continue
            lines.append(line)
        return '\n'.join(lines) + '\n'
    edit('meson.build', prune_trace_list)
    edit('linux-user/meson.build', lambda s: re.sub(r"^subdir\('(.*?)'\).*$", lambda m:
         '' if m[1] in user_arches else m[0], s, flags=re.M))
    edit('bsd-user/meson.build', lambda s: "# defuss-vm supports Linux userspace only.\nif have_bsd_user\n  error('BSD user mode is outside defuss-vm scope')\nendif\n")
    for name in ['pc-bios/meson.build', 'pc-bios/descriptors/meson.build']:
        edit(name, lambda s: '\n'.join(line for line in s.splitlines()
             if not any("'" + item + "'" in line for item in firmware_removed)
             and not any(x in line for x in ('edk2-riscv', 'edk2-loongarch', "subdir('dtb')"))) + '\n')

    report['totals'] = {
        'keptFiles': len(report['files']), 'excludedFiles': len(report['excluded']),
        'importedBytes': sum(f['bytes'] for f in report['files'].values()),
        'excludedBytes': sum(f['bytes'] for f in report['excluded'].values()),
    }
    out = ROOT / 'manifests/qemu-import.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['totals'], indent=2))


if __name__ == '__main__':
    main()
