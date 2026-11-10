#!/usr/bin/env python3
"""Prepare a fresh diagnostic census extension; never edit frozen M3b source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASE = ROOT / 'artifacts/m3b-source-01/source'
BASE_FINGERPRINT = 'b458c012278728289c39b971bb0a7d01fc2a15411eebb4124399d3d72d2551b1'
COPIES = {'core.h': 'tcg/m3cc-core.h', 'adapter.inc': 'tcg/m3cc-adapter.inc',
          'injection.inc': 'tcg/m3cc-injection.inc'}


def replace(text, old, new, count=1):
    if text.count(old) != count:
        raise RuntimeError(f'Anchor count {text.count(old)} != {count}: {old[:100]}')
    return text.replace(old, new)


def patch_files(source):
    out = {}
    path = Path('tcg/wasm64.c')
    s = (source / path).read_text()
    s = replace(s, '#include "m3-region-adapter.inc"',
                '#include "m3cc-core.h"\n'
                'static void m3cc_note(CPUArchState *, void *, unsigned);\n'
                '#include "m3-region-adapter.inc"')
    s = replace(s, 'static void init_wasm(void)\n{\n',
                'static void init_wasm(void)\n{\n    m3cc_lock();\n')
    s = replace(s, '            m3b_note_tier(false);\n',
                '            m3b_note_tier(false);\n'
                '            m3cc_note(env, ctx.tb_ptr, M3CC_OUTER_TCI);\n', 2)
    a = s.index('        case INDEX_op_goto_tb:')
    b = s.index('        case INDEX_op_goto_ptr:', a)
    c = s.index('        case INDEX_op_qemu_ld:', b)
    goto_tb = replace(s[a:b], '                (void)m3b_boundary_before(env, tb_ptr, false);',
                      '                m3cc_note(env, (void *)tb_ptr, M3CC_GOTO_TB_TCI);\n'
                      '                (void)m3b_boundary_before(env, tb_ptr, false);')
    goto_ptr = replace(s[b:c], '            (void)m3b_boundary_before(env, tb_ptr, false);',
                       '            m3cc_note(env, (void *)tb_ptr, M3CC_GOTO_PTR_TCI);\n'
                       '            (void)m3b_boundary_before(env, tb_ptr, false);')
    s = s[:a] + goto_tb + goto_ptr + s[c:]
    out[path] = s
    path = Path('tcg/m3-region-adapter.inc')
    s = (source / path).read_text()
    s = replace(s, '    return call_wasm_tb(f, context);\n}',
                '    m3cc_note(context->env, context->tb_ptr, M3CC_COMPILED);\n'
                '    return call_wasm_tb(f, context);\n}')
    out[path] = s
    path = Path('tcg/m3b-runtime-head.inc')
    s = (source / path).read_text()
    s = replace(s, '#include "m3b-runtime-boundary.inc"\n',
                '#include "m3b-runtime-boundary.inc"\n#include "m3cc-adapter.inc"\n')
    out[path] = s
    return out


def identity(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint(source):
    digest = hashlib.sha256()
    count = 0
    for path in sorted(source.rglob('*')):
        if not path.is_file() or '__pycache__' in path.parts or path.suffix == '.pyc':
            continue
        name = path.relative_to(source).as_posix()
        digest.update(name.encode() + b'\0')
        digest.update(hashlib.sha256(path.read_bytes()).digest())
        count += 1
    return digest.hexdigest(), count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=BASE)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if source != BASE.resolve() or not output.is_relative_to(ROOT / 'artifacts'):
        raise SystemExit('Use the frozen M3b base and a fresh artifact output')
    manifest = output.parent / (output.name + '-m3b-census-overlay.json')
    if output.exists() or manifest.exists() or source in output.parents or output in source.parents:
        raise SystemExit('Output/manifest must be fresh and isolated')
    before, count = fingerprint(source)
    if before != BASE_FINGERPRINT:
        raise SystemExit('Frozen base fingerprint mismatch')
    patched = patch_files(source)
    if args.check:
        print(json.dumps({'status': 'anchors-passed', 'patched': list(map(str, patched)),
                          'copied': COPIES, 'runtimeValidation': 'none'}, indent=2))
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, output, symlinks=True)
    if fingerprint(source) != (before, count) or fingerprint(output) != (before, count):
        raise RuntimeError('Source/copy drift; incomplete output retained')
    changes = []
    for path, text in patched.items():
        with (output / path).open('w') as f:
            f.write(text); f.flush(); os.fsync(f.fileno())
        changes.append({'path': str(path), 'before': identity(source / path),
                        'after': identity(output / path)})
    for name, destination in COPIES.items():
        with (output / destination).open('x') as f:
            f.write((HERE / name).read_text()); f.flush(); os.fsync(f.fileno())
        changes.append({'path': destination, 'before': None, 'after': identity(output / destination)})
    report = {'schema': 1, 'kind': 'm3b-context-census-incremental-overlay',
              'base': str(source), 'baseFingerprint': before, 'baseFiles': count,
              'source': str(output), 'changes': changes,
              'generatorSha256': identity(Path(__file__)),
              'diagnosticExtensions': ['context-entry-census-v1', 'generation-specific-injection-v1'],
              'censusAbi': {'version': 1, 'words': 2400, 'slots': 4},
              'defaultEnabled': False, 'timingEligible': False, 'runtimeValidation': 'none'}
    with manifest.open('x') as f:
        json.dump(report, f, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
    fd = os.open(output.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    print(json.dumps({'status': 'prepared', 'source': str(output), 'manifest': str(manifest)}))


if __name__ == '__main__':
    main()
