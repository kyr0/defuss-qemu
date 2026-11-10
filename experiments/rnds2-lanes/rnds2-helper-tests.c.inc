EMSCRIPTEN_KEEPALIVE int defuss_inline_rnds2_helper_selftest(void);
EMSCRIPTEN_KEEPALIVE int defuss_inline_rnds2_helper_selftest(void)
{
    static const unsigned aliases[5][3] = {
        {0, 1, 2}, {0, 0, 1}, {0, 1, 0}, {0, 1, 1}, {0, 0, 0}
    };
    static const uint32_t edges[8] = {
        0, UINT32_MAX, 1, 0x80000000, 0x7fffffff, 0xaaaaaaaa, 0x55555555, 0xffff0000
    };
    uint64_t rng = UINT64_C(0x4698af135a067ce2);
    for (unsigned alias = 0; alias < 5; alias++) {
        for (unsigned repeat = 0; repeat < 4096; repeat++) {
            ZMMReg actual[3], expected[3];
            for (unsigned reg = 0; reg < 3; reg++) {
                for (unsigned word = 0; word < 16; word++) {
                    rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
                    actual[reg].ZMM_L(word) = repeat % 32 < 8 ?
                        edges[(repeat + reg + word) % 8] : (uint32_t)rng;
                }
            }
            memcpy(expected, actual, sizeof(actual));
            unsigned d = aliases[alias][0], a = aliases[alias][1], b = aliases[alias][2];
            uint32_t wk0 = actual[repeat % 3].ZMM_L(0);
            uint32_t wk1 = actual[repeat % 3].ZMM_L(1);
            uint32_t av[4], bv[4], result[4];
            for (unsigned i = 0; i < 4; i++) {
                av[i] = actual[a].ZMM_L(i); bv[i] = actual[b].ZMM_L(i);
            }
            rnds2_oracle(result, av, bv, wk0, wk1);
            for (unsigned i = 0; i < 4; i++) expected[d].ZMM_L(i) = result[i];
            helper_sha256rnds2(&actual[d], &actual[a], &actual[b], wk0, wk1);
            if (memcmp(actual, expected, sizeof(actual))) return 100 + alias;
        }
    }
    return 0; /* 5 alias partitions * 4096 = 20,480 native helper calls. */
}
