/* Host-model tests only; native QEMU layout is validated by the later SDK build. */
#include <assert.h>
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <pthread.h>
#include "../../artifacts/m3b-context-v2-source-01/source/tcg/m3-region-core.h"
#define TARGET_X86_64
#define EMSCRIPTEN_KEEPALIVE
#define qatomic_read(p) (*(p))
#define qatomic_store_release(p,v) (*(p)=(v))
enum { R_EAX,R_ECX,R_EDX,R_EBX,R_ESP,R_EBP,R_ESI,R_EDI };
enum { M3B_B_ATTEMPTS=22,M3B_B_REQUESTED=23,M3B_SERVICE_PAID=24 };
typedef struct { uint32_t selector;uint64_t base;uint32_t limit,flags; } SegmentCache;
typedef struct {
 uint64_t regs[16],eip,eflags,cc_src,cc_dst,cc_src2,cr[5],efer;
 uint32_t cc_op,df,hflags,hflags2,mxcsr,fpuc,fpus,fpstt,m3b_service_debt;
 uint8_t fptags[8];SegmentCache segs[6],ldt,tr;
} CPUArchState;
struct WasmTBHeader { struct {unsigned fused;} m3b;struct m3_descriptor m3; };
static uint32_t m3b_words[128];static unsigned instances_global=12000;static bool enabled=true;
static bool defuss_m3b_profile_enabled(void){return enabled;}
#include "observer.inc"
static void reset(void){memset(m3s_words+5,0,(M3S_WORDS-5)*4);m3s_words[14]=64;memset(m3b_words,0,sizeof(m3b_words));}
static struct WasmTBHeader owner(void){return (struct WasmTBHeader){.m3b.fused=1,.m3={.magic=M3_MAGIC,.version=M3_VERSION,.valid=1,.generation=123,.owner=0x123456,.members=1,.recovery=M3_RECOVERY_TCI_SEARCH}};}
static CPUArchState env(void){CPUArchState e={0};for(unsigned i=0;i<16;i++)e.regs[i]=UINT64_C(0x1122334455667788)+i;e.eip=0x401005;e.cc_src=0x789;e.cc_dst=0x456;e.cc_op=3;e.df=1;e.m3b_service_debt=1;e.fptags[0]=1;e.segs[3].base=0x12340000;return e;}
static void events(CPUArchState *e,unsigned token){
 uint32_t *w=m3s_words+64+(token-1)*640;unsigned debt=e->m3b_service_debt;e->m3b_service_debt=0;m3b_words[22]++;m3b_words[24]++;m3b_words[23]+=debt==2;
 for(unsigned i=0;i<4;i++){uint32_t *v=w+288+i*64;v[0]=i+1;v[1]=(unsigned[]){0,1,0,2}[i];v[2]=(unsigned[]){1,0,2,0}[i];v[3]=1;v[4]=w[4];v[5]=w[5];v[7]=m3b_words[22];v[8]=m3b_words[24];v[9]=m3b_words[23];v[11]=token;}
 w[18]=4;
}
int main(void){
 struct WasmTBHeader h=owner();unsigned success=0,corruptions=0;
 for(unsigned debt=1;debt<=2;debt++)for(unsigned compiled=0;compiled<2;compiled++){
  reset();CPUArchState e=env();e.m3b_service_debt=debt;CPUArchState before=e;unsigned t=m3s_before(&e,&h,0x401000,compiled);assert(t==1 && m3s_words[6]==1 && !memcmp(&before,&e,sizeof(e)));events(&e,t);m3s_after(&e,t);assert(m3s_words[6]==0&&m3s_words[9]==1&&!m3s_words[7]&&m3s_words[65]==2);success++;
 }
 for(unsigned bad=0;bad<8;bad++){
  reset();CPUArchState e=env();unsigned t=m3s_before(&e,&h,0x401000,true);events(&e,t);uint32_t *w=m3s_words+64;
  switch(bad){case 0:e.regs[13]^=1;break;case 1:e.m3b_service_debt=1;break;case 2:m3b_words[24]++;break;case 3:w[18]=3;break;case 4:w[288+4]^=1;break;case 5:w[288+6]=1;break;case 6:w[288+2]=2;break;case 7:w[288+11]=2;break;}
  m3s_after(&e,t);assert(m3s_words[7]&&w[1]==3&&!m3s_words[9]);corruptions++;
 }
 reset();CPUArchState e=env();enabled=false;assert(!m3s_before(&e,&h,0x401000,true)&&!m3s_words[5]);enabled=true;e.m3b_service_debt=0;assert(!m3s_before(&e,&h,0x401000,true)&&!m3s_words[5]);
 reset();for(unsigned i=0;i<4;i++){e=env();unsigned t=m3s_before(&e,&h,0x401000,true);assert(t==i+1);events(&e,t);m3s_after(&e,t);}e=env();assert(!m3s_before(&e,&h,0x401000,true)&&m3s_words[5]==4&&m3s_words[8]==1);
 reset();e=env();h.m3b.fused=0;assert(!m3s_before(&e,&h,0x401000,true)&&m3s_words[7]==2);
 printf("{\"successfulModels\":%u,\"corruptionModels\":%u,\"boundedSlots\":4,\"realAsyncify\":false}\n",success,corruptions);return 0;
}
