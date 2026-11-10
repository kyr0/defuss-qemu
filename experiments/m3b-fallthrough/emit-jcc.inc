    if (s->m3b_plan) {
        TCGLabel *fallthrough = gen_new_label();
        /* gen_prepare_cc inside gen_jcc may change the lazy-flags model. Save
         * continuation state only AFTER it and its cc_op synchronization. */
        gen_jcc(s, (decode->b & 0xf) ^ 1, fallthrough);
        CCOp saved_cc_op = s->cc_op;
        bool saved_dirty = s->cc_op_dirty;
        target_ulong saved_pc = s->pc_save;
        gen_jmp_rel(s, s->dflag, decode->immediate, 0);
        gen_set_label(fallthrough);
        s->cc_op = saved_cc_op;
        s->cc_op_dirty = saved_dirty;
        s->pc_save = saved_pc;
        s->base.is_jmp = DISAS_NEXT;
        return;
    }
