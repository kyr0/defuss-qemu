#!/usr/bin/env python3
"""Copy an isolated selectable MSG1 source overlay; never change production."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BACKEND = Path('tcg/wasm64/tcg-target.c.inc')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Expected one exact source anchor: ' + old[:100])
    return text.replace(old, new, 1)


def changes(source, mode):
    if mode not in ('switch', 'diagnostic'):
        raise ValueError('Unknown mode')
    diagnostic = mode == 'diagnostic'
    backend = (source / BACKEND).read_text()
    if ('static bool emit_inline_rnds2(' not in backend or
            'emit_m2_msg1' in backend or 'emit_m2_msg2' in backend):
        raise ValueError('Requires the retained RNDS2 base without a MSG1/MSG2 overlay; combined candidates need a separate experiment')
    anchor = 'static void tcg_wasm_out_call(TCGContext *s, intptr_t func,\n'
    header = ('#define DEFUSS_M2_MSG1_DIAGNOSTIC ' + str(int(diagnostic)) + '\n' +
              '#include "m2-sha-msg1-config.c.inc"\n#include "m2-sha-msg1.c.inc"\n\n')
    backend = once(backend, anchor, header + anchor)
    declaration = anchor + '                              const TCGHelperInfo *info)\n{\n'
    backend = once(backend, declaration, declaration + '    bool m2_msg1_on = m2_msg1_enabled();\n')
    call = '    if (emit_inline_rnds2(s, func, info)) {\n'
    backend = once(backend, call, '    if (m2_msg1_on && emit_m2_msg1(s, func, info)) { return; }\n' + call)
    if backend.index('if (wasm44_defer)', backend.index(anchor)) > backend.index('if (m2_msg1_on', backend.index(anchor)):
        raise ValueError('MSG1 must follow deferred-emission guard')
    if diagnostic:
        backend = once(backend, '    int64_t func_idx = get_helper_idx(s, func);',
                       '    if (m2_msg1_matches(func, info)) { m2_msg1_count(s, 2); }\n'
                       '    int64_t func_idx = get_helper_idx(s, func);')
    output = {BACKEND: backend, Path('tcg/wasm64/m2-sha-msg1.c.inc'): (HERE / 'lowering.c.inc').read_text(),
              Path('tcg/wasm64/m2-sha-msg1-config.c.inc'): (HERE / 'config.c.inc').read_text()}
    if diagnostic:
        helper = Path('target/i386/ops_sse.h')
        output[helper] = once((source / helper).read_text(),
            'void helper_sha256msg1(Reg *d, Reg *a, Reg *b)\n{',
            'void helper_sha256msg1(Reg *d, Reg *a, Reg *b)\n{\n    defuss_m2_msg1_banks[0]++;')
        unit = Path('target/i386/tcg/fpu_helper.c')
        counters = '''#include <emscripten.h>
/* Single-vCPU stopped reads/resets only. bank2 is a subset of bank0.
 * This diagnostic build is not an uninstrumented performance candidate. */
uint64_t defuss_m2_msg1_banks[3];
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m2_msg1_counts(int clear);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m2_msg1_counts(int clear)
{
    if (clear) { memset(defuss_m2_msg1_banks, 0, sizeof(defuss_m2_msg1_banks)); }
    return (uintptr_t)defuss_m2_msg1_banks;
}
'''
        output[unit] = once((source / unit).read_text(), '#define SHIFT 0\n#include "ops_sse.h"',
                            counters + '#define SHIFT 0\n#include "ops_sse.h"')
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'engine/qemu')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mode', choices=['switch', 'diagnostic'], required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    patched = changes(source, args.mode)
    if args.check:
        print(json.dumps({'status': 'passed', 'mode': args.mode, 'anchors': len(patched)})); return
    if output.exists() or output == source or source in output.parents or output in source.parents:
        parser.error('Use a fresh independent source output directory')
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, output, symlinks=True)
    records = []
    for path, text in patched.items():
        original = source / path
        (output / path).write_text(text)
        records.append({'path': str(path), 'before': sha(original) if original.exists() else None, 'after': sha(output / path)})
    manifest = {'schema': 1, 'experiment': 'm2-sha-msg1', 'mode': args.mode,
        'kind': 'diagnostic-only' if args.mode == 'diagnostic' else 'uninstrumented',
        'source': str(source), 'output': str(output), 'changes': records,
        'inputs': {p.name: sha(p) for p in [Path(__file__), HERE / 'lowering.c.inc', HERE / 'config.c.inc']},
        'configAbi': 1, 'defaultEnabled': False, 'selection': 'One atomic pre-translation selection; generated translations cannot change mode',
        'contract': 'Exact sha256msg1 helper only; save original b[0], preserve sequential stores, ordinary helper argument allocator and retained RNDS2/PSHUFB',
        'guestValidation': 'not run by preparation', 'productionDefaultChanged': False}
    path = output.parent / (output.name + '-m2-msg1-overlay.json')
    with path.open('x') as stream:
        json.dump(manifest, stream, indent=2); stream.write('\n')
    print(json.dumps({'source': str(output), 'manifest': str(path), 'mode': args.mode}))


if __name__ == '__main__':
    main()
