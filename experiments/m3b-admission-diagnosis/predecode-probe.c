/* Host-only probe of supplied historical bytes; never executes guest code. */
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include "../m3b-fallthrough/predecode.h"
int main(int argc, char **argv)
{
    unsigned char bytes[128];
    struct m3b_plan plan;
    char *end;
    if (argc != 3 || strlen(argv[1]) % 2 || strlen(argv[1]) > 256) return 2;
    size_t count = strlen(argv[1]) / 2;
    for (size_t i = 0; i < count; i++) {
        char hex[3] = {argv[1][2*i], argv[1][2*i+1], 0};
        errno = 0;
        unsigned long n = strtoul(hex, &end, 16);
        if (errno || *end || n > 255) return 2;
        bytes[i] = n;
    }
    errno = 0;
    unsigned long remaining = strtoul(argv[2], &end, 10);
    if (errno || *end || remaining > 4096 || !remaining) return 2;
    enum m3b_predecode_result result = m3b_predecode(bytes, count, remaining, 32, &plan);
    printf("{\"result\":%u,\"bytes\":%u,\"instructions\":%u,\"bOffset\":%u,\"jccIndex\":%u,\"sideOffset\":%u,\"backedgeOffset\":%u}\n",
           result, plan.bytes, plan.count, plan.b_offset, plan.jcc_index, plan.jcc_target_offset, plan.backedge_offset);
    return 0;
}
