/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Single-writer, stopped-reader diagnostic storage; deliberately no timers. */
#ifndef DEFUSS_M1_PROFILE_CORE_H
#define DEFUSS_M1_PROFILE_CORE_H
#include <stdint.h>
#include <string.h>
#include <limits.h>

#define M1_MAGIC UINT32_C(0x4d315046)
#define M1_VERSION 1u
#define M1_HEADER_WORDS 32u
#define M1_WAYS 4u
#define M1_PC_BUCKETS 256u
#define M1_EDGE_BUCKETS 512u
#define M1_KEY_WORDS 8u
#define M1_PC_STRIDE 12u
#define M1_EDGE_STRIDE 20u
#define M1_SYSCALLS 512u

enum m1_counter {
    M1_DISPATCH_ITERATIONS, M1_COMPILED_ENTRIES, M1_INTERPRETED_ENTRIES,
    M1_INTERPRETED_CHAINS, M1_OBSERVED_EDGES, M1_ROOT_ENTRIES,
    M1_DISPATCH_RETURNS, M1_RETIER_RETURNS, M1_ADMISSION_CALLS,
    M1_ADMISSION_READY, M1_ADMISSION_COLD, M1_ADMISSION_HELD,
    M1_STALE_INSTANCE_MISSES, M1_INSTANCE_INSTALLS, M1_INSTANCE_BUDGET_REJECTS,
    M1_PC_REPLACEMENTS, M1_EDGE_REPLACEMENTS, M1_COUNTER_SATURATIONS,
    M1_UNKNOWN_PC_ENTRIES, M1_UNSUPPORTED_CONTEXT_ENTRIES,
    M1_SYSCALL64_USER_ENTRY_ATTEMPTS, M1_SYSCALL_NUMBER_OVERFLOW,
    M1_SYSCALL_OTHER_MODE, M1_TCI_TO_DISPATCHER, M1_CONTEXT_TRANSITIONS,
    M1_TIER_TRANSITIONS, M1_PC_HASH_COLLISIONS, M1_EDGE_HASH_COLLISIONS,
    M1_PC_SAMPLES, M1_EDGE_SAMPLES,
    M1_COMPILED_UNKNOWN, M1_COMPILED_KERNEL, M1_COMPILED_USER,
    M1_COMPILED_OTHER_RING, M1_COMPILED_REAL, M1_COMPILED_VM86,
    M1_INTERPRETED_UNKNOWN, M1_INTERPRETED_KERNEL, M1_INTERPRETED_USER,
    M1_INTERPRETED_OTHER_RING, M1_INTERPRETED_REAL, M1_INTERPRETED_VM86,
    M1_COUNTER_COUNT
};
enum m1_privilege { M1_UNKNOWN, M1_KERNEL, M1_USER, M1_OTHER_RING, M1_REAL, M1_VM86 };
enum m1_tier { M1_INTERPRETED, M1_COMPILED };
#define M1_COUNTER_OFFSET M1_HEADER_WORDS
#define M1_PC_OFFSET (M1_COUNTER_OFFSET + M1_COUNTER_COUNT * 2u)
#define M1_EDGE_OFFSET (M1_PC_OFFSET + M1_PC_BUCKETS * M1_WAYS * M1_PC_STRIDE)
#define M1_SYSCALL_OFFSET (M1_EDGE_OFFSET + M1_EDGE_BUCKETS * M1_WAYS * M1_EDGE_STRIDE)
#define M1_TOTAL_WORDS (M1_SYSCALL_OFFSET + M1_SYSCALLS * 2u)

struct m1_key { uint32_t words[M1_KEY_WORDS]; };
struct m1_storage {
    uint32_t words[M1_TOTAL_WORDS];
    struct m1_key previous;
    uint32_t previous_valid;
    uint32_t sample_phase;
};

static uint64_t m1_get64(const uint32_t *p)
{ return (uint64_t)p[0] | ((uint64_t)p[1] << 32); }
static void m1_set64(uint32_t *p, uint64_t n)
{ p[0] = (uint32_t)n; p[1] = (uint32_t)(n >> 32); }
static void m1_inc(struct m1_storage *s, enum m1_counter index)
{
    uint32_t *p = s->words + M1_COUNTER_OFFSET + (unsigned)index * 2;
    uint64_t n = m1_get64(p);
    if (n != UINT64_MAX) {
        m1_set64(p, n + 1);
    } else {
        s->words[15] = 1; /* Sticky saturation; never silently wrap. */
        if (index != M1_COUNTER_SATURATIONS) { m1_inc(s, M1_COUNTER_SATURATIONS); }
    }
}
static void m1_increment_value(struct m1_storage *s, uint32_t *p)
{
    uint64_t n = m1_get64(p);
    if (n == UINT64_MAX) {
        s->words[15] = 1;
        m1_inc(s, M1_COUNTER_SATURATIONS);
    } else { m1_set64(p, n + 1); }
}
static int m1_reset(struct m1_storage *s, unsigned enabled, unsigned period)
{
    uint32_t epoch = s->words[3] + 1;
    if (period < 1 || period > 65536 || enabled > 1) { return -1; }
    memset(s, 0, sizeof(*s));
    s->words[0] = M1_MAGIC; s->words[1] = M1_VERSION;
    s->words[3] = epoch; s->words[4] = M1_TOTAL_WORDS;
    s->words[5] = M1_PC_BUCKETS * M1_WAYS; s->words[6] = M1_PC_STRIDE;
    s->words[7] = M1_EDGE_BUCKETS * M1_WAYS; s->words[8] = M1_EDGE_STRIDE;
    s->words[9] = M1_COUNTER_OFFSET; s->words[10] = M1_COUNTER_COUNT;
    s->words[11] = M1_PC_OFFSET; s->words[12] = M1_EDGE_OFFSET;
    s->words[13] = M1_SYSCALL_OFFSET; s->words[14] = M1_SYSCALLS;
    /* 15 saturation, 16 rejected nonzero-worker observations. */
    s->words[17] = period;
    s->words[18] = 1; /* Addressing revision: target-verified x86 PCREL entry PC. */
    s->words[2] = enabled; /* Published last; caller must stop all vCPUs. */
    return 0;
}
static unsigned m1_x86_privilege(uint32_t flags)
{
    /* These masks are checked against the QEMU constants in the adapter. */
    if (flags & (UINT32_C(1) << 19)) { return M1_UNKNOWN; } /* SMM */
    if (!(flags & (UINT32_C(1) << 7))) { return M1_REAL; }
    if (flags & (UINT32_C(1) << 17)) { return M1_VM86; }
    switch (flags & 3) {
    case 0: return M1_KERNEL;
    case 3: return M1_USER;
    default: return M1_OTHER_RING;
    }
}
struct m1_pc_result { uint64_t address; unsigned known; };
static struct m1_pc_result m1_x86_entry_pc(uint64_t translated_pc,
                                         uint64_t eip, uint64_t cs_base,
                                         uint32_t flags, unsigned pc_relative,
                                         unsigned aot, uint64_t page_offset_mask)
{
    struct m1_pc_result result = { translated_pc, !aot };
    if (aot) { return result; } /* Replay does not initialize header metadata. */
    if (pc_relative) {
        /* Exact x86_get_tb_cpu_state formula. In 64-bit code CS.base is
         * ignored; legacy linear addresses wrap to 32 bits, including real
         * and virtual-8086 mode. EIP is synchronized at each observed TB entry. */
        result.address = flags & (UINT32_C(1) << 15) ? eip :
                         (uint32_t)(eip + cs_base);
        /* Physical-page TB reuse preserves the virtual page offset. Reject
         * stale/invalid entry metadata instead of reporting a plausible PC. */
        result.known = !((result.address ^ translated_pc) & page_offset_mask);
    }
    return result;
}
static struct m1_key m1_key_make(uint64_t pc, uint64_t context,
                                uint32_t flags, uint32_t cflags,
                                unsigned tier, unsigned privilege)
{
    struct m1_key k;
    m1_set64(k.words, pc); m1_set64(k.words + 2, context);
    k.words[4] = flags; k.words[5] = cflags;
    k.words[6] = tier; k.words[7] = privilege;
    return k;
}
static uint32_t m1_hash(const uint32_t *key, unsigned n)
{
    uint32_t h = UINT32_C(2166136261);
    for (unsigned i = 0; i < n; i++) {
        h ^= key[i]; h *= UINT32_C(16777619);
        h ^= h >> 16;
    }
    return h;
}
/* Four-way bucket-local Space-Saving. count-error <= true sampled frequency
 * <= count for represented keys; evicted keys are absent, never precise zero.
 * This is a bounded approximate address census, not a global top-k guarantee. */
static void m1_table_hit(struct m1_storage *s, const uint32_t *key,
                         unsigned key_words, unsigned offset, unsigned buckets,
                         unsigned stride, enum m1_counter replacements,
                         enum m1_counter collisions)
{
    unsigned bucket = m1_hash(key, key_words) % buckets;
    uint32_t *base = s->words + offset + bucket * M1_WAYS * stride;
    uint32_t *victim = base;
    uint64_t minimum = UINT64_MAX;
    for (unsigned i = 0; i < M1_WAYS; i++) {
        uint32_t *slot = base + i * stride;
        uint64_t count = m1_get64(slot + key_words);
        if (count && !memcmp(slot, key, key_words * sizeof(uint32_t))) {
            m1_increment_value(s, slot + key_words);
            return;
        }
        if (count < minimum) { minimum = count; victim = slot; }
    }
    if (minimum) { m1_inc(s, replacements); }
    if (m1_get64(base + key_words)) { m1_inc(s, collisions); }
    memcpy(victim, key, key_words * sizeof(uint32_t));
    m1_set64(victim + key_words, minimum);
    m1_set64(victim + key_words + 2, minimum);
    m1_increment_value(s, victim + key_words);
}
static void m1_chain_start(struct m1_storage *s)
{ s->previous_valid = 0; m1_inc(s, M1_ROOT_ENTRIES); }
static void m1_entry(struct m1_storage *s, struct m1_key key,
                     unsigned pc_known, unsigned context_known)
{
    uint32_t edge[M1_KEY_WORDS * 2];
    unsigned tier = key.words[6], privilege = key.words[7];
    unsigned sampled = ++s->sample_phase >= s->words[17];
    if (sampled) { s->sample_phase = 0; }
    m1_inc(s, tier == M1_COMPILED ? M1_COMPILED_ENTRIES : M1_INTERPRETED_ENTRIES);
    m1_inc(s, (enum m1_counter)((tier == M1_COMPILED ? M1_COMPILED_UNKNOWN :
                               M1_INTERPRETED_UNKNOWN) + privilege));
    if (!context_known) { m1_inc(s, M1_UNSUPPORTED_CONTEXT_ENTRIES); }
    if (!pc_known) {
        m1_inc(s, M1_UNKNOWN_PC_ENTRIES);
        s->previous_valid = 0;
        return;
    }
    if (sampled) {
        m1_inc(s, M1_PC_SAMPLES);
        m1_table_hit(s, key.words, M1_KEY_WORDS, M1_PC_OFFSET, M1_PC_BUCKETS,
                     M1_PC_STRIDE, M1_PC_REPLACEMENTS, M1_PC_HASH_COLLISIONS);
    }
    if (s->previous_valid) {
        m1_inc(s, M1_OBSERVED_EDGES);
        if (memcmp(s->previous.words + 2, key.words + 2, 4 * sizeof(uint32_t))) {
            m1_inc(s, M1_CONTEXT_TRANSITIONS);
        }
        if (s->previous.words[6] != key.words[6]) { m1_inc(s, M1_TIER_TRANSITIONS); }
        if (sampled) {
            memcpy(edge, s->previous.words, sizeof(s->previous.words));
            memcpy(edge + M1_KEY_WORDS, key.words, sizeof(key.words));
            m1_inc(s, M1_EDGE_SAMPLES);
            m1_table_hit(s, edge, M1_KEY_WORDS * 2, M1_EDGE_OFFSET, M1_EDGE_BUCKETS,
                         M1_EDGE_STRIDE, M1_EDGE_REPLACEMENTS, M1_EDGE_HASH_COLLISIONS);
        }
    }
    s->previous = key;
    s->previous_valid = 1;
}
static void m1_syscall(struct m1_storage *s, uint64_t number, unsigned valid64user)
{
    if (!valid64user) { m1_inc(s, M1_SYSCALL_OTHER_MODE); return; }
    m1_inc(s, M1_SYSCALL64_USER_ENTRY_ATTEMPTS);
    if (number >= M1_SYSCALLS) { m1_inc(s, M1_SYSCALL_NUMBER_OVERFLOW); return; }
    m1_increment_value(s, s->words + M1_SYSCALL_OFFSET + (unsigned)number * 2);
}
#endif
