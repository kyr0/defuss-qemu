/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Included after existing M3b worker helpers; declarations precede M3a call.
 * Diagnostic only: shared value bank, no function/instance references retained. */
static uint32_t m3cc_bank[M3CC_WORDS] = {
    [0] = M3CC_MAGIC, [1] = M3CC_ABI, [5] = M3CC_WORDS,
    [6] = M3CC_WATCHES, [7] = M3CC_OFFSET, [8] = M3CC_STRIDE,
    [9] = M3CC_TUPLE,
};
static void m3cc_atomic_inc(unsigned at)
{
    uint32_t old = qatomic_read(m3cc_bank + at);
    while (old != UINT32_MAX) {
        uint32_t seen = qatomic_cmpxchg(m3cc_bank + at, old, old + 1);
        if (seen == old) { return; }
        old = seen;
    }
    qatomic_set(m3cc_bank + 4, 1);
    m3cc_fault(m3cc_bank, NULL, M3CC_OVERFLOW);
}
static bool m3cc_profile(void)
{
    unsigned s = defuss_m3b_profile_status();
    return (s & ~M3B_ENABLED) ==
        (M3B_CHOSEN | M3B_LOCKED | M3B_DIAGNOSTIC_PROFILE |
         M3B_GRAPH_READY | M3B_PROFILE_ELIGIBLE) &&
        !defuss_m3b_profile_reasons() && wasm44_single_ctx() &&
        defuss_m3b_dynamic_profile();
}
static bool m3cc_stopped(bool initial)
{
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
    /* The frozen profile's before-realize/backend/control-surface fences
     * establish a permanent single boot CPU before this list is traversed. */
    if (!m3cc_profile() || !m3_enabled() ||
        !(runstate_check(RUN_STATE_PAUSED) ||
          (initial && runstate_check(RUN_STATE_PRELAUNCH)))) { return false; }
    unsigned count = 0;
    CPUState *cpu;
    CPU_FOREACH(cpu) {
        if (!qatomic_read(&cpu->stopped)) { return false; }
        count++;
    }
    return count == 1 && qatomic_read(&thread_idx_max) <= 1;
#else
    return false;
#endif
}
static void m3cc_lock(void)
{
    uint32_t old = qatomic_read(m3cc_bank + 2);
    while (!(old & M3CC_LOCKED)) {
        uint32_t seen = qatomic_cmpxchg(m3cc_bank + 2, old, old | M3CC_LOCKED);
        if (seen == old) { return; }
        old = seen;
    }
}
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3cc_abi(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3cc_abi(void) { return M3CC_ABI; }
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3cc_status(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3cc_status(void)
{ return qatomic_load_acquire(m3cc_bank + 2); }
EMSCRIPTEN_KEEPALIVE int defuss_m3cc_configure(unsigned enabled);
EMSCRIPTEN_KEEPALIVE int defuss_m3cc_configure(unsigned enabled)
{
    if (enabled > 1 || qatomic_cmpxchg(m3cc_bank + 2, 0,
            M3CC_CHOSEN | (enabled ? M3CC_ENABLED : 0)) != 0) {
        m3cc_atomic_inc(11); return -1;
    }
    return 0;
}
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3cc_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3cc_data(void)
{
    if (!m3cc_stopped(true) || (defuss_m3cc_status() & M3CC_WRITING)) {
        m3cc_atomic_inc(11); return 0;
    }
    return (uintptr_t)m3cc_bank;
}
static bool m3cc_write_begin(void)
{
    return m3cc_stopped(false) && qatomic_read(&thread_idx_max) == 1 &&
        qatomic_cmpxchg(m3cc_bank + 2, 7, 7 | M3CC_WRITING) == 7;
}
static void m3cc_write_end(void)
{ qatomic_store_release(m3cc_bank + 2, 7); }
EMSCRIPTEN_KEEPALIVE int defuss_m3cc_watch(unsigned slot, uint64_t pc,
                                        unsigned require_fused, unsigned epoch);
EMSCRIPTEN_KEEPALIVE int defuss_m3cc_watch(unsigned slot, uint64_t pc,
                                        unsigned require_fused, unsigned epoch)
{
    if (slot >= M3CC_WATCHES || require_fused > 1 ||
        (pc && (pc < 0x100000 || pc >= UINT64_C(0x100000000))) ||
        (!pc && require_fused) || !m3cc_write_begin()) {
        m3cc_atomic_inc(11); return -1;
    }
    const uint32_t *a = m3_words + M3_WATCH_OFFSET + slot * M3_WATCH_STRIDE;
    const uint32_t *b = m3b_words + M3B_WATCH_OFFSET + slot * M3B_WATCH_STRIDE;
    bool valid = m3cc_bank[10] != UINT32_MAX && epoch == m3cc_bank[10] + 1 &&
        (!pc || (m3_read_pair(a) == pc && m3_read_pair(a + 2) == pc + 1 &&
        a[7] == 1 && m3b_pair(b) == pc && m3b_pair(b + 2) == pc + 1)) &&
        (!require_fused || defuss_m3b_profile_enabled());
    for (unsigned i = 0; i < M3CC_WATCHES; i++) {
        const uint32_t *w = m3cc_bank + M3CC_OFFSET + i * M3CC_STRIDE;
        if (pc && i != slot && w[2] && m3cc_pair(w) == pc) { valid = false; }
    }
    if (!valid) { m3cc_write_end(); m3cc_atomic_inc(11); return -2; }
    uint32_t *w = m3cc_bank + M3CC_OFFSET + slot * M3CC_STRIDE;
    memset(w, 0, M3CC_STRIDE * sizeof(*w));
    m3cc_put(w, pc); w[2] = !!pc; w[3] = require_fused; w[4] = epoch;
    m3cc_bank[10] = epoch;
    m3cc_bank[13] = (m3cc_bank[13] & ~(1u << slot)) | (!!pc << slot);
    m3cc_write_end(); return 0;
}
#ifdef TARGET_X86_64
_Static_assert(M3CC_SEGMENT_FLAGS_MASK == (DESC_G_MASK | DESC_B_MASK |
    DESC_L_MASK | DESC_AVL_MASK | DESC_P_MASK | DESC_DPL_MASK |
    DESC_S_MASK | DESC_TYPE_MASK), "Census ABI2 retains every segment access flag");
static void m3cc_segment(uint32_t *p, const SegmentCache *s)
{
    p[0] = s->selector; m3cc_put(p + 1, s->base);
    p[3] = s->limit; p[4] = s->flags & M3CC_SEGMENT_FLAGS_MASK;
}
static void m3cc_tuple(uint32_t *p, CPUArchState *env,
                       const TranslationBlock *tb, const struct WasmTBHeader *h,
                       uint64_t actual_pc)
{
    memset(p, 0, M3CC_TUPLE * sizeof(*p));
    const struct m3_descriptor *d = &h->m3;
    m3cc_put(p, actual_pc); m3cc_put(p + 2, (uintptr_t)tb);
    m3cc_put(p + 4, d->generation); m3cc_put(p + 6, (uintptr_t)h);
    m3cc_put(p + 8, d->translation_pc); m3cc_put(p + 10, d->page0);
    m3cc_put(p + 12, d->page1); p[14] = tb->flags; p[15] = tb_cflags(tb);
    p[16] = h->m3b.fused; p[17] = env->hflags; p[18] = env->hflags2;
    p[19] = env->eflags & (IOPL_MASK | TF_MASK | RF_MASK | VM_MASK | AC_MASK | IF_MASK);
    m3cc_put(p + 20, env->cr[0]); m3cc_put(p + 22, env->cr[3]);
    m3cc_put(p + 24, env->cr[4]); m3cc_put(p + 26, env->efer);
    for (unsigned i = 0; i < 6; i++) {
        m3cc_segment(p + 28 + i * 5, &env->segs[i]);
        p[M3CC_RAW_SEGMENTS_BEGIN + i] = env->segs[i].flags;
    }
    m3cc_put(p + 58, env->gdt.base); p[60] = env->gdt.limit;
    m3cc_put(p + 61, env->idt.base); p[63] = env->idt.limit;
    m3cc_segment(p + 64, &env->ldt); m3cc_segment(p + 69, &env->tr);
    p[96] = env->ldt.flags; p[97] = env->tr.flags;
    for (unsigned i = 0; i < 8; i++) { m3cc_put(p + 74 + i * 2, env->dr[i]); }
}
static bool m3cc_normal_flags(uint32_t f, uint32_t c)
{
    return (f & (HF_PE_MASK | HF_LMA_MASK | HF_CS64_MASK | HF_CPL_MASK)) ==
        (HF_PE_MASK | HF_LMA_MASK | HF_CS64_MASK | HF_CPL_MASK) &&
        !(f & (HF_VM_MASK | HF_SMM_MASK | HF_GUEST_MASK | HF_TF_MASK |
               HF_INHIBIT_IRQ_MASK | HF_MPX_EN_MASK)) &&
        c == (CF_CLUSTER_MASK | CF_PCREL);
}
#endif
static void m3cc_note(CPUArchState *env, void *code, unsigned site)
{
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
    if (!(qatomic_load_acquire(m3cc_bank + 2) & M3CC_ENABLED) ||
        !qatomic_read(m3cc_bank + 13)) { return; }
    /* Diagnostic lookup validates the target address before any header/owner
     * dereference. The returned TB is observed only, never used for execution.
     * CPU execution holds its normal lifetime/RCU boundary throughout. */
    TranslationBlock *tb = code ? tcg_tb_lookup((uintptr_t)code) : NULL;
    bool address_ok = tb && tb->tc.ptr == code;
    struct WasmTBHeader *h = address_ok ? code : NULL;
    const struct m3_descriptor *d = h ? &h->m3 : NULL;
    bool known = d && m3_known(d);
    unsigned common = 0;
    if (defuss_m3cc_status() != 7 || !m3cc_profile() ||
        thread_idx != 0 || qatomic_read(&thread_idx_max) != 1 ||
        current_cpu != env_cpu(env) || qemu_in_coroutine() ||
        instance_budget != 12000 || !m3b_asyncify_normal()) {
        common |= M3CC_WORKER;
    }
    if (!known || d->owner != (uintptr_t)tb || !qatomic_read(&d->valid) ||
        (tb_cflags(tb) & CF_INVALID) || d->eligibility != M3_ELIGIBLE ||
        d->flags != tb->flags || d->cflags != tb_cflags(tb) ||
        d->page0 != tb_page_addr0(tb) || d->page1 != tb_page_addr1(tb)) {
        common |= M3CC_METADATA;
    }
    bool rf = (env->eflags & RF_MASK) != 0;
    uint64_t actual_pc = (env->hflags & HF_CS64_MASK) ? env->eip :
        (uint32_t)(env->segs[R_CS].base + env->eip);
    if (address_ok && !(tb_cflags(tb) & CF_PCREL)) { actual_pc = tb->pc; }
    uint32_t flags = env->hflags |
        (env->eflags & (IOPL_MASK | TF_MASK | RF_MASK | VM_MASK | AC_MASK));
    if (known && flags != d->flags) { common |= M3CC_FLAGS; }
    if (!address_ok) { m3cc_fault(m3cc_bank, NULL, M3CC_METADATA); }
    for (unsigned slot = 0; slot < M3CC_WATCHES; slot++) {
        uint32_t *w = m3cc_bank + M3CC_OFFSET + slot * M3CC_STRIDE;
        if (!w[2]) { continue; }
        uint64_t pc = m3cc_pair(w);
        if (actual_pc != pc) { continue; }
        unsigned faults = common, kind = M3CC_OTHER;
        uint32_t tuple[M3CC_TUPLE], *sample = NULL;
        if (!known || d->translation_pc != pc) { faults |= M3CC_PC; }
        if (!(faults & M3CC_METADATA)) {
            if (!m3cc_normal_flags(flags, d->cflags)) { faults |= M3CC_CONTEXT; }
            if (h->m3b.fused) {
                if (rf || h->m3b.magic != M3B_MAGIC || h->m3b.fused != 1 ||
                    h->m3b.budget != 1 || h->m3b.reserved ||
                    !tb->m3b_fused || tb->m3b_bytes != h->m3b.bytes ||
                    tb->m3b_b_offset != h->m3b.b_offset ||
                    tb->size != h->m3b.bytes || !h->m3b.b_offset ||
                    h->m3b.b_offset >= h->m3b.bytes || h->m3b.bytes > 128 ||
                    tb->icount > 32 || h->plan_id || h->aot_recipe ||
                    h->wasm_size <= 0 || d->page1 != (uint64_t)-1) {
                    faults |= M3CC_METADATA;
                } else { kind = M3CC_FUSED_NORMAL; }
            } else { kind = rf ? M3CC_ORDINARY_RF : M3CC_ORDINARY_NORMAL; }
            if (site == M3CC_COMPILED) {
                struct WasmInstanceInfo *instance = get_info_local(h);
                if (!instance || !instance->tb_func || instance->tb_ptr != h ||
                    instance->m3_generation != d->generation) { faults |= M3CC_METADATA; }
            }
            if (!(faults & M3CC_METADATA)) { m3cc_tuple(tuple, env, tb, h, actual_pc); sample = tuple; }
        }
        m3cc_record(m3cc_bank, slot, kind, site, rf, faults, sample);
    }
#endif
}

#include "m3cc-injection.inc"
