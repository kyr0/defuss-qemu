/* Host validation of actual boundary API/helper source with explicit context
 * stubs. No generated x86/Wasm, QEMU flag calculation or Asyncify claim. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <pthread.h>
#include "core.h"
#define TARGET_X86_64 1
#define EMSCRIPTEN_KEEPALIVE
#define RUN_STATE_PAUSED 3
#define CC_OP_DYNAMIC 100
#define TB_EXIT_MASK 3
#define TB_EXIT_IDX1 1
#define TB_EXIT_REQUESTED 3
enum { R_EAX, R_ECX, R_EDX, R_EBX, R_ESP, R_EBP, R_ESI, R_EDI };
enum { R_ES, R_CS, R_SS, R_DS, R_FS, R_GS };
typedef struct {
    uint64_t regs[16],eip,eflags,cc_dst,cc_src,cc_src2;
    uint32_t cc_op,hflags,hflags2,m3b_service_debt,m3b_boundary_force;
    int32_t df;
    struct { uint64_t base; } segs[6];
    uint64_t cr[8],efer;
} CPUArchState;
typedef struct { unsigned icount; } TranslationBlock;
struct WasmTBHeader {
    struct m3b_header m3b;
    struct { uintptr_t owner; uint64_t generation; } m3;
};
static struct { void *tb_ptr; } ctx;
static uint32_t m3b_words[M3B_WORDS];
static bool paused=true,enabled=true,eligible=true,normal=true,mutate_flags;
static unsigned cpu_exits;
#define qatomic_read(p) __atomic_load_n((p),__ATOMIC_RELAXED)
#define qatomic_load_acquire(p) __atomic_load_n((p),__ATOMIC_ACQUIRE)
#define qatomic_store_release(p,v) __atomic_store_n((p),(v),__ATOMIC_RELEASE)
static uint32_t compare_exchange(uint32_t *p,uint32_t old,uint32_t value)
{ __atomic_compare_exchange_n(p,&old,value,false,__ATOMIC_ACQ_REL,__ATOMIC_ACQUIRE);return old; }
#define qatomic_cmpxchg(p,o,v) compare_exchange((p),(o),(v))
static bool runstate_check(int value) { return value==RUN_STATE_PAUSED&&paused; }
static bool defuss_m3b_profile_enabled(void) { return enabled; }
static bool m3b_worker_eligible(CPUArchState *env) { (void)env;return eligible; }
static bool m3b_fused(const void *p) { return ((const struct WasmTBHeader *)p)->m3b.fused!=0; }
static uint64_t m3b_pair(const uint32_t *p) { return p[0]|(uint64_t)p[1]<<32; }
static unsigned cpu_compute_eflags(CPUArchState *env)
{ if(mutate_flags)env->cc_src^=1;return env->eflags|(unsigned)env->cc_src; }
static CPUArchState *env_cpu(CPUArchState *env) { return env; }
static void cpu_exit(CPUArchState *env) { (void)env;cpu_exits++; }
static bool m3b_asyncify_normal(void) { return normal; }
#include "runtime-boundary.inc"

static CPUArchState env;
static TranslationBlock owner;
static struct WasmTBHeader code;
static const uint64_t pc=UINT64_C(0x123456789);
static void reset(void)
{
    memset(&env,0,sizeof(env));memset(&code,0,sizeof(code));memset(m3b_words,0,sizeof(m3b_words));
    memset(m3b_boundary,0,sizeof(m3b_boundary));
    m3b_boundary[0]=M3B_BOUNDARY_MAGIC;m3b_boundary[1]=1;
    m3b_boundary[6]=M3B_BOUNDARY_WORDS;m3b_boundary[7]=64;
    paused=enabled=eligible=normal=true;mutate_flags=false;cpu_exits=0;
    env.eip=pc;env.eflags=0x202;env.cc_src=0x40;env.df=1;env.cc_op=1;
    for(unsigned i=0;i<16;i++)env.regs[i]=UINT64_C(0xf12300000000)+i;
    owner.icount=6;code.m3b=(struct m3b_header){.fused=1,.b_offset=5,.bytes=17};
    code.m3.owner=(uintptr_t)&owner;code.m3.generation=43;ctx.tb_ptr=&code;
}
static unsigned begin(unsigned mode)
{
    assert(defuss_m3b_boundary_arm(1,mode,pc)==0);
    unsigned token=m3b_boundary_before(&env,&code,true);
    assert(token==1&&m3b_boundary[2]==M3B_BOUNDARY_ACTIVE);
    return token;
}
static void return_from_call(unsigned token,unsigned mode)
{
    env.eip=pc+(mode==2?5:0);env.m3b_service_debt=mode;
    if(mode==2)env.m3b_boundary_force=2;
    ctx.tb_ptr=NULL;
    m3b_boundary_after(&env,mode==2?TB_EXIT_REQUESTED:TB_EXIT_IDX1,token);
}
static void pay(unsigned mode)
{
    env.m3b_service_debt=0;
    m3b_words[M3B_SERVICE_PAID]++;m3b_words[M3B_B_ATTEMPTS]++;
    if(mode==2)m3b_words[M3B_B_REQUESTED]++;
}
static void *racing_arm(void *result)
{ *(int *)result=defuss_m3b_boundary_arm(1,1,pc);return NULL; }
int main(void)
{
    reset();paused=false;assert(defuss_m3b_boundary_arm(1,1,pc)==-1);
    paused=true;enabled=false;assert(defuss_m3b_boundary_arm(1,1,pc)==-2);
    enabled=true;assert(defuss_m3b_boundary_arm(2,1,pc)==-4);
    assert(defuss_m3b_boundary_arm(1,3,pc)==-1);
    assert(defuss_m3b_boundary_arm(1,1,0x1000)==-1);
    assert(defuss_m3b_boundary_arm(1,1,(UINT64_C(1)<<47)-127)==-1);
    for(unsigned mode=1;mode<=2;mode++){
        reset();CPUArchState original=env;unsigned token=begin(mode);
        assert(!memcmp(&env.regs,&original.regs,sizeof(env.regs))&&env.cc_src==original.cc_src);
        assert(m3b_boundary[19]==1&&m3b_boundary[17]==1&&m3b_pair(m3b_boundary+10)==43);
        return_from_call(token,mode);assert(m3b_boundary[2]==M3B_BOUNDARY_ACTIVE);
        assert(env.m3b_boundary_force==0&&cpu_exits==(mode==2));
        assert(m3b_pair(m3b_boundary+128)==pc+(mode==2?5:0));
        pay(mode);m3b_boundary_complete(&env,token);
        assert(m3b_boundary[2]==M3B_BOUNDARY_COMPLETE&&m3b_boundary[18]==3);
        assert(!memcmp(m3b_boundary+96,m3b_boundary+160,64*sizeof(uint32_t)));
        assert(m3b_boundary[19]==1&&m3b_boundary[20]==1&&m3b_boundary[21]==1);
        assert(defuss_m3b_boundary_data()==(uintptr_t)m3b_boundary);
        m3b_boundary_complete(&env,token);assert(m3b_boundary[2]==M3B_BOUNDARY_FAILED&&m3b_boundary[5]==M3B_BOUNDARY_DUPLICATE);
        assert(defuss_m3b_boundary_arm(2,1,pc)==-3);
    }
    reset();assert(defuss_m3b_boundary_arm(1,1,pc)==0);
    assert(m3b_boundary_before(&env,&code,false)==1&&m3b_boundary[5]==M3B_BOUNDARY_TCI);
    reset();code.m3b.fused=0;assert(defuss_m3b_boundary_arm(1,1,pc)==0);
    assert(m3b_boundary_before(&env,&code,true)==1&&m3b_boundary[5]==M3B_BOUNDARY_ORDINARY);
    reset();unsigned token=begin(2);m3b_boundary_entry(&env);
    assert(env.m3b_boundary_force==0&&m3b_boundary[5]==M3B_BOUNDARY_DUPLICATE);
    reset();token=begin(1);ctx.tb_ptr=NULL;m3b_boundary_after(&env,0,token);
    assert(m3b_boundary[5]==M3B_BOUNDARY_RETURN);
    reset();token=begin(1);return_from_call(token,1);pay(1);env.regs[4]^=1;m3b_boundary_complete(&env,token);
    assert(m3b_boundary[5]==M3B_BOUNDARY_ACCOUNTING);
    reset();token=begin(1);return_from_call(token,1);m3b_boundary_complete(&env,token);
    assert(m3b_boundary[5]==M3B_BOUNDARY_ACCOUNTING);
    reset();token=begin(1);return_from_call(token,1);pay(1);normal=false;m3b_boundary_complete(&env,token);
    assert(m3b_boundary[5]==M3B_BOUNDARY_ACCOUNTING);
    reset();mutate_flags=true;assert(defuss_m3b_boundary_arm(1,1,pc)==0);
    assert(m3b_boundary_before(&env,&code,true)==1&&m3b_boundary[5]==M3B_BOUNDARY_FLAGS);
    reset();assert(defuss_m3b_boundary_arm(1,1,pc)==0);env.eip++;
    assert(m3b_boundary_before(&env,&code,true)==0&&m3b_boundary[2]==M3B_BOUNDARY_ARMED);
    reset();m3b_boundary[2]=M3B_BOUNDARY_COMPLETE;m3b_boundary[3]=32;
    assert(defuss_m3b_boundary_arm(33,1,pc)==-4);
    reset();pthread_t threads[2];int results[2]={99,99};
    assert(!pthread_create(&threads[0],NULL,racing_arm,&results[0]));
    assert(!pthread_create(&threads[1],NULL,racing_arm,&results[1]));
    assert(!pthread_join(threads[0],NULL)&&!pthread_join(threads[1],NULL));
    assert((results[0]==0) != (results[1]==0));assert(m3b_boundary[2]==M3B_BOUNDARY_ARMED);
    puts("actual boundary helper API/capture/token/error contracts passed; no generated code or Asyncify");
    return 0;
}
