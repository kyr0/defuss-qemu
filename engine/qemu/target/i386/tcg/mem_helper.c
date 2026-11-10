/*
 *  x86 memory access helpers
 *
 *  Copyright (c) 2003 Fabrice Bellard
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, see <http://www.gnu.org/licenses/>.
 */

#include "qemu/osdep.h"
#include "cpu.h"
#include "exec/helper-proto.h"
#include "accel/tcg/cpu-ldst.h"
#include "qemu/int128.h"
#include "qemu/atomic128.h"
#include "tcg/tcg.h"
#include "helper-tcg.h"

#if defined(__EMSCRIPTEN__) && defined(TARGET_X86_64) && !defined(CONFIG_USER_ONLY)
#include "accel/tcg/probe.h"
#include "exec/target_page.h"
#include <emscripten.h>

EMSCRIPTEN_KEEPALIVE unsigned defuss64_rep32(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss64_rep32(void) { return 1; }

/* Per-element atomics preserve natural-width accesses and forward MOVS
 * overlap, including distinct virtual mappings of the same physical RAM.
 * tlb_vaddr_to_host returns NULL for MMIO, dirty/code traps and watchpoints. */
void helper_wasm_rep_ram(CPUX86State *env, uint32_t mode)
{
    uint64_t src = env->regs[R_ESI], dst = env->regs[R_EDI];
    unsigned shift = mode & 3, width = 1u << shift;
    bool copy = mode & 4;
    bool real = mode & 0x100;
    bool flat32 = mode & 0x200;
    unsigned mmu = (mode & 0xff) >> 3;
    unsigned count = (env->regs[R_ECX] - 1) & 0xffff;
    unsigned room;
    /* The architectural first element already checked segment access and
     * serviced faults. Batch only flat protected-mode32 segments; page bounds
     * and the TLB probe below still reject MMIO, code/dirty traps/watchpoints. */
    if (flat32 && (env->segs[R_ES].base != 0 ||
                   env->segs[R_ES].limit != UINT32_MAX ||
                   (copy && (env->segs[R_DS].base != 0 ||
                             env->segs[R_DS].limit != UINT32_MAX)))) {
        return;
    }
    if (real) {
        uint16_t di = dst, si = src;
        /* Restrict batching to conventional real-mode segments. The TLB
         * supplies the actual A20-aware RAM mapping. Stop at segment wrap. */
        if (env->segs[R_ES].base != (uint32_t)env->segs[R_ES].selector << 4 ||
            env->segs[R_ES].limit != 0xffff ||
            (copy && (env->segs[R_DS].base != (uint32_t)env->segs[R_DS].selector << 4 ||
                      env->segs[R_DS].limit != 0xffff))) {
            return;
        }
        dst = env->segs[R_ES].base + di;
        src = env->segs[R_DS].base + si;
        room = MIN(0x10000u - di, TARGET_PAGE_SIZE - (dst & ~TARGET_PAGE_MASK));
        if (copy) {
            room = MIN(room, 0x10000u - si);
        }
    } else {
        room = TARGET_PAGE_SIZE - (dst & ~TARGET_PAGE_MASK);
    }
    void *from = NULL, *to;

    if (env->df != 1 || ((dst | (copy ? src : 0)) & (width - 1))) {
        return;
    }
    if (copy) {
        unsigned available = TARGET_PAGE_SIZE - (src & ~TARGET_PAGE_MASK);
        room = MIN(room, available);
    }
    count = MIN(count, room >> shift);
    if (count < 8) {
        return;
    }
    if (copy) {
        from = tlb_vaddr_to_host(env, src, MMU_DATA_LOAD, mmu);
        if (!from) {
            return;
        }
    }
    to = tlb_vaddr_to_host(env, dst, MMU_DATA_STORE, mmu);
    if (!to) {
        return;
    }
#define REP_WIDTH(T) do {                                                \
        T *out = to;                                                     \
        if (copy) {                                                      \
            const T *in = from;                                          \
            for (unsigned i = 0; i < count; i++) {                       \
                T v = qatomic_read(&in[i]);                              \
                qatomic_set(&out[i], v);                                 \
            }                                                            \
        } else {                                                         \
            T v = env->regs[R_EAX];                                      \
            for (unsigned i = 0; i < count; i++) {                       \
                qatomic_set(&out[i], v);                                 \
            }                                                            \
        }                                                                \
    } while (0)
    switch (shift) {
    case 0: REP_WIDTH(uint8_t); break;
    case 1: REP_WIDTH(uint16_t); break;
    case 2: REP_WIDTH(uint32_t); break;
    case 3: REP_WIDTH(uint64_t); break;
    }
#undef REP_WIDTH
    if (real) {
        env->regs[R_EDI] = deposit64(env->regs[R_EDI], 0, 16, env->regs[R_EDI] + (count << shift));
        if (copy) {
            env->regs[R_ESI] = deposit64(env->regs[R_ESI], 0, 16, env->regs[R_ESI] + (count << shift));
        }
        env->regs[R_ECX] = deposit64(env->regs[R_ECX], 0, 16, env->regs[R_ECX] - count);
#ifndef CONFIG_TCG_INTERPRETER
        wasm46_note_batch(count);
#endif
        return;
    }
    env->regs[R_EDI] += (uint64_t)count << shift;
    if (copy) {
        env->regs[R_ESI] += (uint64_t)count << shift;
    }
    env->regs[R_ECX] -= count;
    if (flat32) {
        /* Address-size32 updates zero-extend in the x86-64 CPU state. */
        env->regs[R_EDI] = (uint32_t)env->regs[R_EDI];
        if (copy) {
            env->regs[R_ESI] = (uint32_t)env->regs[R_ESI];
        }
        env->regs[R_ECX] = (uint32_t)env->regs[R_ECX];
#ifndef CONFIG_TCG_INTERPRETER
        wasm46_note_batch(count);
#endif
    }
}
#endif

void helper_boundw(CPUX86State *env, target_ulong a0, int v)
{
    int low, high;

    low = cpu_ldsw_le_data_ra(env, a0, GETPC());
    high = cpu_ldsw_le_data_ra(env, a0 + 2, GETPC());
    v = (int16_t)v;
    if (v < low || v > high) {
        if (env->hflags & HF_MPX_EN_MASK) {
            env->bndcs_regs.sts = 0;
        }
        raise_exception_ra(env, EXCP05_BOUND, GETPC());
    }
}

void helper_boundl(CPUX86State *env, target_ulong a0, int v)
{
    int low, high;

    low = cpu_ldl_le_data_ra(env, a0, GETPC());
    high = cpu_ldl_le_data_ra(env, a0 + 4, GETPC());
    if (v < low || v > high) {
        if (env->hflags & HF_MPX_EN_MASK) {
            env->bndcs_regs.sts = 0;
        }
        raise_exception_ra(env, EXCP05_BOUND, GETPC());
    }
}
