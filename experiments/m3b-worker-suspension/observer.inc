/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Observation only. Included before the unchanged M3b service helper. */
#ifdef TARGET_X86_64
#define M3S_MAGIC UINT32_C(0x4d335357)
#define M3S_SLOTS 4u
#define M3S_STRIDE 640u
#define M3S_HEADER 64u
#define M3S_WORDS (M3S_HEADER + M3S_SLOTS * M3S_STRIDE)
static uint32_t m3s_words[M3S_WORDS] = {
    [0] = M3S_MAGIC, [1] = 1, [2] = M3S_WORDS,
    [3] = M3S_SLOTS, [4] = M3S_STRIDE, [14] = M3S_HEADER,
};
static void m3s_put(uint32_t *w, unsigned at, uint64_t value)
{ w[at] = value; w[at + 1] = value >> 32; }
EMSCRIPTEN_KEEPALIVE int defuss_m3s_abi(void);
EMSCRIPTEN_KEEPALIVE int defuss_m3s_abi(void) { return 1; }
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3s_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3s_data(void)
{ return (uintptr_t)m3s_words; }
static void m3s_error(uint32_t *slot, unsigned code)
{
    if (!m3s_words[7]) { m3s_words[7] = code; }
    if (slot && !slot[28]) { slot[28] = code; }
}
static void m3s_state(uint32_t *w, CPUArchState *env)
{
    static const unsigned order[16] = {
        R_EAX, R_EBX, R_ECX, R_EDX, R_ESI, R_EDI, R_EBP, R_ESP,
        8, 9, 10, 11, 12, 13, 14, 15,
    };
    for (unsigned i = 0; i < 16; i++) { m3s_put(w, 2 * i, env->regs[order[i]]); }
    m3s_put(w, 32, env->eip); m3s_put(w, 34, env->eflags);
    m3s_put(w, 36, env->cc_src); m3s_put(w, 38, env->cc_dst);
    m3s_put(w, 40, env->cc_src2); w[42] = env->cc_op; w[43] = env->df;
    w[44] = env->hflags; w[45] = env->hflags2;
    m3s_put(w, 46, env->cr[0]); m3s_put(w, 48, env->cr[2]);
    m3s_put(w, 50, env->cr[3]); m3s_put(w, 52, env->cr[4]);
    m3s_put(w, 54, env->efer); w[56] = env->mxcsr;
    w[57] = env->fpuc; w[58] = env->fpus; w[59] = env->fpstt;
    for (unsigned i = 0; i < 8; i++) { w[60 + i / 4] |= (uint32_t)env->fptags[i] << ((i % 4) * 8); }
    for (unsigned i = 0; i < 8; i++) {
        const SegmentCache *s = i < 6 ? &env->segs[i] : i == 6 ? &env->ldt : &env->tr;
        unsigned at = 64 + i * 5;
        w[at] = s->selector; m3s_put(w, at + 1, s->base);
        w[at + 3] = s->limit; w[at + 4] = s->flags;
    }
}
/* Caller has checked the unchanged countdown/full-capacity predicate. */
static unsigned m3s_before(CPUArchState *env, const void *owner,
                           uint64_t entry_pc, bool compiled)
{
    if (!defuss_m3b_profile_enabled() || !env->m3b_service_debt) { return 0; }
    if (qatomic_read(&m3s_words[6])) { m3s_error(NULL, 1); return 0; }
    if (m3s_words[5] >= M3S_SLOTS) {
        if (m3s_words[8] != UINT32_MAX) { m3s_words[8]++; }
        return 0;
    }
    unsigned token = ++m3s_words[5];
    uint32_t *w = m3s_words + M3S_HEADER + (token - 1) * M3S_STRIDE;
    const struct WasmTBHeader *h = owner;
    if (env->m3b_service_debt > 2 || !h || !h->m3b.fused || !m3_known(&h->m3)) {
        m3s_error(w, 2); w[1] = 3; return 0;
    }
    w[0] = token; w[1] = 1; w[2] = compiled; w[3] = env->m3b_service_debt;
    m3s_put(w, 4, (uintptr_t)pthread_self()); m3s_put(w, 6, entry_pc);
    m3s_put(w, 8, (uintptr_t)owner); m3s_put(w, 10, h->m3.generation);
    m3s_put(w, 12, h->m3.owner); w[14] = h->m3.valid; w[15] = h->m3.eligibility;
    m3s_put(w, 16, (uintptr_t)&env->m3b_service_debt);
    w[20] = qatomic_read(&m3b_words[M3B_B_ATTEMPTS]);
    w[21] = qatomic_read(&m3b_words[M3B_SERVICE_PAID]);
    w[22] = qatomic_read(&m3b_words[M3B_B_REQUESTED]); w[23] = 1;
    w[29] = qatomic_read(&instances_global);
    m3s_put(m3s_words, 12, (uintptr_t)m3b_words);
    m3s_put(m3s_words, 16, (uintptr_t)&instances_global);
    m3s_state(w + 32, env);
    qatomic_store_release(&m3s_words[6], token);
    return token;
}
static void m3s_after(CPUArchState *env, unsigned token)
{
    if (!token) { return; }
    if (token > M3S_SLOTS || qatomic_read(&m3s_words[6]) != token) {
        m3s_error(NULL, 3); return;
    }
    uint32_t *w = m3s_words + M3S_HEADER + (token - 1) * M3S_STRIDE;
    w[24] = qatomic_read(&m3b_words[M3B_B_ATTEMPTS]);
    w[25] = qatomic_read(&m3b_words[M3B_SERVICE_PAID]);
    w[26] = qatomic_read(&m3b_words[M3B_B_REQUESTED]);
    w[27] = env->m3b_service_debt; w[30] = qatomic_read(&instances_global);
    m3s_state(w + 160, env);
    if (w[18] != 4 || w[27] || memcmp(w + 32, w + 160, 128 * sizeof(uint32_t)) ||
        (uint64_t)w[24] != (uint64_t)w[20] + 1 ||
        (uint64_t)w[25] != (uint64_t)w[21] + 1 ||
        (uint64_t)w[26] != (uint64_t)w[22] + (w[3] == 2)) { m3s_error(w, 4); }
    for (unsigned i = 0; i < 4; i++) {
        static const unsigned before[4] = {0, 1, 0, 2};
        static const unsigned after[4] = {1, 0, 2, 0};
        const uint32_t *e = w + 288 + i * 64;
        if (e[0] != i + 1 || e[1] != before[i] || e[2] != after[i] || e[3] != 1 ||
            e[4] != w[4] || e[5] != w[5] || e[6] || e[7] != w[24] ||
            e[8] != w[25] || e[9] != w[26] || e[11] != token) { m3s_error(w, 5); }
    }
    w[1] = w[28] ? 3 : 2;
    if (w[1] == 2) { m3s_words[9]++; }
    qatomic_store_release(&m3s_words[6], 0);
}

#endif /* TARGET_X86_64 */
