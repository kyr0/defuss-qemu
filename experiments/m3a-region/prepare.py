#!/usr/bin/env python3
"""Create an isolated one-TB region overlay, preserving baseline source/runtime."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace(text, old, new, count=1):
    if text.count(old) != count:
        raise RuntimeError(f"Source anchor mismatch ({text.count(old)} != {count}): {old[:100]}")
    return text.replace(old, new)


def patch_files(source):
    outputs = {}
    path = Path('tcg/wasm64.h')
    text = (source / path).read_text()
    text = replace(text, '#define TCG_WASM_H\n', '#define TCG_WASM_H\n#include "m3-region-core.h"\n')
    text = replace(text, 'struct WasmInstanceInfo {\n', 'struct WasmInstanceInfo {\n    uint64_t m3_generation;\n')
    text = replace(text, 'struct WasmTBHeader {\n', 'struct WasmTBHeader {\n    struct m3_descriptor m3;\n')
    text = replace(text, 'void defuss_note_emission(unsigned size, unsigned insns);',
                   'void defuss_m3_publish(struct TranslationBlock *tb, uint64_t pc);\n'
                   'void defuss_m3_invalidated(struct TranslationBlock *tb);\n'
                   'void defuss_m3_flushed(void);\n'
                   'uintptr_t defuss_m3_redispatch(CPUArchState *env, void *code);\n\n'
                   'void defuss_note_emission(unsigned size, unsigned insns);')
    outputs[path] = text

    path = Path('tcg/wasm64/tcg-target.c.inc')
    text = (source / path).read_text()
    text = replace(text, '    h = (struct WasmTBHeader *)(s->code_ptr);\n',
                   '    h = (struct WasmTBHeader *)(s->code_ptr);\n'
                   '    memset(&h->m3, 0, sizeof(h->m3));\n')
    outputs[path] = text

    path = Path('tcg/tcg.c')
    text = (source / path).read_text()
    text = replace(text, '    i = tcg_out_tb_end(s);\n    if (i < 0) {\n        return i;\n    }\n',
                   '    i = tcg_out_tb_end(s);\n    if (i < 0) {\n        return i;\n    }\n'
                   '    defuss_m3_publish(tb, pc_start);\n')
    outputs[path] = text

    path = Path('tcg/wasm64.c')
    text = (source / path).read_text()
    text = replace(text, '/* Configuration is fixed before starting vCPU workers.',
                   '#include "m3-region-adapter.inc"\n\n'
                   '/* Configuration is fixed before starting vCPU workers.')
    text = replace(text, '    instances[instances_end].tb_func = tb_func;\n',
                   '    instances[instances_end].m3_generation = ((struct WasmTBHeader *)tb_ptr)->m3.generation;\n'
                   '    m3_note(M3_INSTANCE_INSTALLS);\n'
                   '    instances[instances_end].tb_func = tb_func;\n')
    text = replace(text, '        instances[instances_begin].tb_ptr = NULL;\n',
                   '        instances[instances_begin].m3_generation = 0;\n'
                   '        m3_note(M3_INSTANCE_RETIRES);\n'
                   '        instances[instances_begin].tb_ptr = NULL;\n')
    text = replace(text, '    if (elm->tb_ptr != tb_ptr) {\n',
                   '    const struct m3_descriptor *descriptor = &((struct WasmTBHeader *)tb_ptr)->m3;\n'
                   '    bool stale_generation = m3_enabled() && m3_known(descriptor) &&\n'
                   '        elm->m3_generation != descriptor->generation;\n'
                   '    if (stale_generation) { m3_note(M3_STALE_INSTANCE_MISSES); }\n'
                   '    if (elm->tb_ptr != tb_ptr || stale_generation) {\n')
    text = replace(text, 'static void init_wasm(void)\n{\n',
                   'static void init_wasm(void)\n{\n'
                   '    m3_lock_configuration(&m3_words[12], m3_atomic_load, m3_atomic_cas);\n')
    text = replace(text, '            res = call_wasm_tb(tb_func, &ctx);',
                   '            res = m3_call_wasm_tb(tb_func, &ctx);', count=2)
    outputs[path] = text

    path = Path('accel/tcg/tb-maint.c')
    text = (source / path).read_text()
    text = replace(text, '#include "tcg/tcg.h"\n',
                   '#include "tcg/tcg.h"\n'
                   '#if defined(__EMSCRIPTEN__) && !defined(CONFIG_TCG_INTERPRETER)\n'
                   '#include "tcg/wasm64.h"\n#endif\n')
    text = replace(text, '    tcg_region_reset_all();\n',
                   '#if defined(__EMSCRIPTEN__) && !defined(CONFIG_TCG_INTERPRETER)\n'
                   '    defuss_m3_flushed();\n#endif\n    tcg_region_reset_all();\n')
    text = replace(text, '    qatomic_set(&tb->cflags, tb->cflags | CF_INVALID);\n    qemu_spin_unlock(&tb->jmp_lock);\n',
                   '    qatomic_set(&tb->cflags, tb->cflags | CF_INVALID);\n    qemu_spin_unlock(&tb->jmp_lock);\n'
                   '#if defined(__EMSCRIPTEN__) && !defined(CONFIG_TCG_INTERPRETER)\n'
                   '    defuss_m3_invalidated(tb);\n#endif\n')
    outputs[path] = text

    path = Path('accel/tcg/translate-all.c')
    text = (source / path).read_text()
    text = replace(text, '#include "wasm-plan.inc"\n', '#include "wasm-plan.inc"\n\n'
                   '/* Before the first guest operation, use the established requested-exit\n'
                   ' * encoding/synchronization contract, as wasm44_retier does. */\n'
                   'uintptr_t defuss_m3_redispatch(CPUArchState *env, void *code)\n'
                   '{\n'
                   '    TranslationBlock *tb = tcg_tb_lookup((uintptr_t)code);\n'
                   '    g_assert(tb && tb->tc.ptr == code);\n'
                   '    if (!(tb_cflags(tb) & CF_INVALID)) { tb_phys_invalidate(tb, -1); }\n'
                   '    cpu_exit(env_cpu(env));\n'
                   '    return (uintptr_t)tcg_splitwx_to_rx(tb) | TB_EXIT_REQUESTED;\n'
                   '}\n')
    outputs[path] = text
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=PROJECT / 'engine/qemu')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if not output.is_relative_to(PROJECT / 'artifacts'):
        raise SystemExit('Output must be under defuss-vm/artifacts')
    patched = patch_files(source)
    if args.check:
        print(json.dumps({'status':'passed', 'anchors':list(map(str, patched))}, indent=2))
        return
    if output == source or output in source.parents or source in output.parents:
        raise SystemExit('Source and output must be separate trees')
    if output.exists():
        raise SystemExit('Output exists; choose a fresh output directory')
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, output, symlinks=True)
    changes = []
    for path, text in patched.items():
        (output / path).write_text(text)
        changes.append({'path':str(path), 'before':sha(source / path), 'after':sha(output / path)})
    for name, destination in [('m3-region-core.h','tcg/m3-region-core.h'),
                              ('adapter.inc','tcg/m3-region-adapter.inc'),
                              ('test-injection.inc','tcg/m3-region-test.inc')]:
        shutil.copyfile(HERE / name, output / destination)
        changes.append({'path':destination, 'before':None, 'after':sha(output / destination)})
    manifest = {'schema':1, 'kind':'one-TB-region-infrastructure-experiment', 'source':str(source),
                'output':str(output), 'changes':changes, 'generatorSha256':sha(Path(__file__)),
                'abi':1, 'defaultEnabled':False, 'fusion':False, 'validatedGuest':'none',
                'testCompanion':'Stopped-only exact watched static user-PC fault injection; no pending hot-path request',
                'recovery':'Unmodified QEMU TCI instruction-search/Asyncify path',
                'lifetime':'Existing TB allocation and instance ring; no independent executable cache'}
    manifest_path = output.parent / (output.name + '-m3-overlay.json')
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'source':str(output), 'manifest':str(manifest_path)}, indent=2))


if __name__ == '__main__':
    main()
