#!/usr/bin/env python3
"""Build the isolated MSG1 ISA fixture inside the pinned Linux amd64 SDK."""
import argparse
import datetime
import gzip
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location('bun_app_package', ROOT/'packaging/bun_app_package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)
SDK = 'registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT/'artifacts') or output.exists():
        parser.error('Use a fresh output directory under project artifacts/')
    output.mkdir(parents=True)
    report = {'schema': 1, 'status': 'running', 'fixtureContract': 'msg1-isa-v1',
        'sdkRequired': SDK, 'instruction': 'sha256msg1', 'modes': 7, 'checksPerMode': 4096,
        'totalChecks': 28672, 'successfulInstructions': 32768,
        'expectedInstructionCounts': [4096] * 6 + [8192],
        'memoryFault': {'warmup': 4096, 'faults': 1, 'successfulFaultingInstructions': 0,
            'source': 'm128 crosses PROT_NONE in last eight bytes; b[0] remains readable',
            'checks': ['exact PC', 'exact fault address', 'SEGV_ACCERR', 'saved/restored YMM0-2',
                       'flags', 'preceding side effect once']},
        'scope': 'ISA fixture source/build evidence; not an unchanged Bun workload or a guest execution result'}
    try:
        scratch = ROOT/'tmp'
        if scratch.is_symlink():
            raise ValueError('Project tmp must not be a symlink')
        scratch.mkdir(exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix='msg1-guest-', dir=scratch))
        environment = dict(os.environ, TMPDIR=str(work), TMP=str(work), TEMP=str(work), PYTHONDONTWRITEBYTECODE='1')
        report['scratch'] = {'path': str(work.relative_to(ROOT)), 'retained': True}
        report['startedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        source = output/'guest-fixture.c'
        shutil.copyfile(HERE/'guest-fixture.c', source)
        base = ROOT/'assets/bun/amd64/initramfs-virt'
        if package.sha(base) != package.PINS[base]:
            raise ValueError('Base initramfs identity changed')
        report['inputHashes'] = {str(p.relative_to(ROOT)): package.sha(p) for p in
            [HERE/'guest-fixture.c', Path(__file__), ROOT/'packaging/bun_app_package.py', base]}
        target = subprocess.check_output(['gcc', '-dumpmachine'], env=environment, text=True).strip()
        if not target.startswith('x86_64') or 'linux' not in target:
            raise ValueError('Use the pinned Linux amd64 SDK; compiler target is ' + target)
        report['compilerTarget'] = target
        report['compilerVersion'] = subprocess.check_output(['gcc', '--version'], env=environment, text=True).strip()
        command = ['gcc', '-O2', '-static', '-mavx2', '-msha', '-mno-red-zone',
                   '-fno-tree-vectorize', '-fno-tree-slp-vectorize', str(source), '-o', str(output/'fixture')]
        report['command'] = command
        package.write_record(output/'build-request.json', report)
        with (output/'compile.log').open('x') as log:
            subprocess.run(command, env=environment, check=True, stdout=log, stderr=subprocess.STDOUT)
        disassembly = subprocess.check_output(['objdump', '-d', str(output/'fixture')], env=environment, text=True)
        (output/'fixture.disassembly.txt').write_text(disassembly)
        sites = [line.strip() for line in disassembly.splitlines() if re.search(r'\bsha256msg1\b', line)]
        if len(sites) != 8 or re.search(r'\bsha256msg2\b', disassembly):
            raise ValueError('Expected seven MSG1 forms plus one fault/warmup PC, with no MSG2 opcode')
        report['staticInstructions'] = {'sha256msg1': 8, 'sha256msg2': 0, 'sites': sites,
            'disassemblySha256': package.sha(output/'fixture.disassembly.txt')}
        entries = package.unpack_cpio(gzip.decompress(base.read_bytes()))
        init = b'''#!/bin/busybox sh
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
/fixture || echo FIXTURE_FAIL:exit-$?
poweroff -f
while :; do sleep 1; done
'''
        entries['init'] = (stat.S_IFREG|0o755, 0, 0, init, 0, 0)
        entries['fixture'] = (stat.S_IFREG|0o755, 0, 0, (output/'fixture').read_bytes(), 0, 0)
        entries['TRAILER!!!'] = (0, 0, 0, b'', 0, 0)
        package.write_cpio(entries, output/'initramfs.cpio.gz')
        for path, digest in report['inputHashes'].items():
            if package.sha(ROOT/path) != digest:
                raise ValueError('Input changed during build: ' + path)
        report.update(status='passed', binarySha256=package.sha(output/'fixture'),
                      initramfsSha256=package.sha(output/'initramfs.cpio.gz'))
    except Exception as error:
        report.update(status='failed', failure=str(error))
        raise
    finally:
        package.write_record(output/'build-report.json', report)
    print(json.dumps({'status': report['status'], 'output': str(output)}))


if __name__ == '__main__':
    main()
