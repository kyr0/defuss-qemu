/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Included after get_info_local in target-specific tcg/wasm64.c. */
#include "cpu.h"
#include "exec/translation-block.h"
#include "exec/target_page.h"
#ifndef CONFIG_USER_ONLY
#include "system/runstate.h"
#endif

static uint32_t m3_words[M3_WORDS] = {
    [0] = M3_MAGIC, [1] = M3_VERSION,
    [5] = sizeof(struct WasmTBHeader), [6] = sizeof(struct m3_descriptor),
    [7] = sizeof(struct WasmInstanceInfo),
    [8] = M3_WATCHES, [9] = M3_WATCH_OFFSET, [10] = M3_WATCH_STRIDE,
};
/* Shared monotonically increasing identity, never reset by TB flush. */
static uint64_t m3_generation;

static uint32_t m3_atomic_load(uint32_t *word) { return qatomic_read(word); }
static uint32_t m3_atomic_cas(uint32_t *word, uint32_t old, uint32_t next)
{ return qatomic_cmpxchg(word, old, next); }
static inline bool m3_enabled(void)
{ return (qatomic_read(&m3_words[12]) & M3_CONFIG_ENABLED) != 0; }
static void m3_add(unsigned index, uint32_t count)
{
    uint32_t old = qatomic_read(&m3_words[index]);
    while (true) {
        bool saturated = false;
        uint32_t next = m3_saturating_add(old, count, &saturated);
        uint32_t observed = qatomic_cmpxchg(&m3_words[index], old, next);
        if (observed == old) {
            if (saturated) { qatomic_set(&m3_words[4], 1); }
            return;
        }
        old = observed;
    }
}
static inline void m3_note(unsigned index) { m3_add(index, 1); }
static uint64_t m3_next_generation(void)
{
    uint64_t old = qatomic_read(&m3_generation);
    while (old != UINT64_MAX) {
        uint64_t observed = qatomic_cmpxchg(&m3_generation, old, old + 1);
        if (observed == old) { return old + 1; }
        old = observed;
    }
    m3_note(M3_GENERATION_EXHAUSTIONS);
    return 0;
}

EMSCRIPTEN_KEEPALIVE unsigned defuss_m3_abi(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3_abi(void) { return M3_VERSION; }
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3_data(void)
{
    /* One atomic configuration word is authoritative. These public ABI fields
     * are snapshots only; neither participates in the configure/lock race. */
    uint32_t state = qatomic_read(&m3_words[12]);
    m3_words[2] = !!(state & M3_CONFIG_ENABLED);
    m3_words[3] = !!(state & M3_CONFIG_LOCKED);
    return (uintptr_t)m3_words;
}
EMSCRIPTEN_KEEPALIVE int defuss_m3_configure(unsigned enabled);
EMSCRIPTEN_KEEPALIVE int defuss_m3_configure(unsigned enabled)
{
    /* The same CAS word is locked by first dispatcher startup. */
    return m3_configure_state(&m3_words[12], enabled, m3_atomic_load, m3_atomic_cas);
}
EMSCRIPTEN_KEEPALIVE int defuss_m3_watch(unsigned slot, uint64_t begin, uint64_t end);
EMSCRIPTEN_KEEPALIVE int defuss_m3_watch(unsigned slot, uint64_t begin, uint64_t end)
{
#ifdef CONFIG_USER_ONLY
    return -1;
#else
    if (slot >= M3_WATCHES || (begin >= end && (begin || end)) ||
        runstate_is_running()) { return -1; }
    uint32_t *watch = m3_words + M3_WATCH_OFFSET + slot * M3_WATCH_STRIDE;
    /* Reset/read requires the externally confirmed all-vCPU stopped boundary. */
    memset(watch, 0, M3_WATCH_STRIDE * sizeof(*watch));
    watch[0] = begin; watch[1] = begin >> 32;
    watch[2] = end; watch[3] = end >> 32;
    watch[7] = begin < end;
    m3_note(11); /* Watch configuration epoch; entry counters reset per slot. */
    return 0;
#endif
}
static inline uint64_t m3_read_pair(const uint32_t *words)
{ return words[0] | (uint64_t)words[1] << 32; }

#include "m3-region-test.inc"

static void m3_watch_entry(CPUArchState *env, const struct m3_descriptor *d)
{
#ifdef TARGET_X86_64
    uint64_t pc = d->cflags & CF_PCREL ? env->eip : d->translation_pc;
    if ((d->cflags & CF_PCREL) && ((pc ^ d->translation_pc) & ~TARGET_PAGE_MASK)) {
        m3_note(M3_WATCH_PC_MISMATCHES);
        return;
    }
    for (unsigned slot = 0; slot < M3_WATCHES; slot++) {
        unsigned offset = M3_WATCH_OFFSET + slot * M3_WATCH_STRIDE;
        uint32_t *watch = m3_words + offset;
        if (watch[7] && pc >= m3_read_pair(watch) && pc < m3_read_pair(watch + 2)) {
            m3_note(offset + 4);
            watch[5] = pc; watch[6] = pc >> 32;
        }
    }
#endif
}

void defuss_m3_publish(struct TranslationBlock *tb, uint64_t pc)
{
    struct WasmTBHeader *h = (void *)tb->tc.ptr;
    bool target = false, mode = false;
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
    target = true;
    mode = (tb->flags & (HF_PE_MASK | HF_LMA_MASK | HF_CS64_MASK)) ==
           (HF_PE_MASK | HF_LMA_MASK | HF_CS64_MASK) &&
           !(tb->flags & (HF_VM_MASK | HF_SMM_MASK));
#endif
    unsigned reason = m3_eligibility(target, wasm44_single_ctx(), mode,
        (tb_cflags(tb) & (CF_SINGLE_STEP | CF_USE_ICOUNT | CF_PARALLEL |
                         CF_NOIRQ | CF_BP_PAGE | CF_STEP_ATOMIC)) != 0,
        tb_page_addr0(tb) == (tb_page_addr_t)-1,
        h->plan_id != 0 || h->aot_recipe != NULL, h->wasm_size > 0);
    struct m3_descriptor *d = &h->m3;
    d->generation = m3_next_generation();
    d->version = M3_VERSION; d->valid = 1; d->eligibility = reason;
    d->members = 1; d->recovery = M3_RECOVERY_TCI_SEARCH;
    d->owner = (uintptr_t)tb; d->translation_pc = pc;
    d->page0 = tb_page_addr0(tb); d->page1 = tb_page_addr1(tb);
    d->flags = tb->flags; d->cflags = tb_cflags(tb); d->instructions = tb->icount;
    d->wasm_bytes = MAX(h->wasm_size, 0); d->import_bytes = MAX(h->import_size, 0);
    d->tci_bytes = h->wasm_ptr ? (uint8_t *)h->wasm_ptr - (uint8_t *)h->tci_ptr : 0;
    /* Normal QEMU publication occurs later, after search data is encoded. */
    d->magic = d->generation ? M3_MAGIC : 0;
    m3_note(M3_PUBLISHED);
    if (m3_known(d) && reason == M3_ELIGIBLE) { m3_note(M3_ELIGIBLE_PUBLISHED); }
    m3_add(M3_EMITTED_WASM_BYTES, d->wasm_bytes);
    m3_add(M3_IMPORT_BYTES, d->import_bytes);
    m3_add(M3_DESCRIPTOR_BYTES, sizeof(*d));
}

void defuss_m3_invalidated(struct TranslationBlock *tb)
{
    struct m3_descriptor *d = &((struct WasmTBHeader *)tb->tc.ptr)->m3;
    if (m3_known(d) && d->owner == (uintptr_t)tb &&
        qatomic_xchg(&d->valid, 0)) { m3_note(M3_INVALIDATIONS); }
}
void defuss_m3_flushed(void) { m3_note(M3_FLUSHES); }

static uintptr_t m3_call_wasm_tb(wasm_tb_func f, struct WasmContext *context)
{
    if (!m3_enabled()) { return call_wasm_tb(f, context); }
    m3_note(M3_COMPILED_ATTEMPTS);
    struct WasmTBHeader *h = context->tb_ptr;
    const struct m3_descriptor *d = &h->m3;
    unsigned reason = M3_METADATA;
    enum m3_decision decision = M3_LEGACY;
    if (!wasm44_single_ctx() || thread_idx != 0) {
        reason = M3_CONTEXTS;
        m3_note(M3_EXTRA_WORKER_REJECTS);
    } else if (m3_known(d)) {
        TranslationBlock *owner = (void *)d->owner;
        struct WasmInstanceInfo *instance = get_info_local(h);
        decision = m3_choose(d, instance ? instance->m3_generation : 0,
            owner->tc.ptr == h && instance && instance->tb_ptr == h,
            (tb_cflags(owner) & CF_INVALID) != 0,
            qatomic_read(&d->valid) != 0);
        reason = d->eligibility;
    } else {
        m3_note(M3_INVALID_METADATA);
    }
    if (decision == M3_REDISPATCH) {
        void *code = context->tb_ptr;
        m3_note(M3_INVALID_REDISPATCHES);
        context->tb_ptr = NULL;
        return defuss_m3_redispatch(context->env, code);
    }
    if (decision == M3_SELECT) {
        m3_note(M3_SELECTED_ENTRIES);
        m3_watch_entry(context->env, d);
    } else {
        m3_note(M3_FALLBACK_ENTRIES);
        m3_note(M3_FALLBACK_REASONS + reason);
    }
    /* Exact same generated function, context, return and Asyncify convention.
     * No after-call cleanup: faults can leave by QEMU's nonlocal exit path. */
    return call_wasm_tb(f, context);
}
