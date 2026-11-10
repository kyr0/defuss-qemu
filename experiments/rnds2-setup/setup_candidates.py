"""Forward narrow pure SIMD intrinsic operands before the generic helper ABI.

Input is the root builder's full base-source overlay, already containing the
proven bun-replay PSHUFB compiled intrinsic. No original source is modified.
"""
from pathlib import Path

KINDS = ("setup", "setup-check")
BACKEND = "tcg/wasm64/tcg-target.c.inc"


def once(text, before, after):
    if text.count(before) != 1:
        raise ValueError("Expected exactly one source anchor: " + before[:100])
    return text.replace(before, after, 1)


BACKEND_ADDITION = r'''
/* Exact helper identities only. Neither this selector nor its rejects mutate
 * allocator/emitter state. All selected pointers address private vector state;
 * guest-memory loads and faults remain translator-owned and precede the call. */
enum BunInlineSetupKind {
    BUN_SETUP_NONE, BUN_SETUP_PSHUFB_XMM, BUN_SETUP_PSHUFB_YMM,
    BUN_SETUP_MIN, BUN_SETUP_EQ, BUN_SETUP_MASK
};

static unsigned bun_inline_setup_kind(TCGOp *op, bool deferred)
{
    const TCGHelperInfo *info = tcg_call_info(op);
    const unsigned ptr1 = dh_typecode_ptr << 3;
    const unsigned ptr3 = ptr1 | (dh_typecode_ptr << 6) |
                          (dh_typecode_ptr << 9);
    unsigned kind, nin, nout, signature;
    intptr_t func = (intptr_t)tcg_call_func(op);

    if (deferred || (void *)func != info->func || !info->name ||
        info->flags != TCG_CALL_NO_RWG ||
        info->out_kind != TCG_CALL_RET_NORMAL) {
        return BUN_SETUP_NONE;
    }
    if (!strcmp(info->name, "pshufb_xmm") ||
        !strcmp(info->name, "pshufb_ymm")) {
        kind = !strcmp(info->name, "pshufb_xmm") ?
               BUN_SETUP_PSHUFB_XMM : BUN_SETUP_PSHUFB_YMM;
        nin = 4; nout = 0;
        signature = dh_typecode_void | ptr3 | (dh_typecode_ptr << 12);
    } else if (func == (intptr_t)helper_wasm_xmm_min_u8 ||
               func == (intptr_t)helper_wasm_xmm_eq_u8) {
        kind = func == (intptr_t)helper_wasm_xmm_min_u8 ? BUN_SETUP_MIN : BUN_SETUP_EQ;
        nin = 3; nout = 0;
        signature = dh_typecode_void | ptr3;
    } else if (func == (intptr_t)helper_wasm_xmm_mask_u8) {
        kind = BUN_SETUP_MASK;
        nin = 1; nout = 1;
        signature = dh_typecode_i32 | ptr1;
    } else {
        return BUN_SETUP_NONE;
    }
    if (info->typemask != signature || info->nr_in != nin ||
        info->nr_out != nout || TCGOP_CALLI(op) != nin ||
        TCGOP_CALLO(op) != nout || op->nargs != nin + nout + 2) {
        return BUN_SETUP_NONE;
    }
    for (unsigned i = 0; i < nin; i++) {
        const TCGCallArgumentLoc *loc = &info->in[i];
        if (loc->kind != TCG_CALL_ARG_NORMAL || loc->arg_slot != i ||
            loc->arg_idx != i || loc->tmp_subindex != 0 ||
            arg_temp(op->args[nout + i])->type != TCG_TYPE_PTR) {
            return BUN_SETUP_NONE;
        }
    }
    if (nout && arg_temp(op->args[0])->type != TCG_TYPE_I32) {
        return BUN_SETUP_NONE;
    }
    return kind;
}

static TCGRegSet bun_inline_setup_clobbers(unsigned kind)
{
    /* TCI helper_return and the compiled intrinsic agree: void preserves all
     * locals; the selected i32 mask result writes only R0. No generic helper
     * (including SHA/PTEST) is admitted by the early selector. */
    return kind == BUN_SETUP_MASK ? (TCGRegSet)1 << TCG_REG_R0 : 0;
}

__COUNTERS__

static void bun_inline_setup_ptr(TCGContext *s, TCGReg reg)
{
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, REG_IDX(reg));
    tcg_wasm_out_norm_ptr(s, 0);
}

static void bun_inline_setup_emit(TCGContext *s, unsigned kind,
                                  const TCGReg regs[4])
{
    tcg_debug_assert(!wasm44_defer && kind != BUN_SETUP_NONE);
    __COUNT_EXECUTION__
    if (kind == BUN_SETUP_MASK) {
        bun_inline_setup_ptr(s, regs[0]);
        emit_v128_mem(s, 0x00);
        tcg_wasm_out_op_idx(s, 0xfd, 0x64);
        tcg_wasm_out_op(s, OPC_I64_EXTEND_I32_U);
        tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, REG_IDX(TCG_REG_R0));
    } else if (kind == BUN_SETUP_MIN || kind == BUN_SETUP_EQ) {
        bun_inline_setup_ptr(s, regs[0]);
        bun_inline_setup_ptr(s, regs[1]);
        emit_v128_mem(s, 0x00);
        bun_inline_setup_ptr(s, regs[2]);
        emit_v128_mem(s, 0x00);
        tcg_wasm_out_op_idx(s, 0xfd, kind == BUN_SETUP_MIN ? 0x77 : 0x23);
        emit_v128_mem(s, 0x0b);
    } else {
        unsigned lanes = kind == BUN_SETUP_PSHUFB_YMM ? 2 : 1;
        for (unsigned lane = 0; lane < lanes; lane++) {
            bun_inline_setup_ptr(s, regs[1]); /* env remains TCI-only */
            bun_inline_setup_ptr(s, regs[2]);
            emit_replay_pshufb_v128_mem(s, 0x00, lane * 16);
            bun_inline_setup_ptr(s, regs[3]);
            emit_replay_pshufb_v128_mem(s, 0x00, lane * 16);
            tcg_wasm_out_op_idx(s, 0xfd, 0x0c);
            for (unsigned byte = 0; byte < 16; byte++) {
                tcg_wasm_out8(s, 0x8f);
            }
            tcg_wasm_out_op_idx(s, 0xfd, 0x4e);
            tcg_wasm_out_op_idx(s, 0xfd, 0x0e);
            emit_replay_pshufb_v128_mem(s, 0x0b, lane * 16);
        }
    }
}

'''

COUNTERS = r'''
#include <emscripten.h>
/* Diagnostic only; five COMPILED execution totals in enum order minus one. */
static uint64_t bun_inline_setup_counts[5];
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_inline_setup_counts(int clear);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_inline_setup_counts(int clear)
{
    if (clear) {
        memset(bun_inline_setup_counts, 0, sizeof(bun_inline_setup_counts));
    }
    return (uintptr_t)bun_inline_setup_counts;
}
'''

COUNT_EXECUTION = r'''
    /* Count before the result writes R0. No TCG or scratch local is clobbered. */
    tcg_wasm_out_op_const(s, OPC_I64_CONST,
        (intptr_t)&bun_inline_setup_counts[kind - 1]);
    tcg_wasm_out_norm_ptr(s, 0);
    tcg_wasm_out_op_const(s, OPC_I64_CONST,
        (intptr_t)&bun_inline_setup_counts[kind - 1]);
    tcg_wasm_out_norm_ptr(s, 0);
    tcg_wasm_out_op_ldst(s, OPC_I64_LOAD, 0, 0);
    tcg_wasm_out_op_const(s, OPC_I64_CONST, 1);
    tcg_wasm_out_op(s, OPC_I64_ADD);
    tcg_wasm_out_op_ldst(s, OPC_I64_STORE, 0, 0);
'''

ALLOCATOR_ADDITION = r'''
#if defined(__EMSCRIPTEN__) && !defined(CONFIG_TCG_INTERPRETER)
static bool bun_inline_setup_alloc(TCGContext *s, TCGOp *op)
{
    unsigned kind = bun_inline_setup_kind(op, wasm44_defer);
    if (!kind) {
        return false;
    }
    const TCGHelperInfo *info = tcg_call_info(op);
    const int nout = TCGOP_CALLO(op), nin = TCGOP_CALLI(op);
    const TCGLifeData arg_life = op->life;
    TCGRegSet allocated = s->reserved_regs;
    TCGReg regs[4];

    /* Keep all sources pinned until emission. Repeated input temporaries may
     * share a register; loading later arguments must not evict an earlier one.
     * Loads/spills are emitted to BOTH engines as usual. */
    for (int i = nin - 1; i >= 0; i--) {
        TCGTemp *ts = arg_temp(op->args[nout + i]);
        temp_load(s, ts, tcg_target_available_regs[ts->type], allocated, 0);
        regs[i] = ts->reg;
        tcg_regset_set_reg(allocated, ts->reg);
    }
    for (int i = nin - 1; i >= 0; i--) {
        /* Preserve the original interpreter ABI. Only the compiled engine
         * avoids these stores and the intrinsic's subsequent stack reloads. */
        tcg_out_ldst(s, INDEX_op_st, regs[i], TCG_REG_CALL_STACK,
                     arg_slot_stk_ofs(info->in[i].arg_slot));
    }
    for (int i = nout; i < nout + nin; i++) {
        if (IS_DEAD_ARG(i)) {
            temp_dead(s, arg_temp(op->args[i]));
        }
    }
    TCGRegSet clobbers = bun_inline_setup_clobbers(kind);
    for (int i = 0; i < TCG_TARGET_NB_REGS; i++) {
        if (tcg_regset_test_reg(clobbers, i)) {
            tcg_reg_free(s, i, allocated);
        }
    }
    /* NO_RWG was checked before any mutation. Liveness retains ordinary
     * global coherence and output dead/sync bookkeeping. Selected helpers do
     * not touch TCG globals, unwind or access guest/MMIO memory. */
    bun_inline_setup_tci_call(s, tcg_call_func(op), info);
    bun_inline_setup_emit(s, kind, regs);
    if (nout) {
        TCGTemp *ts = arg_temp(op->args[0]);
        tcg_debug_assert(!temp_readonly(ts));
        set_temp_val_reg(s, ts, TCG_REG_R0);
        ts->mem_coherent = 0;
        if (NEED_SYNC_ARG(0)) {
            temp_sync(s, ts, s->reserved_regs, 0, IS_DEAD_ARG(0));
        } else if (IS_DEAD_ARG(0)) {
            temp_dead(s, ts);
        }
    }
    return true;
}
#endif

'''

METADATA_TEST = r'''
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
EMSCRIPTEN_KEEPALIVE int defuss_inline_setup_metadata_selftest(void);
EMSCRIPTEN_KEEPALIVE int defuss_inline_setup_metadata_selftest(void)
{
    if (helper_info_pshufb_xmm.flags != TCG_CALL_NO_RWG) { return 1; }
    if (helper_info_pshufb_ymm.flags != TCG_CALL_NO_RWG) { return 2; }
    if (helper_info_pshufb_mmx.flags != 0) { return 3; }
    if (helper_info_ptest_xmm.flags != 0 || helper_info_ptest_ymm.flags != 0) {
        return 4;
    }
    return 0;
}
#endif
'''


def changes(kind, source_root):
    if kind not in KINDS:
        raise ValueError(f"Unknown setup kind {kind!r}; choose from {KINDS}")
    source_root = Path(source_root)
    backend = (source_root / BACKEND).read_text()
    if "static bool emit_replay_pshufb(" not in backend:
        raise ValueError("Setup candidate requires the proven PSHUFB base backend")
    addition = BACKEND_ADDITION.replace("__COUNTERS__", COUNTERS if kind.endswith("-check") else "")
    addition = addition.replace("__COUNT_EXECUTION__", COUNT_EXECUTION if kind.endswith("-check") else "")
    backend = once(backend, "static void tcg_wasm_out_call(TCGContext *s, intptr_t func,\n",
                   addition + "static void tcg_wasm_out_call(TCGContext *s, intptr_t func,\n")
    # Split the established dual emitter without changing its TCI body.
    call_anchor = "static void tcg_out_call(TCGContext *s, const tcg_insn_unit *func,\n"
    backend = once(backend, call_anchor,
                   "static void bun_inline_setup_tci_call(TCGContext *s, const tcg_insn_unit *func,\n")
    backend = once(backend,
                   "    tcg_wasm_out_call(s, (intptr_t)func, info);\n}\n",
                   "}\n\n" + call_anchor + "                         const TCGHelperInfo *info)\n{\n"
                   "    bun_inline_setup_tci_call(s, func, info);\n"
                   "    tcg_wasm_out_call(s, (intptr_t)func, info);\n}\n")
    if kind.endswith("-check"):
        backend += "\n" + Path(__file__).with_name("setup-guard-tests.c.inc").read_text()
    tcg = (source_root / "tcg/tcg.c").read_text()
    tcg = once(tcg, "static void tcg_reg_alloc_call(TCGContext *s, TCGOp *op)\n{\n",
               ALLOCATOR_ADDITION + "static void tcg_reg_alloc_call(TCGContext *s, TCGOp *op)\n{\n"
               "#if defined(__EMSCRIPTEN__) && !defined(CONFIG_TCG_INTERPRETER)\n"
               "    if (bun_inline_setup_alloc(s, op)) { return; }\n#endif\n")
    header_path = "target/i386/tcg/ops_sse_header.h.inc"
    header = once((source_root / header_path).read_text(),
                  "DEF_HELPER_4(glue(pshufb, SUFFIX), void, env, Reg, Reg, Reg)",
                  "#if SHIFT >= 1\n"
                  "/* Private vector pointers only; env and TCG globals are unused. */\n"
                  "DEF_HELPER_FLAGS_4(glue(pshufb, SUFFIX), TCG_CALL_NO_RWG, void, env, Reg, Reg, Reg)\n"
                  "#else\nDEF_HELPER_4(glue(pshufb, SUFFIX), void, env, Reg, Reg, Reg)\n#endif")
    translator = (source_root / "target/i386/tcg/translate.c").read_text()
    if kind.endswith("-check"):
        translator += METADATA_TEST
    # helper.h must be copied to the overlay so its relative tcg/... include
    # resolves to the edited header. translate.c owns x86 helper_info/thunks.
    return {BACKEND: backend, "tcg/tcg.c": tcg, header_path: header,
            "target/i386/helper.h": (source_root / "target/i386/helper.h").read_text(),
            "target/i386/tcg/translate.c": translator}
