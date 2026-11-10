/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Included after the original check_gc_completion and before init_wasm_js. */
static unsigned fifo_live(void)
{
    return instances_end >= instances_begin ? instances_end - instances_begin :
        instances_end + INSTANCES_BUF_MAX - instances_begin;
}
static void fifo_peaks(void)
{
#if FIFO_DIAGNOSTIC
    fifo_counts[FIFO_LIVE_PEAK] = MAX(fifo_counts[FIFO_LIVE_PEAK],fifo_live());
    fifo_counts[FIFO_PENDING_PEAK] = MAX(fifo_counts[FIFO_PENDING_PEAK],(unsigned)instance_pending_gc);
    fifo_counts[FIFO_CHARGED_PEAK] = MAX(fifo_counts[FIFO_CHARGED_PEAK],(unsigned)qatomic_read(&instances_global));
#endif
}
static void fifo_worker_init(CPUArchState *env)
{
    (void)env;
    fifo_worker_started = true;
#if FIFO_DIAGNOSTIC
    CPUState *cpu = env_cpu(env);
    if (thread_idx == 0) {
        struct fifo_profile p = fifo_native_profile(cpu,true);
        /* The owning worker runs inside the established CPU execution scope.
         * Pin before publishing: the exported request must not acquire a ref
         * through a raw pointer that can already have been freed. This one
         * diagnostic runtime-lifetime ref is never a TB/instance reference. */
        object_ref(OBJECT(cpu));
        fifo_owner_eligible = fifo_profile_valid(&p);
        qatomic_store_release(&fifo_owner,cpu);
    }
#endif
}
static void fifo_before_reserve(CPUArchState *env)
{
    fifo_install_eligible = false;
    if (!fifo_enabled() || fifo_faulted) { return; }
    qatomic_or(&fifo_policy_state,2);
    FIFO_NOTE(FIFO_SOFT_CHECKS,1);
    struct fifo_profile profile = fifo_native_profile(env_cpu(env),true);
    if (!fifo_profile_valid(&profile)) {
        qatomic_or(&fifo_policy_state,8);
        qatomic_or(&fifo_rejection_bits,fifo_profile_rejections(&profile));
        FIFO_NOTE(FIFO_POLICY_REJECTIONS,1); return;
    }
    if (!fifo_asyncify_normal()) {
        qatomic_or(&fifo_policy_state,8);
        qatomic_or(&fifo_rejection_bits,UINT32_C(1) << 13);
        FIFO_NOTE(FIFO_ASYNCIFY_REJECTIONS,1); return;
    }
    FIFO_NOTE(FIFO_POLICY_ELIGIBLE_ATTEMPTS,1);
    if (!fifo_accounting_valid(qatomic_read(&instances_global),fifo_live(),
                               instance_pending_gc,instance_done_gc)) {
        fifo_faulted = true;
        qatomic_or(&fifo_policy_state,12);
        qatomic_or(&fifo_rejection_bits,UINT32_C(1) << 15);
        FIFO_NOTE(FIFO_ACCOUNTING_ERRORS,1);
        return;
    }
    fifo_install_eligible = true;
    qatomic_or(&fifo_policy_state,1);
    /* Only callbacks already delivered to this worker release capacity. */
    check_gc_completion();
    if (instance_pending_gc) { FIFO_NOTE(FIFO_PENDING_GUARDS,1); return; }
    if (fifo_soft_due(qatomic_read(&instances_global),fifo_live(),
                      instance_pending_gc,fifo_since_soft)) {
        fifo_retire_records(FIFO_BATCH);
        fifo_since_soft = 0;
        FIFO_NOTE(FIFO_SOFT_BATCHES,1);
        FIFO_NOTE(FIFO_SOFT_RETIRED,FIFO_BATCH);
    }
}
static bool fifo_reserve_instance(CPUArchState *env)
{
    fifo_before_reserve(env);
    return reserve_instance();
}

#if FIFO_DIAGNOSTIC && !defined(CONFIG_USER_ONLY)
#include "fifo-diagnostic.inc"
#else
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_fifo_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_fifo_data(void) { return 0; }
EMSCRIPTEN_KEEPALIVE int defuss_fifo_request(uint32_t request);
EMSCRIPTEN_KEEPALIVE int defuss_fifo_request(uint32_t request) { (void)request; return -1; }
#endif
