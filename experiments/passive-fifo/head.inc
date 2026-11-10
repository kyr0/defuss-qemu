/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "fifo-core.h"
#include "cpu.h"
#include "qemu/coroutine.h"
#include "exec/cpu-common.h"
#ifndef CONFIG_USER_ONLY
#include "hw/core/boards.h"
#include "system/runstate.h"
#endif
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
#include "hw/i386/pc.h"
#endif

static uint32_t fifo_configuration;
/* Bounded effective-policy facts, not execution counters. Both variants expose
 * them so timing cannot accept requested-on with silent permanent fallback. */
static uint32_t fifo_policy_state;
static uint32_t fifo_rejection_bits;
static __thread unsigned fifo_since_soft;
static __thread bool fifo_faulted;
static __thread bool fifo_worker_started;
static __thread bool fifo_install_eligible;
static int thread_idx_max;

static uint32_t fifo_load(uint32_t *p) { return qatomic_read(p); }
static uint32_t fifo_cas(uint32_t *p,uint32_t old,uint32_t next)
{ return qatomic_cmpxchg(p,old,next); }
static bool fifo_enabled(void)
{ return (qatomic_read(&fifo_configuration) & FIFO_ENABLED) != 0; }

EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_abi(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_abi(void) { return FIFO_ABI; }
EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_diagnostic(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_diagnostic(void)
{ return FIFO_DIAGNOSTIC; }
EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_status(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_status(void)
{ return qatomic_read(&fifo_configuration); }
EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_state(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_state(void)
{ return qatomic_read(&fifo_policy_state); }
EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_rejections(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_fifo_rejections(void)
{ return qatomic_read(&fifo_rejection_bits); }
EMSCRIPTEN_KEEPALIVE int defuss_fifo_configure(unsigned enabled);
EMSCRIPTEN_KEEPALIVE int defuss_fifo_configure(unsigned enabled)
{ return fifo_configure(&fifo_configuration,enabled,fifo_load,fifo_cas); }

EM_JS(int, fifo_asyncify_normal, (), {
    return typeof Asyncify !== 'undefined' &&
        Asyncify.state === Asyncify.State.Normal;
});

#if FIFO_DIAGNOSTIC
static __thread uint32_t fifo_counts[FIFO_COUNTERS];
static __thread bool fifo_saturated;
static CPUState *fifo_owner;
static bool fifo_owner_eligible;
static void fifo_note(unsigned n,uint64_t amount)
{
    fifo_counts[n] = fifo_add_saturated(fifo_counts[n],amount,&fifo_saturated);
}
#define FIFO_NOTE(n,amount) fifo_note(n,amount)
#else
#define FIFO_NOTE(n,amount) ((void)0)
#endif

static unsigned fifo_live(void);
static void fifo_peaks(void);
static void fifo_before_reserve(CPUArchState *env);
static void fifo_worker_init(CPUArchState *env);

static void fifo_installed(void)
{
    if (fifo_install_eligible && fifo_since_soft < FIFO_BATCH) { fifo_since_soft++; }
    FIFO_NOTE(FIFO_INSTALLS,1);
#if FIFO_DIAGNOSTIC
    fifo_peaks();
#endif
}

/* Pure topology/mode facts are collected afresh. A single TCG context alone
 * does not establish a single guest CPU. No active TB function is held here. */
static struct fifo_profile fifo_topology_profile(CPUState *owner)
{
    struct fifo_profile p = {0};
#if defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
    CPUState *cpu;
    unsigned count = 0;
    CPU_FOREACH(cpu) { count++; }
    p.x86_full_system = true;
    p.pc_machine = current_machine &&
        object_dynamic_cast(OBJECT(current_machine),TYPE_PC_MACHINE);
    p.one_cpu = count == 1 && first_cpu == owner && current_machine &&
        current_machine->smp.cpus == 1;
    p.max_one_cpu = current_machine && current_machine->smp.max_cpus == 1;
    p.boot_cpu = owner && owner->cpu_index == 0 && current_machine &&
        current_machine->possible_cpus && current_machine->possible_cpus->len == 1 &&
        current_machine->possible_cpus->cpus[0].cpu == owner;
    p.no_hotplug = p.pc_machine && owner && !owner->parent_obj.hotplugged &&
        !owner->unplug && X86_MACHINE(current_machine)->acpi_dev == NULL;
    p.one_context = wasm44_single_ctx();
    p.only_worker = qatomic_read(&thread_idx_max) == 1;
    p.no_plan_aot = defuss_fifo_dynamic_profile();
#endif
    return p;
}
static struct fifo_profile fifo_native_profile(CPUState *owner,bool executing)
{
    struct fifo_profile p = fifo_topology_profile(owner);
    p.first_worker = fifo_worker_started && thread_idx == 0;
    p.budget_default = instance_budget == FIFO_CAP;
    p.not_coroutine = !qemu_in_coroutine();
    p.current_owner = owner && (executing ? current_cpu == owner : qemu_cpu_is_self(owner));
    return p;
}

static uint32_t fifo_profile_rejections(const struct fifo_profile *p)
{
    uint32_t reasons = 0;
#define FIFO_REASON(field,bit) do { if (!p->field) { reasons |= UINT32_C(1) << bit; } } while (0)
    FIFO_REASON(x86_full_system,0); FIFO_REASON(pc_machine,1);
    FIFO_REASON(boot_cpu,2); FIFO_REASON(one_cpu,3); FIFO_REASON(max_one_cpu,4);
    FIFO_REASON(one_context,5); FIFO_REASON(first_worker,6); FIFO_REASON(only_worker,7);
    FIFO_REASON(budget_default,8); FIFO_REASON(no_hotplug,9); FIFO_REASON(no_plan_aot,10);
    FIFO_REASON(not_coroutine,11); FIFO_REASON(current_owner,12);
#undef FIFO_REASON
    return reasons;
}
