/* Diagnostic-only admission observations. Never used to decide execution. */
#include <emscripten.h>
static uint32_t m3ba_words[128] = {
    [0] = 0x4d334241, [1] = 1, [2] = 128,
};
static void m3ba_note(unsigned index)
{
    uint32_t old = qatomic_read(&m3ba_words[index]);
    while (old != UINT32_MAX) {
        uint32_t seen = qatomic_cmpxchg(&m3ba_words[index], old, old + 1);
        if (seen == old) { return; }
        old = seen;
    }
    qatomic_set(&m3ba_words[3], 1);
}
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3ba_abi(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3ba_abi(void) { return 1; }
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3ba_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3ba_data(void)
{ return (uintptr_t)m3ba_words; }

/* Called only after the original can_form result was false. The duplicate
 * pure observations below describe reasons, without changing that result or
 * calling a guest-memory probe. Multiple reasons may apply to one rejection. */
static void m3ba_form_rejection(const TranslationBlock *tb, uint64_t pc)
{
    uint32_t f = tb->flags, c = tb_cflags(tb), reasons = 0;
    if (!defuss_m3b_profile_enabled()) { reasons |= 1u << 0; }
    if (!wasm44_single_ctx()) { reasons |= 1u << 1; }
    if (!defuss_m3b_dynamic_profile()) { reasons |= 1u << 2; }
    if ((f & (HF_PE_MASK | HF_LMA_MASK | HF_CS64_MASK | HF_CPL_MASK)) !=
        (HF_PE_MASK | HF_LMA_MASK | HF_CS64_MASK | HF_CPL_MASK)) {
        reasons |= 1u << 3;
    }
    if (f & (HF_VM_MASK | HF_SMM_MASK | HF_GUEST_MASK | HF_RF_MASK |
             HF_TF_MASK | HF_INHIBIT_IRQ_MASK | HF_MPX_EN_MASK)) {
        reasons |= 1u << 4;
    }
    if (!(c & CF_PCREL)) { reasons |= 1u << 5; }
    if (c & (CF_NO_GOTO_TB | CF_SINGLE_STEP | CF_MEMI_ONLY | CF_USE_ICOUNT |
             CF_INVALID | CF_PARALLEL | CF_NOIRQ | CF_BP_PAGE | CF_STEP_ATOMIC)) {
        reasons |= 1u << 6;
    }
    if (tb_page_addr0(tb) == (tb_page_addr_t)-1) { reasons |= 1u << 7; }
    if (!reasons) { m3ba_note(24); }
    for (unsigned i = 0; i < 8; i++) {
        if (reasons & (1u << i)) { m3ba_note(48 + i); }
    }
    m3ba_words[8] = reasons;
    m3ba_words[9] = f; m3ba_words[10] = c;
    m3ba_words[12] = pc; m3ba_words[13] = pc >> 32;
}

/* This observer sees only the exact byte span already accepted by the original
 * RAM-span guard. It copies no more than the unchanged predecoder can read.
 * The fixed last-sample buffer is descriptive, not a frequency sample. */
static void m3ba_decode(enum m3b_predecode_result result,
                       const TranslationBlock *tb, uint64_t pc,
                       const void *host, unsigned span, unsigned max_insns)
{
    if ((unsigned)result >= 8 || !span || span > 128) {
        m3ba_note(25); return;
    }
    m3ba_note(32 + result);
    m3ba_words[64] = pc; m3ba_words[65] = pc >> 32;
    m3ba_words[66] = tb->flags; m3ba_words[67] = tb_cflags(tb);
    m3ba_words[68] = span; m3ba_words[69] = max_insns;
    m3ba_words[70] = result;
    uint64_t page = tb_page_addr0(tb);
    m3ba_words[72] = page; m3ba_words[73] = page >> 32;
    memset(m3ba_words + 96, 0, 128);
    memcpy(m3ba_words + 96, host, span);
}
