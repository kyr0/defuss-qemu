/* Host model only. The actual SDK build checks native layout and integration. */
#include <assert.h>
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include "../../artifacts/m3b-context-v2-source-01/source/tcg/m3-region-core.h"
#define TARGET_X86_64
#define EMSCRIPTEN_KEEPALIVE
static bool enabled=true;
static bool defuss_m3b_profile_enabled(void){return enabled;}
typedef struct {uint64_t cr[5],eip,efer;uint32_t hflags,hflags2;} CPUArchState;
typedef struct {unsigned m3b_fused,m3b_bytes,m3b_b_offset,flags,cflags;uint64_t page0,page1;} TranslationBlock;
#define tb_page_addr0(t) ((t)->page0)
#define tb_page_addr1(t) ((t)->page1)
#define tb_cflags(t) ((t)->cflags)
struct WasmTBHeader {struct {unsigned fused,bytes,b_offset;} m3b;struct m3_descriptor m3;};
#include "observer.inc"
static const unsigned char bytes[12]={0x83,0xf9,0,0x74,7,1,0xf0,0x83,0xe9,1,0xeb,0xf4};
static CPUArchState env(void){return (CPUArchState){.cr={0x80050033,0,0,0x123000,0x350eb0},.eip=0x20000004,.efer=0xd01,.hflags=0x18c0c2b3,.hflags2=0x101};}
static TranslationBlock block(void){return (TranslationBlock){.m3b_fused=1,.m3b_bytes=12,.m3b_b_offset=5,.flags=0x18c0c2b3,.cflags=0xff020000,.page0=0x123004,.page1=UINT64_MAX};}
static struct WasmTBHeader header(TranslationBlock *t,uint64_t generation){return (struct WasmTBHeader){.m3b={1,12,5},.m3={.magic=M3_MAGIC,.version=M3_VERSION,.valid=1,.eligibility=M3_ELIGIBLE,.members=1,.recovery=M3_RECOVERY_TCI_SEARCH,.generation=generation,.owner=(uintptr_t)t,.translation_pc=0x20000004,.page0=t->page0,.page1=t->page1,.flags=t->flags,.cflags=t->cflags}};}
static void reset(void){memset(m3co_words+5,0,(M3CO_WORDS-5)*4);m3co_words[12]=64;m3co_cached_slot=0;m3co_cached_code=0;m3co_cached_generation=0;enabled=true;}
int main(void){
 CPUArchState e=env();TranslationBlock t=block();struct WasmTBHeader h=header(&t,7);CPUArchState before=e;TranslationBlock tb_before=t;struct WasmTBHeader h_before=h;
 reset();enabled=false;defuss_m3co_formed(&e,&t,e.eip,bytes,12);m3co_enter(&e,&h,true);assert(!m3co_words[5]&&!m3co_words[6]);enabled=true;
 defuss_m3co_formed(&e,&t,e.eip,bytes,12);uint32_t *w=m3co_words+64;assert(m3co_words[5]==1&&w[0]==1&&!memcmp(w+32,bytes,12));
 for(unsigned i=0;i<1500;i++)m3co_enter(&e,&h,false);for(unsigned i=0;i<10000;i++)m3co_enter(&e,&h,true);
 assert(w[0]==2&&w[28]==10000&&w[29]==1500&&m3co_words[6]==10000&&m3co_words[7]==1500&&!m3co_words[10]);assert(m3co_pair(w,14)==7&&m3co_pair(w,16)==(uintptr_t)&h);
 assert(!memcmp(&before,&e,sizeof(e))&&!memcmp(&tb_before,&t,sizeof(t))&&!memcmp(&h_before,&h,sizeof(h)));
 /* Same descriptor address may only bind a new generation after formation. */
 defuss_m3co_formed(&e,&t,e.eip,bytes,12);h.m3.generation=8;m3co_enter(&e,&h,true);assert(m3co_words[5]==2&&w[128]==2&&m3co_pair(w+128,14)==8&&w[128+28]==1&&w[28]==10000&&!m3co_words[10]);
 unsigned corruptions=0;
 for(unsigned bad=0;bad<12;bad++){
  reset();e=env();t=block();h=header(&t,7);defuss_m3co_formed(&e,&t,e.eip,bytes,12);m3co_enter(&e,&h,true);
  switch(bad){case 0:h.m3.generation++;break;case 1:h.m3.owner++;break;case 2:h.m3.page0+=4096;break;case 3:h.m3.page1=0;break;case 4:h.m3.translation_pc++;break;case 5:h.m3.flags++;break;case 6:h.m3.cflags++;break;case 7:h.m3b.bytes++;break;case 8:h.m3b.b_offset++;break;case 9:e.eip++;break;case 10:e.cr[3]+=4096;break;case 11:h.m3.valid=0;break;}
  m3co_enter(&e,&h,true);assert(m3co_words[10]||m3co_words[9]);assert(m3co_words[64+28]==1);corruptions++;
 }
 reset();e=env();t=block();h=header(&t,7);m3co_enter(&e,&h,true);assert(m3co_words[9]==1&&m3co_words[6]==1);
 reset();defuss_m3co_formed(&e,&t,e.eip,bytes,129);assert(m3co_words[10]&&!m3co_words[5]);
 reset();defuss_m3co_formed(&e,&t,0x20000ffe,bytes,12);assert(m3co_words[10]&&!m3co_words[5]);
 reset();for(unsigned i=0;i<16;i++)defuss_m3co_formed(&e,&t,e.eip,bytes,12);defuss_m3co_formed(&e,&t,e.eip,bytes,12);assert(m3co_words[5]==16&&m3co_words[8]==1);
 reset();defuss_m3co_formed(&e,&t,e.eip,bytes,12);m3co_enter(&e,&h,true);m3co_words[64+28]=UINT32_MAX;m3co_enter(&e,&h,true);assert(m3co_words[64+28]==UINT32_MAX&&m3co_words[10]==1);
 printf("{\"tierModels\":2,\"corruptions\":%u,\"slots\":16,\"reuse\":true,\"saturation\":true,\"guestExecuted\":false}\n",corruptions);return 0;
}
