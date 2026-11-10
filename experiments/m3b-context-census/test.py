#!/usr/bin/env python3
"""Actual census adapter/API and extracted dispatcher host checks; not QEMU."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def write(path, data):
    if isinstance(data, str):
        data = data.encode()
    with path.open('xb') as f:
        f.write(data); f.flush(); os.fsync(f.fileno())


def identity(path):
    data = path.read_bytes()
    return {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


def function(text, name):
    match = re.search(r'^static[^\n]*\b' + re.escape(name) + r'\([^;{}]*\)\n\{.*?^\}', text, re.S | re.M)
    if not match:
        raise AssertionError('Missing actual source function ' + name)
    return match[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--cc', default=os.environ.get('CC', 'clang'))
    parser.add_argument('--sysroot', default=os.environ.get('SDKROOT'))
    args = parser.parse_args()
    output = args.report.resolve()
    if not output.is_relative_to(ROOT / 'artifacts') or output.exists():
        raise SystemExit('Fresh report below project/artifacts required')
    output.parent.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('m3cc_prepare', HERE / 'prepare.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    patched = module.patch_files(module.BASE)
    runtime = patched[Path('tcg/wasm64.c')]
    compiled = function(patched[Path('tcg/m3-region-adapter.inc')], 'm3_call_wasm_tb')
    assert compiled.count('m3cc_note(') == 1
    assert compiled.index('decision == M3_REDISPATCH') < compiled.index('m3cc_note(') < compiled.rindex('return call_wasm_tb(')
    assert runtime.count('m3cc_note(env, ctx.tb_ptr, M3CC_OUTER_TCI);') == 2
    assert runtime.count('m3b_note_tier(false);\n            m3cc_note(env, ctx.tb_ptr, M3CC_OUTER_TCI);') == 2
    assert function(runtime, 'init_wasm').startswith('static void init_wasm(void)\n{\n    m3cc_lock();')
    start = runtime.index('        case INDEX_op_goto_tb:')
    end = runtime.index('        case INDEX_op_qemu_ld:', start)
    gotos = runtime[start:end]
    for case, site in [('goto_tb', 'M3CC_GOTO_TB_TCI'), ('goto_ptr', 'M3CC_GOTO_PTR_TCI')]:
        piece = gotos.split('        case INDEX_op_' + case + ':', 1)[1].split('        case ', 1)[0]
        assert piece.count('m3cc_note(') == 1
        assert piece.index('if (m3b_fused(') < piece.index('if (inc_counter(') < piece.index('m3cc_note(') < piece.index('get_tci_ptr(')
    for name in ['reserve_instance', 'remove_old_instances', 'check_gc_completion', 'trysleep']:
        assert function(runtime, name) == function((module.BASE / 'tcg/wasm64.c').read_text(), name)
    scratch = Path(tempfile.mkdtemp(prefix='cc-', dir=ROOT / 'tmp'))
    write(scratch / 'compiled-extract.h', compiled + '\n')
    write(scratch / 'goto-extract.h', gotos)
    constants = []
    sources = [module.BASE / 'target/i386/cpu.h', module.BASE / 'include/exec/translation-block.h']
    for source in sources:
        for line in source.read_text().splitlines():
            if re.match(r'^#define (HF_[A-Z0-9_]+|CF_[A-Z0-9_]+|TF_MASK|IF_MASK|IOPL_MASK|RF_MASK|VM_MASK|AC_MASK)\s', line):
                constants.append(line)
    write(scratch / 'source-constants.h', '\n'.join(constants) + '\n')
    for origin, dest in module.COPIES.items():
        write(scratch / Path(dest).name, (HERE / origin).read_bytes())
    compiler = shlex.split(args.cc)
    if not compiler or not shutil.which(compiler[0]):
        raise SystemExit('A native compiler is required')
    compiler[0] = shutil.which(compiler[0])
    sysroot = args.sysroot
    fallback = Path('/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk')
    if not sysroot and platform.system() == 'Darwin' and fallback.is_dir():
        sysroot = str(fallback)
    command = compiler + ['-std=gnu11', '-Wall', '-Wextra', '-Werror', '-O1',
                          '-fsanitize=address,undefined', '-fno-omit-frame-pointer']
    if sysroot:
        if not Path(sysroot).is_dir():
            raise SystemExit('Existing SDKROOT/sysroot required')
        command += ['-isysroot', sysroot]
    binary = scratch / 'adapter-contract'
    command += ['-I', str(HERE), '-I', str(scratch), str(HERE / 'test-adapter.c'), '-o', str(binary)]
    report = {'schema': 1, 'kind': 'm3b-context-census-host-contract', 'status': 'failed',
              'runtimeValidation': 'none', 'scratch': str(scratch), 'compileArgv': command,
              'sourceInputs': {str(p.relative_to(ROOT)): identity(p) for p in
                  [HERE / n for n in ['prepare.py', 'core.h', 'adapter.inc', 'injection.inc', 'test-adapter.c', 'test.py']] + sources +
                  [module.BASE / p for p in patched] +
                  [ROOT / 'experiments/m3a-region/m3-region-core.h', ROOT / 'experiments/m3b-fallthrough/core.h']},
              'extracted': {p.name: identity(p) for p in scratch.iterdir()}, 'commands': []}
    env = dict(os.environ, TMPDIR=str(scratch), TMP=str(scratch), TEMP=str(scratch))
    try:
        for label, argv in [('compile', command), ('run', [str(binary)])]:
            print(json.dumps({'step': label, 'argv': argv, 'scratch': str(scratch)}), flush=True)
            result = subprocess.run(argv, cwd=ROOT, env=env, capture_output=True, timeout=90)
            write(scratch / (label + '.stdout'), result.stdout); write(scratch / (label + '.stderr'), result.stderr)
            print(result.stdout.decode(errors='replace'), end=''); print(result.stderr.decode(errors='replace'), end='')
            report['commands'].append({'step': label, 'argv': argv, 'returncode': result.returncode,
                'stdout': identity(scratch / (label + '.stdout')), 'stderr': identity(scratch / (label + '.stderr'))})
            if result.returncode:
                raise RuntimeError(f'{label} returned {result.returncode}')
        report['sourceRecheck'] = {name: identity(ROOT / name) for name in report['sourceInputs']}
        if report['sourceRecheck'] != report['sourceInputs']:
            raise RuntimeError('Source changed during host contract')
        report['status'] = 'passed'
    except Exception as exc:
        report['failure'] = repr(exc)
        raise
    finally:
        write(output, json.dumps(report, indent=2) + '\n')
        fd = os.open(output.parent, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)


if __name__ == '__main__':
    main()
