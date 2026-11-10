/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef DEFUSS_M3CC_CORE_H
#define DEFUSS_M3CC_CORE_H
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <limits.h>
#define M3CC_MAGIC UINT32_C(0x4d334343)
#define M3CC_ABI 1u
#define M3CC_WATCHES 4u
#define M3CC_OFFSET 32u
#define M3CC_TUPLE 112u
#define M3CC_STRIDE 592u
#define M3CC_WORDS (M3CC_OFFSET + M3CC_WATCHES * M3CC_STRIDE)
#define M3CC_ENABLED 1u
#define M3CC_CHOSEN 2u
#define M3CC_LOCKED 4u
#define M3CC_WRITING 8u
enum m3cc_kind { M3CC_FUSED_NORMAL, M3CC_ORDINARY_RF,
                 M3CC_ORDINARY_NORMAL, M3CC_OTHER };
enum m3cc_site { M3CC_COMPILED, M3CC_OUTER_TCI,
                 M3CC_GOTO_TB_TCI, M3CC_GOTO_PTR_TCI };
enum m3cc_fault {
    M3CC_METADATA = 1, M3CC_PC = 2, M3CC_FLAGS = 4,
    M3CC_CONTEXT = 8, M3CC_CONTINUITY = 16,
    M3CC_UNEXPECTED = 32, M3CC_WORKER = 64, M3CC_OVERFLOW = 128,
};
static inline uint64_t m3cc_pair(const uint32_t *p)
{ return p[0] | (uint64_t)p[1] << 32; }
static inline void m3cc_put(uint32_t *p, uint64_t v)
{ p[0] = v; p[1] = v >> 32; }
static inline void m3cc_fault(uint32_t *bank, uint32_t *w, unsigned bits)
{ __atomic_fetch_or(bank + 3, bits, __ATOMIC_RELAXED); if (w) { w[5] |= bits; } }
static inline void m3cc_inc(uint32_t *bank, uint32_t *w, uint32_t *value)
{
    if (*value == UINT32_MAX) {
        __atomic_store_n(bank + 4, 1, __ATOMIC_RELAXED); m3cc_fault(bank, w, M3CC_OVERFLOW);
    } else { ++*value; }
}
/* Fields0..7 are owner-specific. RF and fused classification are normalized
 * only for cross-kind context comparison, never for retained raw tuples. */
static inline bool m3cc_same_context(const uint32_t *a, const uint32_t *b)
{
    for (unsigned i = 8; i < M3CC_TUPLE; i++) {
        if (i == 16) { continue; }
        uint32_t x = a[i], y = b[i];
        if (i == 14 || i == 17 || i == 19) {
            x &= ~UINT32_C(0x10000); y &= ~UINT32_C(0x10000);
        }
        if (x != y) { return false; }
    }
    return true;
}
/* This is the actual adapter's bounded accounting, shared by host fixtures.
 * The caller has validated metadata and produced a value-only tuple. */
static inline void m3cc_record(uint32_t *bank, unsigned slot,
                              unsigned kind, unsigned site, bool rf,
                              unsigned faults, const uint32_t *tuple)
{
    if (slot >= M3CC_WATCHES) { m3cc_fault(bank, NULL, M3CC_METADATA); return; }
    uint32_t *w = bank + M3CC_OFFSET + slot * M3CC_STRIDE;
    unsigned tier = site == M3CC_COMPILED ? 0 : 1;
    if (kind > M3CC_OTHER || site > M3CC_GOTO_PTR_TCI) {
        m3cc_fault(bank, w, M3CC_METADATA); return;
    }
    m3cc_inc(bank, w, bank + 12); m3cc_inc(bank, w, w + 6);
    if (rf) { m3cc_inc(bank, w, w + 7); }
    m3cc_inc(bank, w, w + 8 + kind * 2 + tier);
    m3cc_inc(bank, w, w + 20 + site);
    w[18] = kind; w[19] = tier;
    if (kind == M3CC_OTHER || (w[3] && kind == M3CC_ORDINARY_NORMAL)) {
        faults |= M3CC_UNEXPECTED;
    }
    if (tuple) {
        uint32_t *first = w + 32 + kind * M3CC_TUPLE;
        if (w[16] & (1u << kind)) {
            if (memcmp(first, tuple, M3CC_TUPLE * sizeof(*tuple))) {
                faults |= M3CC_CONTINUITY;
            }
        } else {
            memcpy(first, tuple, M3CC_TUPLE * sizeof(*tuple));
            w[16] |= 1u << kind;
        }
        for (unsigned k = 0; k < 3; k++) {
            if ((w[16] & (1u << k)) &&
                !m3cc_same_context(w + 32 + k * M3CC_TUPLE, tuple)) {
                faults |= M3CC_CONTEXT;
            }
        }
    }
    if (faults && !w[5]) {
        w[24] = kind; w[25] = site; w[27] = tuple != NULL;
        if (tuple) { memcpy(w + 480, tuple, M3CC_TUPLE * sizeof(*tuple)); }
    }
    m3cc_fault(bank, w, faults);
}
#endif
