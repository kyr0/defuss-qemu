/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Diagnostic-only QEMU work item; never read another worker's TLS directly. */
static uint32_t fifo_words[FIFO_WORDS] = {
    [0]=FIFO_MAGIC,[1]=FIFO_ABI,[14]=1,
};

static void fifo_snapshot_on_owner(CPUState *cpu,run_on_cpu_data data)
{
    uint32_t request = data.host_ulong;
    uint32_t copy[FIFO_WORDS] = {0};
    int status = -2;
    struct fifo_profile p = fifo_native_profile(cpu,false);
    uint32_t reasons = fifo_profile_rejections(&p);
    bool normal = fifo_asyncify_normal();
    if (!normal) { reasons |= UINT32_C(1) << 13; }
    if (!fifo_enabled()) { reasons |= UINT32_C(1) << 14; }
    if (fifo_faulted) { reasons |= UINT32_C(1) << 15; }
    if (qatomic_read(&fifo_words[2]) == request &&
        qatomic_read(&fifo_owner) == cpu && fifo_profile_valid(&p) && normal &&
        runstate_check(RUN_STATE_PAUSED) && qatomic_read(&cpu->stopped) &&
        !qatomic_read(&cpu->running)) {
        status = fifo_accounting_valid(qatomic_read(&instances_global),fifo_live(),
                                       instance_pending_gc,instance_done_gc) ? 0 : -3;
        FIFO_NOTE(FIFO_SNAPSHOTS,1);
        copy[8] = qatomic_read(&instances_global);
        copy[9] = fifo_live();
        copy[10] = instance_pending_gc;
        copy[11] = instance_done_gc;
        copy[12] = instance_budget;
        copy[13] = fifo_since_soft;
        copy[15] = fifo_saturated;
        memcpy(copy+16,fifo_counts,sizeof(fifo_counts));
    }
    copy[4] = status;
    copy[5] = qatomic_read(&fifo_configuration);
    copy[6] = cpu->cpu_index;
    copy[7] = thread_idx;
    copy[14] = 1;
    copy[40] = reasons == 0;
    copy[41] = reasons;
    /* Request is immutable while pending. Release publication makes the
     * complete copied record visible to the host's acquire read. */
    if (qatomic_read(&fifo_words[2]) == request) {
        memcpy(fifo_words+4,copy+4,(FIFO_WORDS-4)*sizeof(uint32_t));
        qatomic_store_release(&fifo_words[3],request);
    }
    object_unref(OBJECT(cpu));
}

EMSCRIPTEN_KEEPALIVE uintptr_t defuss_fifo_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_fifo_data(void)
{ return (uintptr_t)fifo_words; }

EMSCRIPTEN_KEEPALIVE int defuss_fifo_request(uint32_t request);
EMSCRIPTEN_KEEPALIVE int defuss_fifo_request(uint32_t request)
{
    CPUState *cpu = qatomic_load_acquire(&fifo_owner);
    uint32_t previous = qatomic_read(&fifo_words[2]);
    if (!request || request <= previous || previous != qatomic_load_acquire(&fifo_words[3]) ||
        !(qatomic_read(&fifo_configuration) & FIFO_LOCKED) || !cpu ||
        !runstate_check(RUN_STATE_PAUSED) || !qatomic_read(&cpu->stopped) ||
        qatomic_read(&cpu->running)) { return -1; }
    /* Do not walk QEMU's CPU list or read worker TLS from this exported main
     * thread. Publication carries a permanent owner ref plus the fixed native
     * single-boot-CPU/no-ACPI/no-hotplug eligibility established by that owner.
     * The callback rechecks every fact under QEMU's owning-worker/BQL scope. */
    if (!fifo_owner_eligible || qatomic_read(&thread_idx_max) != 1) { return -2; }
    if (qatomic_cmpxchg(&fifo_words[2],previous,request) != previous) { return -1; }
    /* At most one queued request. A reference additionally protects the CPU
     * object until its callback returns; no TB/function pointer is retained. */
    object_ref(OBJECT(cpu));
    async_run_on_cpu(cpu,fifo_snapshot_on_owner,RUN_ON_CPU_HOST_ULONG(request));
    return 0;
}
