/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Exact SHA256MSG2 on private architectural-register storage. The translator
 * still owns guest loads/faults, upper vector lanes, flags and feature checks.
 * Keep the ordinary helper allocator and three 8-byte pointer argument slots.
 * R0 is already freed by tcg_reg_alloc_call; TMP locals are emitter scratch.
 * Sequential source reads/stores match the original helper even for overlaps. */
static bool m2_msg2_matches(intptr_t func, const TCGHelperInfo *info)
{
    const unsigned signature = dh_typecode_void | (dh_typecode_ptr << 3) |
        (dh_typecode_ptr << 6) | (dh_typecode_ptr << 9);
    return (void *)func == info->func && info->name &&
        !(info->flags & TCG_CALL_NO_RETURN) && info->typemask == signature &&
        !strcmp(info->name, "sha256msg2");
}

#if DEFUSS_M2_MSG2_DIAGNOSTIC
extern uint64_t defuss_m2_msg2_banks[3];
static void m2_msg2_count(TCGContext *s, unsigned bank)
{
    intptr_t address = (intptr_t)&defuss_m2_msg2_banks[bank];
    tcg_wasm_out_op_const(s, OPC_I64_CONST, address);
    tcg_wasm_out_norm_ptr(s, 0);
    tcg_wasm_out_op_const(s, OPC_I64_CONST, address);
    tcg_wasm_out_norm_ptr(s, 0);
    tcg_wasm_out_op_ldst(s, OPC_I64_LOAD, 0, 0);
    tcg_wasm_out_op_const(s, OPC_I64_CONST, 1);
    tcg_wasm_out_op(s, OPC_I64_ADD);
    tcg_wasm_out_op_ldst(s, OPC_I64_STORE, 0, 0);
}
#endif

static void m2_msg2_address(TCGContext *s, unsigned local)
{
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, local);
    tcg_wasm_out_norm_ptr(s, 0);
}

static void m2_msg2_sigma(TCGContext *s)
{
    /* i32 rotr17 ^ rotr19 ^ logical shr10, modulo 2^32 throughout. */
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_const(s, OPC_I32_CONST, 17);
    tcg_wasm_out_op(s, OPC_I32_ROTR);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_const(s, OPC_I32_CONST, 19);
    tcg_wasm_out_op(s, OPC_I32_ROTR);
    tcg_wasm_out_op(s, OPC_I32_XOR);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_const(s, OPC_I32_CONST, 10);
    tcg_wasm_out_op(s, OPC_I32_SHR_U);
    tcg_wasm_out_op(s, OPC_I32_XOR);
}

static bool emit_m2_msg2(TCGContext *s, intptr_t func, const TCGHelperInfo *info)
{
    if (!m2_msg2_matches(func, info)) {
        return false;
    }
    tcg_debug_assert(REG_IDX(TCG_REG_R0) == REG_LOCAL_BASE + TCG_REG_R0);
    tcg_debug_assert(tcg_regset_test_reg(tcg_target_call_clobber_regs, TCG_REG_R0));
#if DEFUSS_M2_MSG2_DIAGNOSTIC
    m2_msg2_count(s, 1);
#endif
    int offset = 0;
    push_arg_i64(s, &offset);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, TMP64_LOCAL_0_IDX); /* d */
    push_arg_i64(s, &offset);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, TMP64_LOCAL_1_IDX); /* a */
    push_arg_i64(s, &offset);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, REG_IDX(TCG_REG_R0)); /* b */
    for (unsigned word = 0; word < 4; word++) {
        m2_msg2_address(s, TMP64_LOCAL_0_IDX); /* Store address beneath value. */
        m2_msg2_address(s, TMP64_LOCAL_1_IDX);
        tcg_wasm_out_op_ldst(s, OPC_I32_LOAD, 0, word * 4);
        m2_msg2_address(s, word < 2 ? REG_IDX(TCG_REG_R0) : TMP64_LOCAL_0_IDX);
        tcg_wasm_out_op_ldst(s, OPC_I32_LOAD, 0, (word < 2 ? word + 2 : word - 2) * 4);
        tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, TMP32_LOCAL_0_IDX);
        m2_msg2_sigma(s);
        tcg_wasm_out_op(s, OPC_I32_ADD);
        tcg_wasm_out_op_ldst(s, OPC_I32_STORE, 0, word * 4);
    }
    return true;
}
