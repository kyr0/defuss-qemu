/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef DEFUSS_PASSIVE_FIFO_CORE_H
#define DEFUSS_PASSIVE_FIFO_CORE_H
#include <stdbool.h>
#include <stdint.h>
#include <limits.h>

#define FIFO_ABI 1u
#define FIFO_MAGIC UINT32_C(0x46494631)
#define FIFO_CAP 12000u
#define FIFO_SOFT 9000u
#define FIFO_BATCH 256u
#define FIFO_MIN_LIVE 512u
#define FIFO_ENABLED 1u
#define FIFO_LOCKED 2u
#define FIFO_CHOSEN 4u
#define FIFO_WORDS 64u

typedef uint32_t (*fifo_load_fn)(uint32_t *);
typedef uint32_t (*fifo_cas_fn)(uint32_t *,uint32_t,uint32_t);
static inline int fifo_configure(uint32_t *state,unsigned enabled,
                                 fifo_load_fn load,fifo_cas_fn cas)
{
    if (enabled > 1) { return -1; }
    uint32_t old = load(state);
    while (!(old & (FIFO_CHOSEN | FIFO_LOCKED))) {
        uint32_t next = FIFO_CHOSEN | (enabled ? FIFO_ENABLED : 0);
        uint32_t seen = cas(state, old, next);
        if (seen == old) { return 0; }
        old = seen;
    }
    return -1;
}
static inline void fifo_lock(uint32_t *state,fifo_load_fn load,fifo_cas_fn cas)
{
    uint32_t old = load(state);
    while (!(old & FIFO_LOCKED)) {
        uint32_t seen = cas(state, old, old | FIFO_LOCKED);
        if (seen == old) { return; }
        old = seen;
    }
}
struct fifo_profile {
    bool x86_full_system, pc_machine, boot_cpu, one_cpu, max_one_cpu;
    bool one_context, first_worker, only_worker, budget_default;
    bool no_hotplug, no_plan_aot, not_coroutine, current_owner;
};
static inline bool fifo_profile_valid(const struct fifo_profile *p)
{
    return p->x86_full_system && p->pc_machine && p->boot_cpu && p->one_cpu &&
        p->max_one_cpu && p->one_context && p->first_worker && p->only_worker &&
        p->budget_default && p->no_hotplug && p->no_plan_aot &&
        p->not_coroutine && p->current_owner;
}
static inline bool fifo_accounting_valid(int charged,unsigned live,
                                        int pending,int done)
{
    return charged >= 0 && (unsigned)charged <= FIFO_CAP && live <= FIFO_CAP &&
        pending >= 0 && (unsigned)pending <= FIFO_CAP && done >= 0 && done <= pending &&
        (unsigned)charged == live + (unsigned)pending;
}
static inline bool fifo_soft_due(int charged,unsigned live,int pending,
                                 unsigned since_soft)
{
    return charged >= 0 && (unsigned)charged >= FIFO_SOFT && (unsigned)charged < FIFO_CAP && pending == 0 &&
        live >= FIFO_MIN_LIVE && since_soft >= FIFO_BATCH;
}
static inline uint32_t fifo_add_saturated(uint32_t old,uint64_t increment,
                                         bool *saturated)
{
    if (increment > UINT32_MAX - old) { *saturated = true; return UINT32_MAX; }
    return old + (uint32_t)increment;
}
enum fifo_counter {
    FIFO_INSTALLS, FIFO_SOFT_BATCHES, FIFO_SOFT_RETIRED, FIFO_EMERGENCY_BATCHES,
    FIFO_EMERGENCY_RETIRED, FIFO_GC_CONSUMED, FIFO_RESERVATION_FAILURES,
    FIFO_RETIRED_ENTRY_MISSES, FIFO_ADMISSION_HELD, FIFO_CAPACITY_TCI,
    FIFO_POLICY_ELIGIBLE_ATTEMPTS, FIFO_POLICY_REJECTIONS, FIFO_PENDING_GUARDS,
    FIFO_ASYNCIFY_REJECTIONS, FIFO_ACCOUNTING_ERRORS, FIFO_WASM_INPUT_BYTES,
    FIFO_IMPORT_BYTES, FIFO_COMPILED_CALLS, FIFO_INTERPRETED_CALLS,
    FIFO_SOFT_CHECKS, FIFO_SNAPSHOTS, FIFO_PENDING_PEAK, FIFO_CHARGED_PEAK,
    FIFO_LIVE_PEAK, FIFO_COUNTERS
};
#endif
