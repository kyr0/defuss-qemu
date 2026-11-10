/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Diagnostic draft. Include after the fused-entry helpers and
 * before m3b_call_wasm_tb. This is a separate ABI; the128-word bank is unchanged.
 * No owner, generated function, instance or host guest-RAM pointer is retained.
 */
#define M3B_BOUNDARY_MAGIC UINT32_C(0x4d334253)
#define M3B_BOUNDARY_WORDS 256u
#define M3B_BOUNDARY_REQUESTS 32u
enum m3b_boundary_status {
    M3B_BOUNDARY_IDLE, M3B_BOUNDARY_ARMED, M3B_BOUNDARY_ACTIVE,
    M3B_BOUNDARY_COMPLETE, M3B_BOUNDARY_FAILED, M3B_BOUNDARY_WRITING,
};
enum m3b_boundary_failure {
    M3B_BOUNDARY_TCI = 1, M3B_BOUNDARY_ORDINARY, M3B_BOUNDARY_INELIGIBLE,
    M3B_BOUNDARY_DIRTY, M3B_BOUNDARY_RETURN, M3B_BOUNDARY_EIP,
    M3B_BOUNDARY_FORCE, M3B_BOUNDARY_FLAGS, M3B_BOUNDARY_CC_OP,
    M3B_BOUNDARY_ACCOUNTING, M3B_BOUNDARY_DUPLICATE,
};
static uint32_t m3b_boundary[M3B_BOUNDARY_WORDS] = {
    [0] = M3B_BOUNDARY_MAGIC, [1] = 1,
    [6] = M3B_BOUNDARY_WORDS, [7] = 64,
};

static void m3b_boundary_put64(unsigned at, uint64_t value)
{
    m3b_boundary[at] = value;
    m3b_boundary[at + 1] = value >> 32;
}

static void m3b_boundary_failed(unsigned reason)
{
    m3b_boundary[5] = reason;
    qatomic_store_release(&m3b_boundary[2], M3B_BOUNDARY_FAILED);
}

EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3b_boundary_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3b_boundary_data(void)
{ return (uintptr_t)m3b_boundary; }

EMSCRIPTEN_KEEPALIVE int defuss_m3b_boundary_arm(unsigned request,
                                               unsigned mode, uint64_t pc);
EMSCRIPTEN_KEEPALIVE int defuss_m3b_boundary_arm(unsigned request,
                                               unsigned mode, uint64_t pc)
{
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
    /* External host must confirm QMP paused and all CPUs stopped. As with
     * watch configuration, this main-thread API does not read another TLS. */
    if (!runstate_check(RUN_STATE_PAUSED) || (mode != 1 && mode != 2) ||
        pc < 0x10000 || pc > (UINT64_C(1) << 47) - 128) { return -1; }
    if (!defuss_m3b_profile_enabled()) { return -2; }
    unsigned status = qatomic_load_acquire(&m3b_boundary[2]);
    if (status != M3B_BOUNDARY_IDLE && status != M3B_BOUNDARY_COMPLETE) {
        return -3;
    }
    if (qatomic_cmpxchg(&m3b_boundary[2], status, M3B_BOUNDARY_WRITING) != status) {
        return -3;
    }
    /* Read request metadata only after acquiring the writer state, so even
     * competing native callers cannot race a bank clear/publication. */
    if (request != m3b_boundary[3] + 1 || request > M3B_BOUNDARY_REQUESTS) {
        qatomic_store_release(&m3b_boundary[2], status);
        return -4;
    }
    memset(m3b_boundary + 3, 0,
           (M3B_BOUNDARY_WORDS - 3) * sizeof(*m3b_boundary));
    m3b_boundary[3] = request;
    m3b_boundary[4] = mode;
    m3b_boundary[6] = M3B_BOUNDARY_WORDS;
    m3b_boundary[7] = 64;
    m3b_boundary_put64(8, pc);
    qatomic_store_release(&m3b_boundary[2], M3B_BOUNDARY_ARMED);
    return 0;
#else
    return -2;
#endif
}

#ifdef TARGET_X86_64
/* cpu_compute_eflags reads env->eflags/df and calls cpu_cc_compute_all, which
 * passes value arguments to pure helper_cc_compute_all. It does not use
 * helper_read_eflags (that helper normalizes/mutates lazy flags). Preserve and
 * compare every native flag field before publishing the observation anyway. */
static bool m3b_boundary_state(CPUArchState *env, unsigned at)
{
    static const unsigned order[16] = {
        R_EAX, R_EBX, R_ECX, R_EDX, R_ESI, R_EDI, R_EBP, R_ESP,
        8, 9, 10, 11, 12, 13, 14, 15,
    };
    if (env->cc_op >= CC_OP_DYNAMIC) {
        m3b_boundary_failed(M3B_BOUNDARY_CC_OP);
        return false;
    }
    for (unsigned i = 0; i < 16; i++) {
        m3b_boundary_put64(at + i * 2, env->regs[order[i]]);
    }
    m3b_boundary_put64(at + 32, env->eip);
    m3b_boundary_put64(at + 36, env->eflags);
    m3b_boundary_put64(at + 38, env->cc_dst);
    m3b_boundary_put64(at + 40, env->cc_src);
    m3b_boundary_put64(at + 42, env->cc_src2);
    m3b_boundary[at + 44] = env->cc_op;
    m3b_boundary[at + 45] = env->df;
    m3b_boundary[at + 46] = env->hflags;
    m3b_boundary[at + 47] = env->hflags2;
    m3b_boundary_put64(at + 48, env->segs[R_CS].base);
    m3b_boundary_put64(at + 50, env->segs[R_FS].base);
    m3b_boundary_put64(at + 52, env->segs[R_GS].base);
    m3b_boundary_put64(at + 54, env->cr[0]);
    m3b_boundary_put64(at + 56, env->cr[4]);
    m3b_boundary_put64(at + 58, env->efer);
    m3b_boundary[at + 34] = cpu_compute_eflags(env);
    if (m3b_pair(m3b_boundary + at + 36) != env->eflags ||
        m3b_pair(m3b_boundary + at + 38) != env->cc_dst ||
        m3b_pair(m3b_boundary + at + 40) != env->cc_src ||
        m3b_pair(m3b_boundary + at + 42) != env->cc_src2 ||
        m3b_boundary[at + 44] != env->cc_op ||
        m3b_boundary[at + 45] != (uint32_t)env->df ||
        m3b_boundary[at + 46] != env->hflags ||
        m3b_boundary[at + 47] != env->hflags2) {
        m3b_boundary_failed(M3B_BOUNDARY_FLAGS);
        return false;
    }
    return true;
}
#endif

/* Call for every actual tier at the final call boundary, not just successful
 * matching fused calls. An ordinary/TCI first hit is retained as failure. */
static void m3b_boundary_entry(CPUArchState *env)
{
#ifdef TARGET_X86_64
    /* An ACTIVE request cannot reach a new outer dispatch: the permitted
     * body has no helper/coroutine. A nonlocal escape must never leak force. */
    if (qatomic_load_acquire(&m3b_boundary[2]) == M3B_BOUNDARY_ACTIVE ||
        env->m3b_boundary_force) {
        env->m3b_boundary_force = 0;
        m3b_boundary_failed(M3B_BOUNDARY_DUPLICATE);
    }
#endif
}

static unsigned m3b_boundary_before(CPUArchState *env, const void *code,
                                    bool compiled)
{
#ifdef TARGET_X86_64
    unsigned status = qatomic_load_acquire(&m3b_boundary[2]);
    if (status == M3B_BOUNDARY_ACTIVE) {
        env->m3b_boundary_force = 0;
        m3b_boundary_failed(M3B_BOUNDARY_DUPLICATE);
        return 0;
    }
    if (status != M3B_BOUNDARY_ARMED ||
        env->eip != m3b_pair(m3b_boundary + 8)) { return 0; }
    if (qatomic_cmpxchg(&m3b_boundary[2], M3B_BOUNDARY_ARMED,
                       M3B_BOUNDARY_ACTIVE) != M3B_BOUNDARY_ARMED) { return 0; }
    unsigned token = m3b_boundary[3];
    m3b_boundary[17] = compiled;
    if (!compiled) { m3b_boundary_failed(M3B_BOUNDARY_TCI); return token; }
    if (!m3b_fused(code)) { m3b_boundary_failed(M3B_BOUNDARY_ORDINARY); return token; }
    if (!m3b_worker_eligible(env)) {
        m3b_boundary_failed(M3B_BOUNDARY_INELIGIBLE); return token;
    }
    if (env->m3b_boundary_force || env->m3b_service_debt) {
        m3b_boundary_failed(M3B_BOUNDARY_DIRTY); return token;
    }
    const struct WasmTBHeader *h = code;
    const TranslationBlock *owner = (const void *)h->m3.owner;
    m3b_boundary_put64(10, h->m3.generation);
    m3b_boundary[12] = h->m3b.b_offset;
    m3b_boundary[13] = h->m3b.bytes;
    m3b_boundary[30] = owner->icount;
    m3b_boundary[22] = qatomic_read(&m3b_words[M3B_SERVICE_PAID]);
    m3b_boundary[24] = qatomic_read(&m3b_words[M3B_B_ATTEMPTS]);
    m3b_boundary[26] = qatomic_read(&m3b_words[M3B_B_REQUESTED]);
    if (m3b_boundary[19]++) {
        m3b_boundary_failed(M3B_BOUNDARY_DUPLICATE); return token;
    }
    if (!m3b_boundary_state(env, 32)) { return token; }
    /* The diagnostic flag is examined only at B, after ordinary insn_start.
     * The generic A pending check and normal generated code are unchanged. */
    env->m3b_boundary_force = m3b_boundary[4] == 2 ? 1 : 0;
    return token;
#else
    return 0;
#endif
}

/* Call immediately after the actual generated/TCI call, before debt payment.
 * The real IDX1/REQUESTED return and materialized EIP are observed unchanged. */
static bool m3b_boundary_owns_token(unsigned token)
{
    if (!token) { return false; }
    unsigned status = qatomic_load_acquire(&m3b_boundary[2]);
    if (status == M3B_BOUNDARY_FAILED) { return false; }
    if (token != m3b_boundary[3] || status != M3B_BOUNDARY_ACTIVE) {
        m3b_boundary_failed(M3B_BOUNDARY_DUPLICATE);
        return false;
    }
    return true;
}

static void m3b_boundary_after(CPUArchState *env, uintptr_t result, unsigned token)
{
#ifdef TARGET_X86_64
    if (!m3b_boundary_owns_token(token)) { return; }
    unsigned forced = env->m3b_boundary_force;
    env->m3b_boundary_force = 0;
    m3b_boundary[16] = forced;
    /* Force supplies only the private branch selector. Supply the ordinary
     * CPU exit request after the real return; never write pending from IR. */
    if (forced == 2) { cpu_exit(env_cpu(env)); }
    if (m3b_boundary[19] != 1 || m3b_boundary[20]++) {
        m3b_boundary_failed(M3B_BOUNDARY_DUPLICATE); return;
    }
    m3b_boundary[14] = result & TB_EXIT_MASK;
    m3b_boundary[15] = env->m3b_service_debt;
    if (!m3b_boundary_state(env, 96)) { return; }
    m3b_boundary[18] = 2;
    unsigned mode = m3b_boundary[4];
    if (ctx.tb_ptr || (result & TB_EXIT_MASK) !=
        (mode == 1 ? TB_EXIT_IDX1 : TB_EXIT_REQUESTED) ||
        env->m3b_service_debt != (mode == 1 ? 1 : 2)) {
        m3b_boundary_failed(M3B_BOUNDARY_RETURN); return;
    }
    if (env->eip != m3b_pair(m3b_boundary + 8) +
        (mode == 1 ? 0 : m3b_boundary[12])) {
        m3b_boundary_failed(M3B_BOUNDARY_EIP); return;
    }
    if (forced != (mode == 1 ? 0 : 2)) {
        m3b_boundary_failed(M3B_BOUNDARY_FORCE); return;
    }
#endif
}

/* Called after unmodified service helper returns, including actual Asyncify
 * rewind. These exact per-request counts cannot silently accept replay. */
static void m3b_boundary_complete(CPUArchState *env, unsigned token)
{
#ifdef TARGET_X86_64
    if (!m3b_boundary_owns_token(token)) { return; }
    if (m3b_boundary[18] != 2 || m3b_boundary[21]++) {
        m3b_boundary_failed(M3B_BOUNDARY_DUPLICATE); return;
    }
    m3b_boundary[23] = qatomic_read(&m3b_words[M3B_SERVICE_PAID]);
    m3b_boundary[25] = qatomic_read(&m3b_words[M3B_B_ATTEMPTS]);
    m3b_boundary[27] = qatomic_read(&m3b_words[M3B_B_REQUESTED]);
    m3b_boundary[28] = env->m3b_service_debt;
    m3b_boundary[29] = m3b_asyncify_normal();
    if (!m3b_boundary_state(env, 160)) { return; }
    m3b_boundary[18] = 3;
    if (env->m3b_boundary_force || env->m3b_service_debt ||
        !m3b_boundary[29] || qatomic_read(&m3b_words[4]) ||
        memcmp(m3b_boundary + 96, m3b_boundary + 160, 64 * sizeof(uint32_t)) ||
        (uint64_t)m3b_boundary[23] != (uint64_t)m3b_boundary[22] + 1 ||
        (uint64_t)m3b_boundary[25] != (uint64_t)m3b_boundary[24] + 1 ||
        (uint64_t)m3b_boundary[27] != (uint64_t)m3b_boundary[26] +
            (m3b_boundary[4] == 2)) {
        m3b_boundary_failed(M3B_BOUNDARY_ACCOUNTING); return;
    }
    qatomic_store_release(&m3b_boundary[2], M3B_BOUNDARY_COMPLETE);
#endif
}
