"""Inline the exact pure SHA256RNDS2 helper on the proven PSHUFB base.

changes(kind, source_root) returns complete source overlays; no files are built.
The diagnostic variant counts native, inline, and compiled-original execution.
"""
from pathlib import Path

KINDS = ("rnds2", "rnds2-check")
DEPENDENCIES = ["rnds2-guard-tests.c.inc", "rnds2-helper-tests.c.inc", "rnds2-oracle.c.inc"]
BACKEND = "tcg/wasm64/tcg-target.c.inc"


def once(text, before, after):
    if text.count(before) != 1:
        raise ValueError("Expected one source anchor: " + before[:100])
    return text.replace(before, after, 1)


COUNTERS = r'''
#include <emscripten.h>
/* One vCPU. Bank0 includes bank2; sum bank0+bank1 for total executions.
 * Native selftests also increment bank0: reset before a guest starts. */
uint64_t bun_inline_rnds2_counts[3];
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_inline_rnds2_counts(int clear);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_inline_rnds2_counts(int clear)
{
    if (clear) {
        memset(bun_inline_rnds2_counts, 0, sizeof(bun_inline_rnds2_counts));
    }
    return (uintptr_t)bun_inline_rnds2_counts;
}
'''

DIAGNOSTIC = r'''
extern uint64_t bun_inline_rnds2_counts[3];
static void emit_inline_rnds2_count(TCGContext *s, unsigned bank)
{
    intptr_t address = (intptr_t)&bun_inline_rnds2_counts[bank];
    tcg_wasm_out_op_const(s, OPC_I64_CONST, address);
    tcg_wasm_out_norm_ptr(s, 0);
    tcg_wasm_out_op_const(s, OPC_I64_CONST, address);
    tcg_wasm_out_norm_ptr(s, 0);
    tcg_wasm_out_op_ldst(s, OPC_I64_LOAD, 0, 0);
    tcg_wasm_out_op_const(s, OPC_I64_CONST, 1);
    tcg_wasm_out_op(s, OPC_I64_ADD);
    tcg_wasm_out_op_ldst(s, OPC_I64_STORE, 0, 0);
}
'''

INTRINSIC = r'''
/* No broad vector backend or local-layout change. R0/R1 have already been
 * freed by tcg_reg_alloc_call: they are the declared 128-bit call-clobber set.
 * This exact void helper has no return-register postprocessing. Arguments
 * occupy five 8-byte call-stack slots: d0,a8,b16,wk0=24,wk1=32. */
static bool inline_rnds2_matches(intptr_t func, const TCGHelperInfo *info)
{
    const unsigned signature = dh_typecode_void | (dh_typecode_ptr << 3) |
        (dh_typecode_ptr << 6) | (dh_typecode_ptr << 9) |
        (dh_typecode_i32 << 12) | (dh_typecode_i32 << 15);
    return (void *)func == info->func && info->name &&
        !(info->flags & TCG_CALL_NO_RETURN) && info->typemask == signature &&
        !strcmp(info->name, "sha256rnds2");
}

__DIAGNOSTIC__

/* Logical words retain their original names. Initially:
 * R0=[B,A], R1=[F,E], TMP64_0=[D,C], TMP64_1=[H,G] (low,high).
 * After round0 D becomes EE0 and H becomes AA0; C/G stay intact. */
enum { RN_A, RN_B, RN_C, RN_D, RN_E, RN_F, RN_G, RN_H };
static void emit_inline_rnds2_word(TCGContext *s, unsigned word)
{
    static const unsigned locals[8] = {
        REG_LOCAL_BASE + TCG_REG_R0, REG_LOCAL_BASE + TCG_REG_R0,
        TMP64_LOCAL_0_IDX, TMP64_LOCAL_0_IDX,
        REG_LOCAL_BASE + TCG_REG_R1, REG_LOCAL_BASE + TCG_REG_R1,
        TMP64_LOCAL_1_IDX, TMP64_LOCAL_1_IDX
    };
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, locals[word]);
    if (!(word & 1)) {
        tcg_wasm_out_op_const(s, OPC_I64_CONST, 32);
        tcg_wasm_out_op(s, OPC_I64_SHR_U);
    }
    tcg_wasm_out_op(s, OPC_I32_WRAP_I64);
}

static void emit_inline_rnds2_sigma(TCGContext *s, unsigned word,
                                    unsigned a, unsigned b, unsigned c)
{
    emit_inline_rnds2_word(s, word);
    tcg_wasm_out_op_const(s, OPC_I32_CONST, a);
    tcg_wasm_out_op(s, OPC_I32_ROTR);
    emit_inline_rnds2_word(s, word);
    tcg_wasm_out_op_const(s, OPC_I32_CONST, b);
    tcg_wasm_out_op(s, OPC_I32_ROTR);
    tcg_wasm_out_op(s, OPC_I32_XOR);
    emit_inline_rnds2_word(s, word);
    tcg_wasm_out_op_const(s, OPC_I32_CONST, c);
    tcg_wasm_out_op(s, OPC_I32_ROTR);
    tcg_wasm_out_op(s, OPC_I32_XOR);
}

static void emit_inline_rnds2_choose(TCGContext *s, unsigned e,
                                     unsigned f, unsigned g)
{
    /* g ^ (e & (f ^ g)) */
    emit_inline_rnds2_word(s, g);
    emit_inline_rnds2_word(s, e);
    emit_inline_rnds2_word(s, f);
    emit_inline_rnds2_word(s, g);
    tcg_wasm_out_op(s, OPC_I32_XOR);
    tcg_wasm_out_op(s, OPC_I32_AND);
    tcg_wasm_out_op(s, OPC_I32_XOR);
}

static void emit_inline_rnds2_majority(TCGContext *s, unsigned a,
                                       unsigned b, unsigned c)
{
    /* (a & b) ^ (c & (a ^ b)) */
    emit_inline_rnds2_word(s, a);
    emit_inline_rnds2_word(s, b);
    tcg_wasm_out_op(s, OPC_I32_AND);
    emit_inline_rnds2_word(s, c);
    emit_inline_rnds2_word(s, a);
    emit_inline_rnds2_word(s, b);
    tcg_wasm_out_op(s, OPC_I32_XOR);
    tcg_wasm_out_op(s, OPC_I32_AND);
    tcg_wasm_out_op(s, OPC_I32_XOR);
}

static void emit_inline_rnds2_t(TCGContext *s, unsigned e, unsigned f,
                                unsigned g, unsigned h, int wk_offset)
{
    emit_inline_rnds2_choose(s, e, f, g);
    emit_inline_rnds2_sigma(s, e, 6, 11, 25);
    tcg_wasm_out_op(s, OPC_I32_ADD);
    push_arg_i64(s, &wk_offset);
    tcg_wasm_out_op(s, OPC_I32_WRAP_I64);
    tcg_wasm_out_op(s, OPC_I32_ADD);
    emit_inline_rnds2_word(s, h);
    tcg_wasm_out_op(s, OPC_I32_ADD);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, TMP32_LOCAL_0_IDX);
}

static void emit_inline_rnds2_aa(TCGContext *s, unsigned a,
                                 unsigned b, unsigned c)
{
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP32_LOCAL_0_IDX);
    emit_inline_rnds2_majority(s, a, b, c);
    tcg_wasm_out_op(s, OPC_I32_ADD);
    emit_inline_rnds2_sigma(s, a, 2, 13, 22);
    tcg_wasm_out_op(s, OPC_I32_ADD);
}

static void emit_inline_rnds2_load(TCGContext *s, int arg_offset,
                                   unsigned memory_offset, unsigned local)
{
    emit_xmm_ptr(s, &arg_offset);
    tcg_wasm_out_op_ldst(s, OPC_I64_LOAD, 0, memory_offset);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, local);
}

static void emit_inline_rnds2_high(TCGContext *s, unsigned local)
{
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, local);
    tcg_wasm_out_op_const(s, OPC_I64_CONST, INT64_C(-4294967296));
    tcg_wasm_out_op(s, OPC_I64_AND);
}

static void emit_inline_rnds2_dest(TCGContext *s)
{
    int offset = 0;
    emit_xmm_ptr(s, &offset);
}

static bool emit_inline_rnds2(TCGContext *s, intptr_t func,
                              const TCGHelperInfo *info)
{
    if (!inline_rnds2_matches(func, info)) {
        return false;
    }
    tcg_debug_assert(REG_IDX(TCG_REG_R0) == REG_LOCAL_BASE + TCG_REG_R0);
    tcg_debug_assert(REG_IDX(TCG_REG_R1) == REG_LOCAL_BASE + TCG_REG_R1);
    tcg_debug_assert(tcg_regset_test_reg(tcg_target_call_clobber_regs, TCG_REG_R0));
    tcg_debug_assert(tcg_regset_test_reg(tcg_target_call_clobber_regs, TCG_REG_R1));
__COUNT_INLINE__
    emit_inline_rnds2_load(s, 16, 8, REG_IDX(TCG_REG_R0)); /* B,A */
    emit_inline_rnds2_load(s, 16, 0, REG_IDX(TCG_REG_R1)); /* F,E */
    emit_inline_rnds2_load(s, 8, 8, TMP64_LOCAL_0_IDX);   /* D,C */
    emit_inline_rnds2_load(s, 8, 0, TMP64_LOCAL_1_IDX);   /* H,G */

    emit_inline_rnds2_t(s, RN_E, RN_F, RN_G, RN_H, 24);
    emit_inline_rnds2_high(s, TMP64_LOCAL_1_IDX);
    emit_inline_rnds2_aa(s, RN_A, RN_B, RN_C);
    tcg_wasm_out_op(s, OPC_I64_EXTEND_I32_U);
    tcg_wasm_out_op(s, OPC_I64_OR);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, TMP64_LOCAL_1_IDX); /* AA0,G */
    emit_inline_rnds2_high(s, TMP64_LOCAL_0_IDX);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP32_LOCAL_0_IDX);
    emit_inline_rnds2_word(s, RN_D);
    tcg_wasm_out_op(s, OPC_I32_ADD);
    tcg_wasm_out_op(s, OPC_I64_EXTEND_I32_U);
    tcg_wasm_out_op(s, OPC_I64_OR);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, TMP64_LOCAL_0_IDX); /* EE0,C */

    /* Round1: A=AA0, B=oldA, C=oldB, D=oldC;
     *         E=EE0, F=oldE, G=oldF, H=oldG.
     * wk1 is consumed before any architectural destination write. */
    emit_inline_rnds2_t(s, RN_D, RN_E, RN_F, RN_G, 32);
    emit_inline_rnds2_dest(s);
    emit_inline_rnds2_aa(s, RN_H, RN_A, RN_B);
    tcg_wasm_out_op_ldst(s, OPC_I32_STORE, 0, 12);
    emit_inline_rnds2_dest(s);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP32_LOCAL_0_IDX);
    emit_inline_rnds2_word(s, RN_C);
    tcg_wasm_out_op(s, OPC_I32_ADD);
    tcg_wasm_out_op_ldst(s, OPC_I32_STORE, 0, 4);
    emit_inline_rnds2_dest(s);
    emit_inline_rnds2_word(s, RN_H);
    tcg_wasm_out_op_ldst(s, OPC_I32_STORE, 0, 8);
    emit_inline_rnds2_dest(s);
    emit_inline_rnds2_word(s, RN_D);
    tcg_wasm_out_op_ldst(s, OPC_I32_STORE, 0, 0);
    return true;
}

__GUARD_TESTS__
'''


def changes(kind, source_root):
    if kind not in KINDS:
        raise ValueError(f"Unknown RNDS2 kind: {kind}")
    root = Path(source_root)
    diagnostic = kind.endswith("-check")
    backend = (root / BACKEND).read_text()
    if "static bool emit_replay_pshufb(" not in backend:
        raise ValueError("RNDS2 requires the previously validated JIT PSHUFB base")
    # These standard scalar opcodes were not needed by the pinned backend.
    if "OPC_I32_AND =" not in backend:
        backend = once(backend, "    OPC_I32_REM_U = 0x70,\n",
                       "    OPC_I32_REM_U = 0x70,\n    OPC_I32_AND = 0x71,\n")
    if "OPC_I32_XOR =" not in backend:
        backend = once(backend, "    OPC_I32_SHR_S = 0x75,\n",
                       "    OPC_I32_XOR = 0x73,\n    OPC_I32_SHR_S = 0x75,\n")
    addition = INTRINSIC.replace("__DIAGNOSTIC__", DIAGNOSTIC if diagnostic else "")
    addition = addition.replace("__COUNT_INLINE__", "    emit_inline_rnds2_count(s, 1);" if diagnostic else "")
    addition = addition.replace("__GUARD_TESTS__", Path(__file__).with_name("rnds2-guard-tests.c.inc").read_text() if diagnostic else "")
    anchor = "static void tcg_wasm_out_call(TCGContext *s, intptr_t func,\n"
    backend = once(backend, anchor, addition + anchor)
    dispatch = "    if (emit_replay_pshufb(s, func, info)) {\n"
    backend = once(backend, dispatch, "    if (emit_inline_rnds2(s, func, info)) {\n        return;\n    }\n" + dispatch)
    call_start = backend.index(anchor)
    if not (backend.index("if (wasm44_defer)", call_start) < backend.index("if (emit_inline_rnds2", call_start)):
        raise ValueError("RNDS2 emitter must follow the deferred-emission guard")
    if diagnostic:
        fallback = "    int64_t func_idx = get_helper_idx(s, func);"
        # If a future exact matching call deliberately falls through, count it
        # as a subset of native helper entries. Current matches always inline.
        backend = once(backend, fallback,
            "    if (inline_rnds2_matches(func, info)) { emit_inline_rnds2_count(s, 2); }\n" + fallback)
    result = {BACKEND: backend, "tcg/tcg.c": (root / "tcg/tcg.c").read_text()}
    if diagnostic:
        helper = "target/i386/ops_sse.h"
        text = (root / helper).read_text()
        declaration = "void helper_sha256rnds2(Reg *d, Reg *a, Reg *b, uint32_t wk0, uint32_t wk1)\n{"
        text = once(text, declaration, declaration + "\n    bun_inline_rnds2_counts[0]++;")
        unit = "target/i386/tcg/fpu_helper.c"
        fpu = once((root / unit).read_text(), '#define SHIFT 0\n#include "ops_sse.h"',
                   COUNTERS + '#define SHIFT 0\n#include "ops_sse.h"')
        fpu += "\n" + Path(__file__).with_name("rnds2-oracle.c.inc").read_text()
        fpu += "\n" + Path(__file__).with_name("rnds2-helper-tests.c.inc").read_text()
        result.update({helper: text, unit: fpu})
    return result
