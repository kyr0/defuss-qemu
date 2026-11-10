/* Diagnostic only. These tests exercise the exact selector and clobber policy
 * used by allocation. Actual emitted values/aliases are guest-fixture checks. */
#include <emscripten.h>
static void bun_inline_setup_test_dummy(void) { }
static volatile unsigned bun_inline_setup_test_marker;
static void bun_inline_setup_test_other(void) { bun_inline_setup_test_marker++; }

EMSCRIPTEN_KEEPALIVE int defuss_inline_setup_guard_selftest(void);
EMSCRIPTEN_KEEPALIVE int defuss_inline_setup_guard_selftest(void)
{
    static const char *const names[5] = {
        "pshufb_xmm", "pshufb_ymm", "wasm_xmm_min_u8",
        "wasm_xmm_eq_u8", "wasm_xmm_mask_u8"
    };
    void *funcs[5] = { (void *)bun_inline_setup_test_dummy,
        (void *)bun_inline_setup_test_dummy, (void *)helper_wasm_xmm_min_u8,
        (void *)helper_wasm_xmm_eq_u8, (void *)helper_wasm_xmm_mask_u8 };
    TCGOp *op = g_malloc0(sizeof(*op) + 8 * sizeof(TCGArg));
    TCGTemp temps[5] = { 0 };
    int failure = 0;
    for (unsigned kind = 1; kind <= 5; kind++) {
        unsigned nin = kind <= 2 ? 4 : kind == 5 ? 1 : 3;
        unsigned nout = kind == 5;
        TCGHelperInfo info = { .func = funcs[kind - 1], .name = names[kind - 1],
            .flags = TCG_CALL_NO_RWG, .nr_in = nin, .nr_out = nout,
            .out_kind = TCG_CALL_RET_NORMAL,
            .typemask = nout ? dh_typecode_i32 : dh_typecode_void };
        op->opc = INDEX_op_call;
        op->nargs = nin + nout + 2;
        TCGOP_CALLI(op) = nin; TCGOP_CALLO(op) = nout;
        for (unsigned i = 0; i < nin; i++) {
            info.typemask |= dh_typecode_ptr << (3 * (i + 1));
            info.in[i] = (TCGCallArgumentLoc){ .kind = TCG_CALL_ARG_NORMAL,
                .arg_slot = i, .arg_idx = i };
            temps[nout + i].type = TCG_TYPE_PTR;
            op->args[nout + i] = temp_arg(&temps[nout + i]);
        }
        if (nout) { temps[0].type = TCG_TYPE_I32; op->args[0] = temp_arg(&temps[0]); }
        op->args[nin + nout] = (uintptr_t)info.func;
        op->args[nin + nout + 1] = (uintptr_t)&info;
#define EXPECT(C, N) do { if (!(C)) { failure = (N) + 100 * kind; goto done; } } while (0)
        EXPECT(bun_inline_setup_kind(op, false) == kind, 1);
        EXPECT(bun_inline_setup_kind(op, true) == BUN_SETUP_NONE, 2);
        EXPECT(bun_inline_setup_clobbers(kind) ==
               (nout ? (TCGRegSet)1 << TCG_REG_R0 : 0), 3);
        op->args[nin + nout] = (uintptr_t)bun_inline_setup_test_other;
        EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 4);
        op->args[nin + nout] = (uintptr_t)info.func;
        for (unsigned flags = 0; flags < 16; flags++) {
            info.flags = flags;
            EXPECT(bun_inline_setup_kind(op, false) ==
                   (flags == TCG_CALL_NO_RWG ? kind : BUN_SETUP_NONE), 5);
        }
        info.flags = TCG_CALL_NO_RWG;
        info.name = NULL;
        EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 6);
        info.name = names[kind - 1];
        info.typemask ^= 1u << 3;
        EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 7);
        info.typemask ^= 1u << 3;
        info.out_kind = TCG_CALL_RET_BY_REF;
        EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 8);
        info.out_kind = TCG_CALL_RET_NORMAL;
        info.nr_in++;
        EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 9);
        info.nr_in--;
        info.nr_out++;
        EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 10);
        info.nr_out--;
        op->nargs++;
        EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 11);
        op->nargs--;
        for (unsigned i = 0; i < nin; i++) {
            info.in[i].kind = TCG_CALL_ARG_BY_REF;
            EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 12);
            info.in[i].kind = TCG_CALL_ARG_NORMAL;
            info.in[i].arg_slot++;
            EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 13);
            info.in[i].arg_slot--;
            info.in[i].arg_idx++;
            EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 14);
            info.in[i].arg_idx--;
            info.in[i].tmp_subindex = 1;
            EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 15);
            info.in[i].tmp_subindex = 0;
            temps[nout + i].type = TCG_TYPE_I32;
            EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 16);
            temps[nout + i].type = TCG_TYPE_PTR;
        }
        if (nout) {
            temps[0].type = TCG_TYPE_I64;
            EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 18);
            temps[0].type = TCG_TYPE_I32;
        } else {
            /* Aliased input temporaries are valid; the allocator pins the
             * shared register and both vector inputs are read before store. */
            TCGArg saved = op->args[nin - 1];
            op->args[nin - 1] = op->args[1];
            EXPECT(bun_inline_setup_kind(op, false) == kind, 19);
            op->args[nin - 1] = saved;
        }
        if (kind <= 2) {
            const char *rejects[] = { "pshufb_mmx", "ptest_xmm", "sha256rnds2", "pshufb_xmm_extra" };
            for (unsigned i = 0; i < ARRAY_SIZE(rejects); i++) {
                info.name = rejects[i];
                EXPECT(bun_inline_setup_kind(op, false) == BUN_SETUP_NONE, 17);
            }
        }
#undef EXPECT
    }
done:
    g_free(op);
    return failure;
}
