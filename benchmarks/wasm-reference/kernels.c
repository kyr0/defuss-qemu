/* Standalone computational references, not a guest ABI or replacement engine. */
#include <stdint.h>
#include <stddef.h>

#define ARENA_BYTES (8u * 1024u * 1024u)
#define MAX_SHA_BYTES UINT64_C(0x1fffffffffffffff)
static uint8_t arena[ARENA_BYTES] __attribute__((aligned(64)));

uint32_t ref_abi_version(void) { return 1; }
uintptr_t ref_memory_base(void) { return (uintptr_t)arena; }
uint32_t ref_memory_capacity(void) { return ARENA_BYTES; }
uint32_t ref_integer(uint32_t seed, uint32_t iterations, uint32_t multiplier,
                     uint32_t increment) {
    uint32_t x = seed;
    for (uint32_t i = 0; i < iterations; ++i) x = (x ^ i) * multiplier + increment;
    return x;
}

static const uint32_t iv[8] = {
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
};
static const uint32_t constants[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};
static uint32_t rotate(uint32_t x, unsigned n) { return (x >> n) | (x << (32 - n)); }
static uint32_t load_be(const uint8_t *p) {
    return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
}
static void store_be(uint8_t *p, uint32_t x) {
    p[0] = x >> 24; p[1] = x >> 16; p[2] = x >> 8; p[3] = x;
}
static void copy_bytes(uint8_t *to, const uint8_t *from, uint32_t count) {
    for (uint32_t i = 0; i < count; ++i) to[i] = from[i];
}
/* Raw prevalidated entry: aligned little-endian state words, arbitrary input
 * byte alignment, complete blocks, disjoint state/input. No implicit padding. */
void ref_sha256_compress(uint32_t *state, const uint8_t *input, uint32_t blocks) {
    for (uint32_t block = 0; block < blocks; ++block, input += 64) {
        uint32_t w[64];
        for (unsigned i = 0; i < 16; ++i) w[i] = load_be(input + 4*i);
        for (unsigned i = 16; i < 64; ++i) {
            uint32_t x = w[i-15], y = w[i-2];
            uint32_t s0 = rotate(x,7) ^ rotate(x,18) ^ (x >> 3);
            uint32_t s1 = rotate(y,17) ^ rotate(y,19) ^ (y >> 10);
            w[i] = w[i-16] + s0 + w[i-7] + s1;
        }
        uint32_t a=state[0], b=state[1], c=state[2], d=state[3];
        uint32_t e=state[4], f=state[5], g=state[6], h=state[7];
        for (unsigned i=0; i<64; ++i) {
            uint32_t s1=rotate(e,6)^rotate(e,11)^rotate(e,25);
            uint32_t choose=(e&f)^(~e&g);
            uint32_t t1=h+s1+choose+constants[i]+w[i];
            uint32_t s0=rotate(a,2)^rotate(a,13)^rotate(a,22);
            uint32_t majority=(a&b)^(a&c)^(b&c);
            h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+s0+majority;
        }
        state[0]+=a;state[1]+=b;state[2]+=c;state[3]+=d;
        state[4]+=e;state[5]+=f;state[6]+=g;state[7]+=h;
    }
}

typedef struct {
    uint32_t state[8];
    uint64_t total;
    uint8_t tail[64];
    uint32_t used;
    uint32_t finalized;
} HashContext;
uint32_t ref_sha256_context_bytes(void) { return sizeof(HashContext); }
uint32_t ref_sha256_total_offset(void) { return offsetof(HashContext,total); }
uint32_t ref_sha256_used_offset(void) { return offsetof(HashContext,used); }
void ref_sha256_init(HashContext *ctx) {
    for (unsigned i=0;i<8;++i) ctx->state[i]=iv[i];
    ctx->total=0;ctx->used=0;ctx->finalized=0;
    for(unsigned i=0;i<64;++i)ctx->tail[i]=0;
}
/* Returns 1 after finalization, 2 on bit-length overflow, 3 for malformed
 * context. Every rejection occurs before context/output mutation. */
uint32_t ref_sha256_update(HashContext *ctx, const uint8_t *input, uint32_t length) {
    if (ctx->finalized) return 1;
    if (ctx->used>=64 || (ctx->total&63)!=ctx->used) return 3;
    if (ctx->total>MAX_SHA_BYTES || length>MAX_SHA_BYTES-ctx->total) return 2;
    ctx->total+=length;
    if (ctx->used) {
        uint32_t n=64-ctx->used;if(n>length)n=length;
        copy_bytes(ctx->tail+ctx->used,input,n);ctx->used+=n;input+=n;length-=n;
        if(ctx->used==64){ref_sha256_compress(ctx->state,ctx->tail,1);ctx->used=0;}
        else return 0;
    }
    uint32_t blocks=length/64;
    ref_sha256_compress(ctx->state,input,blocks);input+=blocks*64;length-=blocks*64;
    copy_bytes(ctx->tail,input,length);ctx->used=length;
    return 0;
}
uint32_t ref_sha256_final(HashContext *ctx,uint8_t *output) {
    if(ctx->finalized)return 1;
    if(ctx->used>=64 || (ctx->total&63)!=ctx->used)return 3;
    if(ctx->total>MAX_SHA_BYTES)return 2;
    uint64_t bits=ctx->total*8;
    ctx->tail[ctx->used++]=0x80;
    if(ctx->used>56){while(ctx->used<64)ctx->tail[ctx->used++]=0;ref_sha256_compress(ctx->state,ctx->tail,1);ctx->used=0;}
    while(ctx->used<56)ctx->tail[ctx->used++]=0;
    for(unsigned i=0;i<8;++i)ctx->tail[56+i]=(uint8_t)(bits>>(56-i*8));
    ref_sha256_compress(ctx->state,ctx->tail,1);
    for(unsigned i=0;i<8;++i)store_be(output+i*4,ctx->state[i]);
    ctx->used=0;ctx->finalized=1;
    return 0;
}
uint32_t ref_sha256_hash(const uint8_t *input,uint32_t length,uint8_t *output) {
    HashContext ctx;ref_sha256_init(&ctx);
    uint32_t status=ref_sha256_update(&ctx,input,length);
    return status ? status : ref_sha256_final(&ctx,output);
}
