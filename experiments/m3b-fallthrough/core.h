/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef DEFUSS_M3B_CORE_H
#define DEFUSS_M3B_CORE_H
#include <stdint.h>

#define M3B_ABI 1u
#define M3B_MAGIC 0x4d334231u
#define M3B_WORDS 128u
#define M3B_WATCH_OFFSET 32u
#define M3B_WATCH_STRIDE 20u
#define M3B_WATCHES 4u
/* Diagnostic source variant, never a timing artifact. */
enum m3b_counter {
    M3B_TRIALS = 16, M3B_FORMED, M3B_RETRIES, M3B_ENTRY_REJECTS,
    M3B_COMPILED_ENTRIES, M3B_TCI_ENTRIES, M3B_B_ATTEMPTS,
    M3B_B_REQUESTED, M3B_SERVICE_PAID, M3B_DEBT_ERRORS,
    M3B_TCI_TARGET_RETURNS, M3B_BACKEDGE_TCI_RETURNS,
    M3B_IR_REJECTS, M3B_PUBLISHED,
};
struct m3b_header {
    uint32_t magic;
    uint16_t bytes, b_offset;
    uint8_t fused, budget;
    uint16_t reserved;
};
#endif
