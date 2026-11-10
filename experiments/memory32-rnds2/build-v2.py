#!/usr/bin/env python3
"""Clean WASM build of the consolidated sources inside the pinned SDK."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from runtime_dependencies import stage_dependencies


SDK = 'registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812'
TARGETS = {'x86_64-softmmu': 'x86_64', 'i386-softmmu': 'i386', 'aarch64-softmmu': 'aarch64'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source', type=Path, default=ROOT / 'engine/qemu',
                        help='Explicit isolated source tree inside this project; default is the retained import')
    parser.add_argument('--targets', default=','.join(TARGETS))
    parser.add_argument('--jobs', type=int, default=8)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    targets = args.targets.split(',')
    if not targets or len(set(targets)) != len(targets) or any(t not in TARGETS for t in targets):
        parser.error('Supported targets: ' + ','.join(TARGETS))
    if not 1 <= args.jobs <= 64:
        parser.error('--jobs must be 1..64')
    output = args.output.resolve()
    if output.exists():
        parser.error('Use a fresh output directory')
    source = args.source.resolve()
    if not source.is_relative_to(ROOT) or not (source / 'configure').is_file():
        parser.error('--source must be a QEMU source tree inside this project')
    if output.is_relative_to(source):
        parser.error('Build output must be outside the source tree')
    link = ['-pthread', '-msimd128', '-sASYNCIFY=1', '-sPROXY_TO_PTHREAD=1',
            '-sFORCE_FILESYSTEM', '-sALLOW_TABLE_GROWTH', '-sTOTAL_MEMORY=2GB',
            '-sWASM_BIGINT', '-sEXPORT_ES6=1', '-sASYNCIFY_IMPORTS=ffi_call_js',
            '-sEXPORTED_RUNTIME_METHODS=addFunction,removeFunction,TTY,FS',
            '-sSTACK_SIZE=1048576', '-sDEFAULT_PTHREAD_STACK_SIZE=1048576',
            '-sSTACK_OVERFLOW_CHECK=2']
    configure = ['emconfigure', str(source / 'configure'), '--static', '--cpu=wasm64', '--wasm64-32bit-address-limit',
                 '--target-list=' + ','.join(targets), '--disable-werror', '--disable-docs',
                 '--disable-tools', '--disable-rust', '--disable-guest-agent', '--disable-plugins',
                 '--disable-download', '--without-default-features', '--enable-tcg',
                 '--disable-tcg-interpreter', '--with-coroutine=wasm',
                 *(['--enable-fdt=internal'] if 'aarch64-softmmu' in targets else []),
                 '-Dc_args=-pthread -msimd128', '-Dc_link_args=' + ' '.join(link), '-Doptimization=2']
    compile_command = ['ninja', '-j' + str(args.jobs),
                       *['qemu-system-' + TARGETS[t] + '.js' for t in targets]]
    report = {'schema': 1, 'memoryProfile': 'MEMORY64=2: i64 C pointers, lowered memory32', 'sdk': SDK, 'source': str(source), 'targets': targets,
              'commands': [configure, compile_command], 'runs': [], 'status': 'planned',
              'scope': 'Fresh source build; imported runtime performance claims do not transfer automatically'}
    if args.dry_run:
        print(json.dumps(report, indent=2)); return
    for tool in ['emconfigure', 'emcc', 'ninja']:
        if not shutil.which(tool): parser.error('Run inside the pinned SDK; missing ' + tool)
    output.mkdir(parents=True)
    build = output / 'build'; build.mkdir()
    report['emccVersion'] = subprocess.check_output(['emcc', '--version'], text=True).strip()
    # QAPI/trace generators must not leave bytecode caches in the source import.
    build_env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    fingerprint = hashlib.sha256()
    for path in sorted(source.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
            fingerprint.update(str(path.relative_to(source)).encode() + b'\0')
            with path.open('rb') as stream:
                fingerprint.update(hashlib.file_digest(stream, 'sha256').digest())
    report['sourceFingerprint'] = fingerprint.hexdigest()
    def save():
        (output / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n')
    report['status'] = 'running'; save()
    try:
        for label, command in [('configure', configure), ('compile', compile_command)]:
            start = time.monotonic()
            with (output / (label + '.log')).open('w') as log:
                result = subprocess.run(command, cwd=build, env=build_env, stdout=log, stderr=subprocess.STDOUT)
            report['runs'].append({'step': label, 'returncode': result.returncode,
                                   'seconds': time.monotonic() - start}); save()
            if result.returncode: raise RuntimeError('Failed ' + label + '; inspect ' + str(output / (label + '.log')))
        for target in targets:
            name = 'qemu-system-' + TARGETS[target]
            runtime = output / 'runtime' / TARGETS[target]; runtime.mkdir(parents=True)
            for suffix in ['js', 'wasm', 'worker.js', 'worker.mjs']:
                artifact = build / (name + '.' + suffix)
                if artifact.exists(): shutil.copyfile(artifact, runtime / artifact.name)
            for script in ['fix-emscripten-poll.py', 'expose-profile.py']:
                subprocess.run([os.sys.executable, str(ROOT / ('experiments/memory32-rnds2' if script == 'expose-profile.py' else 'scripts') / script), str(runtime / (name + '.js'))], check=True)
            stage_dependencies(runtime, ROOT / 'host/browser', output / 'runtime')
        report['artifacts'] = {}
        for path in sorted((output / 'runtime').rglob('*')):
            if path.is_file():
                with path.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                report['artifacts'][str(path.relative_to(output))] = {'sha256': digest, 'bytes': path.stat().st_size}
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', failure=str(error)); raise
    finally:
        save()
    print(json.dumps({'status': report['status'], 'targets': targets, 'output': str(output)}))


if __name__ == '__main__':
    main()
