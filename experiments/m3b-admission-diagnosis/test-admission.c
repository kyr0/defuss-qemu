/* Host model for the observation-only bank, not a guest or QEMU test. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <sys/mman.h>
#include <unistd.h>
typedef uint64_t tb_page_addr_t;
typedef struct TranslationBlock { uint32_t flags, cflags; uint64_t page; } TranslationBlock;
#define tb_cflags(tb) ((tb)->cflags)
#define tb_page_addr0(tb) ((tb)->page)
#define qatomic_read(p) (*(p))
#define qatomic_set(p,v) (*(p)=(v))
static uint32_t cas(uint32_t *p,uint32_t old,uint32_t next) { uint32_t v=*p;if(v==old)*p=next;return v; }
#define qatomic_cmpxchg cas
/* Distinct host-model bits test the predicate structure; native build uses
 * the original target's definitions, independently unchanged by this overlay. */
#define HF_PE_MASK (1u<<0)
#define HF_LMA_MASK (1u<<1)
#define HF_CS64_MASK (1u<<2)
#define HF_CPL_MASK (3u<<3)
#define HF_VM_MASK (1u<<5)
#define HF_SMM_MASK (1u<<6)
#define HF_GUEST_MASK (1u<<7)
#define HF_RF_MASK (1u<<8)
#define HF_TF_MASK (1u<<9)
#define HF_INHIBIT_IRQ_MASK (1u<<10)
#define HF_MPX_EN_MASK (1u<<11)
#define CF_PCREL (1u<<0)
#define CF_NO_GOTO_TB (1u<<1)
#define CF_SINGLE_STEP (1u<<2)
#define CF_MEMI_ONLY (1u<<3)
#define CF_USE_ICOUNT (1u<<4)
#define CF_INVALID (1u<<5)
#define CF_PARALLEL (1u<<6)
#define CF_NOIRQ (1u<<7)
#define CF_BP_PAGE (1u<<8)
#define CF_STEP_ATOMIC (1u<<9)
static bool profile=true,context=true,dynamic=true;
static bool defuss_m3b_profile_enabled(void){return profile;}
static bool wasm44_single_ctx(void){return context;}
static bool defuss_m3b_dynamic_profile(void){return dynamic;}
#include "../m3b-fallthrough/predecode.h"
#include "admission.inc"
#include "original-can-form.inc"
int main(void)
{
    const uint32_t good=HF_PE_MASK|HF_LMA_MASK|HF_CS64_MASK|HF_CPL_MASK;
    TranslationBlock tb={good,CF_PCREL,0x12345678};
    assert(defuss_m3ba_abi()==1 && defuss_m3ba_data()==(uintptr_t)m3ba_words);
    for(unsigned i=0;i<8;i++){
        tb=(TranslationBlock){good,CF_PCREL,0x12345678};profile=context=dynamic=true;
        switch(i){case 0:profile=false;break;case 1:context=false;break;case 2:dynamic=false;break;case 3:tb.flags=0;break;case 4:tb.flags|=HF_TF_MASK;break;case 5:tb.cflags=0;break;case 6:tb.cflags|=CF_PARALLEL;break;case 7:tb.page=UINT64_MAX;break;}
        m3ba_form_rejection(&tb,UINT64_C(0x7f123456789a));assert(m3ba_words[8]==(1u<<i));assert(m3ba_words[48+i]==1);
        assert(m3ba_words[12]==0x3456789a && m3ba_words[13]==0x7f12);
    }
    profile=context=dynamic=true;tb=(TranslationBlock){good,CF_PCREL,0x12345678};
    m3ba_form_rejection(&tb,0);assert(m3ba_words[24]==1);
    /* Compare reason-zero to the verbatim original eligibility function. */
    uint32_t random=0x628a3f11;
    for(unsigned i=0;i<16384;i++){
        random=random*1664525u+1013904223u;tb.flags=random&4095;
        random=random*1664525u+1013904223u;tb.cflags=random&1023;
        profile=!!(i&1);context=!!(i&2);dynamic=!!(i&4);tb.page=(i&8)?UINT64_MAX:0x12345678;
        bool allowed=defuss_m3b_can_form(&tb);m3ba_form_rejection(&tb,0);
        assert((m3ba_words[8]==0)==allowed);
    }
    m3ba_words[16]=UINT32_MAX-1;m3ba_note(16);assert(m3ba_words[16]==UINT32_MAX && !m3ba_words[3]);m3ba_note(16);assert(m3ba_words[16]==UINT32_MAX && m3ba_words[3]==1);
    size_t page=(size_t)sysconf(_SC_PAGESIZE);uint8_t *map=mmap(NULL,page*2,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);assert(map!=MAP_FAILED);assert(!mprotect(map+page,page,PROT_NONE));
    for(unsigned span=1;span<=128;span++){
        uint8_t *bytes=map+page-span;memset(bytes,0xa5,span);
        for(unsigned result=0;result<8;result++){
            m3ba_decode(result,&tb,UINT64_C(0x7f123456789a),bytes,span,32);
            assert(m3ba_words[68]==span && m3ba_words[70]==result);
            const uint8_t *saved=(const void*)(m3ba_words+96);
            for(unsigned n=0;n<128;n++)assert(saved[n]==(n<span?0xa5:0));
        }
    }
    for(unsigned i=0;i<8;i++)assert(m3ba_words[32+i]==128);
    /* Invalid bounds must return before touching a protected source page. */
    m3ba_decode(0,&tb,0,map+page,129,32);m3ba_decode(8,&tb,0,map+page,1,32);m3ba_decode(0,&tb,0,map+page,0,32);assert(m3ba_words[25]==3);
    assert(!munmap(map,page*2));puts("{\"reasonCases\":8,\"boundedCopies\":1024,\"invalidBoundsRejected\":3,\"saturationChecked\":true}");return 0;
}
