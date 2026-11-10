/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Host shape/bounds fixtures only; these do not execute a guest or validate IR. */
#include "predecode.h"
#include <assert.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <unistd.h>
#ifndef MAP_ANONYMOUS
#define MAP_ANONYMOUS MAP_ANON
#endif
static unsigned checks, accepted, rejected;
static void require(bool value) { checks++; assert(value); }
struct bytes { uint8_t data[256]; size_t size, jcc, b, back; };
static void put(struct bytes *v, const void *data, size_t n)
{
    require(v->size + n <= sizeof(v->data));
    memcpy(v->data + v->size, data, n); v->size += n;
}
static void displacement(uint8_t *p, int value, unsigned n)
{
    if (n == 1) { require(value >= -128 && value <= 127); }
    uint32_t u = (uint32_t)value;
    for (unsigned i = 0; i < n; i++) { p[i] = (uint8_t)(u >> (8 * i)); }
}
static struct bytes loop(const uint8_t *a, size_t na, const uint8_t *b,
                         size_t nb, unsigned cc, bool near_cc, bool near_jmp)
{
    struct bytes v = {0}; uint8_t jcc[] = {0x0f, (uint8_t)(0x80 | cc), 0, 0, 0, 0};
    uint8_t short_cc[] = {(uint8_t)(0x70 | cc), 0};
    uint8_t jmp[] = {0xe9, 0, 0, 0, 0}, short_jmp[] = {0xeb, 0};
    put(&v, a, na); v.jcc = v.size;
    put(&v, near_cc ? jcc : short_cc, near_cc ? 6 : 2); v.b = v.size;
    put(&v, b, nb); v.back = v.size;
    put(&v, near_jmp ? jmp : short_jmp, near_jmp ? 5 : 2);
    displacement(v.data + v.jcc + (near_cc ? 2 : 1), (int)(v.size - v.b), near_cc ? 4 : 1);
    displacement(v.data + v.back + 1, -(int)v.size, near_jmp ? 4 : 1);
    return v;
}
static struct m3b_plan good(const struct bytes *v, unsigned count)
{
    struct { uint64_t before; struct m3b_plan plan; uint64_t after; } out;
    memset(&out, 0xa5, sizeof(out)); uint64_t before = out.before, after = out.after;
    uint8_t original[256]; memcpy(original, v->data, sizeof(original));
    require(m3b_predecode(v->data, v->size, v->size, 32, &out.plan) == M3B_SHAPE_OK);
    require(out.before == before && out.after == after);
    require(memcmp(original, v->data, sizeof(original)) == 0);
    require(out.plan.bytes == v->size && out.plan.count == count);
    require(out.plan.b_offset == v->b && out.plan.backedge_offset == v->back);
    require(out.plan.jcc_target_offset == v->size);
    require(out.plan.insns[out.plan.jcc_index].offset == v->jcc);
    require(out.plan.insns[out.plan.jcc_index].kind == M3B_JCC);
    require(out.plan.insns[count - 1].kind == M3B_JMP);
    unsigned next = 0;
    for (unsigned i = 0; i < count; i++) {
        require(out.plan.insns[i].offset == next);
        require(out.plan.insns[i].length > 0 && out.plan.insns[i].length <= 15);
        next += out.plan.insns[i].length;
    }
    require(next == v->size); accepted++; return out.plan;
}
static void bad(const uint8_t *bytes, size_t n, unsigned page, unsigned count,
                int expected)
{
    struct m3b_plan out, zero = {0}; memset(&out, 0xa5, sizeof(out));
    enum m3b_predecode_result result = m3b_predecode(bytes, n, page, count, &out);
    require(result != M3B_SHAPE_OK);
    if (expected >= 0) { require((int)result == expected); }
    require(memcmp(&out, &zero, sizeof(out)) == 0); rejected++;
}
static void instruction_forms(void)
{
    static const struct { uint8_t bytes[10]; unsigned size, kind; } forms[] = {
        {{0x01,0xd8},2,M3B_ADD}, {{0x03,0xc3},2,M3B_ADD},
        {{0x09,0xd8},2,M3B_OR}, {{0x0b,0xc3},2,M3B_OR},
        {{0x21,0xd8},2,M3B_AND}, {{0x23,0xc3},2,M3B_AND},
        {{0x29,0xd8},2,M3B_SUB}, {{0x2b,0xc3},2,M3B_SUB},
        {{0x31,0xd8},2,M3B_XOR}, {{0x33,0xc3},2,M3B_XOR},
        {{0x39,0xd8},2,M3B_CMP}, {{0x3b,0xc3},2,M3B_CMP},
        {{0x85,0xd8},2,M3B_TEST}, {{0x89,0xd8},2,M3B_MOV},
        {{0x8b,0xc3},2,M3B_MOV}, {{0x05,0xff,0xff,0xff,0xff},5,M3B_ADD},
        {{0x0d,0,0,0,0x80},5,M3B_OR}, {{0x25,0,0,0,0},5,M3B_AND},
        {{0x2d,0x39,0x7a,0x16,0xef},5,M3B_SUB}, {{0x35,1,2,3,4},5,M3B_XOR},
        {{0x3d,0,0,0,0},5,M3B_CMP}, {{0xa9,0xff,0,0,0},5,M3B_TEST},
        {{0x69,0xc3,0x31,0x42,0x53,0x64},6,M3B_IMUL},
        {{0x6b,0xc3,0x81},3,M3B_IMUL}, {{0x0f,0xaf,0xc3},3,M3B_IMUL},
        {{0x81,0xc0,0,0,0,0x80},6,M3B_ADD}, {{0x83,0xe8,0xff},3,M3B_SUB},
        {{0xc1,0xe0,31},3,M3B_SHL}, {{0xc1,0xe8,0},3,M3B_SHR},
        {{0xc1,0xf8,0xff},3,M3B_SAR}, {{0xd1,0xe0},2,M3B_SHL},
        {{0xd1,0xe8},2,M3B_SHR}, {{0xd1,0xf8},2,M3B_SAR},
        {{0xff,0xc0},2,M3B_INC}, {{0xff,0xc8},2,M3B_DEC},
        {{0xf7,0xc0,0x11,0x22,0x33,0x44},6,M3B_TEST},
        {{0xf7,0xd0},2,M3B_NOT}, {{0xf7,0xd8},2,M3B_NEG},
        {{0xc7,0xc0,9,8,7,6},6,M3B_MOV}, {{0xb8,1,3,5,7},5,M3B_MOV},
        {{0x49,0xbf,1,2,3,4,5,6,7,8},10,M3B_MOV}, {{0x90},1,M3B_NOP},
    };
    const uint8_t b[] = {0x83,0xc3,7};
    for (unsigned f = 0; f < sizeof(forms)/sizeof(forms[0]); f++) {
        for (unsigned n = 1; n < forms[f].size; n++) {
            bad(forms[f].bytes, n, n, 32, M3B_SHAPE_TRUNCATED);
        }
        for (unsigned cc = 0; cc < 16; cc++) for (unsigned branches = 0; branches < 4; branches++) {
            struct bytes v = loop(forms[f].bytes, forms[f].size, b, sizeof(b), cc, branches & 1, branches & 2);
            struct m3b_plan p = good(&v, 4);
            require(p.insns[0].kind == forms[f].kind && p.insns[0].length == forms[f].size);
            require(p.insns[0].rex == (forms[f].bytes[0] == 0x49 ? 0x49 : 0));
        }
    }
    /* Independent list of supported ALU group subopcodes, for both immediate sizes. */
    const unsigned groups[] = {0,1,4,5,6,7};
    const unsigned kinds[] = {M3B_ADD,M3B_OR,M3B_AND,M3B_SUB,M3B_XOR,M3B_CMP};
    for (unsigned g=0;g<6;g++) for (unsigned wide=0;wide<2;wide++) {
        uint8_t a[] = {(uint8_t)(wide ? 0x81 : 0x83),(uint8_t)(0xc0 | (groups[g]<<3)),0x81,0x52,0x23,0xf4};
        struct bytes v=loop(a,wide?6:3,b,sizeof(b),g,false,false);
        struct m3b_plan p=good(&v,4);require(p.insns[0].kind==kinds[g]);
    }
    /* Every source/destination pair, including identical and extended registers. */
    for (unsigned width = 0; width < 2; width++) for (unsigned a = 0; a < 16; a++) for (unsigned breg = 0; breg < 16; breg++) {
        uint8_t add[] = {(uint8_t)(0x40 | (width ? 8 : 0) | ((a >> 3) << 2) | (breg >> 3)), 0x01, (uint8_t)(0xc0 | ((a & 7) << 3) | (breg & 7))};
        struct bytes v = loop(add, sizeof(add), b, sizeof(b), (a+breg)&15, false, false);
        struct m3b_plan p = good(&v, 4); require(p.insns[0].rex == add[0]);
    }
}
static void rejections(void)
{
    const uint8_t nop[] = {0x90};
    static const struct { uint8_t bytes[8]; unsigned n, error; } cases[] = {
        {{0x01,0x00},2,M3B_SHAPE_MEMORY}, {{0x8b,0x04,0x24},3,M3B_SHAPE_MEMORY},
        {{0x8b,0x05,0,0,0,0},6,M3B_SHAPE_MEMORY}, {{0x0f,0xaf,0},3,M3B_SHAPE_MEMORY},
        {{0x81,0xd0,1,0,0,0},6,M3B_SHAPE_OPCODE}, /* ADC */
        {{0x83,0xd8,1},3,M3B_SHAPE_OPCODE}, /* SBB */
        {{0xc1,0xc0,1},3,M3B_SHAPE_OPCODE}, /* rotate */
        {{0xc1,0xf0,1},3,M3B_SHAPE_OPCODE}, /* non-whitelisted /6 */
        {{0xff,0xd0},2,M3B_SHAPE_OPCODE}, /* indirect CALL */
        {{0xff,0xe0},2,M3B_SHAPE_OPCODE}, /* indirect JMP */
        {{0xf7,0xf0},2,M3B_SHAPE_OPCODE}, /* DIV */
        {{0xf7,0xc8,0,0,0,0},6,M3B_SHAPE_OPCODE}, /* undocumented TEST alias */
        {{0xc7,0xc8,0,0,0,0},6,M3B_SHAPE_OPCODE},
        {{0xc3},1,M3B_SHAPE_OPCODE}, {{0xe8,0,0,0,0},5,M3B_SHAPE_OPCODE},
        {{0x0f,0x05},2,M3B_SHAPE_OPCODE}, {{0x0f,0x0b},2,M3B_SHAPE_OPCODE},
        {{0xd3,0xe0},2,M3B_SHAPE_OPCODE}, /* variable-count shift */
        {{0x48,0x90},2,M3B_SHAPE_PREFIX}, {{0x48,0x49,0x01,0xc0},4,M3B_SHAPE_PREFIX},
    };
    for (unsigned i = 0; i < sizeof(cases)/sizeof(cases[0]); i++) {
        struct bytes v = loop(cases[i].bytes, cases[i].n, nop, 1, 5, false, false);
        bad(v.data, v.size, v.size, 32, cases[i].error);
    }
    const uint8_t prefixes[] = {0x66,0x67,0xf0,0xf2,0xf3,0x26,0x2e,0x36,0x3e,0x64,0x65};
    for (unsigned i = 0; i < sizeof(prefixes); i++) {
        uint8_t a[] = {prefixes[i],0x01,0xc0};
        struct bytes v = loop(a, sizeof(a), nop, 1, 1, false, false);
        bad(v.data, v.size, v.size, 32, M3B_SHAPE_PREFIX);
    }
    struct bytes base = loop(nop, 1, nop, 1, 2, false, false), v;
    for (int delta = -3; delta <= 3; delta++) if (delta) {
        v = base; v.data[v.jcc+1] += delta;
        bad(v.data, v.size, v.size, 32, -1);
        v = base; v.data[v.back+1] += delta;
        bad(v.data, v.size, v.size, 32, M3B_SHAPE_CLOSURE);
    }
    v = base; v.data[v.b] = 0x74; /* B starts with a second Jcc, not a body. */
    bad(v.data, v.size, v.size, 32, M3B_SHAPE_CONTROL);
    const uint8_t jmp_alone[] = {0xeb,0xfe};
    bad(jmp_alone, sizeof(jmp_alone), sizeof(jmp_alone), 32, M3B_SHAPE_CLOSURE);
    const uint8_t plain[] = {0x90,0x90}; bad(plain, 2, 2, 32, M3B_SHAPE_LIMIT);
    v = loop(nop, 0, nop, 0, 3, false, false); good(&v, 2);
    const uint32_t extremes[] = {UINT32_C(0x7fffffff),UINT32_C(0x80000000),UINT32_C(0xffffffff)};
    for (unsigned i=0;i<3;i++) for (unsigned branch=0;branch<2;branch++) {
        v=loop(nop,1,nop,1,15,true,true);
        size_t at=branch ? v.back+1 : v.jcc+2;
        for(unsigned byte=0;byte<4;byte++)v.data[at+byte]=(uint8_t)(extremes[i]>>(byte*8));
        bad(v.data,v.size,v.size,32,M3B_SHAPE_CLOSURE);
    }
    v = loop(nop, 1, nop, 1, 15, true, true);
    for (size_t n = 0; n < v.size; n++) bad(v.data, n, v.size, 32, -1);
    bad(v.data, v.size, v.size, 0, M3B_SHAPE_LIMIT);
    bad(v.data, v.size, 0, 32, M3B_SHAPE_LIMIT);
    bad(NULL, v.size, v.size, 32, M3B_SHAPE_LIMIT);
    require(m3b_predecode(v.data, v.size, v.size, 32, NULL) == M3B_SHAPE_LIMIT);
}
static void limits_and_guard_page(void)
{
    const uint8_t nop[] = {0x90}; uint8_t a[128]; memset(a, 0x90, sizeof(a));
    struct bytes v = loop(a, 28, a, 2, 4, false, false); good(&v, 32);
    bad(v.data, v.size, v.size, 31, M3B_SHAPE_LIMIT);
    struct m3b_plan p; require(m3b_predecode(v.data,v.size,v.size,UINT_MAX,&p)==M3B_SHAPE_OK);
    v = loop(a, 29, a, 2, 4, false, false); bad(v.data,v.size,v.size,UINT_MAX,M3B_SHAPE_LIMIT);
    for (unsigned i = 0; i < 12; i++) { a[i*10] = 0x48; a[i*10+1] = 0xb8; for (unsigned j=2;j<10;j++) a[i*10+j]=(uint8_t)(i*13+j); }
    v = loop(a,120,nop,1,7,false,true); require(v.size==128); good(&v,15);
    bad(v.data,v.size,127,32,-1);
    v = loop(a,120,nop,1,7,true,true); require(v.size>128); bad(v.data,v.size,v.size,32,-1);
    long page = sysconf(_SC_PAGESIZE); require(page >= 256);
    uint8_t *mapping = mmap(NULL,(size_t)page*2,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
    require(mapping != MAP_FAILED); require(mprotect(mapping+page,(size_t)page,PROT_NONE)==0);
    v = loop(nop,1,nop,1,9,true,true);
    for (size_t n=1;n<=v.size;n++) {
        uint8_t *start=mapping+page-n; memcpy(start,v.data,n);
        if(n<v.size) bad(start,SIZE_MAX,(unsigned)n,32,-1);
        else { require(m3b_predecode(start,SIZE_MAX,(unsigned)n,32,&p)==M3B_SHAPE_OK); accepted++; }
    }
    /* No scan of bytes after the closed backedge, including an inaccessible page. */
    require(p.bytes==v.size); require(munmap(mapping,(size_t)page*2)==0);
}
static void alias_and_publication(void)
{
    _Alignas(struct m3b_plan) uint8_t storage[sizeof(struct m3b_plan)+256], before[sizeof(storage)];
    const uint8_t nop[]={0x90}; struct bytes v=loop(nop,1,nop,1,0,false,false);
    for (unsigned layout=0;layout<3;layout++) {
        memset(storage,0xa5,sizeof(storage));
        struct m3b_plan *out=(struct m3b_plan *)storage;
        uint8_t *input=layout==0?storage:layout==1?storage+sizeof(*out)-2:storage;
        if(layout==2) out=(struct m3b_plan *)(storage+_Alignof(struct m3b_plan));
        memcpy(input,v.data,v.size);memcpy(before,storage,sizeof(storage));
        require(m3b_predecode(input,v.size,v.size,32,out)==M3B_SHAPE_LIMIT);
        require(memcmp(before,storage,sizeof(storage))==0);rejected++;
    }
    /* A failed retry after a previous successful decode cannot leak the old plan. */
    struct m3b_plan p; require(m3b_predecode(v.data,v.size,v.size,32,&p)==M3B_SHAPE_OK);
    uint8_t illegal[]={0xc3}; require(m3b_predecode(illegal,1,1,32,&p)!=M3B_SHAPE_OK);
    struct m3b_plan zero={0};require(memcmp(&p,&zero,sizeof(p))==0);
}
int main(void)
{
    instruction_forms();rejections();limits_and_guard_page();alias_and_publication();
    printf("{\"scope\":\"host-predecode-shape-bounds-only\",\"checks\":%u,\"acceptedShapes\":%u,\"rejectedShapes\":%u}\n",checks,accepted,rejected);
    return 0;
}
