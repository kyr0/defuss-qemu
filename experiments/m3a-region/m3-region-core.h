/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef DEFUSS_M3_REGION_CORE_H
#define DEFUSS_M3_REGION_CORE_H
#include <stdint.h>
#include <stdbool.h>
#include <limits.h>

#define M3_MAGIC UINT32_C(0x4d335231)
#define M3_VERSION 1u
#define M3_WORDS 96u
#define M3_WATCHES 4u
#define M3_WATCH_OFFSET 64u
#define M3_WATCH_STRIDE 8u
#define M3_RECOVERY_TCI_SEARCH 1u
#define M3_CONFIG_ENABLED 1u
#define M3_CONFIG_LOCKED 2u

/* The production adapter supplies QEMU atomics; native race fixtures supply
 * C11 atomics. Configuration and first-vCPU locking share this exact loop. */
typedef uint32_t (*m3_atomic_load_fn)(uint32_t *);
typedef uint32_t (*m3_atomic_cas_fn)(uint32_t *, uint32_t, uint32_t);
static inline int m3_configure_state(uint32_t *state, unsigned enabled,
                                    m3_atomic_load_fn load, m3_atomic_cas_fn cas)
{
    if (enabled > 1) { return -1; }
    uint32_t old = load(state);
    while (!(old & M3_CONFIG_LOCKED)) {
        uint32_t observed = cas(state, old, enabled);
        if (observed == old) { return 0; }
        old = observed;
    }
    return -1;
}
static inline void m3_lock_configuration(uint32_t *state,
                                         m3_atomic_load_fn load,
                                         m3_atomic_cas_fn cas)
{
    uint32_t old = load(state);
    while (!(old & M3_CONFIG_LOCKED)) {
        uint32_t observed = cas(state, old, old | M3_CONFIG_LOCKED);
        if (observed == old) { return; }
        old = observed;
    }
}

enum m3_reason {
    M3_ELIGIBLE = 0, M3_TARGET = 1, M3_CONTEXTS = 2, M3_MODE = 3,
    M3_DEBUG = 4, M3_TEMPORARY = 5, M3_PLAN = 6, M3_NO_WASM = 7,
    M3_METADATA = 8,
};
enum m3_counter {
    M3_PUBLISHED = 16, M3_ELIGIBLE_PUBLISHED, M3_COMPILED_ATTEMPTS,
    M3_SELECTED_ENTRIES, M3_FALLBACK_ENTRIES, M3_INVALID_REDISPATCHES,
    M3_STALE_INSTANCE_MISSES, M3_INSTANCE_INSTALLS, M3_INSTANCE_RETIRES,
    M3_INVALIDATIONS, M3_FLUSHES, M3_EMITTED_WASM_BYTES, M3_IMPORT_BYTES,
    M3_DESCRIPTOR_BYTES, M3_INVALID_METADATA, M3_GENERATION_EXHAUSTIONS,
    M3_EXTRA_WORKER_REJECTS, M3_WATCH_PC_MISMATCHES,
    M3_INJECTED_STALE_INSTANCES, M3_INJECTED_INVALID_DESCRIPTORS,
    M3_INJECTION_REJECTS,
    M3_FALLBACK_REASONS = 40,
};
/* Embedded in the existing TB allocation: no independent cache or lifetime. */
struct m3_descriptor {
    uint32_t magic, version, valid, eligibility, members, recovery;
    uint64_t generation;
    uintptr_t owner;
    uint64_t translation_pc, page0, page1;
    uint32_t flags, cflags, instructions, wasm_bytes, import_bytes, tci_bytes;
};
enum m3_decision { M3_SELECT, M3_LEGACY, M3_REDISPATCH };

static inline uint32_t m3_saturating_add(uint32_t value, uint32_t add,
                                         bool *saturated)
{
    if (add > UINT32_MAX - value) {
        *saturated = true;
        return UINT32_MAX;
    }
    return value + add;
}
static inline unsigned m3_eligibility(bool target, bool one_context,
                                      bool supported_mode, bool debug,
                                      bool temporary, bool plan, bool has_wasm)
{
    if (!target) { return M3_TARGET; }
    if (!one_context) { return M3_CONTEXTS; }
    if (!supported_mode) { return M3_MODE; }
    if (debug) { return M3_DEBUG; }
    if (temporary) { return M3_TEMPORARY; }
    if (plan) { return M3_PLAN; }
    if (!has_wasm) { return M3_NO_WASM; }
    return M3_ELIGIBLE;
}
static inline bool m3_known(const struct m3_descriptor *d)
{
    return d->magic == M3_MAGIC && d->version == M3_VERSION &&
           d->generation != 0 && d->owner != 0 && d->members == 1 &&
           d->recovery == M3_RECOVERY_TCI_SEARCH &&
           d->eligibility <= M3_NO_WASM;
}
static inline enum m3_decision m3_choose(const struct m3_descriptor *d,
                                       uint64_t instance_generation,
                                       bool owner_matches, bool owner_invalid,
                                       bool descriptor_valid)
{
    if (!m3_known(d)) { return M3_LEGACY; }
    if (!descriptor_valid || owner_invalid || !owner_matches ||
        instance_generation != d->generation) { return M3_REDISPATCH; }
    return d->eligibility == M3_ELIGIBLE ? M3_SELECT : M3_LEGACY;
}

/* Diagnostic-only mutation requests are deliberately restricted to one
 * watched, low-address static user-code entry. No execution hook uses these. */
#define M3_TEST_STALE_INSTANCE 1u
#define M3_TEST_INVALID_DESCRIPTOR 2u
static inline bool m3_test_request_valid(unsigned action, unsigned slot,
                                       uint64_t pc, uint64_t begin, uint64_t end,
                                       bool enabled, bool paused,
                                       bool one_stopped_cpu, bool watch_enabled)
{
    return (action == M3_TEST_STALE_INSTANCE ||
            action == M3_TEST_INVALID_DESCRIPTOR) &&
           slot < M3_WATCHES && enabled && paused && one_stopped_cpu &&
           watch_enabled && begin >= UINT64_C(0x100000) &&
           end <= UINT64_C(0x100000000) && begin < end &&
           end - begin <= UINT64_C(65536) && pc >= begin && pc < end;
}
static inline bool m3_test_candidate(const struct m3_descriptor *d, uint64_t pc,
                                     uint64_t instance_generation,
                                     bool owner_matches, bool owner_invalid,
                                     bool descriptor_valid, bool user_mode)
{
    return d->translation_pc == pc && user_mode &&
           m3_choose(d, instance_generation, owner_matches, owner_invalid,
                     descriptor_valid) == M3_SELECT;
}
#endif
