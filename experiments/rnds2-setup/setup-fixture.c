/* Separate coherence fixture, never the timed Bun app.
 * gcc -O2 -static -mavx2 -mno-red-zone -fno-tree-vectorize
 *     -fno-tree-slp-vectorize setup-fixture.c -o setup-fixture
 * Five modes x 4096 iterations. Run hot1500 and interpreter-only hot65535.
 * Pair with the unchanged replay PSHUFB fixture for all alias/memory modes.
 */
#include <stdint.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

enum { MODES = 5, ITERATIONS = 4096 };
typedef struct { uint64_t gpr[4], flags; uint32_t mask; } Scalar;

#define ASM_CASE(K, INSN) case K: \
    __asm__ volatile( \
        "vmovdqu (%[a]), %%ymm0\n\t" \
        "vmovdqu (%[b]), %%ymm1\n\t" \
        "movq %[seed], %%r8\n\t" \
        "movabsq $0xa59c34e7012bd68f, %%r9\n\t" \
        "movabsq $0x35b6e91d7c2840af, %%r10\n\t" \
        "movabsq $0xfedcba9876543210, %%r11\n\t" \
        "movl $0, %%eax\n\t" \
        /* Dirty GPR and lazy flag state immediately before selected helper. */ \
        "addq $1, %%r8\n\t" \
        INSN "\n\t" \
        /* No intervening flag writer: both scalar and lazy flag globals must \
         * survive the intrinsic's read/write of private vector storage. */ \
        "movq %%r8, 0(%[scalar])\n\t" \
        "movq %%r9, 8(%[scalar])\n\t" \
        "movq %%r10, 16(%[scalar])\n\t" \
        "movq %%r11, 24(%[scalar])\n\t" \
        "pushfq\n\tpopq %%r10\n\t" \
        "movq %%r10, 32(%[scalar])\n\t" \
        "movl %%eax, 40(%[scalar])\n\t" \
        "vmovdqu %%ymm0, (%[out])\n\t" \
        "vzeroupper" \
        : : [a]"r"(a), [b]"r"(b), [out]"r"(out), \
            [scalar]"r"(scalar), [seed]"r"(seed) \
        : "rax", "r8", "r9", "r10", "r11", "ymm0", "ymm1", "cc", "memory"); \
    break

__attribute__((noinline, noclone))
static void execute(unsigned kind, const uint8_t a[32], const uint8_t b[32],
                    uint8_t out[32], uint64_t seed, Scalar *scalar)
{
    switch (kind) {
    ASM_CASE(0, "pshufb %%xmm1, %%xmm0");
    ASM_CASE(1, "vpshufb %%ymm1, %%ymm0, %%ymm0");
    ASM_CASE(2, "pminub %%xmm1, %%xmm0");
    ASM_CASE(3, "pcmpeqb %%xmm1, %%xmm0");
    ASM_CASE(4, "pmovmskb %%xmm0, %%eax");
    default: abort();
    }
}
#undef ASM_CASE

static uint64_t random_state = UINT64_C(0xc64d387b9a21ef50);
static uint64_t next_random(void)
{
    random_state ^= random_state << 13;
    random_state ^= random_state >> 7;
    random_state ^= random_state << 17;
    return random_state;
}

static unsigned increment_flags(uint64_t seed)
{
    uint64_t result = seed + 1;
    unsigned parity = 0;
    for (unsigned bit = 0; bit < 8; bit++) { parity ^= (result >> bit) & 1; }
    return (seed == UINT64_MAX ? 1 : 0) | (!parity ? 4 : 0) |
           ((seed & 15) == 15 ? 16 : 0) | (result == 0 ? 64 : 0) |
           (result >> 63 ? 128 : 0) |
           (seed == UINT64_C(0x7fffffffffffffff) ? 2048 : 0);
}

static int bytes_differ(const volatile uint8_t *actual,
                        const volatile uint8_t *expected, unsigned count)
{
    /* Volatile byte reads prevent the oracle from becoming memcmp/SIMD and
     * manufacturing PCMPEQB/PMOVMSKB compiled-coverage counters. */
    for (unsigned i = 0; i < count; i++) {
        if (actual[i] != expected[i]) { return 1; }
    }
    return 0;
}

static int open_gate(void)
{
    int fd = open("/dev/ttyS0", O_RDWR | O_NOCTTY | O_CLOEXEC);
    struct termios attributes;
    if (fd < 0 || tcgetattr(fd, &attributes) < 0) {
        perror("FIXTURE_FAIL:gate-open"); exit(2);
    }
    cfmakeraw(&attributes);
    cfsetispeed(&attributes, B115200); cfsetospeed(&attributes, B115200);
    attributes.c_cflag |= CLOCAL | CREAD;
#ifdef CRTSCTS
    attributes.c_cflag &= ~CRTSCTS;
#endif
    attributes.c_cc[VMIN] = 1; attributes.c_cc[VTIME] = 0;
    if (tcsetattr(fd, TCSANOW, &attributes) < 0) {
        perror("FIXTURE_FAIL:gate-termios"); exit(2);
    }
    return fd;
}

static void checkpoint_gate(int fd, int mode)
{
    if (fd < 0) { return; }
    printf("SETUP_GATE:%d\n", mode); fflush(stdout);
    unsigned char byte = 'G';
    ssize_t count;
    do { count = write(fd, &byte, 1); } while (count < 0 && errno == EINTR);
    if (count != 1) { perror("FIXTURE_FAIL:gate-write"); exit(2); }
    int result;
    do { result = tcdrain(fd); } while (result < 0 && errno == EINTR);
    if (result < 0) { perror("FIXTURE_FAIL:gate-drain"); exit(2); }
    do { count = read(fd, &byte, 1); } while (count < 0 && errno == EINTR);
    if (count != 1 || byte != 'K') {
        fprintf(stderr, "FIXTURE_FAIL:gate-ack count=%ld byte=%u\n", (long)count, byte);
        exit(2);
    }
}

int main(int argc, char **argv)
{
    unsigned first = 0, end = MODES, checks = 0;
    int gated = 0, selected = 0;
    for (int argument = 1; argument < argc; argument++) {
        if (!strcmp(argv[argument], "--gate") && !gated) { gated = 1; continue; }
        char *tail;
        unsigned long value = strtoul(argv[argument], &tail, 10);
        if (selected || !argv[argument][0] || *tail || value >= MODES) { return 2; }
        selected = 1;
        first = value; end = first + 1;
    }
    int gate_fd = gated ? open_gate() : -1;
    static const uint64_t seeds[] = { 0, UINT64_MAX, UINT64_C(0x7fffffffffffffff),
        UINT64_C(0x8000000000000000), 14, 15, 126, 127, 254, 255 };
    puts("SETUP_FIXTURE_START"); fflush(stdout);
    checkpoint_gate(gate_fd, -1);
    for (unsigned kind = first; kind < end; kind++) {
        printf("SETUP_MODE_START:%u\n", kind); fflush(stdout);
        for (unsigned iteration = 0; iteration < ITERATIONS; iteration++) {
            uint8_t a[32], b[32], out[32], expected[32];
            Scalar scalar = { 0 };
            for (unsigned i = 0; i < 32; i++) {
                a[i] = next_random();
                b[i] = iteration % 3 ? next_random() : a[i];
            }
            b[0] = iteration & 255;
            uint64_t seed = seeds[iteration % (sizeof(seeds) / sizeof(seeds[0]))];
            memcpy(expected, a, sizeof(expected));
            unsigned mask = 0;
            if (kind <= 1) {
                for (unsigned i = 0; i < (kind ? 32 : 16); i++) {
                    expected[i] = b[i] & 128 ? 0 : a[(i & ~15u) | (b[i] & 15)];
                }
            } else if (kind <= 3) {
                for (unsigned i = 0; i < 16; i++) {
                    expected[i] = kind == 2 ? (a[i] < b[i] ? a[i] : b[i]) :
                                  (a[i] == b[i] ? 255 : 0);
                }
            } else {
                for (unsigned i = 0; i < 16; i++) { mask |= (a[i] >> 7) << i; }
            }
            execute(kind, a, b, out, seed, &scalar);
            if (bytes_differ(out, expected, sizeof(out)) || scalar.mask != mask ||
                scalar.gpr[0] != seed + 1 ||
                scalar.gpr[1] != UINT64_C(0xa59c34e7012bd68f) ||
                scalar.gpr[2] != UINT64_C(0x35b6e91d7c2840af) ||
                scalar.gpr[3] != UINT64_C(0xfedcba9876543210) ||
                (scalar.flags & 0x8d5) != increment_flags(seed)) {
                printf("FIXTURE_FAIL:setup mode=%u iteration=%u flags=%llx expected=%x\n",
                       kind, iteration, (unsigned long long)scalar.flags,
                       increment_flags(seed));
                return 1;
            }
            checks++;
        }
        printf("SETUP_MODE_PASS:%u\n", kind); fflush(stdout);
        checkpoint_gate(gate_fd, kind);
    }
    printf("SETUP_FIXTURE_PASS checks=%u\n", checks); fflush(stdout);
    puts("FIXTURE_PASS"); fflush(stdout);
    return 0;
}
