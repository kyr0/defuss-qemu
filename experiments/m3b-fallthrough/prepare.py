#!/usr/bin/env python3
"""Prepare a fresh budget-1 fallthrough experiment from frozen M3a source04.

This draft may be read during timing, but --check/copy are validation work and
must wait for the root's safe interval. It never edits the input tree.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASE = ROOT / 'artifacts/m3a-source-04/source'
BASE_FINGERPRINT = 'b517b8d6c23d67db7e74fe4d2d5c4ff421693cb01b86c8666ffba006ca772d49'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace(text, old, new, count=1):
    if text.count(old) != count:
        raise RuntimeError(f'Anchor mismatch {text.count(old)} != {count}: {old[:100]}')
    return text.replace(old, new)


def read(name):
    return (HERE / name).read_text()


def fingerprint(source):
    digest = hashlib.sha256()
    count = 0
    for path in sorted(source.rglob('*')):
        if not path.is_file() or '__pycache__' in path.parts or path.suffix == '.pyc':
            continue
        relative = path.relative_to(source).as_posix()
        digest.update(relative.encode() + b'\0')
        digest.update(hashlib.sha256(path.read_bytes()).digest())
        count += 1
    return digest.hexdigest(), count


def patch_files(source):
    out = {}
    p = Path('include/exec/translation-block.h'); s = (source / p).read_text()
    s = replace(s, '    uint16_t icount;\n', '''    uint16_t icount;
    /* One ordinary owner, at most two logical blocks. Not part of TB key. */
    uint16_t m3b_bytes, m3b_b_offset;
    uint8_t m3b_fused, m3b_trial, m3b_retry, m3b_suppress;
''')
    out[p] = s
    p = Path('target/i386/cpu.h'); s = (source / p).read_text()
    s = replace(s, 'typedef struct CPUArchState {\n', '''typedef struct CPUArchState {
    /* Private diagnostic service debt, never guest-visible or migrated. */
    uint32_t m3b_service_debt;
    uint32_t m3b_boundary_force;
''')
    out[p] = s
    p = Path('tcg/wasm64.h'); s = (source / p).read_text()
    s = replace(s, '#include "m3-region-core.h"\n', '#include "m3-region-core.h"\n#include "m3b-core.h"\n')
    s = replace(s, 'struct WasmTBHeader {\n', 'struct WasmTBHeader {\n    struct m3b_header m3b;\n')
    s = replace(s, 'bool wasm44_single_ctx(void);', '''bool wasm44_single_ctx(void);
bool defuss_m3b_dynamic_profile(void);
bool defuss_m3b_can_form(const struct TranslationBlock *tb);
void defuss_m3b_note(unsigned index);
void defuss_m3b_event_pc(unsigned index, uint64_t pc);''')
    out[p] = s

    p = Path('target/i386/tcg/translate.c'); s = (source / p).read_text()
    s = replace(s, '#include "decode-new.h"\n', '#include "decode-new.h"\n#include "tcg/wasm64.h"\n#include "qemu/m3b-profile.h"\n#include "m3b-predecode.h"\n')
    s = replace(s, '    DisasContextBase base;\n', '''    DisasContextBase base;
    const struct m3b_plan *m3b_plan;
    bool m3b_failed;
    unsigned m3b_matched;
''')
    s = replace(s, '#include "emit.c.inc"\n', '''static bool m3b_match_decoded(DisasContext *s, X86DecodedInsn *d);
static void m3b_gen_b_entry(DisasContext *s);
#include "emit.c.inc"
''')
    s = replace(s, '    switch (sigsetjmp(dc->jmpbuf, 0)) {\n', '''    if (dc->m3b_plan && dc->base.pc_next ==
        dc->base.pc_first + dc->m3b_plan->b_offset) {
        m3b_gen_b_entry(dc);
    }
    switch (sigsetjmp(dc->jmpbuf, 0)) {
''')
    s = replace(s, '''    case 2:
        /* Restore state that may affect the next instruction. */''', '''    case 3:
        /* Speculative decoded-form rejection. The caller discards all IR. */
        dc->m3b_failed = true;
        dc->base.is_jmp = DISAS_NORETURN;
        return;
    case 2:
        /* Restore state that may affect the next instruction. */''')
    s = replace(s, '''static void i386_tr_tb_stop(DisasContextBase *dcbase, CPUState *cpu)
{
    DisasContext *dc = container_of(dcbase, DisasContext, base);
''', '''static void i386_tr_tb_stop(DisasContextBase *dcbase, CPUState *cpu)
{
    DisasContext *dc = container_of(dcbase, DisasContext, base);
    if (dc->m3b_plan && (dc->m3b_failed ||
        dc->m3b_matched != dc->m3b_plan->count ||
        dc->base.is_jmp != DISAS_NORETURN)) {
        /* A partial trial may already own slot0. Never append an ordinary
         * slot0 exit to it; the entire unpublished IR is discarded. */
        dc->m3b_failed = true;
        return;
    }
''')
    old = '''void x86_translate_code(CPUState *cpu, TranslationBlock *tb,
                        int *max_insns, vaddr pc, void *host_pc)
{
    DisasContext dc;

    translator_loop(cpu, tb, max_insns, pc, host_pc, &i386_tr_ops, &dc.base,
                    TCG_TYPE_VA);
}'''
    s = replace(s, old, '''#include "m3b-frontend.inc"

void x86_translate_code(CPUState *cpu, TranslationBlock *tb,
                        int *max_insns, vaddr pc, void *host_pc)
{
    m3b_translate_code(cpu, tb, max_insns, pc, host_pc);
}''')
    out[p] = s
    p = Path('target/i386/tcg/emit.c.inc'); s = (source / p).read_text()
    s = replace(s, 'static void gen_Jcc(DisasContext *s, X86DecodedInsn *decode)\n{\n',
                'static void gen_Jcc(DisasContext *s, X86DecodedInsn *decode)\n{\n' + read('emit-jcc.inc'))
    s = replace(s, '''static void gen_JMP(DisasContext *s, X86DecodedInsn *decode)
{
    gen_update_cc_op(s);
    gen_jmp_rel(s, s->dflag, decode->immediate, 0);
}''', '''static void gen_JMP(DisasContext *s, X86DecodedInsn *decode)
{
    gen_update_cc_op(s);
    gen_jmp_rel(s, s->dflag, decode->immediate, s->m3b_plan ? 1 : 0);
}''')
    out[p] = s
    p = Path('target/i386/tcg/decode-new.c.inc'); s = (source / p).read_text()
    s = replace(s, '''    if (!has_cpuid_feature(s, decode.e.cpuid)) {''', '''    if (s->m3b_plan) {
        if (!m3b_match_decoded(s, &decode)) {
            siglongjmp(s->jmpbuf, 3);
        }
        s->m3b_matched++;
    }
    if (!has_cpuid_feature(s, decode.e.cpuid)) {''')
    out[p] = s

    p = Path('accel/tcg/translate-all.c'); s = (source / p).read_text()
    s = replace(s, '#include "wasm-plan.inc"\n', '''#include "wasm-plan.inc"
bool defuss_m3b_dynamic_profile(void)
{
    return qatomic_read(&plan_table) == NULL && !qatomic_read(&plan_mode) &&
        !qatomic_read(&aot_mode) && !qatomic_read(&aot_active);
}
''')
    s = replace(s, '''    int ret = sigsetjmp(tcg_ctx->jmp_trans, 0);
    if (unlikely(ret != 0)) {
        return ret;
    }

    tcg_func_start(tcg_ctx);''', '''    const int m3b_original_max = *max_insns;
    volatile bool m3b_retried = false;
    tb->m3b_trial = tb->m3b_retry = tb->m3b_suppress = tb->m3b_fused = 0;
    int ret = sigsetjmp(tcg_ctx->jmp_trans, 0);
    if (unlikely(ret != 0)) {
        /* -3 belongs exclusively to QEMU's existing page-lock retry. */
        if ((ret == -1 || ret == -2) && tb->m3b_trial && !m3b_retried) {
            goto m3b_retry_ordinary;
        }
        return ret;
    }

 m3b_restart_translation:
    tcg_func_start(tcg_ctx);''')
    s = replace(s, '''    cs->cc->tcg_ops->translate_code(cs, tb, max_insns, pc, host_pc);
''', '''    cs->cc->tcg_ops->translate_code(cs, tb, max_insns, pc, host_pc);
    if (tb->m3b_retry && !m3b_retried) { goto m3b_retry_ordinary; }
''')
    s = replace(s, '''    int size = tcg_gen_code(tcg_ctx, tb, pc);
''', '''    int size = tcg_gen_code(tcg_ctx, tb, pc);
    if (size < 0 && tb->m3b_trial && !m3b_retried) { goto m3b_retry_ordinary; }
''')
    s = replace(s, '''    return size;
}

/* Called with mmap_lock held for user mode emulation.  */''', '''    return size;

 m3b_retry_ordinary:
    m3b_retried = true;
    tb->m3b_trial = tb->m3b_retry = tb->m3b_fused = 0;
    tb->m3b_suppress = 1;
    *max_insns = m3b_original_max;
    defuss_m3b_event_pc(M3B_RETRIES, pc);
    goto m3b_restart_translation;
}

/* Called with mmap_lock held for user mode emulation.  */''')
    out[p] = s

    p = Path('tcg/tcg.c'); s = (source / p).read_text()
    s = replace(s, '    defuss_m3_publish(tb, pc_start);\n', '''    if (tb->m3b_fused) {
        const struct WasmTBHeader *h = (const void *)tb->tc.ptr;
        if (h->wasm_size <= 0 || h->plan_id || h->aot_recipe) {
            return -2; /* unpublished candidate: one ordinary retry */
        }
    }
    defuss_m3_publish(tb, pc_start);
''')
    s = replace(s, '    defuss_m3_publish(tb, pc_start);\n',
                '    defuss_m3_publish(tb, pc_start);\n'
                '    if (tb->m3b_fused) { defuss_m3b_event_pc(M3B_PUBLISHED, pc_start); }\n')
    out[p] = s

    p = Path('tcg/wasm64/tcg-target.c.inc'); s = (source / p).read_text()
    s = replace(s, '    memset(&h->m3, 0, sizeof(h->m3));\n', '''    memset(&h->m3, 0, sizeof(h->m3));
    h->m3b = (struct m3b_header) {
        .magic = M3B_MAGIC, .fused = s->gen_tb->m3b_fused, .budget = 1,
        .bytes = s->gen_tb->m3b_bytes, .b_offset = s->gen_tb->m3b_b_offset,
    };
''')
    s = replace(s, '''static void tcg_wasm_out_goto_tb(
    TCGContext *s, int which, uintptr_t cur_reset_ptr)
{
    if (wasm44_defer) { return; }
    intptr_t ofs;
''', '''static void tcg_wasm_out_goto_tb(
    TCGContext *s, int which, uintptr_t cur_reset_ptr)
{
    if (wasm44_defer) { return; }
    /* Keep the TCI goto opcode and reset slot, but always execute the following
     * ordinary IDX1 exit after this fused owner's closing backedge. */
    if (s->gen_tb->m3b_fused && which == 1) { return; }
    intptr_t ofs;
''')
    out[p] = s

    p = Path('tcg/wasm64.c'); s = (source / p).read_text()
    s = replace(s, '''static __thread struct WasmContext ctx = {
    .tb_ptr = 0,
    .stack = NULL,
    .do_init = 1,
    .buf128 = NULL,
};
''', '''static __thread struct WasmContext ctx = {
    .tb_ptr = 0,
    .stack = NULL,
    .do_init = 1,
    .buf128 = NULL,
};
#include "m3b-runtime-head.inc"
''')
    s = replace(s, '    bool stale_generation = m3_enabled() && m3_known(descriptor) &&\n',
                '    bool stale_generation = (m3_enabled() || m3b_fused(tb_ptr)) && m3_known(descriptor) &&\n')
    s = replace(s, 'static int thread_idx_max;\n\nstatic void init_wasm(void)',
                '#include "m3b-runtime-service.inc"\n\nstatic void init_wasm(void)')
    s = replace(s, '''        case INDEX_op_goto_tb:
            tci_args_l(insn, tb_ptr, &ptr);
''', '''        case INDEX_op_goto_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            if (m3b_tci_closing_slot(ptr)) {
                defuss_m3b_event_pc(M3B_BACKEDGE_TCI_RETURNS, m3b_runtime_pc(env));
                break; /* following exit_tb returns ordinary owner | IDX1 */
            }
''')
    s = replace(s, '''                ctx.tb_ptr = tb_ptr;
                if (inc_counter(tb_ptr, NULL)) {''', '''                ctx.tb_ptr = tb_ptr;
                if (m3b_fused(tb_ptr)) {
                    defuss_m3b_note(M3B_TCI_TARGET_RETURNS);
                    return 0; /* outer guard BEFORE admission */
                }
                if (inc_counter(tb_ptr, NULL)) {''')
    s = replace(s, '''            ctx.tb_ptr = tb_ptr;
            if (inc_counter(tb_ptr, NULL)) {''', '''            ctx.tb_ptr = tb_ptr;
            if (m3b_fused(tb_ptr)) {
                defuss_m3b_note(M3B_TCI_TARGET_RETURNS);
                return 0; /* outer guard BEFORE admission */
            }
            if (inc_counter(tb_ptr, NULL)) {''')
    s = replace(s, '''    ctx.tb_ptr = (void *)v_tb_ptr;
    while (true) {
        trysleep();''', '''    ctx.tb_ptr = (void *)v_tb_ptr;
    while (true) {
        m3b_boundary_entry(env);
        trysleep();''')
    s = replace(s, '''        uintptr_t res;
        wasm_tb_func tb_func = get_instance_from_tb(ctx.tb_ptr);''', '''        uintptr_t res;
        unsigned m3b_boundary_token = 0;
        uint64_t m3b_entry_pc = m3b_runtime_pc(env);
        if (!m3b_entry_valid(env, ctx.tb_ptr)) {
            void *code = ctx.tb_ptr;
            defuss_m3b_event_pc(M3B_ENTRY_REJECTS, m3b_entry_pc);
            ctx.tb_ptr = NULL;
            return defuss_m3_redispatch(env, code);
        }
        wasm_tb_func tb_func = get_instance_from_tb(ctx.tb_ptr);''')
    # An ordinary TCI target can enter without returning to outer dispatch.
    # Observe it only after failed promotion; do not mislabel a compiled entry.
    s = replace(s, '                tb_ptr = get_tci_ptr(tb_ptr);\n',
                '                (void)m3b_boundary_before(env, tb_ptr, false);\n                tb_ptr = get_tci_ptr(tb_ptr);\n')
    s = replace(s, '''            tb_ptr = get_tci_ptr(tb_ptr);
            break;
        case INDEX_op_qemu_ld:''', '''            (void)m3b_boundary_before(env, tb_ptr, false);
            tb_ptr = get_tci_ptr(tb_ptr);
            break;
        case INDEX_op_qemu_ld:''')
    s = replace(s, '            res = m3_call_wasm_tb(tb_func, &ctx);',
                '            res = m3b_call_wasm_tb(tb_func, &ctx, &m3b_boundary_token);', count=2)
    s = replace(s, '            double interpret_start = (profiling ||',
                '            m3b_note_tier(false);\n            m3b_boundary_token = m3b_boundary_before(env, ctx.tb_ptr, false);\n            double interpret_start = (profiling ||', count=2)
    s = replace(s, '''        if (!ctx.tb_ptr) {
            return res;
        }
    }
}''', '''        m3b_boundary_after(env, res, m3b_boundary_token);
        m3b_service_after_call(env, m3b_entry_pc);
        m3b_boundary_complete(env, m3b_boundary_token);
        if (!ctx.tb_ptr) {
            return res;
        }
    }
}''')
    out[p] = s
    out.update(patch_profile(source))
    return out


def patch_profile(source):
    """Lifecycle guards operate in both arms of the separate diagnostic profile."""
    out = {}
    def begin(name):
        return replace((source / name).read_text(), '#include "qemu/osdep.h"\n',
                       '#include "qemu/osdep.h"\n#include "qemu/m3b-profile.h"\n')
    p = Path('system/meson.build'); s = (source / p).read_text()
    out[p] = replace(s, "  'vl.c',\n", "  'vl.c',\n  'm3b-profile.c',\n")
    p = Path('hw/intc/apic_common.c'); s = begin(p)
    s = replace(s, '''void apic_enable_vapic(APICCommonState *s, hwaddr paddr)
{
''', '''#ifdef __EMSCRIPTEN__
/* Target-specific predicate kept out of the common system profile unit. */
bool defuss_m3b_apic_safe(CPUState *cpu, DeviceState *device)
{
    if (!cpu || !device || !object_dynamic_cast(OBJECT(cpu), TYPE_X86_CPU) ||
        !object_dynamic_cast(OBJECT(device), TYPE_APIC_COMMON)) { return false; }
    APICCommonState *apic = APIC_COMMON(device);
    return X86_CPU(cpu)->apic_state == apic && apic->cpu == X86_CPU(cpu) &&
        !(apic->vapic_control & VAPIC_ENABLE_MASK) &&
        apic->vapic == NULL && apic->vapic_paddr == 0;
}
#endif

void apic_enable_vapic(APICCommonState *s, hwaddr paddr)
{
    /* This non-fallible API must never enable an asynchronous RAM writer in
     * either arm of the fixed diagnostic profile, even before graph freeze. */
    if (!defuss_m3b_launch_allowed(true, &error_fatal)) { abort(); }
''')
    out[p] = s
    p = Path('system/vl.c'); s = begin(p)
    s = replace(s, '''static void object_option_add_visitor(Visitor *v)
{''', '''static void object_option_add_visitor(Visitor *v)
{
    /* No arbitrary user-created non-device objects in this fixed profile. */
    if (!defuss_m3b_launch_allowed(true, &error_fatal)) { return; }''')
    s = replace(s, '''static int mon_init_func(void *opaque, QemuOpts *opts, Error **errp)
{
    return monitor_new_opts(opts, errp);''', '''static int mon_init_func(void *opaque, QemuOpts *opts, Error **errp)
{
    const char *mode = qemu_opt_get(opts, "mode");
    if (!defuss_m3b_launch_allowed(!mode || strcmp(mode, "control"), errp)) { return -1; }
    return monitor_new_opts(opts, errp);''')
    s = replace(s, '''    conf = g_malloc0(sizeof(*conf));''', '''    if (!defuss_m3b_launch_allowed(type == DEV_GDB, &error_fatal)) { return; }
    conf = g_malloc0(sizeof(*conf));''')
    s = replace(s, '''static void qemu_create_late_backends(void)
{
''', '''static void qemu_create_late_backends(void)
{
    if (!defuss_m3b_launch_allowed(autostart || qtest_chrdev || loadvm || incoming ||
                                  replay_mode != REPLAY_MODE_NONE, &error_fatal)) { return; }
''')
    s = replace(s, '''static void incoming_option_parse(const char *str)
{''', '''static void incoming_option_parse(const char *str)
{
    /* Reject all incoming channel kinds before CPR can load state. */
    if (!defuss_m3b_launch_allowed(true, &error_fatal)) { return; }''')
    s = replace(s, '    qdev_machine_creation_done();\n',
                '    qdev_machine_creation_done();\n    defuss_m3b_machine_freeze(machine);\n')
    out[p] = s
    p = Path('monitor/hmp.c'); s = begin(p)
    s = replace(s, '''static void monitor_hmp_complete(UserCreatable *uc, Error **errp)
{''', '''static void monitor_hmp_complete(UserCreatable *uc, Error **errp)
{
    /* Includes -object monitor-hmp, not only legacy -monitor options. */
    if (!defuss_m3b_launch_allowed(true, errp)) { return; }''')
    out[p] = s
    p = Path('hw/core/qdev.c'); s = begin(p)
    s = replace(s, '''bool qdev_set_parent_bus(DeviceState *dev, BusState *bus, Error **errp)
{''', '''bool qdev_set_parent_bus(DeviceState *dev, BusState *bus, Error **errp)
{
    if (!defuss_m3b_mutation_allowed(errp)) { return false; }''')
    s = replace(s, '''    if (value && !dev->realized) {
''', '''    if (value != dev->realized && !defuss_m3b_mutation_allowed(errp)) { return; }
    if (value && !dev->realized) {
''')
    out[p] = s
    p = Path('system/qdev-monitor.c'); s = begin(p)
    s = replace(s, '''void qdev_unplug(DeviceState *dev, Error **errp)
{''', '''void qdev_unplug(DeviceState *dev, Error **errp)
{
    if (!defuss_m3b_mutation_allowed(errp)) { return; }''')
    out[p] = s
    p = Path('block/block-backend.c'); s = begin(p)
    s = replace(s, '''BlockBackend *blk_new(AioContext *ctx, uint64_t perm, uint64_t shared_perm)
{''', '''BlockBackend *blk_new(AioContext *ctx, uint64_t perm, uint64_t shared_perm)
{
    /* Existing callers assume allocation succeeds. Fail before allocation. */
    if (!defuss_m3b_mutation_allowed(&error_fatal)) { abort(); }''')
    s = replace(s, '''int blk_insert_bs(BlockBackend *blk, BlockDriverState *bs, Error **errp)
{''', '''int blk_insert_bs(BlockBackend *blk, BlockDriverState *bs, Error **errp)
{
    if (!defuss_m3b_mutation_allowed(errp)) { return -EPERM; }''')
    s = replace(s, '''int blk_attach_dev(BlockBackend *blk, DeviceState *dev)
{''', '''int blk_attach_dev(BlockBackend *blk, DeviceState *dev)
{
    if (!defuss_m3b_mutation_allowed(NULL)) { return -EPERM; }''')
    out[p] = s
    p = Path('qapi/qmp-dispatch.c'); s = begin(p)
    s = replace(s, '''    cmd = qmp_find_command(cmds, command);''', '''    if (!defuss_m3b_qmp_allowed(command, oob, &err)) { goto out; }
    cmd = qmp_find_command(cmds, command);''')
    out[p] = s
    p = Path('system/runstate.c'); s = begin(p)
    s = replace(s, '''    if (reboot_action == REBOOT_ACTION_SHUTDOWN &&
        reason != SHUTDOWN_CAUSE_SUBSYSTEM_RESET) {''', '''    if (defuss_m3b_profile_requested() ||
        (reboot_action == REBOOT_ACTION_SHUTDOWN &&
         reason != SHUTDOWN_CAUSE_SUBSYSTEM_RESET)) {''')
    s = replace(s, '    vm_shutdown();\n    replay_finish();\n',
                '    vm_shutdown();\n    defuss_m3b_shutdown();\n    replay_finish();\n')
    out[p] = s
    return out


COPIES = {
    'core.h': 'tcg/m3b-core.h',
    'predecode.h': 'target/i386/tcg/m3b-predecode.h',
    'frontend.inc': 'target/i386/tcg/m3b-frontend.inc',
    'runtime-head.inc': 'tcg/m3b-runtime-head.inc',
    'runtime-boundary.inc': 'tcg/m3b-runtime-boundary.inc',
    'runtime-service.inc': 'tcg/m3b-runtime-service.inc',
    'profile.h': 'include/qemu/m3b-profile.h',
    'profile.c': 'system/m3b-profile.c',
    'graph-contract.h': 'system/m3b-graph-contract.h',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=BASE)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if source != BASE.resolve():
        raise SystemExit('Only the separately preserved M3a source04 is the initial base')
    if not output.is_relative_to(ROOT / 'artifacts') or output == source or source in output.parents or output in source.parents:
        raise SystemExit('Use a fresh, separate output under artifacts')
    manifest = output.parent / (output.name + '-m3b-overlay.json')
    if output.exists() or manifest.exists():
        raise SystemExit('Output or adjacent manifest exists; choose a fresh generation')
    observed, count = fingerprint(source)
    if observed != BASE_FINGERPRINT or count != 10102:
        raise SystemExit('Frozen M3a base changed; refusing preparation')
    pin = re.search(r'^#define M3B_GRAPH_PINNED ([01])$', read('graph-contract.h'), re.M)
    if not pin:
        raise SystemExit('Missing explicit graph pin status')
    graph_pinned = pin[1] == '1'
    patched = patch_files(source)
    if args.check:
        print(json.dumps({'status': 'anchors-passed', 'patched': list(map(str, patched)),
                          'copied': COPIES, 'graphPinned': graph_pinned, 'guestValidation': 'none'}, indent=2))
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, output, symlinks=True)
    if fingerprint(output) != (BASE_FINGERPRINT, count) or fingerprint(source) != (BASE_FINGERPRINT, count):
        raise RuntimeError('Base/copy changed during preparation; retained incomplete generation')
    changes = []
    for path, text in patched.items():
        with (output / path).open('w') as f:
            f.write(text); f.flush(); os.fsync(f.fileno())
        changes.append({'path': str(path), 'before': sha(source / path), 'after': sha(output / path)})
    for origin, destination in COPIES.items():
        with (output / destination).open('x') as f:
            f.write(read(origin)); f.flush(); os.fsync(f.fileno())
        changes.append({'path': destination, 'before': None, 'after': sha(output / destination)})
    report = {'schema': 1, 'kind': 'm3b-budget1-diagnostic-overlay', 'base': str(source),
              'baseFingerprint': BASE_FINGERPRINT, 'baseFiles': count,
              'source': str(output), 'changes': changes, 'generatorSha256': sha(Path(__file__)),
              'defaultEnabled': False, 'productionEligible': False, 'graphPinned': graph_pinned,
              'budget': 1, 'maximumInstructions': 32, 'maximumBytes': 128,
              'guestValidation': 'none', 'timingEligible': False}
    with manifest.open('x') as f:
        json.dump(report, f, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
    descriptor = os.open(output.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    print(json.dumps({'source': str(output), 'manifest': str(manifest)}, indent=2))


if __name__ == '__main__':
    main()
