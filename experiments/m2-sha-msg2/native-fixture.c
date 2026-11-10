/* Host-only adapter: execute the exact candidate emitter, not a rewritten
 * implementation. generated-qemu.h and generated-address.inc are extracted
 * from the retained backend; generated-oracle.inc is the exact QEMU helper. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include "generated-qemu.h"
typedef struct { uint8_t bytes[4096]; size_t length; } TCGContext;
typedef struct {void *func; const char *name; unsigned flags, typemask;} TCGHelperInfo;
#define tcg_debug_assert assert
#define tcg_target_call_clobber_regs 3
#define tcg_regset_test_reg(set, reg) (((set) >> (reg)) & 1)
#define qatomic_read(ptr) __atomic_load_n((ptr), __ATOMIC_SEQ_CST)
#define qatomic_cmpxchg(ptr, old, value) ({ unsigned expected_ = (old); __atomic_compare_exchange_n((ptr), &expected_, (value), false, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST); expected_; })
static void tcg_wasm_out_op(TCGContext *s, unsigned opcode)
{ assert(s->length < sizeof(s->bytes)); s->bytes[s->length++] = opcode; }
static void leb(TCGContext *s, uint64_t n)
{ do {unsigned byte=n&127; n>>=7; tcg_wasm_out_op(s,byte|(n?128:0));}while(n); }
static void tcg_wasm_out_op_idx(TCGContext *s, unsigned opcode, unsigned index)
{tcg_wasm_out_op(s,opcode);leb(s,index);}
static void tcg_wasm_out_op_const(TCGContext *s, unsigned opcode, int64_t n)
{tcg_wasm_out_op(s,opcode);bool more;do{unsigned byte=n&127;n>>=7;more=!((n==0&&!(byte&64))||(n==-1&&(byte&64)));tcg_wasm_out_op(s,byte|(more?128:0));}while(more);}
static void tcg_wasm_out_op_ldst(TCGContext *s, unsigned opcode, unsigned align, uint64_t offset)
{tcg_wasm_out_op(s,opcode);leb(s,align);leb(s,offset);}
#include "generated-address.inc"
#define DEFUSS_M2_MSG2_DIAGNOSTIC 0
#include "config.c.inc"
#include "lowering.c.inc"
static void dummy(void) {}
static volatile unsigned marker;
static void other(void) {marker++;}
static const unsigned signature = dh_typecode_void | (dh_typecode_ptr<<3) | (dh_typecode_ptr<<6) | (dh_typecode_ptr<<9);
static void guards(void)
{
    TCGContext s={0};TCGHelperInfo info={.func=(void *)dummy,.name="sha256msg2",.typemask=signature};
    assert(!emit_m2_msg2(&s,(intptr_t)other,&info)&&!s.length);
    info.flags=TCG_CALL_NO_RETURN;assert(!emit_m2_msg2(&s,(intptr_t)dummy,&info)&&!s.length);
    info.flags=0;info.name=NULL;assert(!emit_m2_msg2(&s,(intptr_t)dummy,&info)&&!s.length);
    info.name="sha256msg1";assert(!emit_m2_msg2(&s,(intptr_t)dummy,&info)&&!s.length);
    info.name="sha256msg2";
    for(unsigned shift=0;shift<=12;shift+=3){info.typemask=signature^(1u<<shift);assert(!emit_m2_msg2(&s,(intptr_t)dummy,&info)&&!s.length);}
    info.typemask=signature;assert(m2_msg2_matches((intptr_t)dummy,&info));
}
static void *choose_on(void *unused){(void)unused;defuss_m2_msg2_config(1);return NULL;}
static void *lock_choice(void *unused){(void)unused;m2_msg2_enabled();return NULL;}
static void configuration(void)
{
    assert(defuss_m2_msg2_status()==0x10000);
    assert(defuss_m2_msg2_config(2)==-1&&defuss_m2_msg2_status()==0x10000);
    assert(defuss_m2_msg2_config(1)==0&&defuss_m2_msg2_status()==0x10002);
    assert(defuss_m2_msg2_config(0)==-1&&m2_msg2_enabled()&&defuss_m2_msg2_status()==0x10004);
    assert(defuss_m2_msg2_config(1)==-1);
    m2_msg2_state=0;assert(!m2_msg2_enabled()&&defuss_m2_msg2_status()==0x10003);
    assert(defuss_m2_msg2_config(1)==-1);
    m2_msg2_state=0;assert(defuss_m2_msg2_config(0)==0&&!m2_msg2_enabled());
    for(unsigned i=0;i<100;i++){
        m2_msg2_state=0;pthread_t a,b;assert(!pthread_create(&a,NULL,choose_on,NULL));assert(!pthread_create(&b,NULL,lock_choice,NULL));
        assert(!pthread_join(a,NULL)&&!pthread_join(b,NULL));
        unsigned state=defuss_m2_msg2_status();assert(state==0x10003||state==0x10004);
        assert(m2_msg2_enabled()==(state==0x10004)&&defuss_m2_msg2_config(0)==-1);
    }
}
typedef struct {uint32_t lane[4];} Reg;
#define L(n) lane[n]
static uint32_t ror32(uint32_t x,unsigned n){return (x>>n)|(x<<(32-n));}
#include "generated-oracle.inc"
static uint32_t random_word(void){static uint32_t state=0x51b34079;state^=state<<13;state^=state>>17;state^=state<<5;return state;}
static void u32(FILE *file,uint32_t n){unsigned char bytes[4]={n,n>>8,n>>16,n>>24};assert(fwrite(bytes,1,4,file)==4);}
int main(int argc,char **argv)
{
    assert(argc==3);guards();configuration();
    TCGContext s={0};TCGHelperInfo info={.func=(void *)dummy,.name="sha256msg2",.typemask=signature};
    assert(emit_m2_msg2(&s,(intptr_t)dummy,&info));
    FILE *body=fopen(argv[1],"wb");assert(body);assert(fwrite(s.bytes,1,s.length,body)==s.length);assert(!fclose(body));
    FILE *cases=fopen(argv[2],"wb");assert(cases);
    const unsigned aliases[][3]={{64,96,128},{64,64,96},{64,96,64},{64,96,96},{64,64,64},{68,64,96},{60,64,96},{68,96,64},{60,96,64},{72,64,68}};
    const uint32_t edges[]={0,UINT32_MAX,1,0x80000000,0x7fffffff,0xaaaaaaaa,0x55555555,0xffff0000};
    unsigned count=0;
    for(unsigned alias=0;alias<10;alias++)for(unsigned repeat=0;repeat<2048;repeat++){
        uint32_t *memory=malloc(512);assert(memory);
        for(unsigned i=0;i<128;i++)memory[i]=repeat%32<8?edges[(repeat+i)%8]:random_word();
        for(unsigned i=0;i<3;i++)u32(cases,aliases[alias][i]);
        for(unsigned i=0;i<128;i++)u32(cases,memory[i]);
        helper_sha256msg2((Reg *)((char *)memory+aliases[alias][0]),(Reg *)((char *)memory+aliases[alias][1]),(Reg *)((char *)memory+aliases[alias][2]));
        for(unsigned i=0;i<128;i++)u32(cases,memory[i]);free(memory);count++;
    }
    assert(!fclose(cases));printf("PASS: matcher/configuration/concurrent-lock guards; original helper cases=%u; emitted bytes=%zu\n",count,s.length);
}
