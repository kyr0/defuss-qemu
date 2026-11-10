/* Independent scalar SHA state update: eight explicit state words, two rounds.
 * No QEMU macros, packed-local layout, SHA intrinsics, or partial output stores. */
static uint32_t rnds2_oracle_rotate(uint32_t x, unsigned n)
{
    return (x >> n) | (x << (32 - n));
}
static void rnds2_oracle(uint32_t out[4], const uint32_t a[4],
                         const uint32_t b[4], uint32_t wk0, uint32_t wk1)
{
    uint32_t state[8] = {b[3], b[2], a[3], a[2], b[1], b[0], a[1], a[0]};
    uint32_t words[2] = {wk0, wk1};
    for (unsigned round = 0; round < 2; round++) {
        uint32_t x = state[0], y = state[4];
        uint32_t sum0 = rnds2_oracle_rotate(x, 2) ^ rnds2_oracle_rotate(x, 13) ^ rnds2_oracle_rotate(x, 22);
        uint32_t sum1 = rnds2_oracle_rotate(y, 6) ^ rnds2_oracle_rotate(y, 11) ^ rnds2_oracle_rotate(y, 25);
        uint32_t choose = (y & state[5]) | (~y & state[6]);
        uint32_t majority = (x & state[1]) | ((x | state[1]) & state[2]);
        uint32_t t1 = state[7] + sum1 + choose + words[round];
        uint32_t next_a = t1 + sum0 + majority;
        uint32_t next_e = state[3] + t1;
        for (unsigned i = 7; i > 0; i--) state[i] = state[i - 1];
        state[0] = next_a;
        state[4] = next_e;
    }
    out[0] = state[5]; out[1] = state[4];
    out[2] = state[1]; out[3] = state[0];
}
