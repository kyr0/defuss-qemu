/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * WebAssembly backend with forked TCI, based on tci.c
 *
 * Copyright (c) 2009, 2011, 2016 Stefan Weil
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

#include "qemu/osdep.h"
#include "tcg/tcg.h"
#include "tcg/tcg-ldst.h"
#include "tcg/helper-info.h"
#include <ffi.h>
#include <emscripten.h>
#include "wasm64.h"


/* TBs executed more than this value will be compiled to wasm */
/* Set by the launcher at preRun, before any vCPU is created. */
static int wasm_hot_limit = 1500;
EMSCRIPTEN_KEEPALIVE void defuss_set_hot_limit(int n);
EMSCRIPTEN_KEEPALIVE void defuss_set_hot_limit(int n)
{
    if (n >= 16 && n <= 65535) {
        wasm_hot_limit = n;
    }
}
#define INSTANTIATE_NUM wasm_hot_limit

#define EM_JS_PRE(ret, name, args, body...) EM_JS(ret, name, args, body)

#define DEC_PTR(p) bigintToI53Checked(p)
#define ENC_PTR(p) BigInt(p)
#if defined(WASM64_MEMORY64_2)
#define ENC_WASM_TABLE_IDX(i) Number(i)
#else
#define ENC_WASM_TABLE_IDX(i) i
#endif

EM_JS_PRE(void*, instantiate_wasm, (void *wasm_begin,
                                    int wasm_size,
                                    void *import_vec_begin,
                                    int import_vec_size, uint32_t *timing),
{
    const memory_v = new DataView(HEAP8.buffer);
    const wasm = HEAP8.subarray(DEC_PTR(wasm_begin),
                                DEC_PTR(wasm_begin) + wasm_size);
    var helper = {};
    /* expose-profile.py captures each worker's raw asyncify_get_state before
     * Emscripten export instrumentation and supplies a native Wasm predicate.
     * Older hosts keep the established JS fallback. No helper ABI changes. */
    helper.u = Module.pcNativeUnwindCheck || (() => {
        return (Asyncify.state != Asyncify.State.Unwinding) ? 1 : 0;
    });
    for (var i = 0; i < import_vec_size / 8; i++) {
        const idx = memory_v.getBigInt64(
            DEC_PTR(import_vec_begin) + i * 8, true);
        helper[i] = wasmTable.get(ENC_WASM_TABLE_IDX(idx));
    }
    const start = timing ? performance.now() : 0;
    const mod = new WebAssembly.Module(wasm);
    const compiled = timing ? performance.now() : 0;
    const inst = new WebAssembly.Instance(mod, {
            "env" : {
                "memory" : wasmMemory,
            },
            "helper" : helper,
    });

    Module.__wasm_tb.inst_gc_registry.register(inst.exports.start, "tbinstance");

    const entry = addFunction(inst.exports.start, 'ii');
    if (timing) {
        const i = DEC_PTR(timing) / 4;
        Atomics.add(HEAPU32, i, Math.round((compiled - start) * 1000));
        Atomics.add(HEAPU32, i + 1, Math.round((performance.now() - compiled) * 1000));
    }
    return ENC_PTR(entry);
});

__thread uintptr_t tci_tb_ptr;

static void tci_args_l(uint32_t insn, const void *tb_ptr, void **l0)
{
    int diff = sextract32(insn, 12, 20);
    *l0 = diff ? (void *)tb_ptr + diff : NULL;
}

static void tci_args_r(uint32_t insn, TCGReg *r0)
{
    *r0 = extract32(insn, 8, 4);
}

static void tci_args_nl(uint32_t insn, const void *tb_ptr,
                        uint8_t *n0, void **l1)
{
    *n0 = extract32(insn, 8, 4);
    *l1 = sextract32(insn, 12, 20) + (void *)tb_ptr;
}

static void tci_args_rl(uint32_t insn, const void *tb_ptr,
                        TCGReg *r0, void **l1)
{
    *r0 = extract32(insn, 8, 4);
    *l1 = sextract32(insn, 12, 20) + (void *)tb_ptr;
}

static void tci_args_rr(uint32_t insn, TCGReg *r0, TCGReg *r1)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
}

static void tci_args_ri(uint32_t insn, TCGReg *r0, tcg_target_ulong *i1)
{
    *r0 = extract32(insn, 8, 4);
    *i1 = sextract32(insn, 12, 20);
}

static void tci_args_rrm(uint32_t insn, TCGReg *r0,
                         TCGReg *r1, MemOpIdx *m2)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *m2 = extract32(insn, 16, 16);
}

static void tci_args_rrr(uint32_t insn, TCGReg *r0, TCGReg *r1, TCGReg *r2)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
}

static void tci_args_rrs(uint32_t insn, TCGReg *r0, TCGReg *r1, int32_t *i2)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *i2 = sextract32(insn, 16, 16);
}

static void tci_args_rrbb(uint32_t insn, TCGReg *r0, TCGReg *r1,
                          uint8_t *i2, uint8_t *i3)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *i2 = extract32(insn, 16, 6);
    *i3 = extract32(insn, 22, 6);
}

static void tci_args_rrrc(uint32_t insn,
                          TCGReg *r0, TCGReg *r1, TCGReg *r2, TCGCond *c3)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *c3 = extract32(insn, 20, 4);
}

static void tci_args_rrrrrc(uint32_t insn, TCGReg *r0, TCGReg *r1,
                            TCGReg *r2, TCGReg *r3, TCGReg *r4, TCGCond *c5)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *r3 = extract32(insn, 20, 4);
    *r4 = extract32(insn, 24, 4);
    *c5 = extract32(insn, 28, 4);
}

static bool tci_compare32(uint32_t u0, uint32_t u1, TCGCond condition)
{
    bool result = false;
    int32_t i0 = u0;
    int32_t i1 = u1;
    switch (condition) {
    case TCG_COND_EQ:
        result = (u0 == u1);
        break;
    case TCG_COND_NE:
        result = (u0 != u1);
        break;
    case TCG_COND_LT:
        result = (i0 < i1);
        break;
    case TCG_COND_GE:
        result = (i0 >= i1);
        break;
    case TCG_COND_LE:
        result = (i0 <= i1);
        break;
    case TCG_COND_GT:
        result = (i0 > i1);
        break;
    case TCG_COND_LTU:
        result = (u0 < u1);
        break;
    case TCG_COND_GEU:
        result = (u0 >= u1);
        break;
    case TCG_COND_LEU:
        result = (u0 <= u1);
        break;
    case TCG_COND_GTU:
        result = (u0 > u1);
        break;
    default:
        g_assert_not_reached();
    }
    return result;
}

static bool tci_compare64(uint64_t u0, uint64_t u1, TCGCond condition)
{
    bool result = false;
    int64_t i0 = u0;
    int64_t i1 = u1;
    switch (condition) {
    case TCG_COND_EQ:
        result = (u0 == u1);
        break;
    case TCG_COND_NE:
        result = (u0 != u1);
        break;
    case TCG_COND_LT:
        result = (i0 < i1);
        break;
    case TCG_COND_GE:
        result = (i0 >= i1);
        break;
    case TCG_COND_LE:
        result = (i0 <= i1);
        break;
    case TCG_COND_GT:
        result = (i0 > i1);
        break;
    case TCG_COND_LTU:
        result = (u0 < u1);
        break;
    case TCG_COND_GEU:
        result = (u0 >= u1);
        break;
    case TCG_COND_LEU:
        result = (u0 <= u1);
        break;
    case TCG_COND_GTU:
        result = (u0 > u1);
        break;
    default:
        g_assert_not_reached();
    }
    return result;
}

static uint64_t tci_qemu_ld(CPUArchState *env, uint64_t taddr,
                            MemOpIdx oi, const void *tb_ptr)
{
    MemOp mop = get_memop(oi);
    uintptr_t ra = (uintptr_t)tb_ptr;

    switch (mop & MO_SSIZE) {
    case MO_UB:
        return helper_ldub_mmu(env, taddr, oi, ra);
    case MO_SB:
        return helper_ldsb_mmu(env, taddr, oi, ra);
    case MO_UW:
        return helper_lduw_mmu(env, taddr, oi, ra);
    case MO_SW:
        return helper_ldsw_mmu(env, taddr, oi, ra);
    case MO_UL:
        return helper_ldul_mmu(env, taddr, oi, ra);
    case MO_SL:
        return helper_ldsl_mmu(env, taddr, oi, ra);
    case MO_UQ:
        return helper_ldq_mmu(env, taddr, oi, ra);
    default:
        g_assert_not_reached();
    }
}

static void tci_qemu_st(CPUArchState *env, uint64_t taddr, uint64_t val,
                        MemOpIdx oi, const void *tb_ptr)
{
    MemOp mop = get_memop(oi);
    uintptr_t ra = (uintptr_t)tb_ptr;

    switch (mop & MO_SIZE) {
    case MO_UB:
        helper_stb_mmu(env, taddr, val, oi, ra);
        break;
    case MO_UW:
        helper_stw_mmu(env, taddr, val, oi, ra);
        break;
    case MO_UL:
        helper_stl_mmu(env, taddr, val, oi, ra);
        break;
    case MO_UQ:
        helper_stq_mmu(env, taddr, val, oi, ra);
        break;
    default:
        g_assert_not_reached();
    }
}

static __thread int thread_idx;

static inline int32_t get_counter_local(void *tb_ptr)
{
    return get_counter(tb_ptr, thread_idx);
}

static inline void set_counter_local(void *tb_ptr, int v)
{
    set_counter(tb_ptr, thread_idx, v);
}

static inline struct WasmInstanceInfo *get_info_local(void *tb_ptr)
{
    return get_info(tb_ptr, thread_idx);
}

static inline void set_info_local(void *tb_ptr, struct WasmInstanceInfo *info)
{
    set_info(tb_ptr, thread_idx, info);
}

/* Configuration is fixed before starting vCPU workers. Detached JS instances
 * remain charged until their existing FinalizationRegistry callback runs. */
static bool wasm46_admission = true;
bool wasm46_rep16 = true;
static bool pressure_meter;
static int instances_global;
static __thread unsigned instance_budget = 12000;
static uint32_t pressure_stats[7];

EMSCRIPTEN_KEEPALIVE void defuss46_settings(unsigned flags);
EMSCRIPTEN_KEEPALIVE void defuss46_settings(unsigned flags)
{
    wasm46_admission = flags & 1;
    wasm46_rep16 = flags & 2;
    pressure_meter = flags & 4;
}
EMSCRIPTEN_KEEPALIVE uint32_t defuss46_stat(unsigned index);
EMSCRIPTEN_KEEPALIVE uint32_t defuss46_stat(unsigned index)
{
    return index < ARRAY_SIZE(pressure_stats) ? qatomic_read(&pressure_stats[index]) : 0;
}
void wasm46_note_batch(unsigned count);
void wasm46_note_batch(unsigned count)
{
    if (pressure_meter) {
        qatomic_inc(&pressure_stats[5]);
        qatomic_add(&pressure_stats[6], count);
    }
}

/* Sample occupancy only at admission, and then every 128 further executions.
 * Previously known-hot plan entries and deferred TCI recipes still reach
 * their normal retranslation path. Compiled blocks incur no extra checks. */
static inline bool inc_counter(void *tb_ptr, bool *held)
{
    int32_t count = get_counter_local(tb_ptr);
    if (count < 0) {
        return true;
    }
    if (count >= INSTANTIATE_NUM) {
        if (!wasm46_admission || (!held && get_info_local(tb_ptr)) ||
            !((struct WasmTBHeader *)tb_ptr)->wasm_size) {
            return true;
        }
        if (count == INSTANTIATE_NUM || !(count & 127)) {
            unsigned n = qatomic_read(&instances_global);
            unsigned floor = MAX(1500, INSTANTIATE_NUM);
            unsigned need = INSTANTIATE_NUM;
            if (n * 20 >= instance_budget * 19) {
                need = floor * 64;
            } else if (n * 20 >= instance_budget * 18) {
                need = floor * 16;
            } else if (n * 20 >= instance_budget * 16) {
                need = floor * 4;
            } else if (n * 2 >= instance_budget) {
                need = floor;
            }
            if ((unsigned)count >= need) {
                return true;
            }
        }
        if (held) {
            *held = true;
        }
    }
    set_counter_local(tb_ptr, count + 1);
    return false;
}

static __thread struct WasmContext ctx = {
    .tb_ptr = 0,
    .stack = NULL,
    .do_init = 1,
    .buf128 = NULL,
};

/* Optional cold-bytecode sampler. Words 1..3 are sampled tier dispatches.
 * At most 64 interpreted bytecodes are counted per selected dispatch. */
static uint32_t wasm_profile[4 + 256];
static uint32_t stage_times[10]; /* Four (us, calls) pairs, emitted bytes and guest instructions. */
static uint32_t interpreter_pairs[256 * 256];
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_stage_stats(int pairs);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_stage_stats(int pairs)
{
    return pairs ? (uintptr_t)interpreter_pairs : (uintptr_t)stage_times;
}
void defuss_note_emission(unsigned size, unsigned insns)
{
    qatomic_add(&stage_times[8], size);
    qatomic_add(&stage_times[9], insns);
}
double defuss_stage_start(void)
{
    return qatomic_read(&wasm_profile[0]) ? emscripten_get_now() : 0;
}
void defuss_stage_end(unsigned stage, double start)
{
    if (start > 0) {
        double us = (emscripten_get_now() - start) * 1000;
        qatomic_add(&stage_times[stage * 2], (uint32_t)(us + 0.5));
        qatomic_inc(&stage_times[stage * 2 + 1]);
    }
}
/* One ending timestamp for the same interpreted interval. Pressure time is
 * a subset of interpreter time, not an additional timed stage. Keep the
 * existing pressure truncation and stage rounding, and never read the clock
 * when neither counter is enabled. pressure_index is 0 (off), 1 (held), or
 * 3 (instance budget); its following word stores elapsed microseconds. */
static inline __attribute__((always_inline)) void
record_interpretation(double start, bool profiling, unsigned pressure_index)
{
    if (pressure_index || (profiling && start > 0)) {
        double us = (emscripten_get_now() - start) * 1000;
        if (pressure_index) {
            qatomic_inc(&pressure_stats[pressure_index]);
            qatomic_add(&pressure_stats[pressure_index + 1], (uint32_t)us);
        }
        if (profiling && start > 0) {
            qatomic_add(&stage_times[4], (uint32_t)(us + 0.5));
            qatomic_inc(&stage_times[5]);
        }
    }
}
static __thread uint32_t profile_phase;
static uint32_t jit_time_us[2];
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_jit_time(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_jit_time(void)
{
    return (uintptr_t)jit_time_us;
}
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_profile(int op);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_profile(int op)
{
    if (op == -1) {
        return (uintptr_t)wasm_profile;
    }
    return op >= 0 && op < tcg_op_defs_max ? (uintptr_t)tcg_op_defs[op].name : 0;
}
/* Bounded leaf fast path. No helpers, guest accesses or control transfers.
 * The caller retains sampled dispatches and all fallback semantics. */
EMSCRIPTEN_KEEPALIVE uint32_t *defuss63_fast(tcg_target_ulong *, uint32_t *);
EMSCRIPTEN_KEEPALIVE __attribute__((noinline)) uint32_t *
defuss63_fast(tcg_target_ulong *regs, uint32_t *pc)
{
    for (unsigned n = 0; n < 64; n++, pc++) {
        uint32_t insn = *pc;
        unsigned r0 = (insn >> 8) & 15;
        unsigned r1 = (insn >> 12) & 15;
        unsigned r2 = (insn >> 16) & 15;
        switch (insn & 255) {
        case INDEX_op_and:
            regs[r0] = regs[r1] & regs[r2];
            break;
        case INDEX_op_or:
            regs[r0] = regs[r1] | regs[r2];
            break;
        case INDEX_op_xor:
            regs[r0] = regs[r1] ^ regs[r2];
            break;
        case INDEX_op_add:
            regs[r0] = regs[r1] + regs[r2];
            break;
        case INDEX_op_sub:
            regs[r0] = regs[r1] - regs[r2];
            break;
        case INDEX_op_mul:
            regs[r0] = regs[r1] * regs[r2];
            break;
        case INDEX_op_shl:
            regs[r0] = regs[r1] << (regs[r2] & 63);
            break;
        case INDEX_op_shr:
            regs[r0] = regs[r1] >> (regs[r2] & 63);
            break;
        case INDEX_op_sar:
            regs[r0] = (int64_t)regs[r1] >> (regs[r2] & 63);
            break;
        case INDEX_op_neg:
            regs[r0] = -regs[r1];
            break;
        case INDEX_op_mov:
            regs[r0] = regs[r1];
            break;
        case INDEX_op_tci_add_s16:
            regs[r0] = regs[r1] + (int64_t)(int16_t)(insn >> 16);
            break;
        case INDEX_op_tci_movi:
            regs[r0] = (int32_t)insn >> 12;
            break;
        case INDEX_op_tci_movl:
            regs[r0] = *(uint64_t *)((uint8_t *)(pc + 1) + ((int32_t)insn >> 12));
            break;
        case INDEX_op_ld:
            regs[r0] = *(uint64_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16));
            break;
        case INDEX_op_ld8u:
            regs[r0] = *(uint8_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16));
            break;
        case INDEX_op_ld8s:
            regs[r0] = *(int8_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16));
            break;
        case INDEX_op_ld16u:
            regs[r0] = *(uint16_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16));
            break;
        case INDEX_op_ld16s:
            regs[r0] = *(int16_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16));
            break;
        case INDEX_op_ld32u:
            regs[r0] = *(uint32_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16));
            break;
        case INDEX_op_ld32s:
            regs[r0] = *(int32_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16));
            break;
        case INDEX_op_st:
            *(uint64_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16)) = regs[r0];
            break;
        case INDEX_op_st8:
            *(uint8_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16)) = regs[r0];
            break;
        case INDEX_op_st16:
            *(uint16_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16)) = regs[r0];
            break;
        case INDEX_op_st32:
            *(uint32_t *)(regs[r1] + (int64_t)(int16_t)(insn >> 16)) = regs[r0];
            break;
        default:
            return pc;
        }
    }
    return pc;
}

static inline __attribute__((always_inline)) uintptr_t
tcg_qemu_tb_exec_tci(CPUArchState *env, bool sample)
{
    uint32_t *tb_ptr = get_tci_ptr(ctx.tb_ptr);
    tcg_target_ulong regs[TCG_TARGET_NB_REGS];
    uint64_t stack[(TCG_STATIC_CALL_ARGS_SIZE + TCG_STATIC_FRAME_SIZE)
                   / sizeof(uint64_t)];

    unsigned budget = 64, previous = 256;
    regs[TCG_AREG0] = (tcg_target_ulong)env;
    regs[TCG_REG_CALL_STACK] = (uintptr_t)stack;

    for (;;) {
        uint32_t insn;
        TCGOpcode opc;
        TCGReg r0, r1, r2, r3, r4;
        tcg_target_ulong t1;
        uint8_t pos, len;
        TCGCond condition;
        uint32_t tmp32;
        uint64_t taddr;
        MemOpIdx oi;
        int32_t ofs;
        void *ptr;

        /* Preserve the first 64 opcode/pair samples, then resume batching
         * even if this invocation chains more TBs. Keep sample set so helper
         * timing retains its original scope after the opcode budget ends.
         * The leaf stops before guest accesses, helpers, control flow and mb. */
        if (!sample || !budget) {
            tb_ptr = defuss63_fast(regs, tb_ptr);
        }
        insn = *tb_ptr++;
        opc = extract32(insn, 0, 8);
        if (sample && budget) {
            qatomic_inc(&wasm_profile[4 + opc]);
            if (previous < 256) {
                qatomic_inc(&interpreter_pairs[previous * 256 + opc]);
            }
            previous = opc;
            budget--;
        }

        switch (opc) {
        case INDEX_op_tci_call_typed:
            {
                typedef void (*Thunk)(uint64_t *);
                tci_args_nl(insn, tb_ptr, &len, &ptr);
                Thunk fn = ((Thunk *)ptr)[0];
                tci_tb_ptr = (uintptr_t)tb_ptr;
                double start = sample ? defuss_stage_start() : 0;
                fn(stack);
                if (sample) {
                    defuss_stage_end(3, start);
                }
            }
            goto helper_return;
        case INDEX_op_call:
            {
                void *call_slots[MAX_CALL_IARGS];
                ffi_cif *cif;
                void *func;
                unsigned i, s, n;

                tci_args_nl(insn, tb_ptr, &len, &ptr);
                func = ((void **)ptr)[0];
                cif = ((void **)ptr)[1];

                n = cif->nargs;
                for (i = s = 0; i < n; ++i) {
                    ffi_type *t = cif->arg_types[i];
                    call_slots[i] = &stack[s];
                    s += DIV_ROUND_UP(t->size, 8);
                }

                /* Helper functions may need to access the "return address" */
                tci_tb_ptr = (uintptr_t)tb_ptr;
                double helper_start = sample ? defuss_stage_start() : 0;
                ffi_call(cif, func, stack, call_slots);
                if (sample) {
                    defuss_stage_end(3, helper_start);
                }
            }

        helper_return:
            switch (len) {
            case 0: /* void */
                break;
            case 1: /* uint32_t */
                /*
                 * The result winds up "left-aligned" in the stack[0] slot.
                 * Note that libffi has an odd special case in that it will
                 * always widen an integral result to ffi_arg.
                 */
                if (sizeof(ffi_arg) == 8) {
                    regs[TCG_REG_R0] = (uint32_t)stack[0];
                } else {
                    regs[TCG_REG_R0] = *(uint32_t *)stack;
                }
                break;
            case 2: /* uint64_t */
                memcpy(&regs[TCG_REG_R0], stack, 8);
                break;
            case 3: /* Int128 */
                memcpy(&regs[TCG_REG_R0], stack, 16);
                break;
            default:
                g_assert_not_reached();
            }
            break;
        case INDEX_op_and:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] & regs[r2];
            break;
        case INDEX_op_or:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] | regs[r2];
            break;
        case INDEX_op_xor:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] ^ regs[r2];
            break;
        case INDEX_op_tci_add_s16:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            regs[r0] = regs[r1] + (tcg_target_long)ofs;
            break;
        case INDEX_op_add:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] + regs[r2];
            break;
        case INDEX_op_sub:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] - regs[r2];
            break;
        case INDEX_op_mul:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] * regs[r2];
            break;
        case INDEX_op_extract:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            regs[r0] = extract64(regs[r1], pos, len);
            break;
        case INDEX_op_sextract:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            regs[r0] = sextract64(regs[r1], pos, len);
            break;
        case INDEX_op_shl:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] << (regs[r2] % TCG_TARGET_REG_BITS);
            break;
        case INDEX_op_shr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] >> (regs[r2] % TCG_TARGET_REG_BITS);
            break;
        case INDEX_op_sar:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ((tcg_target_long)regs[r1]
                        >> (regs[r2] % TCG_TARGET_REG_BITS));
            break;
        case INDEX_op_neg:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = -regs[r1];
            break;
        case INDEX_op_setcond:
            tci_args_rrrc(insn, &r0, &r1, &r2, &condition);
            regs[r0] = tci_compare64(regs[r1], regs[r2], condition);
            break;
        case INDEX_op_movcond:
            tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &condition);
            tmp32 = tci_compare64(regs[r1], regs[r2], condition);
            regs[r0] = regs[tmp32 ? r3 : r4];
            break;
        case INDEX_op_tci_setcond32:
            tci_args_rrrc(insn, &r0, &r1, &r2, &condition);
            regs[r0] = tci_compare32(regs[r1], regs[r2], condition);
            break;
        case INDEX_op_tci_movcond32:
            tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &condition);
            tmp32 = tci_compare32(regs[r1], regs[r2], condition);
            regs[r0] = regs[tmp32 ? r3 : r4];
            break;
        case INDEX_op_mov:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = regs[r1];
            break;
        case INDEX_op_tci_movi:
            tci_args_ri(insn, &r0, &t1);
            regs[r0] = t1;
            break;
        case INDEX_op_tci_movl:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            regs[r0] = *(tcg_target_ulong *)ptr;
            break;
        case INDEX_op_ld:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(tcg_target_ulong *)ptr;
            break;
        case INDEX_op_ld8u:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint8_t *)ptr;
            break;
        case INDEX_op_ld8s:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(int8_t *)ptr;
            break;
        case INDEX_op_ld16u:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint16_t *)ptr;
            break;
        case INDEX_op_ld16s:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(int16_t *)ptr;
            break;
        case INDEX_op_st:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(tcg_target_ulong *)ptr = regs[r0];
            break;
        case INDEX_op_st8:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint8_t *)ptr = regs[r0];
            break;
        case INDEX_op_st16:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint16_t *)ptr = regs[r0];
            break;
        case INDEX_op_ld32u:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint32_t *)ptr;
            break;
        case INDEX_op_ld32s:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(int32_t *)ptr;
            break;
        case INDEX_op_st32:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint32_t *)ptr = regs[r0];
            break;
        case INDEX_op_divs:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int64_t)regs[r1] / (int64_t)regs[r2];
            break;
        case INDEX_op_divu:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint64_t)regs[r1] / (uint64_t)regs[r2];
            break;
        case INDEX_op_rems:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int64_t)regs[r1] % (int64_t)regs[r2];
            break;
        case INDEX_op_remu:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint64_t)regs[r1] % (uint64_t)regs[r2];
            break;
        case INDEX_op_tci_divs32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int32_t)regs[r1] / (int32_t)regs[r2];
            break;
        case INDEX_op_tci_divu32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint32_t)regs[r1] / (uint32_t)regs[r2];
            break;
        case INDEX_op_tci_rems32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int32_t)regs[r1] % (int32_t)regs[r2];
            break;
        case INDEX_op_tci_remu32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint32_t)regs[r1] % (uint32_t)regs[r2];
            break;
        case INDEX_op_ctpop:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = ctpop64(regs[r1]);
            break;
        case INDEX_op_clz:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] ? clz64(regs[r1]) : regs[r2];
            break;
        case INDEX_op_ctz:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] ? ctz64(regs[r1]) : regs[r2];
            break;
        case INDEX_op_tci_clz32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp32 = regs[r1];
            regs[r0] = tmp32 ? clz32(tmp32) : regs[r2];
            break;
        case INDEX_op_tci_ctz32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp32 = regs[r1];
            regs[r0] = tmp32 ? ctz32(tmp32) : regs[r2];
            break;
        case INDEX_op_rotl:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = rol64(regs[r1], regs[r2] & 63);
            break;
        case INDEX_op_rotr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ror64(regs[r1], regs[r2] & 63);
            break;
        case INDEX_op_tci_rotl32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = rol32(regs[r1], regs[r2] & 31);
            break;
        case INDEX_op_tci_rotr32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ror32(regs[r1], regs[r2] & 31);
            break;
        case INDEX_op_br:
            tci_args_l(insn, tb_ptr, &ptr);
            tb_ptr = ptr;
            continue;
        case INDEX_op_tci_brcond32:
        case INDEX_op_tci_brcond64:
            tci_args_rrrc(insn, &r0, &r1, &r2, &condition);
            insn = *tb_ptr++;
            if (opc == INDEX_op_tci_brcond32 ?
                tci_compare32(regs[r1], regs[r2], condition) :
                tci_compare64(regs[r1], regs[r2], condition)) {
                /* Unlike exit_tb, zero displacement is a valid fall-through. */
                tb_ptr = (void *)tb_ptr + sextract32(insn, 12, 20);
            }
            break;
        case INDEX_op_brcond:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            if (regs[r0]) {
                tb_ptr = ptr;
            }
            break;
        case INDEX_op_exit_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            ctx.tb_ptr = 0;
            return (uintptr_t)ptr;
        case INDEX_op_goto_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            if (tb_ptr != *(void **)ptr) {
                tb_ptr = *(void **)ptr;
                ctx.tb_ptr = tb_ptr;
                if (inc_counter(tb_ptr, NULL)) {
                    return 0; /* enter to wasm TB */
                }
                tb_ptr = get_tci_ptr(tb_ptr);
            }
            break;
        case INDEX_op_goto_ptr:
            tci_args_r(insn, &r0);
            ptr = (void *)regs[r0];
            if (!ptr) {
                ctx.tb_ptr = 0;
                return 0;
            }
            tb_ptr = ptr;
            ctx.tb_ptr = tb_ptr;
            if (inc_counter(tb_ptr, NULL)) {
                return 0; /* enter to wasm TB */
            }
            tb_ptr = get_tci_ptr(tb_ptr);
            break;
        case INDEX_op_qemu_ld:
            tci_args_rrm(insn, &r0, &r1, &oi);
            taddr = regs[r1];
            regs[r0] = tci_qemu_ld(env, taddr, oi, tb_ptr);
            break;
        case INDEX_op_tci_qemu_ld_imm32:
            tci_args_rr(insn, &r0, &r1);
            oi = *tb_ptr++;
            taddr = regs[r1];
            regs[r0] = tci_qemu_ld(env, taddr, oi, tb_ptr);
            break;
        case INDEX_op_tci_qemu_ld_rrr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            taddr = regs[r1];
            oi = regs[r2];
            regs[r0] = tci_qemu_ld(env, taddr, oi, tb_ptr);
            break;
        case INDEX_op_qemu_st:
            tci_args_rrm(insn, &r0, &r1, &oi);
            taddr = regs[r1];
            tci_qemu_st(env, taddr, regs[r0], oi, tb_ptr);
            break;
        case INDEX_op_tci_qemu_st_imm32:
            tci_args_rr(insn, &r0, &r1);
            oi = *tb_ptr++;
            taddr = regs[r1];
            tci_qemu_st(env, taddr, regs[r0], oi, tb_ptr);
            break;
        case INDEX_op_tci_qemu_st_rrr:
            tci_args_rrr(insn, &r0, &r1, &r2);
            taddr = regs[r1];
            oi = regs[r2];
            tci_qemu_st(env, taddr, regs[r0], oi, tb_ptr);
            break;
        case INDEX_op_mb:
            /* Ensure ordering for all kinds */
            smp_mb();
            break;
        default:
            g_assert_not_reached();
        }
    }
}

/*
 * The maximum number of instances that can exist simultaneously
 *
 * If this limit is reached and a new instance is required, older instances are
 * removed to allow creation of new ones without exceeding the browser's limit.
 */
#define MAX_INSTANCES 12000

/* Global pool includes retired exports until their GC callback completes. */
EMSCRIPTEN_KEEPALIVE unsigned defuss62_pool(unsigned limit);
EMSCRIPTEN_KEEPALIVE unsigned defuss62_pool(unsigned limit)
{
    return limit ? MAX_INSTANCES : qatomic_read(&instances_global);
}

#if defined(WASM64_MEMORY64_2)
/* JSC can retain substantial memory for each dynamically instantiated TB.
 * Bound the live/pending pool for this host; other engines retain the default. */
EM_JS(int, bun_instance_budget, (), {
    if (!globalThis.Bun) return 12000;
    const n = Number(globalThis.process?.env?.DEFUSS_BUN_TB_LIMIT ?? 128);
    return Number.isInteger(n) && n >= 16 && n <= 12000 ? n : 128;
});
#endif

/* Avoid overwrapping of begin/end pointers */
#define INSTANCES_BUF_MAX (MAX_INSTANCES + 1)

static __thread struct WasmInstanceInfo instances[INSTANCES_BUF_MAX];
static __thread int instances_begin;
static __thread int instances_end;

static void add_instance(wasm_tb_func tb_func, void *tb_ptr)
{
    instances[instances_end].tb_func = tb_func;
    instances[instances_end].tb_ptr = tb_ptr;
    set_info_local(tb_ptr, &(instances[instances_end]));
    instances_end  = (instances_end + 1) % INSTANCES_BUF_MAX;

    if (pressure_meter) {
        qatomic_inc(&pressure_stats[0]);
    }
}

static __thread int instance_pending_gc;
static __thread int instance_done_gc;

static void remove_old_instances(void)
{
    int num;
    if (instance_pending_gc > 0) {
        return;
    }
    if (instances_begin <= instances_end) {
        num = instances_end - instances_begin;
    } else {
        num = instances_end + (INSTANCES_BUF_MAX - instances_begin);
    }
    /* removes the half of the oldest instances in the buffer */
    num /= 2;
    for (int i = 0; i < num; i++) {
        EM_ASM({ removeFunction($0); }, instances[instances_begin].tb_func);
        instances[instances_begin].tb_ptr = NULL;
        instances_begin = (instances_begin + 1) % INSTANCES_BUF_MAX;
    }
    instance_pending_gc += num;
}

static bool can_add_instance(void)
{
    return qatomic_read(&instances_global) < instance_budget;
}

/* Claim capacity before instantiating, including simultaneous vCPU workers. */
static bool reserve_instance(void)
{
    int n = qatomic_read(&instances_global);
    while (n < instance_budget) {
        int observed = qatomic_cmpxchg(&instances_global, n, n + 1);
        if (observed == n) {
            return true;
        }
        n = observed;
    }
    return false;
}

static wasm_tb_func get_instance_from_tb(void *tb_ptr)
{
    struct WasmInstanceInfo *elm = get_info_local(tb_ptr);
    if (elm == NULL) {
        return NULL;
    }
    if (elm->tb_ptr != tb_ptr) {
        /*
         * This TB was instantiated before, but has been removed. Set counter to
         * the max value so that this will be instantiated.
         */
        set_counter_local(tb_ptr, INSTANTIATE_NUM);
        set_info_local(tb_ptr, NULL);
        return NULL;
    }
    return elm->tb_func;
}

static void check_gc_completion(void)
{
    if (instance_done_gc > 0) {
        qatomic_sub(&instances_global, instance_done_gc);
        instance_pending_gc -= instance_done_gc;
        instance_done_gc = 0;
    }
}

EM_JS_PRE(void, init_wasm_js, (void *instance_done_gc),
{
    Module.__wasm_tb = {
        inst_gc_registry: new FinalizationRegistry((i) => {
            if (i == "tbinstance") {
                const memory_v = new DataView(HEAP8.buffer);
                let v = memory_v.getInt32(DEC_PTR(instance_done_gc), true);
                memory_v.setInt32(DEC_PTR(instance_done_gc), v + 1, true);
            }
        })
    };
});

#define MAX_EXEC_NUM 50000
static __thread int exec_cnt = MAX_EXEC_NUM;
static inline void trysleep(void)
{
    /*
     * Even during running TBs continuously, try to return the control
     * to the browser periodically and allow browsers doing tasks.
     */
    if (--exec_cnt == 0) {
        if (!can_add_instance()) {
            emscripten_sleep(0);
            check_gc_completion();
        }
        exec_cnt = MAX_EXEC_NUM;
    }
}

static int thread_idx_max;

static void init_wasm(void)
{
#if defined(WASM64_MEMORY64_2)
    instance_budget = bun_instance_budget();
#endif
    thread_idx = qatomic_fetch_inc(&thread_idx_max);
    ctx.stack = g_malloc(TCG_STATIC_CALL_ARGS_SIZE + TCG_STATIC_FRAME_SIZE);
    ctx.buf128 = g_malloc(16);
    ctx.tci_tb_ptr = (uint32_t *)&tci_tb_ptr;
    init_wasm_js(&instance_done_gc);
}

static __thread bool initdone;

uintptr_t tcg_qemu_tb_exec(CPUArchState *env, const void *v_tb_ptr)
{
    if (!initdone) {
        init_wasm();
        initdone = true;
    }
    ctx.env = env;
    ctx.tb_ptr = (void *)v_tb_ptr;
    while (true) {
        trysleep();
        uintptr_t res;
        wasm_tb_func tb_func = get_instance_from_tb(ctx.tb_ptr);
        bool profiling = qatomic_read(&wasm_profile[0]);
        bool held = false;
        bool sample = profiling && (++profile_phase % 257 == 0);
        if (tb_func) {
            if (sample) {
                qatomic_inc(&wasm_profile[1]);
            }
            /*
             * Call the Wasm instance
             */
            res = call_wasm_tb(tb_func, &ctx);
        } else if (!inc_counter(ctx.tb_ptr, &held)) {
            /*
             * Run it on TCI because the counter value is small
             */
            double interpret_start = (profiling || (held && pressure_meter)) ? emscripten_get_now() : 0;
            if (sample) {
                qatomic_inc(&wasm_profile[2]);
                res = tcg_qemu_tb_exec_tci(env, true);
            } else {
                res = tcg_qemu_tb_exec_tci(env, false);
            }
            record_interpretation(interpret_start, profiling,
                                  held && pressure_meter ? 1 : 0);
        } else if (!((struct WasmTBHeader *)ctx.tb_ptr)->wasm_size) {
            return wasm44_retier(env, ctx.tb_ptr);
        } else if (!reserve_instance()) {
            /*
             * Too many instances has been created, try removing older
             * instances and keep running this TB on TCI
             */
            remove_old_instances();
            check_gc_completion();
            double interpret_start = (profiling || pressure_meter) ? emscripten_get_now() : 0;
            if (sample) {
                qatomic_inc(&wasm_profile[2]);
                res = tcg_qemu_tb_exec_tci(env, true);
            } else {
                res = tcg_qemu_tb_exec_tci(env, false);
            }
            record_interpretation(interpret_start, profiling,
                                  pressure_meter ? 3 : 0);
        } else {
            /*
             * Instantiate and run the Wasm module
             */
            struct WasmTBHeader *header = (struct WasmTBHeader *)ctx.tb_ptr;
            wasm44_promoted(header->plan_id);
            tb_func = (wasm_tb_func)instantiate_wasm(header->wasm_ptr,
                                                     header->wasm_size,
                                                     header->import_ptr,
                                                     header->import_size,
                                                     qatomic_read(&wasm_profile[0]) ?
                                                     jit_time_us : NULL);
            if (qatomic_read(&wasm_profile[0])) {
                qatomic_inc(&wasm_profile[3]);
            }
            add_instance(tb_func, ctx.tb_ptr);
            res = call_wasm_tb(tb_func, &ctx);
        }
        if (!ctx.tb_ptr) {
            return res;
        }
    }
}
