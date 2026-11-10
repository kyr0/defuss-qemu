/* Actual adapter/API/compiled and TCI-case extraction fixtures, not a VM. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#define TARGET_X86_64 1
#define EMSCRIPTEN_KEEPALIVE
#include "source-constants.h"
#include "descriptor-extract.h"
#include "core.h"
#include "../m3a-region/m3-region-core.h"
#include "../m3b-fallthrough/core.h"
#define qatomic_read(p) __atomic_load_n((p),__ATOMIC_RELAXED)
#define qatomic_set(p,v) __atomic_store_n((p),(v),__ATOMIC_RELAXED)
#define qatomic_load_acquire(p) __atomic_load_n((p),__ATOMIC_ACQUIRE)
#define qatomic_store_release(p,v) __atomic_store_n((p),(v),__ATOMIC_RELEASE)
#define qatomic_cmpxchg(p,o,n) ({ __typeof__(*(p)) old_=(o); __atomic_compare_exchange_n((p),&old_,(n),false,__ATOMIC_SEQ_CST,__ATOMIC_SEQ_CST); old_; })
typedef bool gboolean;
typedef void *gpointer;
enum { RUN_STATE_PAUSED=1, RUN_STATE_PRELAUNCH=2, RUN_STATE_RUNNING=3, R_CS=1 };
enum { M3B_ENABLED=1,M3B_CHOSEN=2,M3B_LOCKED=4,M3B_DIAGNOSTIC_PROFILE=8,
       M3B_GRAPH_READY=16,M3B_PROFILE_ELIGIBLE=32,M3B_PROFILE_FAULT=64 };
typedef struct SegmentCache { uint32_t selector; uint64_t base; uint32_t limit,flags; } SegmentCache;
typedef struct CPUArchState { uint64_t eip,eflags,cr[8],efer,dr[8];uint32_t hflags,hflags2;SegmentCache segs[6],gdt,idt,ldt,tr; } CPUArchState;
typedef struct CPUState { int stopped;CPUArchState *env; } CPUState;
typedef struct TranslationBlock {
    struct { void *ptr; } tc;
    uint64_t pc,page0,page1;uint32_t flags,cflags,size,icount;
    uint16_t m3b_bytes,m3b_b_offset;uint8_t m3b_fused;
} TranslationBlock;
struct WasmContext { CPUArchState *env; void *tb_ptr; };
typedef uintptr_t (*wasm_tb_func)(struct WasmContext *);
struct WasmInstanceInfo { wasm_tb_func tb_func;void *tb_ptr;uint64_t m3_generation; };
struct WasmTBHeader {
    struct m3_descriptor m3;struct m3b_header m3b;
    void *info_ptr,*aot_recipe;unsigned plan_id;int wasm_size;
};
static CPUArchState fixture_env;
static CPUState cpus[2];
static CPUState *current_cpu;
static unsigned cpu_count,profile,reasons,lookups,foreach_calls;
static bool single_ctx,dynamic_profile,coroutine,normal_asyncify,hot,closing,drop_second,duplicate_iter;
static int runstate,thread_idx,thread_idx_max,instance_budget;
static uint32_t m3_words[M3_WORDS],m3b_words[M3B_WORDS];
static struct WasmContext ctx;
static TranslationBlock tbs[3];
static struct WasmTBHeader headers[3];
static struct WasmInstanceInfo instances[3];
static unsigned live_count,body_calls,function_calls,boundary_calls;
static bool generic_abort;
#define CPU_FOREACH(cpu) for(unsigned ci_=0; ci_<cpu_count && (((cpu)=&cpus[ci_]),1); ci_++)
static CPUState *env_cpu(CPUArchState *e) { assert(e==&fixture_env);return &cpus[0]; }
static bool runstate_check(int s) { return runstate==s; }
static bool wasm44_single_ctx(void) { return single_ctx; }
static bool defuss_m3b_dynamic_profile(void) { return dynamic_profile; }
static unsigned defuss_m3b_profile_status(void) { return profile; }
static unsigned defuss_m3b_profile_reasons(void) { return reasons; }
static bool defuss_m3b_profile_enabled(void) { return profile==63; }
static bool qemu_in_coroutine(void) { return coroutine; }
static int m3b_asyncify_normal(void) { return normal_asyncify; }
static bool m3_enabled(void) { return m3_words[12]&1; }
static void m3_note(unsigned i) { m3_words[i]++; }
static uint64_t m3_read_pair(const uint32_t *p) { return m3cc_pair(p); }
static uint64_t m3b_pair(const uint32_t *p) { return m3cc_pair(p); }
static uint32_t tb_cflags(const TranslationBlock *t) { return t->cflags; }
static uint64_t tb_page_addr0(const TranslationBlock *t) { return t->page0; }
static uint64_t tb_page_addr1(const TranslationBlock *t) { return t->page1; }
static TranslationBlock *tcg_tb_lookup(uintptr_t code) {
    lookups++;for(unsigned i=0;i<live_count;i++)if((uintptr_t)tbs[i].tc.ptr==code)return &tbs[i];return NULL;
}
static void tcg_tb_foreach(gboolean (*fn)(gpointer,gpointer,gpointer),void *arg) {
    foreach_calls++;if(drop_second && foreach_calls==2)return;
    for(unsigned i=0;i<live_count;i++)fn(NULL,&tbs[i],arg);
    if(duplicate_iter)fn(NULL,&tbs[0],arg);
}
static struct WasmInstanceInfo *get_info(const void *code,unsigned worker) {
    assert(worker==0);for(unsigned i=0;i<3;i++)if(code==&headers[i])return &instances[i];return NULL;
}
static struct WasmInstanceInfo *get_info_local(const void *code) { return get_info(code,0); }
static bool defuss_m3b_can_form(const TranslationBlock *t) { return profile==63&&!(t->flags&RF_MASK)&&t->m3b_fused; }
static uintptr_t guest_function(struct WasmContext *c) { (void)c;function_calls++;if(generic_abort)return 3;body_calls++;return 1; }
static uintptr_t call_wasm_tb(wasm_tb_func f,struct WasmContext *c) { return f(c); }
static uintptr_t defuss_m3_redispatch(CPUArchState *e,void *h) { (void)e;(void)h;return 3; }
static void m3_watch_entry(CPUArchState *e,const struct m3_descriptor *d) { (void)e;(void)d; }
static void m3cc_note(CPUArchState *,void *,unsigned);
#include "compiled-extract.h"
#include "m3cc-adapter.inc"

enum { INDEX_op_goto_tb,INDEX_op_goto_ptr,INDEX_op_qemu_ld };
static void *link_value;
static bool m3b_tci_closing_slot(const void *p) { (void)p;return closing; }
static uint64_t m3b_runtime_pc(CPUArchState *e) { return e->eip; }
static void defuss_m3b_event_pc(unsigned n,uint64_t pc) { (void)n;(void)pc; }
static void defuss_m3b_note(unsigned n) { (void)n; }
static bool m3b_fused(const void *p) { return ((const struct WasmTBHeader *)p)->m3b.fused; }
static bool inc_counter(const void *p,void *x) { (void)p;(void)x;return hot; }
static unsigned m3b_boundary_before(CPUArchState *e,const void *p,bool compiled) { (void)e;(void)p;(void)compiled;boundary_calls++;return 0; }
static uint32_t *get_tci_ptr(void *p) { return p; }
#define tci_args_l(insn,tb,p) (*(p)=&link_value)
#define tci_args_r(insn,r) (*(r)=0)
static uintptr_t actual_tci_goto(unsigned opc,void *target) {
    uint32_t dummy=0;uint32_t *tb_ptr=&dummy;void *ptr=NULL;unsigned insn=0,r0=0;
    uintptr_t regs[1]={(uintptr_t)target};CPUArchState *env=&fixture_env;
    (void)insn;link_value=target;
    switch(opc) {
#include "goto-extract.h"
    default: assert(false);
    }
    (void)tb_ptr;return 7;
}
static uint32_t *watch(unsigned slot) { return m3cc_bank+M3CC_OFFSET+slot*M3CC_STRIDE; }
static void old_watch(unsigned slot,uint64_t pc) {
    uint32_t *a=m3_words+64+slot*8,*b=m3b_words+32+slot*20;
    memset(a,0,8*sizeof(*a));memset(b,0,20*sizeof(*b));
    m3cc_put(a,pc);m3cc_put(a+2,pc?pc+1:0);a[7]=!!pc;
    m3cc_put(b,pc);m3cc_put(b+2,pc?pc+1:0);
}
static void target(unsigned i,uint64_t pc,bool fused,bool rf) {
    struct WasmTBHeader *h=&headers[i];TranslationBlock *t=&tbs[i];
    memset(h,0,sizeof(*h));memset(t,0,sizeof(*t));
    t->tc.ptr=h;t->pc=pc;t->page0=0x200000+(pc&4095);t->page1=UINT64_MAX;
    t->flags=fixture_env.hflags|(rf?RF_MASK:0);t->cflags=CF_CLUSTER_MASK|CF_PCREL;t->size=fused?19:6;t->icount=fused?6:2;
    t->m3b_fused=fused;t->m3b_bytes=fused?19:0;t->m3b_b_offset=fused?6:0;
    h->m3=(struct m3_descriptor){.magic=M3_MAGIC,.version=1,.valid=1,.eligibility=M3_ELIGIBLE,.members=1,.recovery=M3_RECOVERY_TCI_SEARCH,.generation=10+i,.owner=(uintptr_t)t,.translation_pc=pc,.page0=t->page0,.page1=t->page1,.flags=t->flags,.cflags=t->cflags};
    if(fused)h->m3b=(struct m3b_header){.magic=M3B_MAGIC,.bytes=19,.b_offset=6,.fused=1,.budget=1};
    h->wasm_size=32;h->info_ptr=&instances[i];instances[i]=(struct WasmInstanceInfo){guest_function,h,h->m3.generation};
}
static void fresh(bool fused_mode) {
    memset(&fixture_env,0,sizeof(fixture_env));memset(m3_words,0,sizeof(m3_words));memset(m3b_words,0,sizeof(m3b_words));memset(m3cc_bank,0,sizeof(m3cc_bank));
    m3cc_bank[0]=M3CC_MAGIC;m3cc_bank[1]=2;m3cc_bank[5]=M3CC_WORDS;m3cc_bank[6]=4;m3cc_bank[7]=32;m3cc_bank[8]=592;m3cc_bank[9]=112;
    cpu_count=1;cpus[0]=(CPUState){1,&fixture_env};cpus[1]=cpus[0];current_cpu=&cpus[0];
    profile=fused_mode?63:62;reasons=0;single_ctx=dynamic_profile=normal_asyncify=true;coroutine=hot=closing=drop_second=duplicate_iter=false;
    runstate=RUN_STATE_PRELAUNCH;thread_idx=thread_idx_max=0;instance_budget=12000;live_count=1;lookups=foreach_calls=body_calls=function_calls=boundary_calls=0;generic_abort=false;
    fixture_env.eip=0x401000;fixture_env.hflags=HF_PE_MASK|HF_LMA_MASK|HF_CS64_MASK|3;fixture_env.eflags=IF_MASK;fixture_env.cr[3]=0x2534000;
    m3_words[12]=M3_CONFIG_ENABLED|M3_CONFIG_LOCKED;
    assert(defuss_m3cc_configure(1)==0);assert(defuss_m3cc_status()==3);assert(defuss_m3cc_data()!=0);
    m3cc_lock();thread_idx_max=1;runstate=RUN_STATE_PAUSED;assert(defuss_m3cc_status()==7);
    target(0,fixture_env.eip,fused_mode,false);ctx=(struct WasmContext){&fixture_env,&headers[0]};old_watch(0,fixture_env.eip);
    assert(defuss_m3cc_watch(0,fixture_env.eip,fused_mode,1)==0);
}
static SegmentCache *segment(unsigned n) {
    assert(n<8);return n<6?&fixture_env.segs[n]:n==6?&fixture_env.ldt:&fixture_env.tr;
}
static void segment_contract(void) {
    const uint32_t canonical_cs=DESC_G_MASK|DESC_P_MASK|DESC_S_MASK|
        (3u<<DESC_DPL_SHIFT)|DESC_CS_MASK|DESC_R_MASK|DESC_A_MASK|DESC_L_MASK;
    const uint32_t canonical_ss=DESC_G_MASK|DESC_B_MASK|DESC_P_MASK|DESC_S_MASK|
        (3u<<DESC_DPL_SHIFT)|DESC_W_MASK|DESC_A_MASK;
    assert(canonical_cs==0x00a0fb00&&canonical_ss==0x00c0f300);
    assert(get_seg_base(0x1234ffff,0xab0f0078)==0xab781234);
    assert(get_seg_limit(0xffff,canonical_cs|0xf0000)==UINT32_MAX);
    fresh(true);fixture_env.segs[1]=(SegmentCache){0x33,0,UINT32_MAX,canonical_cs};
    fixture_env.segs[2]=(SegmentCache){0x2b,0,UINT32_MAX,canonical_ss};
    m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);
    fixture_env.segs[1].flags|=0xf0000;fixture_env.segs[2].flags|=0xf0000;
    m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);
    assert(m3cc_bank[3]==0&&watch(0)[6]==2);
    const uint32_t *first=watch(0)+32;
    assert(first[37]==canonical_cs&&first[42]==canonical_ss);
    assert(first[91]==canonical_cs&&first[92]==canonical_ss);
    uint32_t current[M3CC_TUPLE];m3cc_tuple(current,&fixture_env,&tbs[0],&headers[0],fixture_env.eip);
    assert(current[91]==0x00affb00&&current[92]==0x00cff300);
    assert(m3cc_same_tuple(first,current));
    live_count=2;target(1,fixture_env.eip,false,true);fixture_env.eflags|=RF_MASK;
    m3cc_note(&fixture_env,&headers[1],M3CC_OUTER_TCI);
    assert(m3cc_bank[3]==0&&watch(0)[11]==1);
    /* Each access bit of every segment remains mandatory; every excluded
     * raw bit changes evidence only. Selector/base/decoded limit stay exact. */
    for(unsigned n=0;n<8;n++)for(unsigned bit=0;bit<32;bit++) {
        fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);
        segment(n)->flags^=UINT32_C(1)<<bit;
        m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);
        if(M3CC_SEGMENT_FLAGS_MASK&(UINT32_C(1)<<bit))assert(watch(0)[5]&M3CC_CONTINUITY);
        else assert(m3cc_bank[3]==0);
    }
    for(unsigned n=0;n<8;n++)for(unsigned field=0;field<3;field++) {
        fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);
        if(field==0)segment(n)->selector=1;
        else if(field==1)segment(n)->base=UINT64_C(1)<<40;
        else segment(n)->limit=1;
        m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);
        assert(watch(0)[5]&M3CC_CONTINUITY);
    }
    fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);
    memcpy(current,watch(0)+32,sizeof(current));current[98]=1;
    assert(!m3cc_same_tuple(watch(0)+32,current)&&!m3cc_same_context(watch(0)+32,current));
}
int main(void) {
    segment_contract();
    fresh(true);generic_abort=true;assert(m3_call_wasm_tb(guest_function,&ctx)==3);assert(function_calls==1&&body_calls==0&&watch(0)[8]==1);
    generic_abort=false;assert(m3_call_wasm_tb(guest_function,&ctx)==1);assert(watch(0)[8]==2&&!m3cc_bank[3]);
    m3cc_note(&fixture_env,&headers[0],M3CC_OUTER_TCI);assert(watch(0)[9]==1);
    fresh(false);actual_tci_goto(INDEX_op_goto_tb,&headers[0]);assert(watch(0)[13]==1&&watch(0)[22]==1);
    actual_tci_goto(INDEX_op_goto_ptr,&headers[0]);assert(watch(0)[13]==2&&watch(0)[23]==1);
    hot=true;actual_tci_goto(INDEX_op_goto_tb,&headers[0]);assert(watch(0)[6]==2);m3_call_wasm_tb(guest_function,&ctx);assert(watch(0)[12]==1);
    fresh(true);actual_tci_goto(INDEX_op_goto_tb,&headers[0]);assert(watch(0)[6]==0);m3cc_note(&fixture_env,&headers[0],M3CC_OUTER_TCI);assert(watch(0)[9]==1);
    fresh(true);live_count=2;target(1,fixture_env.eip,false,true);fixture_env.eflags|=RF_MASK;m3cc_note(&fixture_env,&headers[1],M3CC_OUTER_TCI);assert(watch(0)[11]==1&&watch(0)[7]==1&&!m3cc_bank[3]);
    fixture_env.eflags&=~RF_MASK;m3cc_note(&fixture_env,&headers[1],M3CC_OUTER_TCI);assert(watch(0)[5]&M3CC_FLAGS);
    fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);fixture_env.cr[3]+=4096;m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);assert((watch(0)[5]&M3CC_CONTINUITY)&&watch(0)[27]);
    fresh(true);m3cc_note(&fixture_env,(void *)(uintptr_t)1,M3CC_OUTER_TCI);assert(m3cc_bank[3]&M3CC_METADATA);
    fresh(true);headers[0].m3.owner=1;m3cc_note(&fixture_env,&headers[0],M3CC_OUTER_TCI);assert(watch(0)[5]&M3CC_METADATA);
    fresh(true);headers[0].m3b.fused=0;m3cc_note(&fixture_env,&headers[0],M3CC_OUTER_TCI);assert(watch(0)[5]&M3CC_UNEXPECTED);
    fresh(true);tbs[0].cflags=headers[0].m3.cflags=CF_CLUSTER_MASK;fixture_env.eip=0x999;m3cc_note(&fixture_env,&headers[0],M3CC_OUTER_TCI);assert(watch(0)[6]==1&&(watch(0)[5]&M3CC_CONTEXT));
    fresh(true);fixture_env.eip+=4096;m3cc_note(&fixture_env,&headers[0],M3CC_OUTER_TCI);assert(watch(0)[6]==0);
    fresh(true);headers[0].m3.translation_pc+=1;m3cc_note(&fixture_env,&headers[0],M3CC_OUTER_TCI);assert(watch(0)[5]&M3CC_PC);
    fresh(true);m3cc_bank[12]=UINT32_MAX;m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);assert(m3cc_bank[4]&&(m3cc_bank[3]&M3CC_OVERFLOW));
    fresh(true);uint32_t saved[M3CC_STRIDE];memcpy(saved,watch(0),sizeof(saved));old_watch(1,0x402000);assert(defuss_m3cc_watch(1,0x402000,1,2)==0);assert(!memcmp(saved,watch(0),sizeof(saved)));
    assert(defuss_m3cc_watch(1,0,0,3)==0);assert(!watch(1)[2]);assert(defuss_m3cc_watch(0,fixture_env.eip,1,3)==-2);
    runstate=RUN_STATE_RUNNING;assert(defuss_m3cc_data()==0&&defuss_m3cc_watch(0,fixture_env.eip,1,4)==-1);assert(defuss_m3cc_configure(1)==-1);
    fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);uint32_t *b=m3b_words+32;b[4]=1;m3cc_put(b+16,fixture_env.eip);m3cc_put(b+18,10);
    live_count=2;target(1,fixture_env.eip,false,true);assert(defuss_m3cc_inject(1,1,0,fixture_env.eip,0)==-1);assert(defuss_m3cc_inject(1,1,0,fixture_env.eip,11)==-1);
    assert(defuss_m3cc_inject(1,1,0,fixture_env.eip,10)==1);assert(instances[0].m3_generation==0&&instances[1].m3_generation==11&&m3cc_bank[17]==1);
    assert(defuss_m3cc_inject(1,1,0,fixture_env.eip,10)==-4);instances[0].m3_generation=10;
    assert(defuss_m3cc_inject(2,2,0,fixture_env.eip,10)==1);assert(headers[0].m3.valid==0&&headers[1].m3.valid==1&&m3cc_bank[18]==1);
    fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);b=m3b_words+32;b[4]=1;m3cc_put(b+16,fixture_env.eip);m3cc_put(b+18,10);drop_second=true;
    assert(defuss_m3cc_inject(1,1,0,fixture_env.eip,10)==-3&&instances[0].m3_generation==10);
    fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);b=m3b_words+32;b[4]=1;m3cc_put(b+16,fixture_env.eip);m3cc_put(b+18,10);duplicate_iter=true;
    assert(defuss_m3cc_inject(1,1,0,fixture_env.eip,10)==-2&&instances[0].m3_generation==10);
    fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);b=m3b_words+32;b[4]=1;m3cc_put(b+16,fixture_env.eip);m3cc_put(b+18,10);
    runstate=RUN_STATE_RUNNING;assert(defuss_m3cc_inject(1,1,0,fixture_env.eip,10)==-1&&m3cc_bank[20]==0);runstate=RUN_STATE_PAUSED;
    instances[0].m3_generation=9;assert(defuss_m3cc_inject(1,1,0,fixture_env.eip,10)==-2&&instances[0].m3_generation==9);
    fresh(true);m3cc_bank[2]=15;assert(defuss_m3cc_data()==0&&defuss_m3cc_watch(0,fixture_env.eip,1,2)==-1);
    fresh(true);thread_idx=1;m3cc_note(&fixture_env,&headers[0],M3CC_OUTER_TCI);assert(watch(0)[5]&M3CC_WORKER);
    fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);headers[0].m3.generation++;instances[0].m3_generation++;m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);assert(watch(0)[5]&M3CC_CONTINUITY);
    fresh(true);m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);headers[0].m3.page0=tbs[0].page0+=4096;m3cc_note(&fixture_env,&headers[0],M3CC_COMPILED);assert(watch(0)[5]&M3CC_CONTINUITY);
    fresh(true);headers[0].m3.cflags=tbs[0].cflags|=CF_COUNT_MASK;m3cc_note(&fixture_env,&headers[0],M3CC_OUTER_TCI);assert(watch(0)[5]&M3CC_CONTEXT);
    fresh(true);m3cc_bank[2]=0;assert(defuss_m3cc_configure(0)==0);m3cc_lock();assert(defuss_m3cc_status()==6&&defuss_m3cc_configure(1)==-1);
    m3cc_record(m3cc_bank,4,0,0,false,0,NULL);assert(m3cc_bank[3]&M3CC_METADATA);
    puts("actual adapter, compiled wrapper, extracted TCI sites and stopped typed APIs passed");return 0;
}
