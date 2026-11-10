#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

/* GPR order matches the frozen M3a fault-state fixture. RIP/native lazy flags
 * at an internal dispatcher boundary are not observable by this trampoline. */
struct arch_state { uint64_t gpr[16],rflags; };
_Static_assert(sizeof(struct arch_state)==136,"assembly state ABI");
_Static_assert(offsetof(struct arch_state,rflags)==128,"assembly flags ABI");
_Alignas(16) struct arch_state m3b_initial,m3b_observed;
_Alignas(16) uint8_t m3b_fp_before[512],m3b_fp_after[512];
_Alignas(16) static uint8_t guest_stack[32768];
static uint32_t memory_word;
extern void m3b_invoke(const void *entry);
#define SYMBOLS(n) extern const uint8_t n[],n##_b[],n##_back[],n##_side[],n##_end[]
SYMBOLS(m3b_add32);SYMBOLS(m3b_add64);SYMBOLS(m3b_imul64);SYMBOLS(m3b_dynamic);SYMBOLS(m3b_memory);
SYMBOLS(m3b_insns32);SYMBOLS(m3b_insns33);SYMBOLS(m3b_bytes128);SYMBOLS(m3b_bytes129);SYMBOLS(m3b_page_end);SYMBOLS(m3b_page_cross);
enum model { ADD32,ADD64,IMUL64,DYNAMIC,MEMORY };
struct program { const char *name,*expectation;const uint8_t *a,*b,*back,*side,*end;enum model model;unsigned prefix_mov; };
#define PROGRAM(n,e,m,p) {#n,e,n,n##_b,n##_back,n##_side,n##_end,m,p}
static const struct program programs[]={
 PROGRAM(m3b_add32,"fused",ADD32,0),PROGRAM(m3b_add64,"fused",ADD64,0),
 PROGRAM(m3b_imul64,"ir-retry",IMUL64,0),PROGRAM(m3b_dynamic,"ir-retry",DYNAMIC,0),
 PROGRAM(m3b_memory,"predecode-reject",MEMORY,0),
 PROGRAM(m3b_insns32,"fused",ADD32,0),PROGRAM(m3b_insns33,"predecode-reject",ADD32,0),
 PROGRAM(m3b_bytes128,"fused",ADD32,1),PROGRAM(m3b_bytes129,"predecode-reject",ADD32,1),
 PROGRAM(m3b_page_end,"ir-retry",ADD32,0),PROGRAM(m3b_page_cross,"predecode-reject",ADD32,0),
};
static uint64_t seed=UINT64_C(0x4a72db913c60e58f),checks,digest=UINT64_C(0xcbf29ce484222325);
static int gate_fd=-1;static unsigned sequence;
static void fail(const char *why){fprintf(stderr,"M3B_FAIL:%s errno=%d\n",why,errno);fflush(stderr);exit(1);}
static void require(int ok,const char *why){checks++;if(!ok)fail(why);}
static uint64_t random64(void){seed^=seed<<13;seed^=seed>>7;seed^=seed<<17;return seed;}
static void mix(uint64_t value){digest^=value;digest*=UINT64_C(0x100000001b3);}
static void open_gate(void){
 gate_fd=open("/dev/ttyS0",O_RDWR|O_NOCTTY);if(gate_fd<0)fail("COM1 open");
 struct termios t;if(tcgetattr(gate_fd,&t))fail("COM1 attrs");cfmakeraw(&t);t.c_cflag|=CLOCAL|CREAD;t.c_cc[VMIN]=1;t.c_cc[VTIME]=0;
 if(cfsetispeed(&t,B115200)||cfsetospeed(&t,B115200)||tcsetattr(gate_fd,TCSANOW,&t))fail("COM1 setup");
}
static void gate(int program,const char *phase,unsigned calls,unsigned bodies){
 printf("M3B_GATE:{\"seq\":%u,\"program\":%d,\"phase\":\"%s\",\"calls\":%u,\"bodies\":%u,\"checks\":%"PRIu64",\"digest\":\"%016"PRIx64"\"}\n",sequence++,program,phase,calls,bodies,checks,digest);
 if(write(gate_fd,"G",1)!=1||tcdrain(gate_fd))fail("COM1 signal");
 char ack=0;if(read(gate_fd,&ack,1)!=1||ack!='K')fail("COM1 ACK");
}
static int legacy_fp_equal(void){
 /* FXSAVE reserved bytes are not architectural state. Compare FCW/FSW/FTW,
  * defined FOP bits,64-bit pointers,MXCSR/mask,80-bit x87 slots and all XMMs. */
 if(memcmp(m3b_fp_before,m3b_fp_after,5))return 0;
 unsigned before=m3b_fp_before[6]|((unsigned)m3b_fp_before[7]<<8);
 unsigned after=m3b_fp_after[6]|((unsigned)m3b_fp_after[7]<<8);
 if((before&0x7ff)!=(after&0x7ff)||memcmp(m3b_fp_before+8,m3b_fp_after+8,24))return 0;
 for(unsigned i=0;i<8;i++)if(memcmp(m3b_fp_before+32+i*16,m3b_fp_after+32+i*16,10))return 0;
 return !memcmp(m3b_fp_before+160,m3b_fp_after+160,256);
}
static void check_case(const struct program *p,unsigned count,int direct_b){
 for(unsigned i=0;i<16;i++)m3b_initial.gpr[i]=random64();
 /* No body touches RSP. Reserve ample mapped stack for interrupt delivery and
  * the capture PUSHF; this is separate from the saved C caller stack. */
 m3b_initial.gpr[7]=(uintptr_t)(guest_stack+sizeof(guest_stack)-256);
 m3b_initial.rflags=UINT64_C(0x202)|(random64()&UINT64_C(0x8d5));
 if(p->model==ADD64||p->model==IMUL64)m3b_initial.gpr[9]=count;
 else m3b_initial.gpr[2]=(random64()&UINT64_C(0xffffffff00000000))|count;
 if(p->model==DYNAMIC)m3b_initial.rflags=(m3b_initial.rflags&~UINT64_C(64))|(count?0:64);
 if(p->model==MEMORY)m3b_initial.gpr[4]=(uintptr_t)&memory_word;
 memory_word=(uint32_t)random64();uint32_t expected_memory=memory_word;
 struct arch_state expected=m3b_initial;
 for(unsigned i=0;i<count;i++){
  if(p->model==ADD64)expected.gpr[10]=(expected.gpr[10]^expected.gpr[13])+UINT64_C(17);
  else if(p->model==IMUL64)expected.gpr[10]=expected.gpr[10]*UINT64_C(0xfffffffffffffff9)+UINT64_C(17);
  else if(p->model==MEMORY)expected_memory+=7;
  else expected.gpr[0]=(uint32_t)(((uint32_t)expected.gpr[0]+UINT32_C(53))^(uint32_t)expected.gpr[3]);
 }
 if(count){if(p->model==ADD64||p->model==IMUL64)expected.gpr[9]=0;else expected.gpr[2]=0;}
 if(p->prefix_mov)expected.gpr[8]=UINT64_C(0x7139ac4e0528b6df);
 /* CMP0 at the final side exit, or final SUB1 for dynamic-entry flags, sets
  * all six defined status bits to PF|ZF. A skipped dynamic body preserves its
  * deliberately seeded full RFLAGS. All other user bits were fixed above. */
 if(p->model!=DYNAMIC||count)expected.rflags=UINT64_C(0x246);
 require(!direct_b||count>0,"direct B bounded count");
 memset(&m3b_observed,0xa5,sizeof(m3b_observed));memset(m3b_fp_before,0,sizeof(m3b_fp_before));memset(m3b_fp_after,0,sizeof(m3b_fp_after));
 m3b_invoke(direct_b?p->b:p->a);
 for(unsigned i=0;i<16;i++)require(m3b_observed.gpr[i]==expected.gpr[i],"complete GPR state");
 require(m3b_observed.rflags==expected.rflags,"full seeded user RFLAGS");
 require(legacy_fp_equal(),"defined legacy FP/SSE state preserved");
 require(memory_word==expected_memory,"memory fallback side effects exactly once");
 /* Digest excludes addresses/RSP and opaque FP state, while checks above
  * still compare them within each invocation. It is reproducible off/on. */
 for(unsigned i=0;i<16;i++)if(i!=7&&!(p->model==MEMORY&&i==4))mix(m3b_observed.gpr[i]);
 mix(m3b_observed.rflags);mix(memory_word);
}
static void layout(void){
 printf("M3B_LAYOUT:{\"schema\":1,\"programs\":[");
 for(unsigned i=0;i<sizeof(programs)/sizeof(programs[0]);i++){
  const struct program *p=&programs[i];size_t bytes=(size_t)((uintptr_t)p->side-(uintptr_t)p->a);
  printf("%s{\"name\":\"%s\",\"expectation\":\"%s\",\"a\":\"0x%"PRIxPTR"\",\"b\":\"0x%"PRIxPTR"\",\"back\":\"0x%"PRIxPTR"\",\"side\":\"0x%"PRIxPTR"\",\"end\":\"0x%"PRIxPTR"\",\"ownerBytes\":%zu,\"codeHex\":\"",i?",":"",p->name,p->expectation,(uintptr_t)p->a,(uintptr_t)p->b,(uintptr_t)p->back,(uintptr_t)p->side,(uintptr_t)p->end,bytes);
  for(size_t n=0;n<bytes;n++){printf("%02x",p->a[n]);}printf("\"}");
 }
 printf("]}\n");
 require((uintptr_t)m3b_bytes128_side-(uintptr_t)m3b_bytes128==128,"exact128-byte layout");
 require((uintptr_t)m3b_bytes129_side-(uintptr_t)m3b_bytes129==129,"exact129-byte layout");
 require(((uintptr_t)m3b_page_end_side&4095)==0,"owner ends at page boundary");
 require(((uintptr_t)m3b_page_cross>>12)!=(((uintptr_t)m3b_page_cross_side-1)>>12),"owner crosses page boundary");
}
int main(void){
 setvbuf(stdout,NULL,_IONBF,0);open_gate();layout();gate(-1,"layout",0,0);
 for(unsigned i=0;i<sizeof(programs)/sizeof(programs[0]);i++){
  const struct program *p=&programs[i];
  /* Host configures exact A and B watches at layout/the preceding direct-B
   * gate, then resets after each gate. Warmup is identical in both modes. */
  for(unsigned j=0;j<2048;j++){check_case(p,4,0);check_case(p,4,1);}gate(i,"warm",4096,16384);
  for(unsigned j=0;j<64;j++){check_case(p,0,0);}gate(i,"side",64,0);
  unsigned bodies=0;for(unsigned j=0;j<64;j++){unsigned n=1+(j%17);check_case(p,n,0);bodies+=n;}gate(i,"body",64,bodies);
  bodies=0;for(unsigned j=0;j<64;j++){unsigned n=1+(j%17);check_case(p,n,1);bodies+=n;}gate(i,"direct-b",64,bodies);
 }
 printf("M3B_PASS:{\"schema\":1,\"programs\":%zu,\"gates\":%u,\"checks\":%"PRIu64",\"digest\":\"%016"PRIx64"\"}\n",sizeof(programs)/sizeof(programs[0]),sequence,checks,digest);
 char final_ack=0;(void)read(gate_fd,&final_ack,1);fail("Unexpected final ACK/read return");
 return 1;
}
