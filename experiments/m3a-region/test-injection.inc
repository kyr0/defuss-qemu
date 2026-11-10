/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Diagnostic companion, included only by the isolated region overlay. */
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
struct m3_injection {
    uint64_t pc, generation;
    unsigned action, matches, mutations;
    bool apply;
};
static gboolean m3_inject_iter(gpointer key, gpointer value, gpointer opaque)
{
    (void)key;
    TranslationBlock *tb = value;
    struct m3_injection *request = opaque;
    struct WasmTBHeader *h = (void *)tb->tc.ptr;
    struct m3_descriptor *d = &h->m3;
    if (!m3_known(d) || d->owner != (uintptr_t)tb ||
        d->translation_pc != request->pc || !h->info_ptr) { return false; }
    /* The instance array is worker-local, but this existing pointer in shared
     * TB memory names its current thread-0 slot. Never use the caller's TLS. */
    struct WasmInstanceInfo *instance = get_info(h, 0);
    if (!instance || !instance->tb_func || !m3_test_candidate(d, request->pc,
            instance->m3_generation, instance->tb_ptr == h,
            (tb_cflags(tb) & CF_INVALID) != 0, qatomic_read(&d->valid) != 0,
            (tb->flags & HF_CPL_MASK) == 3)) { return false; }
    if (!request->apply) {
        request->generation = d->generation;
        /* Two matches are sufficient to reject ambiguity; do not overflow. */
        if (request->matches < 2) { request->matches++; }
    } else if (d->generation == request->generation) {
        if (request->action == M3_TEST_STALE_INSTANCE) {
            qatomic_set(&instance->m3_generation, 0);
        } else {
            qatomic_set(&d->valid, 0);
        }
        request->mutations++;
    }
    return false;
}
#endif

/* Test companion only: no branch, pending request or retained pointer is
 * added to the hot dispatcher. Caller must serialize QMP stop/inject/cont. */
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3_test_abi(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3_test_abi(void) { return 1; }
EMSCRIPTEN_KEEPALIVE int defuss_m3_test_inject(unsigned action, unsigned slot,
                                            uint64_t pc);
EMSCRIPTEN_KEEPALIVE int defuss_m3_test_inject(unsigned action, unsigned slot,
                                            uint64_t pc)
{
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
    unsigned stopped_cpu_count = 0;
    bool stopped = true;
    CPUState *cpu;
    CPU_FOREACH(cpu) {
        stopped_cpu_count++;
        stopped &= qatomic_read(&cpu->stopped);
    }
    const uint32_t *watch = m3_words + M3_WATCH_OFFSET +
        (slot < M3_WATCHES ? slot : 0) * M3_WATCH_STRIDE;
    if (!m3_test_request_valid(action, slot, pc, m3_read_pair(watch),
            m3_read_pair(watch + 2), m3_enabled(),
            runstate_check(RUN_STATE_PAUSED),
            stopped_cpu_count == 1 && stopped && wasm44_single_ctx() &&
            (qatomic_read(&m3_words[12]) & M3_CONFIG_LOCKED) &&
            !qatomic_read(&m3_words[M3_EXTRA_WORKER_REJECTS]), watch[7] != 0)) {
        m3_note(M3_INJECTION_REJECTS);
        return -1;
    }
    struct m3_injection request = {.pc = pc, .action = action};
    /* tcg_tb_foreach holds every region-tree lock during each traversal.
     * First find one live identity; then recheck and mutate that identity.
     * Neither pass retains an owner, instance or function pointer. */
    tcg_tb_foreach(m3_inject_iter, &request);
    if (request.matches != 1) {
        m3_note(M3_INJECTION_REJECTS);
        return -2;
    }
    request.apply = true;
    tcg_tb_foreach(m3_inject_iter, &request);
    if (request.mutations != 1) {
        m3_note(M3_INJECTION_REJECTS);
        return -3;
    }
    m3_note(action == M3_TEST_STALE_INSTANCE ? M3_INJECTED_STALE_INSTANCES :
                                             M3_INJECTED_INVALID_DESCRIPTORS);
    m3_words[50] = pc; m3_words[51] = pc >> 32;
    m3_words[52] = request.generation; m3_words[53] = request.generation >> 32;
    m3_words[54] = action;
    return 1;
#else
    m3_note(M3_INJECTION_REJECTS);
    return -1;
#endif
}

