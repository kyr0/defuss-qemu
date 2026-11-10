/*
 * softmmu size bounds
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef ACCEL_TCG_TLB_BOUNDS_H
#define ACCEL_TCG_TLB_BOUNDS_H

/* Wasm helper transitions make misses expensive at ordinary Linux working
 * set sizes. Keep at least the initial 256 entries on the browser host. */
#if defined(__EMSCRIPTEN__) && !defined(DEFUSS_STOCK_TLB)
#define CPU_TLB_DYN_MIN_BITS 8
#else
#define CPU_TLB_DYN_MIN_BITS 6
#endif
#define CPU_TLB_DYN_MAX_BITS (32 - TARGET_PAGE_BITS)
#define CPU_TLB_DYN_DEFAULT_BITS 8

#endif /* ACCEL_TCG_TLB_BOUNDS_H */
