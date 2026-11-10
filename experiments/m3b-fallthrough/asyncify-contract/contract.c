/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Actual Asyncify fixture, not a VM. Only capacity/GC/CPU context are stubs. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <emscripten.h>
#include "core.h"
#define TARGET_X86_64 1
typedef struct { unsigned m3b_service_debt; } CPUArchState;
static CPUArchState env;
static uint32_t bank[32] = { [0] = UINT32_C(0x4d334143), [1] = 1, [19] = 32 };
static unsigned notes[M3B_WORDS], completions, faults, exits, returns, zero_calls;
static uint64_t last_pc;
static bool capacity;
static bool can_add_instance(void);
static void check_gc_completion(void);
/* Copied verbatim, including its original50000 threshold/TLS declaration. */
#include "original-trysleep.inc"

static void sync_bank(void)
{
    bank[4] = env.m3b_service_debt;
    bank[5] = exec_cnt;
    bank[6] = notes[M3B_B_ATTEMPTS];
    bank[7] = notes[M3B_B_REQUESTED];
    bank[8] = notes[M3B_SERVICE_PAID];
    bank[9] = notes[M3B_DEBT_ERRORS];
    bank[10] = completions; bank[11] = faults; bank[12] = exits;
    bank[13] = returns; bank[14] = zero_calls; bank[15] = capacity;
    bank[16] = last_pc; bank[17] = last_pc >> 32;
}
static bool can_add_instance(void) { sync_bank(); return capacity; }
static void check_gc_completion(void) { completions++; sync_bank(); }
static void defuss_m3b_note(unsigned n) { assert(n < M3B_WORDS); notes[n]++; sync_bank(); }
static void defuss_m3b_event_pc(unsigned n, uint64_t pc)
{ assert(n < M3B_WORDS); notes[n]++; last_pc = pc; sync_bank(); }
static void defuss_m3b_profile_fault(void) { faults++; sync_bank(); }
static CPUArchState *env_cpu(CPUArchState *e) { return e; }
static void cpu_exit(CPUArchState *e) { assert(e == &env); exits++; sync_bank(); }
#include "runtime-service.inc"

static void call(unsigned stage, unsigned debt, int countdown, bool room)
{
    bank[2] = stage; env.m3b_service_debt = debt; exec_cnt = countdown;
    capacity = room; sync_bank();
    m3b_service_after_call(&env, UINT64_C(0x123456789abc));
    returns++; sync_bank();
    assert(env.m3b_service_debt == 0);
    bank[18]++;
}

EMSCRIPTEN_KEEPALIVE uintptr_t contract_data(void) { return (uintptr_t)bank; }
EMSCRIPTEN_KEEPALIVE int run_contract(void)
{
    assert(returns == 0 && bank[3] == 0);
    call(0, 0, 2, false);
    assert(exec_cnt == 2 && notes[M3B_SERVICE_PAID] == 0);
    call(1, 1, 2, false);
    assert(exec_cnt == 1 && notes[M3B_SERVICE_PAID] == 1);
    assert(notes[M3B_B_ATTEMPTS] == 1 && notes[M3B_B_REQUESTED] == 0 && completions == 0);
    zero_calls++; call(2, 0, 1, false);
    assert(exec_cnt == 1 && notes[M3B_SERVICE_PAID] == 1);
    assert(notes[M3B_B_ATTEMPTS] == 1 && notes[M3B_B_REQUESTED] == 0 && completions == 0);
    /* Real emscripten_sleep(0), native unwind and rewind, no mocked sleep. */
    call(3, 2, 1, false);
    assert(exec_cnt == MAX_EXEC_NUM && completions == 1);
    assert(notes[M3B_B_ATTEMPTS] == 2 && notes[M3B_B_REQUESTED] == 1);
    assert(notes[M3B_SERVICE_PAID] == 2 && returns == 4);
    call(4, 1, 1, true);
    assert(exec_cnt == MAX_EXEC_NUM && completions == 1);
    assert(notes[M3B_SERVICE_PAID] == 3 && notes[M3B_B_ATTEMPTS] == 3 && notes[M3B_B_REQUESTED] == 1);
    call(5, 1, 1, false);
    assert(exec_cnt == MAX_EXEC_NUM && completions == 2);
    assert(notes[M3B_SERVICE_PAID] == 4 && notes[M3B_B_ATTEMPTS] == 4);
    call(6, 3, 7, false);
    assert(exec_cnt == 7 && faults == 1 && exits == 1);
    assert(notes[M3B_DEBT_ERRORS] == 1 && notes[M3B_SERVICE_PAID] == 4);
    zero_calls++; call(7, 0, 7, false);
    assert(exec_cnt == 7 && completions == 2 && returns == 8);
    assert(notes[M3B_SERVICE_PAID] == 4 && notes[M3B_B_REQUESTED] == 1);
    bank[3] = 1; sync_bank();
    return 0;
}
