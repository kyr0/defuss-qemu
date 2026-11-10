/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Compile the exact exported test companion with host-native stand-ins.
 * This validates API/mutation boundaries, not actual QEMU or guest recovery. */
#include "m3-region-core.h"
#include <assert.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#define TARGET_X86_64 1
#define EMSCRIPTEN_KEEPALIVE
#define CF_INVALID 0x4000u
#define HF_CPL_MASK 3u
#define RUN_STATE_PAUSED 3
#define qatomic_read(p) __atomic_load_n((p), __ATOMIC_SEQ_CST)
#define qatomic_set(p, v) __atomic_store_n((p), (v), __ATOMIC_SEQ_CST)
typedef void *gpointer;
typedef bool gboolean;
typedef struct { bool stopped; } CPUState;
struct WasmInstanceInfo { uint64_t m3_generation; uintptr_t tb_func; void *tb_ptr; };
struct WasmTBHeader { struct m3_descriptor m3; struct WasmInstanceInfo **info_ptr; };
typedef struct { struct { const void *ptr; } tc; uint32_t flags, cflags; } TranslationBlock;
static CPUState cpus[2];
static unsigned cpu_count;
#define CPU_FOREACH(cpu) for (cpu=cpus; cpu<cpus+cpu_count; cpu++)
static uint32_t m3_words[M3_WORDS];
static int runstate;
static bool one_context, traversal_locked;
static TranslationBlock tbs[2];
static unsigned tb_count;
static struct WasmTBHeader headers[2];
static struct WasmInstanceInfo instances[2], *info[2];
static uint32_t tb_cflags(const TranslationBlock *tb) { return tb->cflags; }
static bool runstate_check(int state) { return runstate==state; }
static bool wasm44_single_ctx(void) { return one_context; }
static bool m3_enabled(void) { return (m3_words[12]&M3_CONFIG_ENABLED)!=0; }
static void m3_note(unsigned n) { bool sat=false; m3_words[n]=m3_saturating_add(m3_words[n],1,&sat); }
static uint64_t m3_read_pair(const uint32_t *p) { return p[0]|(uint64_t)p[1]<<32; }
static struct WasmInstanceInfo *get_info(void *header, int thread)
{ assert(thread==0); return ((struct WasmTBHeader *)header)->info_ptr[thread]; }
static void tcg_tb_foreach(gboolean (*callback)(gpointer,gpointer,gpointer),gpointer data)
{
    assert(!traversal_locked);traversal_locked=true;
    for (unsigned i=0;i<tb_count;i++) { assert(!callback(NULL,&tbs[i],data)); }
    traversal_locked=false;
}
#include "test-injection.inc"

static void reset(void)
{
    memset(m3_words,0,sizeof(m3_words));memset(tbs,0,sizeof(tbs));
    memset(headers,0,sizeof(headers));memset(instances,0,sizeof(instances));
    cpu_count=1;cpus[0].stopped=true;cpus[1].stopped=true;
    runstate=RUN_STATE_PAUSED;one_context=true;tb_count=1;
    m3_words[12]=M3_CONFIG_ENABLED|M3_CONFIG_LOCKED;
    m3_words[M3_WATCH_OFFSET]=0x400000;m3_words[M3_WATCH_OFFSET+2]=0x400100;
    m3_words[M3_WATCH_OFFSET+7]=1;
    for (unsigned i=0;i<2;i++) {
        headers[i].m3=(struct m3_descriptor){.magic=M3_MAGIC,.version=M3_VERSION,
          .valid=1,.members=1,.recovery=M3_RECOVERY_TCI_SEARCH,
          .generation=1+i,.owner=(uintptr_t)&tbs[i],.translation_pc=0x400000};
        tbs[i].tc.ptr=&headers[i];tbs[i].flags=3;
        info[i]=&instances[i];headers[i].info_ptr=&info[i];
        instances[i]=(struct WasmInstanceInfo){.m3_generation=1+i,.tb_func=16+i,.tb_ptr=&headers[i]};
    }
}
static void rejected(unsigned action,unsigned slot,uint64_t pc)
{
    struct WasmTBHeader old_headers[2];struct WasmInstanceInfo old_instances[2];
    memcpy(old_headers,headers,sizeof(headers));memcpy(old_instances,instances,sizeof(instances));
    assert(defuss_m3_test_inject(action,slot,pc)<0);
    assert(memcmp(old_headers,headers,sizeof(headers))==0);
    assert(memcmp(old_instances,instances,sizeof(instances))==0);
    assert(m3_words[M3_INJECTION_REJECTS]==1);
    assert(!m3_words[M3_INJECTED_STALE_INSTANCES]&&!m3_words[M3_INJECTED_INVALID_DESCRIPTORS]);
}
int main(void)
{
    reset();assert(defuss_m3_test_abi()==1);
    assert(defuss_m3_test_inject(1,0,0x400000)==1);
    assert(instances[0].m3_generation==0&&headers[0].m3.valid==1);
    assert(instances[0].tb_func==16&&instances[0].tb_ptr==&headers[0]);
    assert(m3_words[M3_INJECTED_STALE_INSTANCES]==1);
    assert(m3_read_pair(m3_words+50)==0x400000&&m3_read_pair(m3_words+52)==1&&m3_words[54]==1);
    /* Already stale is not a live-current candidate for either action. */
    assert(defuss_m3_test_inject(2,0,0x400000)==-2);
    reset();assert(defuss_m3_test_inject(2,0,0x400000)==1);
    assert(headers[0].m3.valid==0&&instances[0].m3_generation==1);
    assert(tbs[0].cflags==0&&headers[0].m3.owner==(uintptr_t)&tbs[0]);
    assert(m3_words[M3_INJECTED_INVALID_DESCRIPTORS]==1&&m3_words[54]==2);
    for (unsigned mutation=0;mutation<19;mutation++) {
        reset();
        switch (mutation) {
        case 0: runstate=0;break;
        case 1: cpus[0].stopped=false;break;
        case 2: cpu_count=0;break;
        case 3: cpu_count=2;break;
        case 4: one_context=false;break;
        case 5: m3_words[12]=M3_CONFIG_LOCKED;break;
        case 6: m3_words[12]=M3_CONFIG_ENABLED;break;
        case 7: m3_words[M3_EXTRA_WORKER_REJECTS]=1;break;
        case 8: m3_words[M3_WATCH_OFFSET+7]=0;break;
        case 9: tb_count=0;break;
        case 10: tb_count=2;break;
        case 11: tbs[0].flags=0;break;
        case 12: tbs[0].cflags=CF_INVALID;break;
        case 13: headers[0].m3.valid=0;break;
        case 14: instances[0].m3_generation=99;break;
        case 15: instances[0].tb_ptr=&headers[1];break;
        case 16: headers[0].m3.eligibility=M3_PLAN;break;
        case 17: info[0]=NULL;break;
        case 18: headers[0].m3.owner=(uintptr_t)&tbs[1];break;
        }
        rejected(1,0,0x400000);
    }
    reset();rejected(0,0,0x400000);reset();rejected(3,0,0x400000);
    reset();rejected(1,4,0x400000);reset();rejected(1,UINT_MAX,0x400000);
    reset();rejected(1,0,0x400001);reset();rejected(1,0,0x400100);
    reset();m3_words[M3_WATCH_OFFSET]=0;rejected(1,0,0x400000);
    reset();m3_words[M3_WATCH_OFFSET+2]=0x500000;rejected(1,0,0x400000);
    reset();tb_count=2;tbs[1].flags=0;assert(defuss_m3_test_inject(1,0,0x400000)==1);
    assert(instances[1].m3_generation==2&&headers[1].m3.valid==1);
    puts("PASS: exact exported injection API, unique live owner/instance match, stopped/user/watch/context bounds, no mutation on rejection, no unrelated mutation; native stand-ins only");
    return 0;
}
