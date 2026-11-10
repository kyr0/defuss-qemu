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

/* Untested source draft. One fixed image/input stream for OFF and ON. */
struct arch_state { uint64_t gpr[16],rflags; };
_Static_assert(sizeof(struct arch_state)==136,"assembly state ABI");
_Static_assert(offsetof(struct arch_state,rflags)==128,"assembly flags ABI");
_Alignas(16) struct arch_state mbnd_initial,mbnd_observed;
_Alignas(16) uint8_t mbnd_fp_before[512],mbnd_fp_after[512];
_Alignas(16) static uint8_t guest_stack[32768];
static volatile uint64_t prior_effects;
extern void mbnd_invoke(const void *entry);
#define SYMBOLS(n) extern const uint8_t n[],n##_b[],n##_back[],n##_side[],n##_end[]
SYMBOLS(mbnd_add32);SYMBOLS(mbnd_add64);
struct program { const char *name;const uint8_t *a,*b,*back,*side,*end;unsigned width; };
#define PROGRAM(n,w) {#n,n,n##_b,n##_back,n##_side,n##_end,w}
static const struct program programs[]={PROGRAM(mbnd_add32,32),PROGRAM(mbnd_add64,64)};
static uint64_t seed=UINT64_C(0x6c7e9241a5d038bf),checks,digest=UINT64_C(0xcbf29ce484222325);
static int gate_fd=-1;static unsigned sequence;
static void fail(const char *why){fprintf(stderr,"MBND_FAIL:%s errno=%d\n",why,errno);fflush(stderr);exit(1);}
static void require(int ok,const char *why){checks++;if(!ok)fail(why);}
static uint64_t random64(void){seed^=seed<<13;seed^=seed>>7;seed^=seed<<17;return seed;}
static void mix(uint64_t value){digest^=value;digest*=UINT64_C(0x100000001b3);}
static void open_gate(void){
 gate_fd=open("/dev/ttyS0",O_RDWR|O_NOCTTY);if(gate_fd<0)fail("COM1 open");
 struct termios t;if(tcgetattr(gate_fd,&t))fail("COM1 attrs");cfmakeraw(&t);t.c_cflag|=CLOCAL|CREAD;t.c_cc[VMIN]=1;t.c_cc[VTIME]=0;
 if(cfsetispeed(&t,B115200)||cfsetospeed(&t,B115200)||tcsetattr(gate_fd,TCSANOW,&t))fail("COM1 setup");
}
static void gate(int program,const char *phase,unsigned request,unsigned mode,unsigned calls,unsigned bodies){
 printf("MBND_GATE:{\"seq\":%u,\"program\":%d,\"phase\":\"%s\",\"request\":%u,\"mode\":%u,\"calls\":%u,\"bodies\":%u,\"checks\":%"PRIu64",\"digest\":\"%016"PRIx64"\"}\n",sequence++,program,phase,request,mode,calls,bodies,checks,digest);
 if(write(gate_fd,"G",1)!=1||tcdrain(gate_fd))fail("COM1 signal");
 char ack=0;if(read(gate_fd,&ack,1)!=1||ack!='K')fail("COM1 ACK");
}
static int legacy_fp_equal(void){
 if(memcmp(mbnd_fp_before,mbnd_fp_after,5))return 0;
 unsigned before=mbnd_fp_before[6]|((unsigned)mbnd_fp_before[7]<<8);
 unsigned after=mbnd_fp_after[6]|((unsigned)mbnd_fp_after[7]<<8);
 if((before&0x7ff)!=(after&0x7ff)||memcmp(mbnd_fp_before+8,mbnd_fp_after+8,24))return 0;
 for(unsigned i=0;i<8;i++)if(memcmp(mbnd_fp_before+32+i*16,mbnd_fp_after+32+i*16,10))return 0;
 return !memcmp(mbnd_fp_before+160,mbnd_fp_after+160,256);
}
static void prepare_case(const struct program *p,unsigned count){
 for(unsigned i=0;i<16;i++)mbnd_initial.gpr[i]=random64();
 mbnd_initial.gpr[7]=(uintptr_t)(guest_stack+sizeof(guest_stack)-256);
 mbnd_initial.rflags=UINT64_C(0x202)|(random64()&UINT64_C(0x8d5));
 if(p->width==64)mbnd_initial.gpr[9]=count;
 else mbnd_initial.gpr[2]=(random64()&UINT64_C(0xffffffff00000000))|count;
}
static void print_state(const struct arch_state *s){
 printf("{\"gpr\":[");for(unsigned i=0;i<16;i++)printf("%s\"%016"PRIx64"\"",i?",":"",s->gpr[i]);
 printf("],\"rflags\":\"%016"PRIx64"\"}",s->rflags);
}
static void execute_case(const struct program *p,unsigned count,int direct_b){
 struct arch_state expected=mbnd_initial;
 for(unsigned i=0;i<count;i++){
  if(p->width==64)expected.gpr[10]=(expected.gpr[10]^expected.gpr[13])+UINT64_C(17);
  else expected.gpr[0]=(uint32_t)(((uint32_t)expected.gpr[0]+UINT32_C(53))^(uint32_t)expected.gpr[3]);
 }
 expected.gpr[p->width==64?9:2]=0;expected.rflags=UINT64_C(0x246);
 require(count>0,"nonzero bounded body count");
 memset(&mbnd_observed,0xa5,sizeof(mbnd_observed));memset(mbnd_fp_before,0,sizeof(mbnd_fp_before));memset(mbnd_fp_after,0,sizeof(mbnd_fp_after));
 uint64_t previous=prior_effects;prior_effects=previous+1;
 mbnd_invoke(direct_b?p->b:p->a);
 for(unsigned i=0;i<16;i++)require(mbnd_observed.gpr[i]==expected.gpr[i],"complete GPR state");
 require(mbnd_observed.rflags==expected.rflags,"full seeded user RFLAGS");
 require(legacy_fp_equal(),"defined legacy FP/SSE preservation");
 require(prior_effects==previous+1,"prior side effect once");
 for(unsigned i=0;i<16;i++)if(i!=7)mix(mbnd_observed.gpr[i]);mix(mbnd_observed.rflags);mix(prior_effects);
}
static void layout(void){
 printf("MBND_LAYOUT:{\"schema\":1,\"stackPointer\":\"0x%"PRIxPTR"\",\"programs\":[",(uintptr_t)(guest_stack+sizeof(guest_stack)-256));
 for(unsigned i=0;i<2;i++){
  const struct program *p=&programs[i];size_t bytes=(size_t)((uintptr_t)p->side-(uintptr_t)p->a);
  printf("%s{\"name\":\"%s\",\"width\":%u,\"a\":\"0x%"PRIxPTR"\",\"b\":\"0x%"PRIxPTR"\",\"back\":\"0x%"PRIxPTR"\",\"side\":\"0x%"PRIxPTR"\",\"end\":\"0x%"PRIxPTR"\",\"ownerBytes\":%zu,\"codeHex\":\"",i?",":"",p->name,p->width,(uintptr_t)p->a,(uintptr_t)p->b,(uintptr_t)p->back,(uintptr_t)p->side,(uintptr_t)p->end,bytes);
  for(size_t n=0;n<bytes;n++)printf("%02x",p->a[n]);printf("\"}");
  require(bytes<=128&&((uintptr_t)p->a>>12)==(((uintptr_t)p->side-1)>>12),"single-page bounded owner");
 }
 printf("]}\n");require(((uintptr_t)(guest_stack+sizeof(guest_stack)-256)&15)==0,"aligned mapped stack");
}
int main(void){
 setvbuf(stdout,NULL,_IONBF,0);open_gate();layout();gate(-1,"layout",0,0,0,0);
 for(unsigned program=0;program<2;program++){
  const struct program *p=&programs[program];
  for(unsigned i=0;i<2048;i++){prepare_case(p,4);execute_case(p,4,0);prepare_case(p,4);execute_case(p,4,1);}gate(program,"warm",0,0,4096,16384);
  for(unsigned mode=1;mode<=2;mode++){
   unsigned request=program*2+mode,count=mode==1?3:5;prepare_case(p,count);
   printf("MBND_INPUT:{\"request\":%u,\"program\":%u,\"mode\":%u,\"count\":%u,\"priorBefore\":%"PRIu64",\"initial\":",request,program,mode,count,prior_effects);print_state(&mbnd_initial);printf("}\n");
   gate(program,"before",request,mode,0,0);
   uint64_t previous=prior_effects;execute_case(p,count,0);
   printf("MBND_RESULT:{\"request\":%u,\"priorBefore\":%"PRIu64",\"priorAfter\":%"PRIu64",\"observed\":",request,previous,prior_effects);print_state(&mbnd_observed);printf("}\n");
   gate(program,"after",request,mode,1,count);
  }
 }
 printf("MBND_PASS:{\"schema\":1,\"programs\":2,\"probes\":4,\"gates\":%u,\"calls\":%"PRIu64",\"checks\":%"PRIu64",\"digest\":\"%016"PRIx64"\"}\n",sequence,prior_effects,checks,digest);
 char final_ack=0;(void)read(gate_fd,&final_ack,1);fail("Unexpected final ACK/read return");return 1;
}
