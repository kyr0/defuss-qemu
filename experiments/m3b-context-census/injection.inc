/* SPDX-License-Identifier: GPL-2.0-or-later */
/* New typed companion; the previous PC-only M3a API is unchanged. */
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
struct m3cc_injection {
    uint64_t pc, generation;
    const uint32_t *tuple;
    unsigned action, matches, mutations;
    bool apply;
};
static gboolean m3cc_inject_iter(gpointer key, gpointer value, gpointer opaque)
{
    (void)key;
    TranslationBlock *tb = value;
    struct m3cc_injection *r = opaque;
    struct WasmTBHeader *h = (void *)tb->tc.ptr;
    struct m3_descriptor *d = &h->m3;
    if (!m3_known(d) || d->generation != r->generation ||
        d->owner != (uintptr_t)tb || d->translation_pc != r->pc ||
        !h->info_ptr || h->m3b.magic != M3B_MAGIC || h->m3b.fused != 1 ||
        h->m3b.budget != 1 || h->m3b.reserved || !tb->m3b_fused ||
        !h->m3b.b_offset || h->m3b.b_offset >= h->m3b.bytes ||
        h->m3b.bytes > 128 || tb->icount > 32 || h->plan_id ||
        h->aot_recipe || h->wasm_size <= 0 ||
        tb->m3b_bytes != h->m3b.bytes || tb->size != h->m3b.bytes ||
        tb->m3b_b_offset != h->m3b.b_offset || !defuss_m3b_can_form(tb) ||
        (uintptr_t)tb != m3cc_pair(r->tuple + 2) ||
        (uintptr_t)h != m3cc_pair(r->tuple + 6) ||
        d->page0 != m3cc_pair(r->tuple + 10) ||
        d->page1 != (uint64_t)-1 || d->page1 != m3cc_pair(r->tuple + 12) ||
        tb_page_addr0(tb) != d->page0 || tb_page_addr1(tb) != d->page1 ||
        tb->flags != r->tuple[14] || d->flags != tb->flags ||
        tb_cflags(tb) != r->tuple[15] || d->cflags != tb_cflags(tb)) {
        return false;
    }
    struct WasmInstanceInfo *instance = get_info(h, 0);
    if (!instance || !instance->tb_func ||
        !m3_test_candidate(d, r->pc, instance->m3_generation,
            instance->tb_ptr == h, (tb_cflags(tb) & CF_INVALID) != 0,
            qatomic_read(&d->valid) != 0,
            (tb->flags & HF_CPL_MASK) == 3)) { return false; }
    if (!r->apply) {
        if (r->matches < 2) { r->matches++; }
    } else {
        if (r->action == M3_TEST_STALE_INSTANCE) {
            qatomic_set(&instance->m3_generation, 0);
        } else { qatomic_set(&d->valid, 0); }
        r->mutations++;
    }
    return false;
}
#endif
EMSCRIPTEN_KEEPALIVE int defuss_m3cc_inject(unsigned request, unsigned action,
                                         unsigned slot, uint64_t pc,
                                         uint64_t generation);
EMSCRIPTEN_KEEPALIVE int defuss_m3cc_inject(unsigned request, unsigned action,
                                         unsigned slot, uint64_t pc,
                                         uint64_t generation)
{
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
    if (!generation || slot >= M3CC_WATCHES ||
        !defuss_m3b_profile_enabled() || !m3cc_write_begin()) {
        m3cc_atomic_inc(19); return -1;
    }
    uint32_t *w = m3cc_bank + M3CC_OFFSET + slot * M3CC_STRIDE;
    const uint32_t *t = w + 32;
    const uint32_t *a = m3_words + M3_WATCH_OFFSET + slot * M3_WATCH_STRIDE;
    const uint32_t *b = m3b_words + M3B_WATCH_OFFSET + slot * M3B_WATCH_STRIDE;
    if (!request || request > 32 || request != m3cc_bank[20] + 1) {
        m3cc_write_end(); m3cc_atomic_inc(19); return -4;
    }
    bool valid = !m3cc_bank[3] && !m3cc_bank[4] && w[2] && w[3] && !w[5] &&
        w[8] && (w[16] & 1) && m3cc_pair(w) == pc &&
        m3cc_pair(t) == pc && m3cc_pair(t + 4) == generation &&
        b[4] && m3b_pair(b) == pc && m3b_pair(b + 2) == pc + 1 &&
        m3b_pair(b + 16) == pc && m3b_pair(b + 18) == generation &&
        m3_test_request_valid(action, slot, pc, m3_read_pair(a),
            m3_read_pair(a + 2), m3_enabled(), true,
            (qatomic_read(&m3_words[12]) & M3_CONFIG_LOCKED) &&
            !qatomic_read(&m3_words[M3_EXTRA_WORKER_REJECTS]), a[7] != 0) &&
        m3_read_pair(a) == pc && m3_read_pair(a + 2) == pc + 1;
    if (!valid) { m3cc_write_end(); m3cc_atomic_inc(19); return -1; }
    m3cc_atomic_inc(16); m3cc_bank[20] = request;
    m3cc_bank[21] = action; m3cc_bank[22] = 0; m3cc_bank[23] = slot;
    m3cc_put(m3cc_bank + 24, pc); m3cc_put(m3cc_bank + 26, generation);
    m3cc_put(m3cc_bank + 28, 0); m3cc_bank[30] = m3cc_bank[31] = 0;
    struct m3cc_injection r = {
        .pc = pc, .generation = generation, .tuple = t, .action = action,
    };
    /* Both traversals hold normal region-tree locks. No pointer is returned
     * or retained after this paused API call. A duplicate owner never mutates. */
    tcg_tb_foreach(m3cc_inject_iter, &r);
    int result = -2;
    if (r.matches == 1) {
        r.apply = true;
        tcg_tb_foreach(m3cc_inject_iter, &r);
        result = r.mutations == 1 ? 1 : -3;
    }
    m3cc_bank[22] = result;
    if (result == 1) {
        m3cc_atomic_inc(action == M3_TEST_STALE_INSTANCE ? 17 : 18);
        m3cc_put(m3cc_bank + 28, generation);
        m3cc_bank[30] = t[14]; m3cc_bank[31] = t[15];
        m3_note(action == M3_TEST_STALE_INSTANCE ? M3_INJECTED_STALE_INSTANCES :
                                                  M3_INJECTED_INVALID_DESCRIPTORS);
        m3_words[50] = pc; m3_words[51] = pc >> 32;
        m3_words[52] = generation; m3_words[53] = generation >> 32;
        m3_words[54] = action;
    } else { m3cc_atomic_inc(19); }
    m3cc_write_end(); return result;
#else
    m3cc_atomic_inc(19); return -1;
#endif
}
