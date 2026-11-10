/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "m1-profile-core.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

static struct { uint64_t before; struct m1_storage profile; uint64_t after; } guarded;
static struct m1_storage *s = &guarded.profile;
static uint64_t counter(enum m1_counter i)
{ return m1_get64(s->words + M1_COUNTER_OFFSET + 2 * i); }
static void reset(unsigned period)
{
    guarded.before = UINT64_C(0x0123456789abcdef);
    guarded.after = UINT64_C(0xfedcba9876543210);
    assert(m1_reset(s, 1, period) == 0);
}
static void guards(void)
{
    assert(guarded.before == UINT64_C(0x0123456789abcdef));
    assert(guarded.after == UINT64_C(0xfedcba9876543210));
}
static struct m1_key key(uint64_t pc, unsigned tier)
{ return m1_key_make(pc, UINT64_C(0x12345000), 0x80 | 3, 0, tier, M1_USER); }

int main(int argc, char **argv)
{
    reset(1);
    assert(m1_x86_privilege(0) == M1_REAL);
    assert(m1_x86_privilege(0x80) == M1_KERNEL);
    assert(m1_x86_privilege(0x83) == M1_USER);
    assert(m1_x86_privilege(0x81) == M1_OTHER_RING);
    assert(m1_x86_privilege(0x20083) == M1_VM86);
    assert(m1_x86_privilege(0x80083) == M1_UNKNOWN);
    assert(s->words[18] == 1);
    /* One physically shared PCREL TB can execute at different virtual aliases.
     * Translation PC gives only a page-offset check, never the virtual page. */
    struct m1_pc_result pc;
    pc = m1_x86_entry_pc(0x10000123, UINT64_C(0xffff800040000123),
                         0x12340000, 0x8083, 1, 0, 0xfff);
    assert(pc.known && pc.address == UINT64_C(0xffff800040000123));
    pc = m1_x86_entry_pc(0x10000123, 0x30000123, 0, 0x8083, 1, 0, 0xfff);
    assert(pc.known && pc.address == 0x30000123);
    pc = m1_x86_entry_pc(0x123, 0xfffffff0, 0x133, 0x83, 1, 0, 0xfff);
    assert(pc.known && pc.address == 0x123); /* Legacy linear-address wrap. */
    pc = m1_x86_entry_pc(0x37567, 0x4567, 0x23000, 0x20083, 1, 0, 0xfff);
    assert(pc.known && pc.address == 0x27567); /* VM86 segmentation. */
    pc = m1_x86_entry_pc(0xfffffff0, 0xfff0, 0xffff0000, 0, 1, 0, 0xfff);
    assert(pc.known && pc.address == 0xfffffff0); /* Real-mode reset vector. */
    pc = m1_x86_entry_pc(0x10000123, 0x30000456, 0, 0x8083, 1, 0, 0xfff);
    assert(!pc.known); /* Stale entry EIP fails the independent page-offset check. */
    pc = m1_x86_entry_pc(0x10000123, 0x30000456, 0, 0x8083, 0, 0, 0xfff);
    assert(pc.known && pc.address == 0x10000123); /* Non-PCREL keeps metadata PC. */
    pc = m1_x86_entry_pc(0, 0x30000456, 0, 0, 0, 1, 0xfff);
    assert(!pc.known); /* AOT's zeroed metadata is never a valid PC0 record. */
    assert(m1_reset(s, 1, 0) == -1);
    assert(m1_reset(s, 1, 65537) == -1);
    assert(m1_reset(s, 2, 64) == -1);
    m1_chain_start(s);
    for (unsigned i = 0; i < 1000; i++) m1_entry(s, key(i % 3, i % 2), 1, 1);
    assert(counter(M1_COMPILED_ENTRIES) == 500);
    assert(counter(M1_INTERPRETED_ENTRIES) == 500);
    assert(counter(M1_OBSERVED_EDGES) == 999);
    assert(counter(M1_TIER_TRANSITIONS) == 999);
    assert(counter(M1_PC_SAMPLES) == 1000);
    assert(counter(M1_EDGE_SAMPLES) == 999);
    m1_entry(s, key(55, 0), 0, 0); /* Unknown PC breaks the edge. */
    m1_entry(s, key(56, 0), 1, 1);
    assert(counter(M1_OBSERVED_EDGES) == 999);
    assert(counter(M1_UNKNOWN_PC_ENTRIES) == 1);
    assert(counter(M1_UNSUPPORTED_CONTEXT_ENTRIES) == 1);
    m1_chain_start(s);
    m1_entry(s, key(57, 0), 1, 1);
    assert(counter(M1_OBSERVED_EDGES) == 999);
    guards();

    reset(1);
    m1_chain_start(s);
    const uint64_t virtual_entries[] = {0x30000123, 0x30000234, 0x70000123};
    const uint64_t translated_entries[] = {0x10000123, 0x10000234, 0x10000123};
    for (unsigned i = 0; i < 3; i++) {
        pc = m1_x86_entry_pc(translated_entries[i], virtual_entries[i], 0,
                             0x8083, 1, 0, 0xfff);
        m1_entry(s, key(pc.address, i % 2), pc.known, 1);
    }
    assert(counter(M1_OBSERVED_EDGES) == 2);
    assert(counter(M1_PC_SAMPLES) == 3);
    pc = m1_x86_entry_pc(0x10000123, 0x70000456, 0, 0x8083, 1, 0, 0xfff);
    m1_entry(s, key(pc.address, 1), pc.known, 1);
    m1_entry(s, key(0x70000123, 1), 1, 1);
    assert(counter(M1_UNKNOWN_PC_ENTRIES) == 1 && counter(M1_OBSERVED_EDGES) == 2);
    guards();

    /* Force >4 distinct keys into one bucket and check every represented
     * estimate against a full exact oracle, including later readmission. */
    reset(1);
    struct m1_key collision[7];
    uint64_t counts[7] = {0};
    unsigned found = 0;
    for (uint64_t pc = 1; found < 7; pc++) {
        struct m1_key k = key(pc, 1);
        if (m1_hash(k.words, M1_KEY_WORDS) % M1_PC_BUCKETS == 0) collision[found++] = k;
    }
    for (unsigned i = 0; i < 10000; i++) {
        unsigned which = i % 4 ? 0 : (i / 4) % 7;
        counts[which]++;
        m1_entry(s, collision[which], 1, 1);
        for (unsigned slot = 0; slot < M1_WAYS; slot++) {
            uint32_t *p = s->words + M1_PC_OFFSET + slot * M1_PC_STRIDE;
            uint64_t estimate = m1_get64(p + M1_KEY_WORDS);
            if (!estimate) continue;
            uint64_t error = m1_get64(p + M1_KEY_WORDS + 2);
            unsigned k;
            for (k = 0; k < 7 && memcmp(p, collision[k].words, sizeof(collision[k].words)); k++) {}
            assert(k < 7);
            assert(error <= estimate);
            assert(estimate - error <= counts[k] && counts[k] <= estimate);
        }
    }
    assert(counter(M1_PC_REPLACEMENTS) > 0);
    guards();

    reset(64);
    m1_chain_start(s);
    for (unsigned i = 0; i < 256; i++) m1_entry(s, key(i % 2, i % 2), 1, 1);
    assert(counter(M1_PC_SAMPLES) == 4 && counter(M1_EDGE_SAMPLES) == 4);
    assert(counter(M1_OBSERVED_EDGES) == 255);
    uint32_t epoch = s->words[3];
    assert(m1_reset(s, 0, 64) == 0);
    assert(s->words[3] == epoch + 1 && s->words[2] == 0);
    assert(s->previous_valid == 0 && counter(M1_OBSERVED_EDGES) == 0);
    guards();

    reset(1);
    m1_set64(s->words + M1_COUNTER_OFFSET + 2 * M1_DISPATCH_ITERATIONS, UINT64_MAX);
    m1_inc(s, M1_DISPATCH_ITERATIONS);
    assert(counter(M1_DISPATCH_ITERATIONS) == UINT64_MAX);
    assert(counter(M1_COUNTER_SATURATIONS) == 1 && s->words[15] == 1);
    reset(1);
    m1_syscall(s, 0, 1); m1_syscall(s, 511, 1);
    m1_syscall(s, 512, 1); m1_syscall(s, UINT64_MAX, 1); m1_syscall(s, 4, 0);
    assert(counter(M1_SYSCALL64_USER_ENTRY_ATTEMPTS) == 4);
    assert(counter(M1_SYSCALL_NUMBER_OVERFLOW) == 2);
    assert(counter(M1_SYSCALL_OTHER_MODE) == 1);
    assert(m1_get64(s->words + M1_SYSCALL_OFFSET) == 1);
    assert(m1_get64(s->words + M1_SYSCALL_OFFSET + 1022) == 1);
    guards();

    /* Portable little-endian reader fixture, including >2^53 exact counters. */
    m1_entry(s, key(UINT64_C(0xffff800012345678), 1), 1, 1);
    m1_entry(s, key(UINT64_C(0xffff800012345680), 0), 1, 1);
    m1_set64(s->words + M1_COUNTER_OFFSET + 2 * M1_DISPATCH_ITERATIONS, UINT64_MAX - 3);
    if (argc == 2) {
        FILE *f = fopen(argv[1], "wb"); assert(f);
        for (unsigned i = 0; i < M1_TOTAL_WORDS; i++) {
            uint32_t n = s->words[i];
            unsigned char bytes[4] = {n, n >> 8, n >> 16, n >> 24};
            assert(fwrite(bytes, 1, 4, f) == 4);
        }
        assert(fclose(f) == 0);
    }
    puts("PASS: bounds, reset, privilege, PCREL aliases/64-bit/segmentation/wrap/stale/AOT, collision bounds, sampling, edges, saturation, syscalls");
    return 0;
}
