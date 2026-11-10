/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Included after M3a adapter, pool/configuration and the original TLS ctx.
 * The helpers below inspect ctx and must precede both execution tiers. */
#include "qemu/m3b-profile.h"
#include "qemu/coroutine.h"
#include "exec/cpu-common.h"

static int thread_idx_max;
static uint32_t m3b_words[M3B_WORDS] = {
    [0] = M3B_MAGIC, [1] = M3B_ABI, [5] = 1, /* budget */
    [6] = 32, [7] = 128, [8] = sizeof(struct m3b_header),
    [9] = M3B_WATCH_OFFSET, [10] = M3B_WATCH_STRIDE, [12] = M3B_WATCHES,
};

void defuss_m3b_note(unsigned index)
{
    if (index < 16 || index >= M3B_WORDS) { g_assert_not_reached(); }
    uint32_t old = qatomic_read(&m3b_words[index]);
    while (old != UINT32_MAX) {
        uint32_t seen = qatomic_cmpxchg(&m3b_words[index], old, old + 1);
        if (seen == old) { return; }
        old = seen;
    }
    qatomic_set(&m3b_words[4], 1);
}

static uint64_t m3b_pair(const uint32_t *p)
{ return p[0] | (uint64_t)p[1] << 32; }

void defuss_m3b_event_pc(unsigned event, uint64_t pc)
{
    unsigned field;
    defuss_m3b_note(event);
    switch (event) {
    case M3B_COMPILED_ENTRIES: field = 4; break;
    case M3B_TCI_ENTRIES: field = 5; break;
    case M3B_B_ATTEMPTS: field = 6; break;
    case M3B_B_REQUESTED: field = 7; break;
    case M3B_SERVICE_PAID: field = 8; break;
    case M3B_TRIALS: field = 9; break;
    case M3B_IR_REJECTS: field = 10; break;
    case M3B_PUBLISHED: field = 11; break;
    case M3B_ENTRY_REJECTS: field = 12; break;
    case M3B_RETRIES: field = 13; break;
    case M3B_BACKEDGE_TCI_RETURNS: field = 14; break;
    default: return;
    }
    for (unsigned i = 0; i < M3B_WATCHES; i++) {
        uint32_t *w = m3b_words + M3B_WATCH_OFFSET + i * M3B_WATCH_STRIDE;
        if (pc >= m3b_pair(w) && pc < m3b_pair(w + 2)) {
            defuss_m3b_note(M3B_WATCH_OFFSET + i * M3B_WATCH_STRIDE + field);
        }
    }
}

EMSCRIPTEN_KEEPALIVE int defuss_m3b_watch(unsigned slot, uint64_t begin, uint64_t end);
EMSCRIPTEN_KEEPALIVE int defuss_m3b_watch(unsigned slot, uint64_t begin, uint64_t end)
{
#ifdef CONFIG_USER_ONLY
    return -1;
#else
    if (slot >= M3B_WATCHES || runstate_is_running() ||
        ((begin || end) && (begin < 0x10000 || begin >= end || end > (UINT64_C(1) << 47)))) {
        return -1;
    }
    /* Host must independently confirm all vCPUs stopped before this export.
     * No watched addresses, functions or instance objects are retained. */
    uint32_t *w = m3b_words + M3B_WATCH_OFFSET + slot * M3B_WATCH_STRIDE;
    memset(w, 0, M3B_WATCH_STRIDE * sizeof(*w));
    w[0] = begin; w[1] = begin >> 32; w[2] = end; w[3] = end >> 32;
    uint32_t old = qatomic_read(&m3b_words[11]);
    if (old == UINT32_MAX) { qatomic_set(&m3b_words[4], 1); }
    else { qatomic_set(&m3b_words[11], old + 1); }
    return 0;
#endif
}

static uint64_t m3b_runtime_pc(CPUArchState *env)
{
#ifdef TARGET_X86_64
    return env->eip;
#else
    return 0;
#endif
}

EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3b_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3b_data(void)
{
    m3b_words[2] = defuss_m3b_profile_status();
    m3b_words[3] = defuss_m3b_profile_reasons();
    return (uintptr_t)m3b_words;
}

EM_JS(int, m3b_asyncify_normal, (void), {
    return typeof Asyncify !== 'undefined' &&
        Asyncify.state === Asyncify.State.Normal;
});

static bool m3b_worker_eligible(CPUArchState *env)
{
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
    return defuss_m3b_profile_enabled() && wasm44_single_ctx() &&
        thread_idx == 0 && qatomic_read(&thread_idx_max) == 1 &&
        current_cpu == env_cpu(env) && !qemu_in_coroutine() &&
        instance_budget == 12000 && defuss_m3b_dynamic_profile() &&
        m3b_asyncify_normal();
#else
    return false;
#endif
}

bool defuss_m3b_can_form(const TranslationBlock *tb)
{
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY) && !defined(CONFIG_PLUGIN)
    uint32_t f = tb->flags, c = tb_cflags(tb);
    return defuss_m3b_profile_enabled() && wasm44_single_ctx() &&
        defuss_m3b_dynamic_profile() &&
        (f & (HF_PE_MASK | HF_LMA_MASK | HF_CS64_MASK | HF_CPL_MASK)) ==
            (HF_PE_MASK | HF_LMA_MASK | HF_CS64_MASK | HF_CPL_MASK) &&
        !(f & (HF_VM_MASK | HF_SMM_MASK | HF_GUEST_MASK | HF_RF_MASK |
               HF_TF_MASK | HF_INHIBIT_IRQ_MASK | HF_MPX_EN_MASK)) &&
        (c & CF_PCREL) &&
        !(c & (CF_NO_GOTO_TB | CF_SINGLE_STEP | CF_MEMI_ONLY | CF_USE_ICOUNT |
               CF_INVALID | CF_PARALLEL | CF_NOIRQ | CF_BP_PAGE | CF_STEP_ATOMIC)) &&
        tb_page_addr0(tb) != (tb_page_addr_t)-1;
#else
    return false;
#endif
}

static bool m3b_fused(const void *code)
{
    return ((const struct WasmTBHeader *)code)->m3b.fused != 0;
}

/* Called before get_instance_from_tb, admission or either execution tier.
 * Returning M3_LEGACY is NEVER an escape hatch for a fused body. */
static bool m3b_entry_valid(CPUArchState *env, void *code)
{
    const struct WasmTBHeader *h = code;
    const struct m3_descriptor *d = &h->m3;
#ifdef TARGET_X86_64
    if (env->m3b_service_debt) {
        env->m3b_service_debt = 0;
        defuss_m3b_note(M3B_DEBT_ERRORS);
        defuss_m3b_profile_fault();
        return false;
    }
#endif
    if (!h->m3b.fused) { return true; }
    if (!m3b_worker_eligible(env)) {
        defuss_m3b_profile_fault();
        return false;
    }
    if (!qatomic_read(&d->valid)) { return false; }
    if (h->m3b.magic != M3B_MAGIC || h->m3b.fused != 1 ||
        h->m3b.budget != 1 || h->m3b.reserved ||
        !m3_known(d) ||
        d->eligibility != M3_ELIGIBLE || d->page1 != (tb_page_addr_t)-1 ||
        h->plan_id || h->aot_recipe || h->wasm_size <= 0) {
        /* Persistent unsupported metadata (including exhausted generation)
         * must not create an endless invalidate/reform loop. */
        defuss_m3b_profile_fault();
        return false;
    }
    const TranslationBlock *owner = (const void *)d->owner;
    if (tb_cflags(owner) & CF_INVALID) { return false; }
    bool valid = owner->tc.ptr == code && owner->m3b_fused == 1 &&
        owner->m3b_bytes == h->m3b.bytes && owner->size == h->m3b.bytes &&
        owner->m3b_b_offset == h->m3b.b_offset &&
        h->m3b.b_offset > 0 && h->m3b.b_offset < h->m3b.bytes &&
        h->m3b.bytes <= 128 && owner->icount <= 32 &&
        defuss_m3b_can_form(owner);
    if (!valid) { defuss_m3b_profile_fault(); }
    return valid;
}

/* The encoded slot pointer belongs to the current owner, even when its target
 * has been linked to another owner. Keep the normal reset/link metadata but
 * do not consume the closing slot in cold TCI. Its following exit_tb is IDX1. */
static bool m3b_tci_closing_slot(const void *slot)
{
    const struct WasmTBHeader *h = ctx.tb_ptr;
    if (!h || !h->m3b.fused) { return false; }
    const TranslationBlock *owner = (const void *)h->m3.owner;
    return slot == tcg_splitwx_to_rx((void *)&owner->jmp_target_addr[1]);
}

static void m3b_note_tier(bool compiled)
{
    if (m3b_fused(ctx.tb_ptr)) {
        uint64_t pc = m3b_runtime_pc(ctx.env);
        const struct WasmTBHeader *h = ctx.tb_ptr;
        defuss_m3b_event_pc(compiled ? M3B_COMPILED_ENTRIES : M3B_TCI_ENTRIES, pc);
        for (unsigned i = 0; i < M3B_WATCHES; i++) {
            uint32_t *w = m3b_words + M3B_WATCH_OFFSET + i * M3B_WATCH_STRIDE;
            if (pc >= m3b_pair(w) && pc < m3b_pair(w + 2)) {
                w[16] = pc; w[17] = pc >> 32;
                w[18] = h->m3.generation; w[19] = h->m3.generation >> 32;
            }
        }
    }
}

#include "m3b-runtime-boundary.inc"

static uintptr_t m3b_call_wasm_tb(wasm_tb_func f, struct WasmContext *context,
                                  unsigned *boundary_token)
{
    struct WasmTBHeader *h = context->tb_ptr;
    if (h->m3b.fused) {
        struct WasmInstanceInfo *instance = get_info_local(h);
        if (!m3b_entry_valid(context->env, h) || !instance ||
            instance->tb_ptr != h || instance->tb_func != f ||
            instance->m3_generation != h->m3.generation) {
            defuss_m3b_event_pc(M3B_ENTRY_REJECTS, m3b_runtime_pc(context->env));
            context->tb_ptr = NULL;
            return defuss_m3_redispatch(context->env, h);
        }
        m3b_note_tier(true);
    }
    /* A fused call has established every condition required for M3_SELECT,
     * regardless of the separate M3a selector. No unsupported LEGACY route. */
    *boundary_token = m3b_boundary_before(context->env, context->tb_ptr, true);
    return m3_call_wasm_tb(f, context);
}
