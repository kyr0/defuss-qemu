/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Included immediately after original trysleep. No new sleep is introduced. */
static void m3b_service_after_call(CPUArchState *env, uint64_t entry_pc)
{
#ifdef TARGET_X86_64
    unsigned debt = env->m3b_service_debt;
    /* This clear precedes every possible Asyncify unwind. On rewind, the
     * compiler resumes inside trysleep without redoing the accounting. */
    env->m3b_service_debt = 0;
    if (!debt) { return; }
    if (debt > 2) {
        defuss_m3b_note(M3B_DEBT_ERRORS);
        defuss_m3b_profile_fault();
        cpu_exit(env_cpu(env));
        return;
    }
    defuss_m3b_event_pc(M3B_B_ATTEMPTS, entry_pc);
    if (debt == 2) { defuss_m3b_event_pc(M3B_B_REQUESTED, entry_pc); }
    defuss_m3b_event_pc(M3B_SERVICE_PAID, entry_pc);
    /* Pay one turn through the unmodified decrement/threshold/reset path. */
    trysleep();
#endif
}
