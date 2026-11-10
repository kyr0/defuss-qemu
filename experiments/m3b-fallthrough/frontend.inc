/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Included in target/i386/tcg/translate.c after emit.c.inc.  Source draft;
 * QEMU's normal decoder and register writeback remain authoritative. */

static bool m3b_match_decoded(DisasContext *s, X86DecodedInsn *d)
{
    const struct m3b_plan *p = s->m3b_plan;
    unsigned i = s->base.num_insns - 1;
    if (!p || i >= p->count) { return false; }
    const struct m3b_insn *insn = &p->insns[i];
    if (s->base.pc_next != s->base.pc_first + insn->offset ||
        s->pc != s->base.pc_next + insn->length ||
        s->prefix != (insn->rex ? PREFIX_REX : 0) ||
        !CODE64(s) || s->aflag != MO_64 ||
        (s->dflag != MO_32 && s->dflag != MO_64) ||
        d->e.has_intercept || d->e.check) {
        return false;
    }
    for (unsigned n = 0; n < ARRAY_SIZE(d->op); n++) {
        if (d->op[n].has_ea ||
            (d->op[n].unit != X86_OP_SKIP &&
             d->op[n].unit != X86_OP_INT &&
             d->op[n].unit != X86_OP_IMM)) {
            return false;
        }
    }
    switch (insn->kind) {
    case M3B_ADD: return d->e.gen == gen_ADD;
    case M3B_OR: return d->e.gen == gen_OR;
    case M3B_AND: case M3B_TEST: return d->e.gen == gen_AND;
    case M3B_SUB: case M3B_CMP: return d->e.gen == gen_SUB;
    case M3B_XOR: return d->e.gen == gen_XOR;
    case M3B_MOV: case M3B_NOP: return d->e.gen == gen_MOV;
    case M3B_IMUL: return d->e.gen == gen_IMUL3;
    case M3B_SHL: return d->e.gen == gen_SHL;
    case M3B_SHR: return d->e.gen == gen_SHR;
    case M3B_SAR: return d->e.gen == gen_SAR;
    case M3B_INC: return d->e.gen == gen_INC;
    case M3B_DEC: return d->e.gen == gen_DEC;
    case M3B_NOT: return d->e.gen == gen_NOT;
    case M3B_NEG: return d->e.gen == gen_NEG;
    case M3B_JCC:
        return d->e.gen == gen_Jcc && i == p->jcc_index &&
            s->pc + d->immediate == s->base.pc_first + p->bytes;
    case M3B_JMP:
        return d->e.gen == gen_JMP && i + 1 == p->count &&
            s->pc + d->immediate == s->base.pc_first;
    default: return false;
    }
}

/* Called before decoding B, after its ordinary insn_start recovery record.
 * This is a private exit: the generic TB-entry exit must keep meaning A. */
static void m3b_gen_b_entry(DisasContext *s)
{
    TCGLabel *proceed = gen_new_label();
    TCGLabel *forced = gen_new_label();
    TCGLabel *requested = gen_new_label();
    TCGv_i32 pending = tcg_temp_new_i32();
    CCOp saved_cc_op = s->cc_op;
    bool saved_dirty = s->cc_op_dirty;
    target_ulong saved_pc = s->pc_save;

    /* A logical B dispatch attempt owes one service turn, even if the pending
     * interrupt prevents its first guest instruction.  Cold TCI chaining did
     * not previously have a service call here; that distinction is explicit. */
    tcg_gen_st_i32(tcg_constant_i32(1), tcg_env,
                  offsetof(CPUX86State, m3b_service_debt));
    /* Separate, default-disarmed diagnostic selector. This does not affect
     * shape/IR admission and supplies no helper, sleep or guest-RAM access. */
    tcg_gen_ld_i32(pending, tcg_env,
                  offsetof(CPUX86State, m3b_boundary_force));
    tcg_gen_brcondi_i32(TCG_COND_NE, pending, 0, forced);
    tcg_gen_ld_i32(pending, tcg_env,
                  offsetof(CPUState, neg.icount_decr.u32) - sizeof(CPUState));
    tcg_gen_brcondi_i32(TCG_COND_GE, pending, 0, proceed);
    tcg_gen_br(requested);
    gen_set_label(forced);
    tcg_gen_st_i32(tcg_constant_i32(2), tcg_env,
                  offsetof(CPUX86State, m3b_boundary_force));
    gen_set_label(requested);
    gen_update_cc_op(s);
    gen_update_eip_cur(s);
    tcg_gen_st_i32(tcg_constant_i32(2), tcg_env,
                  offsetof(CPUX86State, m3b_service_debt));
    tcg_gen_exit_tb(s->base.tb, TB_EXIT_REQUESTED);
    gen_set_label(proceed);
    s->cc_op = saved_cc_op;
    s->cc_op_dirty = saved_dirty;
    s->pc_save = saved_pc;
}

/* A broad opcode predecode is deliberately insufficient.  Reject any helper,
 * guest-memory access or indirect control flow in the completed actual IR.
 * Host loads/stores are QEMU architectural state and the pending/debt fields. */
static bool m3b_ir_safe(void)
{
    TCGOp *op;
    QTAILQ_FOREACH(op, &tcg_ctx->ops, link) {
        const char *name = tcg_op_defs[op->opc].name;
        if (op->opc == INDEX_op_call || op->opc == INDEX_op_goto_ptr ||
            !strncmp(name, "qemu_", 5) || !strncmp(name, "atomic_", 7)) {
            return false;
        }
    }
    return true;
}

static void m3b_translate_code(CPUState *cpu, TranslationBlock *tb,
                              int *max_insns, vaddr pc, void *host_pc)
{
    struct m3b_plan plan;
    DisasContext dc = { 0 };
    unsigned remaining = TARGET_PAGE_SIZE - (pc & ~TARGET_PAGE_MASK);
    tb->m3b_fused = 0;
    tb->m3b_bytes = tb->m3b_b_offset = 0;
    tb->m3b_retry = 0;

    if (!tb->m3b_suppress && host_pc && defuss_m3b_can_form(tb) &&
        defuss_m3b_ram_span(host_pc, MIN(remaining, M3B_MAX_BYTES), tb_page_addr0(tb)) &&
        m3b_predecode(host_pc, MIN(remaining, M3B_MAX_BYTES), remaining,
                      *max_insns, &plan) == M3B_SHAPE_OK) {
        dc.m3b_plan = &plan;
        tb->m3b_trial = 1;
        defuss_m3b_event_pc(M3B_TRIALS, pc);
    }
    translator_loop(cpu, tb, max_insns, pc, host_pc, &i386_tr_ops, &dc.base,
                    TCG_TYPE_VA);
    if (!dc.m3b_plan) { return; }
    if (dc.m3b_failed || dc.m3b_matched != plan.count ||
        dc.base.num_insns != plan.count || tb->size != plan.bytes ||
        dc.base.is_jmp != DISAS_NORETURN || !m3b_ir_safe()) {
        /* The caller discards the WHOLE IR and retries the ordinary translator
         * once, with its original instruction limit and a fresh context. */
        tb->m3b_retry = 1;
        defuss_m3b_event_pc(M3B_IR_REJECTS, pc);
        return;
    }
    tb->m3b_fused = 1;
    tb->m3b_bytes = plan.bytes;
    tb->m3b_b_offset = plan.b_offset;
    defuss_m3b_note(M3B_FORMED);
}
