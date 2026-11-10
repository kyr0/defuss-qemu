/* Native contract fixture. Compiles actual overlay and extracted pool functions
 * with explicit QEMU/Emscripten stand-ins; this is not guest execution proof. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <pthread.h>
#include <stdatomic.h>
#define TARGET_X86_64 1
#define EMSCRIPTEN_KEEPALIVE
#define MAX(a,b) ((a)>(b)?(a):(b))
#define qatomic_read(p) __atomic_load_n((p),__ATOMIC_SEQ_CST)
#define qatomic_load_acquire(p) __atomic_load_n((p),__ATOMIC_ACQUIRE)
#define qatomic_set(p,v) __atomic_store_n((p),(v),__ATOMIC_SEQ_CST)
#define qatomic_store_release(p,v) __atomic_store_n((p),(v),__ATOMIC_RELEASE)
#define qatomic_or(p,v) ((void)__atomic_fetch_or((p),(v),__ATOMIC_SEQ_CST))
#define qatomic_inc(p) ((void)__atomic_fetch_add((p),1,__ATOMIC_SEQ_CST))
#define qatomic_sub(p,v) ((void)__atomic_fetch_sub((p),(v),__ATOMIC_SEQ_CST))
#define qatomic_cmpxchg(p,a,b) ({ __typeof__(*(p)) _o=(a); __atomic_compare_exchange_n((p),&_o,(b),false,__ATOMIC_SEQ_CST,__ATOMIC_SEQ_CST); _o; })
typedef struct CPUState {
    int cpu_index, refs; bool stopped,running,unplug;
    struct { bool hotplugged; } parent_obj;
    struct CPUState *next;
} CPUState;
typedef CPUState CPUArchState;
static CPUState cpu0, cpu1, *first_cpu, *current_cpu;
static struct { int len; struct {CPUState *cpu;} cpus[1]; } slots;
static struct {
    struct {int cpus,max_cpus;} smp;
    __typeof__(slots) *possible_cpus;
    void *acpi_dev;
} machine,*current_machine;
static bool mock_normal=true,mock_coroutine,mock_dynamic=true,mock_one_ctx=true;
static bool mock_pc=true,mock_paused=true,mock_self=true;
#define CPU_FOREACH(cpu) for((cpu)=first_cpu;(cpu);(cpu)=(cpu)->next)
#define OBJECT(p) (p)
#define TYPE_PC_MACHINE "pc"
#define X86_MACHINE(p) (p)
#define RUN_STATE_PAUSED 1
static bool object_dynamic_cast(void *p,const char *type) { (void)p;(void)type;return mock_pc; }
static void object_ref(CPUState *p) { p->refs++; }
static void object_unref(CPUState *p) { assert(p->refs>0);p->refs--; }
static bool qemu_in_coroutine(void) { return mock_coroutine; }
static bool qemu_cpu_is_self(CPUState *p) { return mock_self && p==&cpu0; }
static bool wasm44_single_ctx(void) { return mock_one_ctx; }
static bool defuss_fifo_dynamic_profile(void) { return mock_dynamic; }
static bool runstate_check(int s) { (void)s;return mock_paused; }
static CPUState *env_cpu(CPUArchState *p) { return p; }
typedef struct {unsigned long host_ulong;} run_on_cpu_data;
#define RUN_ON_CPU_HOST_ULONG(n) ((run_on_cpu_data){n})
static void (*queued)(CPUState*,run_on_cpu_data);
static CPUState *queued_cpu;
static run_on_cpu_data queued_data;
static void async_run_on_cpu(CPUState *p,void (*fn)(CPUState*,run_on_cpu_data),run_on_cpu_data data)
{ assert(!queued);queued=fn;queued_cpu=p;queued_data=data; }
static void deliver(void) { void (*fn)(CPUState*,run_on_cpu_data)=queued;queued=NULL;assert(fn);fn(queued_cpu,queued_data); }
#define EM_JS(ret,name,args,...) static ret name args { return mock_normal; }
#define EM_ASM(code,value) remove_function(value)
static __thread unsigned instance_budget=12000;
static __thread int thread_idx;
static int instances_global;
static unsigned pressure_meter,pressure_stats[7];
#include "fifo-head.inc"
typedef void *wasm_tb_func;
struct WasmInstanceInfo { wasm_tb_func tb_func; void *tb_ptr; };
struct test_tb { struct WasmInstanceInfo *info; unsigned counter; };
static struct test_tb tbs[12001];
static void set_info_local(void *p,struct WasmInstanceInfo *v) { ((struct test_tb*)p)->info=v; }
static struct WasmInstanceInfo *get_info_local(void *p) { return ((struct test_tb*)p)->info; }
static void set_counter_local(void *p,unsigned n) { ((struct test_tb*)p)->counter=n; }
#define INSTANTIATE_NUM 1500
#define MAX_INSTANCES 12000
#define INSTANCES_BUF_MAX (MAX_INSTANCES+1)
static unsigned removed;
static void remove_function(wasm_tb_func fn) { assert(fn);removed++; }
#include "pool-under-test.inc"

static void reset(unsigned live,bool enabled)
{
    memset(&cpu0,0,sizeof(cpu0));memset(&cpu1,0,sizeof(cpu1));
    cpu0.stopped=true;first_cpu=current_cpu=&cpu0;current_machine=&machine;
    machine.smp.cpus=machine.smp.max_cpus=1;machine.possible_cpus=&slots;
    machine.acpi_dev=NULL;slots.len=1;slots.cpus[0].cpu=&cpu0;
    mock_normal=mock_dynamic=mock_one_ctx=mock_pc=mock_paused=mock_self=true;
    mock_coroutine=false;queued=NULL;thread_idx=0;thread_idx_max=1;
    fifo_configuration=0;fifo_policy_state=0;fifo_rejection_bits=0;
    fifo_faulted=fifo_worker_started=fifo_install_eligible=false;fifo_since_soft=0;
    instance_budget=12000;instances_global=0;instances_begin=instances_end=0;
    instance_pending_gc=instance_done_gc=0;removed=0;
#if FIFO_DIAGNOSTIC
    memset(fifo_counts,0,sizeof(fifo_counts));fifo_saturated=false;
    fifo_owner=NULL;fifo_owner_eligible=false;
    memset(fifo_words,0,sizeof(fifo_words));fifo_words[0]=FIFO_MAGIC;fifo_words[1]=FIFO_ABI;fifo_words[14]=1;
#endif
    assert(defuss_fifo_configure(enabled)==0);
    fifo_lock(&fifo_configuration,fifo_load,fifo_cas);
    fifo_worker_init(&cpu0);
    for(unsigned i=0;i<live;i++) { add_instance((void*)(uintptr_t)(i+1),&tbs[i]);instances_global++; }
    fifo_since_soft=FIFO_BATCH;removed=0;
}
static void test_soft_and_completed_only(void)
{
    reset(9000,true);fifo_before_reserve(&cpu0);
    assert(removed==256 && instances_global==9000 && fifo_live()==8744);
    assert(instance_pending_gc==256 && instance_done_gc==0 && fifo_since_soft==0);
    assert(defuss_fifo_state()==3 && defuss_fifo_rejections()==0);
    for(unsigned i=0;i<256;i++)assert(instances[i].tb_ptr==NULL);
    for(unsigned i=256;i<9000;i++)assert(instances[i].tb_ptr==&tbs[i]);
    for(unsigned i=0;i<300;i++)fifo_before_reserve(&cpu0);
    assert(removed==256 && instances_global==9000);
    instance_done_gc=100;fifo_before_reserve(&cpu0);
    assert(instances_global==8900 && instance_pending_gc==156 && instance_done_gc==0);
    instance_done_gc=156;fifo_before_reserve(&cpu0);
    assert(instances_global==8744 && instance_pending_gc==0 && removed==256);
    assert(fifo_accounting_valid(instances_global,fifo_live(),instance_pending_gc,instance_done_gc));
    assert(get_instance_from_tb(&tbs[0])==0 && tbs[0].counter==1500 && !tbs[0].info);
    assert(get_instance_from_tb(&tbs[256])==(void*)(uintptr_t)257);
}
static void test_boundaries_and_fallback(void)
{
    reset(8999,true);assert(fifo_reserve_instance(&cpu0));assert(!removed&&instances_global==9000);
    add_instance((void*)(uintptr_t)12001,&tbs[12000]);fifo_before_reserve(&cpu0);assert(removed==256);
    reset(9000,true);fifo_since_soft=255;fifo_before_reserve(&cpu0);assert(!removed);
    fifo_installed();assert(fifo_since_soft==256);fifo_before_reserve(&cpu0);assert(removed==256);
    reset(12000,true);assert(!fifo_reserve_instance(&cpu0));assert(!removed);
    remove_old_instances();assert(removed==6000 && instances_global==12000 && instance_pending_gc==6000);
    assert(!reserve_instance());remove_old_instances();assert(removed==6000);
    instance_done_gc=6000;check_gc_completion();assert(instances_global==6000 && instance_pending_gc==0);
    assert(reserve_instance());assert(instances_global==6001);
    reset(12000,false);assert(!fifo_reserve_instance(&cpu0));remove_old_instances();
    assert(removed==6000 && instances_global==12000 && defuss_fifo_state()==0);
    instance_done_gc=10;fifo_before_reserve(&cpu0);assert(instance_done_gc==10 && instances_global==12000);
}
static void test_eligibility_and_fault(void)
{
    reset(9000,true);mock_normal=false;fifo_since_soft=0;fifo_before_reserve(&cpu0);fifo_installed();
    assert(!removed&&fifo_since_soft==0&&defuss_fifo_rejections()==(1u<<13));
    /* A resumed normal entry may proceed, but latched rejection stays visible. */
    mock_normal=true;fifo_since_soft=256;fifo_before_reserve(&cpu0);assert(removed==256 && defuss_fifo_state()==11);
    reset(9000,true);cpu0.next=&cpu1;fifo_before_reserve(&cpu0);assert(!removed && (defuss_fifo_rejections()&(1u<<3)));
    reset(9000,true);machine.smp.max_cpus=2;fifo_before_reserve(&cpu0);assert(!removed);
    reset(9000,true);machine.acpi_dev=&machine;fifo_before_reserve(&cpu0);assert(!removed);
    reset(9000,true);mock_coroutine=true;fifo_before_reserve(&cpu0);assert(!removed);
    reset(9000,true);thread_idx_max=2;fifo_before_reserve(&cpu0);assert(!removed);
    reset(9000,true);mock_dynamic=false;fifo_before_reserve(&cpu0);assert(!removed);
    reset(9000,true);instances_global--;fifo_before_reserve(&cpu0);
    assert(fifo_faulted && !removed && defuss_fifo_state()==14 && defuss_fifo_rejections()==(1u<<15));
    instances_global++;fifo_before_reserve(&cpu0);assert(!removed); /* Permanent fail closed. */
    assert(!fifo_accounting_valid(9000,9000,-1,0));
    assert(!fifo_accounting_valid(9000,8744,256,257));
    assert(!fifo_accounting_valid(12001,12001,0,0));
}
static void test_ring_wrap(void)
{
    reset(9000,true);instances_begin=11000;instances_end=(11000+9000)%INSTANCES_BUF_MAX;
    for(unsigned i=0;i<INSTANCES_BUF_MAX;i++){instances[i].tb_func=(void*)(uintptr_t)(i+1);instances[i].tb_ptr=&tbs[i];}
    fifo_before_reserve(&cpu0);assert(removed==256 && instances_begin==11256 && fifo_live()==8744);
    reset(9000,true);instances_begin=11900;instances_end=(11900+9000)%INSTANCES_BUF_MAX;
    for(unsigned i=0;i<INSTANCES_BUF_MAX;i++){instances[i].tb_func=(void*)(uintptr_t)(i+1);instances[i].tb_ptr=&tbs[i];}
    fifo_before_reserve(&cpu0);assert(instances_begin==155 && fifo_live()==8744);
}
static atomic_bool race_start;
static void *choose(void *unused) { (void)unused;while(!atomic_load(&race_start)){};defuss_fifo_configure(1);return NULL; }
static void *lock_config(void *unused) { (void)unused;while(!atomic_load(&race_start)){};fifo_lock(&fifo_configuration,fifo_load,fifo_cas);return NULL; }
static void test_configuration_race(void)
{
    for(unsigned i=0;i<128;i++) {
        pthread_t a,b;fifo_configuration=0;atomic_store(&race_start,false);
        assert(!pthread_create(&a,NULL,choose,NULL));assert(!pthread_create(&b,NULL,lock_config,NULL));
        atomic_store(&race_start,true);pthread_join(a,NULL);pthread_join(b,NULL);
        unsigned s=defuss_fifo_status();assert(s==2 || s==7);
        assert(defuss_fifo_configure(0)==-1 && defuss_fifo_configure(1)==-1 && defuss_fifo_status()==s);
    }
    fifo_configuration=0;assert(defuss_fifo_configure(2)==-1 && defuss_fifo_status()==0);
}
static void test_snapshot(void)
{
#if FIFO_DIAGNOSTIC
    reset(9000,true);fifo_before_reserve(&cpu0);instance_done_gc=17;
    assert(cpu0.refs==1);assert(defuss_fifo_request(1)==0 && cpu0.refs==2);
    assert(defuss_fifo_request(2)==-1 && fifo_words[3]==0);
    deliver();assert(cpu0.refs==1 && fifo_words[3]==1 && (int32_t)fifo_words[4]==0);
    assert(fifo_words[8]==9000 && fifo_words[9]==8744 && fifo_words[10]==256 && fifo_words[11]==17);
    assert(fifo_words[40]==1 && fifo_words[41]==0 && instance_done_gc==17 && removed==256);
    assert(defuss_fifo_request(1)==-1 && defuss_fifo_request(0)==-1);
    assert(defuss_fifo_request(2)==0);cpu0.running=true;deliver();assert((int32_t)fifo_words[4]==-2);
    cpu0.running=false;assert(defuss_fifo_request(3)==0);mock_self=false;deliver();
    assert((int32_t)fifo_words[4]==-2 && (fifo_words[41]&(1u<<12)));
    mock_self=true;assert(defuss_fifo_request(4)==0);instance_done_gc=257;deliver();
    assert((int32_t)fifo_words[4]==-3 && instances_global==9000);
    reset(9000,false);assert(defuss_fifo_request(1)==0);deliver();
    assert((int32_t)fifo_words[4]==0 && fifo_words[40]==0 && fifo_words[41]==(1u<<14));
    fifo_owner_eligible=false;assert(defuss_fifo_request(2)==-2);
    fifo_owner_eligible=true;thread_idx_max=2;assert(defuss_fifo_request(2)==-2);
    thread_idx_max=1;mock_paused=false;assert(defuss_fifo_request(2)==-1);
    mock_paused=true;fifo_words[2]=fifo_words[3]=UINT32_MAX;assert(defuss_fifo_request(1)==-1);
    bool saturated=false;assert(fifo_add_saturated(UINT32_MAX-1,2,&saturated)==UINT32_MAX && saturated);
#else
    assert(defuss_fifo_data()==0 && defuss_fifo_request(1)==-1);
#endif
}
int main(void)
{
    test_soft_and_completed_only();test_boundaries_and_fallback();
    test_eligibility_and_fault();test_ring_wrap();test_configuration_race();test_snapshot();
    printf("native contract groups passed: 6; diagnostic=%d; guest execution=false\n",FIFO_DIAGNOSTIC);
    return 0;
}
