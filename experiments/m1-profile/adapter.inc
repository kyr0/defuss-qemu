/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Included in target-specific tcg/wasm64.c after thread_idx is declared. */
#include "cpu.h"
#include "exec/translation-block.h"
#include "exec/target_page.h"
#include "m1-profile-core.h"

static struct m1_storage m1_profile;

EMSCRIPTEN_KEEPALIVE unsigned defuss_m1_abi(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m1_abi(void) { return M1_VERSION; }
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m1_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m1_data(void)
{ return (uintptr_t)m1_profile.words; }
EMSCRIPTEN_KEEPALIVE int defuss_m1_reset(unsigned enabled, unsigned period);
EMSCRIPTEN_KEEPALIVE int defuss_m1_reset(unsigned enabled, unsigned period)
{
    /* The host must pause all vCPUs before calling; this is not a live reset. */
    return m1_reset(&m1_profile, enabled, period);
}
static inline bool m1_active(void)
{
    if (!qatomic_read(&m1_profile.words[2])) { return false; }
    if (unlikely(thread_idx != 0)) {
        qatomic_inc(&m1_profile.words[16]);
        return false;
    }
    return true;
}
static inline void m1_note(enum m1_counter counter)
{ if (m1_active()) { m1_inc(&m1_profile, counter); } }
static inline void m1_note_entry(CPUArchState *env, void *code, unsigned tier)
{
    if (!m1_active()) { return; }
    const struct WasmTBHeader *h = code;
    uint64_t context = 0;
    unsigned privilege = M1_UNKNOWN, context_known = 0;
    uint64_t pc = h->m1_pc;
    unsigned pc_known = !(h->m1_cflags & CF_PCREL) && !h->aot_recipe;
#ifdef TARGET_I386
    QEMU_BUILD_BUG_ON(HF_CPL_MASK != 3 || HF_PE_MASK != (1u << 7) ||
                      HF_VM_MASK != (1u << 17) || HF_SMM_MASK != (1u << 19) ||
                      HF_CS64_MASK != (1u << 15));
    context = env->cr[3];
    if (!h->aot_recipe) {
        privilege = m1_x86_privilege(h->m1_flags);
        context_known = 1;
    }
    struct m1_pc_result resolved = m1_x86_entry_pc(h->m1_pc, env->eip,
        env->segs[R_CS].base, h->m1_flags, !!(h->m1_cflags & CF_PCREL),
        h->aot_recipe != NULL, (uint64_t)~TARGET_PAGE_MASK);
    pc = resolved.address;
    pc_known = resolved.known;
#endif
    /* x86 PCREL reads synchronized entry state; other target PCREL contexts
     * remain unknown. No instruction-level PC or same-TB loop sampling. */
    struct m1_key key = m1_key_make(pc, context, h->m1_flags,
                                   h->m1_cflags, tier, privilege);
    m1_entry(&m1_profile, key, pc_known, context_known);
}
void defuss_m1_syscall(uint64_t number, unsigned valid64user);
void defuss_m1_syscall(uint64_t number, unsigned valid64user)
{
    if (m1_active()) { m1_syscall(&m1_profile, number, valid64user); }
}
