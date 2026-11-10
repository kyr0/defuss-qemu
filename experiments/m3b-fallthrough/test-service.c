/* Host contract for the ACTUAL runtime-service.inc and copied original
 * trysleep function. This does not emulate or validate real Asyncify. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include "core.h"
#define TARGET_X86_64 1
typedef struct { unsigned m3b_service_debt; } CPUArchState;
static CPUArchState *active;
static unsigned notes[M3B_WORDS], sleeps, completions, faults, exits;
static bool capacity;
static uint64_t last_pc;
static void defuss_m3b_note(unsigned n) { notes[n]++; }
static void defuss_m3b_event_pc(unsigned n, uint64_t pc)
{ notes[n]++; last_pc = pc; }
static void defuss_m3b_profile_fault(void) { faults++; }
static CPUArchState *env_cpu(CPUArchState *e) { return e; }
static void cpu_exit(CPUArchState *e) { assert(e == active); exits++; }
static bool can_add_instance(void) { return capacity; }
static void emscripten_sleep(unsigned ms)
{ assert(ms == 0 && active->m3b_service_debt == 0); sleeps++; }
static void check_gc_completion(void) { completions++; }
#include "original-trysleep.inc"
#include "runtime-service.inc"

int main(void)
{
    CPUArchState env = { 0 };
    active = &env;
    exec_cnt = 2;
    m3b_service_after_call(&env, 0x400000);
    assert(exec_cnt == 2 && notes[M3B_SERVICE_PAID] == 0);
    env.m3b_service_debt = 1;
    m3b_service_after_call(&env, 0x400000);
    assert(env.m3b_service_debt == 0 && exec_cnt == 1 && sleeps == 0);
    assert(notes[M3B_B_ATTEMPTS] == 1 && notes[M3B_SERVICE_PAID] == 1);
    /* Re-entering this accounting boundary with cleared debt cannot repay it. */
    m3b_service_after_call(&env, 0x400000);
    assert(exec_cnt == 1 && notes[M3B_SERVICE_PAID] == 1);
    env.m3b_service_debt = 2;
    m3b_service_after_call(&env, 0x400031);
    assert(exec_cnt == MAX_EXEC_NUM && sleeps == 1 && completions == 1);
    assert(notes[M3B_B_REQUESTED] == 1 && notes[M3B_SERVICE_PAID] == 2);
    assert(last_pc == 0x400031);
    capacity = true;
    exec_cnt = 1;
    env.m3b_service_debt = 1;
    m3b_service_after_call(&env, 0x400000);
    assert(exec_cnt == MAX_EXEC_NUM && sleeps == 1 && completions == 1);
    env.m3b_service_debt = 3;
    m3b_service_after_call(&env, 0x400000);
    assert(env.m3b_service_debt == 0 && faults == 1 && exits == 1);
    assert(notes[M3B_DEBT_ERRORS] == 1 && notes[M3B_SERVICE_PAID] == 3);
    assert(exec_cnt == MAX_EXEC_NUM);
    puts("actual service helper: clear-before-maintenance and exact threshold contracts passed");
    return 0;
}
