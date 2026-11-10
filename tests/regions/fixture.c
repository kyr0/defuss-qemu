#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <fcntl.h>
#include <termios.h>
#include <unistd.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/time.h>
#include <ucontext.h>

struct state { uint32_t value,before_add; uint64_t flags; uint32_t lanes[4]; };
extern void region_state(uint32_t,uint32_t,struct state *);
extern void region_load(void *,uint64_t *),region_store(void *,uint64_t *);
extern char region_load_fault,region_load_after,region_store_fault,region_store_after;
extern uint32_t region_loop(uint32_t,uint32_t);
extern char region_loop_start,region_loop_end;
extern int region_suspend(int);
extern char region_state_end,region_store_end,region_suspend_end;
static int gate_fd=-1;
static volatile sig_atomic_t faults,interrupts,loop_interrupts;
static volatile uintptr_t wanted_fault,wanted_after,wanted_address;
static volatile uint64_t *fault_state;
static uint64_t seed=UINT64_C(0x987654321acbd001),checks;
static void fail(const char *message){fprintf(stderr,"REGION_FAIL:%s errno=%d\n",message,errno);fflush(stderr);exit(1);}
static void require(int ok,const char *why){checks++;if(!ok)fail(why);}
static uint32_t random32(void){seed^=seed<<13;seed^=seed>>7;seed^=seed<<17;return (uint32_t)seed;}
static void open_gate(void){
 gate_fd=open("/dev/ttyS0",O_RDWR|O_NOCTTY);if(gate_fd<0)fail("COM1 open");
 struct termios t;if(tcgetattr(gate_fd,&t))fail("COM1 attrs");cfmakeraw(&t);t.c_cflag|=CLOCAL|CREAD;t.c_cc[VMIN]=1;t.c_cc[VTIME]=0;
 if(cfsetispeed(&t,B115200)||cfsetospeed(&t,B115200)||tcsetattr(gate_fd,TCSANOW,&t))fail("COM1 configure");
}
static void gate(int stage){
 printf("REGION_GATE:%d\n",stage);fflush(stdout);
 if(write(gate_fd,"G",1)!=1||tcdrain(gate_fd))fail("COM1 signal");
 if(!region_suspend(gate_fd))fail("blocked syscall register/ACK preservation");
}
static void reset_suspend_watch(void){
 /* The reset gate must not call region_suspend: any selected entry after this
  * ACK then belongs to the final checked call, not the warmup/reset itself. */
 printf("REGION_GATE:13\n");fflush(stdout);
 if(write(gate_fd,"G",1)!=1||tcdrain(gate_fd))fail("COM1 reset signal");
 char ack=0;if(read(gate_fd,&ack,1)!=1||ack!='K')fail("COM1 reset ACK");
}
static void result(int stage,const char *name){printf("REGION_RESULT:{\"stage\":%d,\"name\":\"%s\",\"checks\":%llu}\n",stage,name,(unsigned long long)checks);fflush(stdout);gate(stage);}
static void fault_handler(int sig,siginfo_t *info,void *opaque){
 ucontext_t *u=opaque;greg_t *g=u->uc_mcontext.gregs;
 static const int indices[16]={REG_RAX,REG_RBX,REG_RCX,REG_RDX,REG_RSI,REG_RDI,REG_RBP,REG_RSP,REG_R8,REG_R9,REG_R10,REG_R11,REG_R12,REG_R13,REG_R14,REG_R15};
 int registers_ok=fault_state!=NULL;
 if(registers_ok)for(unsigned i=0;i<16;i++)if((uint64_t)g[indices[i]]!=fault_state[3+i])registers_ok=0;
 if(sig!=SIGSEGV||(uintptr_t)g[REG_RIP]!=wanted_fault||(uintptr_t)info->si_addr!=wanted_address||
    (uint64_t)g[REG_RAX]!=UINT64_C(0x0123456789abcdef)||(uint64_t)g[REG_R10]!=UINT64_C(0xfedcba9876543210)||
    (g[REG_EFL]&0x8c5)!=0x44||!registers_ok||fault_state[0]!=1||fault_state[1]!=0){
   const char message[]="REGION_FAIL:precise-fault-state\n";write(2,message,sizeof(message)-1);_exit(1);
 }
 faults++;g[REG_RIP]=wanted_after;
}
static void timer_handler(int sig,siginfo_t *info,void *opaque){
 (void)sig;(void)info;ucontext_t *u=opaque;uintptr_t pc=u->uc_mcontext.gregs[REG_RIP];interrupts++;
 if(pc>=(uintptr_t)&region_loop_start&&pc<(uintptr_t)&region_loop_end)loop_interrupts++;
}
static void state_case(uint32_t a,uint32_t b){
 struct state out;
  uint32_t mul=(a^b)*UINT32_C(1664525),value=mul+UINT32_C(1013904223);
  region_state(a,b,&out);
  uint64_t flags=0;uint32_t c=UINT32_C(1013904223);
  if((uint64_t)mul+c>UINT32_MAX)flags|=1;
  if(!__builtin_parity(value&255))flags|=4;
  if((mul^c^value)&16)flags|=16;
  if(!value)flags|=64;
  if(value>>31)flags|=128;
  if((~(mul^c)&(mul^value))>>31)flags|=2048;
  require(out.value==value&&out.before_add==mul,"arithmetic");
  require((out.flags&0x8d5)==flags,"arithmetic flags");
  for(unsigned lane=0;lane<4;lane++)require(out.lanes[lane]==value,"SIMD result");
}
static void state_cases(void){
 for(unsigned i=0;i<30000+4096;i++)state_case(random32(),random32());
 result(0,"state-flags-simd");
 /* The host injects exactly one stopped diagnostic mutation after each of
  * these preceding gates in enabled mode. Both modes execute identical data. */
 for(unsigned i=0;i<64;i++)state_case(UINT32_C(0x12345678)^i,UINT32_C(0xfedcba98)+i);
 result(5,"state-after-stale-instance-gate");
 for(unsigned i=0;i<64;i++)state_case(UINT32_C(0x87654321)+i,UINT32_C(0xabcdef01)^i);
 result(6,"state-after-invalid-descriptor-gate");
 /* Invalid-descriptor recovery discards the old TB. First check 64 immediate
  * resumed calls above, then warm the ordinary cold replacement past 1500. */
 for(unsigned i=0;i<2048;i++)state_case(UINT32_C(0x2468ace0)^i,UINT32_C(0x13579bdf)+i);
 result(7,"state-after-replacement-rewarm");
}
static void one_fault(void (*fn)(void*,uint64_t*),void *address,void *reported,char *at,char *after){
 uint64_t state[19]={0};fault_state=state;wanted_address=(uintptr_t)reported;wanted_fault=(uintptr_t)at;wanted_after=(uintptr_t)after;
 sig_atomic_t before=faults;fn(address,state);
 require(faults==before+1&&state[0]==1&&state[1]==UINT64_C(0xfedcba9876543210),"fault resume committed exactly once");
 fault_state=NULL;
}
static void fault_cases(void){
 const size_t page=4096;uint8_t *memory=mmap(NULL,page*2,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 require(memory!=MAP_FAILED,"map fault fixture");memset(memory,0x5a,page*2);uint64_t state[19]={0};
 for(unsigned i=0;i<30000;i++){region_load(memory,state);region_store(memory,state);}
 gate(11); // Host resets the watched range before any faulting calls.
 require(!mprotect(memory+page,page,PROT_NONE),"protect guard");
 for(unsigned i=0;i<128;i++)one_fault(region_load,memory+page,memory+page,&region_load_fault,&region_load_after);
 gate(14); // Host verifies unmapped-load exposure and resets the load watch.
 for(unsigned i=0;i<128;i++)one_fault(region_load,memory+page-4,memory+page,&region_load_fault,&region_load_after);
 gate(15); // Host verifies cross-page exposure and resets the store watch.
 *(uint64_t*)memory=UINT64_C(0x1111222233334444);
 require(!mprotect(memory,page,PROT_READ),"write-protect");
 for(unsigned i=0;i<128;i++)one_fault(region_store,memory,memory,&region_store_fault,&region_store_after);
 require(*(uint64_t*)memory==UINT64_C(0x1111222233334444),"faulting store has no memory effect");
 require(faults==384,"fault count");require(!munmap(memory,page*2),"unmap faults");result(1,"precise-faults-cross-page");
}
static void smc_cases(void){
 int fd=memfd_create("regions-smc",0);require(fd>=0&&!ftruncate(fd,4096),"SMC backing");
 uint8_t *rw=mmap(NULL,4096,PROT_READ|PROT_WRITE,MAP_SHARED,fd,0);
 uint8_t *rx=mmap(NULL,4096,PROT_READ|PROT_EXEC,MAP_SHARED,fd,0);
 uint8_t *dummy=mmap(NULL,4096,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 require(rw!=MAP_FAILED&&rx!=MAP_FAILED&&dummy!=MAP_FAILED,"SMC aliases");
 printf("REGION_SMC_RANGE:{\"start\":\"0x%llx\",\"end\":\"0x%llx\"}\n",(unsigned long long)(uintptr_t)rx,(unsigned long long)(uintptr_t)(rx+4096));gate(10);
 uint32_t (*simple)(void)=(void*)rx;uint32_t (*active)(void*,uint64_t*)=(void*)(rx+128);
 for(unsigned round=0;round<16;round++){
  uint32_t old=random32(),next=random32();rw[0]=0xb8;memcpy(rw+1,&old,4);rw[5]=0xc3;
  for(unsigned i=0;i<6000;i++)require(simple()==old,"SMC warm old code");
  memcpy(rw+1,&next,4);require(simple()==next,"write through alias invalidates compiled code");
  // A compiled store changes a later instruction of the currently executing TB.
  uint8_t *code=rw+128;memset(code,0x90,38);
  code[0]=0x48;code[1]=0xff;code[2]=0x06; // incq (%rsi): non-idempotent prior store
  code[3]=0xc7;code[4]=0x47;code[5]=33; // movl immediate,33(%rdi)
  memcpy(code+6,&next,4);code[32]=0xb8;memcpy(code+33,&old,4);code[37]=0xc3;
  uint64_t effects=0;
  for(unsigned i=0;i<6000;i++)require(active(dummy,&effects)==old,"active SMC warm");
  require(effects==6000,"active SMC warm side-effect count");
  if(round==0)gate(16); // Host resets the active watch after compiled warmup.
  effects=0;
  require(active(code,&effects)==next,"active TB sees changed later instruction");
  require(effects==1,"active SMC preserves prior non-idempotent store exactly once");
  if(round==0)gate(17); // Only the single mutating call may hit this watch.
 }
 require(!munmap(rw,4096)&&!munmap(rx,4096)&&!munmap(dummy,4096)&&!close(fd),"SMC cleanup");result(2,"alias-and-active-smc");
}
static uint32_t recurrence(uint32_t x,uint32_t n){for(uint32_t i=0;i<n;i++)x=(x^i)*UINT32_C(1664525)+UINT32_C(1013904223);return x;}
static void interrupt_cases(void){
 struct sigaction action={.sa_sigaction=timer_handler,.sa_flags=SA_SIGINFO};sigemptyset(&action.sa_mask);require(!sigaction(SIGALRM,&action,NULL),"timer handler");
 const uint32_t n=1000000,expected=recurrence(123,n);struct itimerval timer={{0,10000},{0,10000}},off={0};
 for(unsigned i=0;i<8;i++)require(region_loop(123,n)==expected,"loop warm oracle");
 gate(12); // Require selected entries during the interrupt phase itself.
 require(!setitimer(ITIMER_REAL,&timer,NULL),"timer start");
 unsigned runs=0;do{require(region_loop(123,n)==expected,"interrupt continuation checksum");runs++;}while(loop_interrupts<3&&runs<128);
 require(!setitimer(ITIMER_REAL,&off,NULL),"timer stop");require(loop_interrupts>=3,"signal must interrupt observed loop PCs");
 printf("REGION_INTERRUPTS:{\"signals\":%d,\"inLoop\":%d,\"runs\":%u}\n",interrupts,loop_interrupts,runs);
 result(3,"interrupt-continuation");
}
int main(void){
 setvbuf(stdout,NULL,_IONBF,0);open_gate();struct sigaction action={.sa_sigaction=fault_handler,.sa_flags=SA_SIGINFO};sigemptyset(&action.sa_mask);
 if(sigaction(SIGSEGV,&action,NULL))fail("fault handler");printf("REGION_LAYOUT:{\"state\":[\"0x%llx\",\"0x%llx\"],\"faultLoad\":[\"0x%llx\",\"0x%llx\"],\"faultStore\":[\"0x%llx\",\"0x%llx\"],\"loop\":[\"0x%llx\",\"0x%llx\"],\"suspend\":[\"0x%llx\",\"0x%llx\"]}\n",(unsigned long long)(uintptr_t)region_state,(unsigned long long)(uintptr_t)&region_state_end,(unsigned long long)(uintptr_t)region_load,(unsigned long long)(uintptr_t)region_store,(unsigned long long)(uintptr_t)region_store,(unsigned long long)(uintptr_t)&region_store_end,(unsigned long long)(uintptr_t)&region_loop_start,(unsigned long long)(uintptr_t)&region_loop_end,(unsigned long long)(uintptr_t)region_suspend,(unsigned long long)(uintptr_t)&region_suspend_end);printf("REGION_START:1\n");gate(-1);
 state_cases();fault_cases();smc_cases();interrupt_cases();
 int pipefd[2];require(!pipe(pipefd),"suspend warm pipe");
 for(unsigned i=0;i<2000;i++){require(write(pipefd[1],"K",1)==1,"suspend warm write");require(region_suspend(pipefd[0]),"suspend warm state");}
 require(!close(pipefd[0])&&!close(pipefd[1]),"suspend warm cleanup");
 reset_suspend_watch();
 volatile uint64_t canary[64];for(unsigned i=0;i<64;i++)canary[i]=UINT64_C(0xcafebabe00000000)+i;
 gate(4);for(unsigned i=0;i<64;i++)require(canary[i]==UINT64_C(0xcafebabe00000000)+i,"suspended stack state");
 printf("REGION_PASS:{\"checks\":%llu,\"faults\":%d,\"stages\":8}\n",(unsigned long long)checks,faults);
 return 0;
}
