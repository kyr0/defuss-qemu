/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Compile in pinned Linux SDK: -O2 -static -mavx2 -msha -mno-red-zone
 * -fno-tree-vectorize -fno-tree-slp-vectorize. No host SHA instruction required.
 * Opcode and scalar oracle follow Intel SDM SHA256MSG2, 0f 38 cd /r. */
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
#include <ucontext.h>

#define MSG2_CASE(K,MODRM) case K: \
    __asm__ volatile( \
        "vmovdqu (%[a]), %%ymm0\n\t" \
        "vmovdqu (%[b]), %%ymm1\n\t" \
        "vmovdqu (%[c]), %%ymm2\n\t" \
        "pushq %[pattern]\n\tpopfq\n\t" \
        "pushfq\n\tpopq (%[f])\n\t" \
        ".byte 0x0f, 0x38, 0xcd, " MODRM "\n\t" \
        "pushfq\n\tpopq 8(%[f])\n\t" \
        "vmovdqu %%ymm0, (%[o])\n\t" \
        "vmovdqu %%ymm1, 32(%[o])\n\t" \
        "vmovdqu %%ymm2, 64(%[o])\n\t" \
        "vzeroupper" \
        : : [a] "r"(in[0]),[b] "r"(in[1]),[c] "r"(in[2]), \
            [o] "r"(out),[f] "r"(flags),[pattern] "r"(pattern),[m] "D"(memory) \
        : "ymm0","ymm1","ymm2","cc","memory"); break

__attribute__((noinline,noclone))
static void operation(unsigned mode,const uint32_t in[3][8],uint32_t out[3][8],
                      const uint32_t memory[8],uint64_t pattern,uint64_t flags[2])
{
    switch(mode){
    MSG2_CASE(0,"0xca"); /* xmm1,xmm2 */
    MSG2_CASE(1,"0xc9"); /* xmm1,xmm1 */
    MSG2_CASE(2,"0xc1"); /* xmm0,xmm1 */
    MSG2_CASE(3,"0xc8"); /* xmm1,xmm0 */
    MSG2_CASE(4,"0xc0"); /* xmm0,xmm0 */
    MSG2_CASE(5,"0x0f"); /* xmm1,[rdi] */
    MSG2_CASE(6,"0x07"); /* xmm0,[rdi] */
    default:abort();
    }
}
static uint32_t sigma(uint32_t x)
{return ((x>>17)|(x<<15))^((x>>19)|(x<<13))^(x>>10);}
static void oracle(uint32_t out[4],const uint32_t a[4],const uint32_t b[4])
{
    uint32_t av[4],bv[4];memcpy(av,a,16);memcpy(bv,b,16);
    out[0]=av[0]+sigma(bv[2]);out[1]=av[1]+sigma(bv[3]);
    out[2]=av[2]+sigma(out[0]);out[3]=av[3]+sigma(out[1]);
}
static int gate_fd;
static void die(const char *reason){fprintf(stderr,"FIXTURE_FAIL:msg2:%s:errno=%d\n",reason,errno);fflush(stderr);exit(1);}
static void gate(int mode)
{
    printf("MSG2_GATE:%d\n",mode);if(fflush(stdout))die("console-flush");
    ssize_t n;do{n=write(gate_fd,"G",1);}while(n<0&&errno==EINTR);if(n!=1)die("gate-write");
    int result;do{result=tcdrain(gate_fd);}while(result<0&&errno==EINTR);if(result)die("gate-drain");
    char reply=0;do{n=read(gate_fd,&reply,1);}while(n<0&&errno==EINTR);if(n!=1||reply!='K')die("gate-ack");
}
static uint32_t random32(void){static uint32_t state=0x9286d3ef;state^=state<<13;state^=state>>17;state^=state<<5;return state;}

/* Linux x86-64 signal frames preserve the architectural state at the fault.
 * Read the fixed FXSAVE XMM area and Linux's standard-format YMMH component;
 * reject an absent/truncated extended state instead of silently testing XMM only. */
extern const unsigned char msg2_fault_instruction[],msg2_fault_resume[];
static volatile sig_atomic_t fault_count,fault_code,fault_xstate;
static volatile uintptr_t fault_pc,fault_address;
static volatile uint64_t fault_flags;
static volatile unsigned char fault_vectors[3][32];
static void fault_handler(int signal,siginfo_t *info,void *context)
{
    ucontext_t *uc=context;
    if(signal!=SIGSEGV||fault_count||uc->uc_mcontext.gregs[REG_RIP]!=(greg_t)(uintptr_t)msg2_fault_instruction)_exit(90);
    fault_count++;fault_code=info->si_code;fault_address=(uintptr_t)info->si_addr;
    fault_pc=uc->uc_mcontext.gregs[REG_RIP];fault_flags=uc->uc_mcontext.gregs[REG_EFL];
    const unsigned char *fp=(const unsigned char *)uc->uc_mcontext.fpregs;
    if(!fp)_exit(91);
    uint32_t magic,extended_size,xstate_size;uint64_t features;
    memcpy(&magic,fp+464,4);memcpy(&extended_size,fp+468,4);
    memcpy(&features,fp+472,8);memcpy(&xstate_size,fp+480,4);
    fault_xstate=magic==UINT32_C(0x46505853)&&extended_size>=832&&xstate_size>=832&&(features&4);
    for(unsigned reg=0;reg<3;reg++)for(unsigned byte=0;byte<16;byte++){
        fault_vectors[reg][byte]=fp[160+reg*16+byte];
        fault_vectors[reg][16+byte]=fault_xstate?fp[576+reg*16+byte]:0;
    }
    /* Resume immediately after the faulting instruction, never retry the
     * preceding observable store or execute SHA against an accessible source. */
    uc->uc_mcontext.gregs[REG_RIP]=(greg_t)(uintptr_t)msg2_fault_resume;
}
__attribute__((noinline,noclone))
static void fault_operation(const uint32_t in[3][8],uint32_t out[3][8],const void *source,
                            uint64_t flags[2],uint64_t *side_effect)
{
    __asm__ volatile(
        "vmovdqu (%[a]), %%ymm0\n\tvmovdqu (%[b]), %%ymm1\n\tvmovdqu (%[c]), %%ymm2\n\t"
        "incq (%[side])\n\tpushq $0xad7\n\tpopfq\n\tpushfq\n\tpopq (%[f])\n\t"
        ".global msg2_fault_instruction\nmsg2_fault_instruction:\n\t"
        ".byte 0x0f, 0x38, 0xcd, 0x07\n\t" /* xmm0,[rdi] */
        ".global msg2_fault_resume\nmsg2_fault_resume:\n\t"
        "pushfq\n\tpopq 8(%[f])\n\t"
        "vmovdqu %%ymm0, (%[o])\n\tvmovdqu %%ymm1, 32(%[o])\n\tvmovdqu %%ymm2, 64(%[o])\n\tvzeroupper"
        : : [a]"r"(in[0]),[b]"r"(in[1]),[c]"r"(in[2]),[o]"r"(out),
            [f]"r"(flags),[side]"r"(side_effect),[m]"D"(source)
        : "ymm0","ymm1","ymm2","cc","memory");
}
static void memory_fault(void)
{
    long page=sysconf(_SC_PAGESIZE);if(page<4096)die("fault-page-size");
    unsigned char *mapping=mmap(NULL,(size_t)page*2,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
    if(mapping==MAP_FAILED)die("fault-mmap");
    unsigned char *source=mapping+page-8; /* The last eight source bytes fault. */
    _Alignas(32) uint32_t in[3][8],out[3][8];uint64_t flags[2],side_effect=0;
    for(unsigned reg=0;reg<3;reg++)for(unsigned word=0;word<8;word++)in[reg][word]=random32();
    for(unsigned i=0;i<16;i++)source[i]=(unsigned char)(i*17+1);
    struct sigaction action={0},previous;action.sa_sigaction=fault_handler;action.sa_flags=SA_SIGINFO;
    sigemptyset(&action.sa_mask);if(sigaction(SIGSEGV,&action,&previous))die("fault-sigaction");
    /* Warm this exact instruction PC before changing the operand permissions. */
    for(unsigned i=0;i<4096;i++)fault_operation(in,out,source,flags,&side_effect);
    if(mprotect(mapping+page,(size_t)page,PROT_NONE))die("fault-mprotect");
    fault_operation(in,out,source,flags,&side_effect);
    if(fault_count!=1||fault_code!=SEGV_ACCERR||fault_pc!=(uintptr_t)msg2_fault_instruction||
       fault_address!=(uintptr_t)(mapping+page)||!fault_xstate||side_effect!=4097||
       (fault_flags&~UINT64_C(0x10000))!=flags[0]||flags[0]!=flags[1]||memcmp(in,out,sizeof(in)))die("fault-state");
    for(unsigned reg=0;reg<3;reg++)for(unsigned byte=0;byte<32;byte++)
        if(fault_vectors[reg][byte]!=((const unsigned char *)in[reg])[byte])die("fault-saved-vector");
    for(unsigned i=0;i<8;i++)if(source[i]!=(unsigned char)(i*17+1))die("fault-source-mutation");
    if(sigaction(SIGSEGV,&previous,NULL)||munmap(mapping,(size_t)page*2))die("fault-cleanup");
    puts("MSG2_FAULT_PASS warmup=4096 faults=1 state=ymm0-2,flags pc=exact address=exact sideEffect=once");
}
int main(void)
{
    gate_fd=open("/dev/ttyS0",O_RDWR|O_NOCTTY);if(gate_fd<0)die("com1-open");
    struct termios serial;if(tcgetattr(gate_fd,&serial))die("com1-get");cfmakeraw(&serial);
    serial.c_cflag|=CLOCAL|CREAD;serial.c_cc[VMIN]=1;serial.c_cc[VTIME]=0;
    if(cfsetispeed(&serial,B115200)||cfsetospeed(&serial,B115200)||tcsetattr(gate_fd,TCSANOW,&serial))die("com1-setup");
    const unsigned destinations[]={1,1,0,1,0,1,0},sources[]={2,1,1,0,0};
    const uint32_t edges[]={0,UINT32_MAX,1,0x80000000,0x7fffffff,0xaaaaaaaa,0x55555555,0xffff0000};
    unsigned checks=0;puts("MSG2_FIXTURE_START");gate(-1);
    for(unsigned mode=0;mode<7;mode++){
        for(unsigned repeat=0;repeat<4096;repeat++){
            _Alignas(32) uint32_t in[3][8],out[3][8],expected[3][8],memory[8],saved[8];uint64_t flags[2];
            for(unsigned reg=0;reg<4;reg++)for(unsigned word=0;word<8;word++){
                uint32_t value=repeat%32<8?edges[(repeat+reg+word)%8]:random32();
                (reg<3?in[reg]:memory)[word]=value;
            }
            memcpy(expected,in,sizeof(in));memcpy(saved,memory,sizeof(memory));
            unsigned d=destinations[mode];oracle(expected[d],in[d],mode<5?in[sources[mode]]:memory);
            uint64_t pattern=UINT64_C(0x202)|((repeat&1)?UINT64_C(0x8d5):0);
            operation(mode,in,out,memory,pattern,flags);
            if(memcmp(out,expected,sizeof(out))||memcmp(memory,saved,sizeof(memory))||flags[0]!=flags[1]){
                fprintf(stderr,"FIXTURE_FAIL:msg2:mode=%u:repeat=%u:flags=%llx/%llx\n",mode,repeat,(unsigned long long)flags[0],(unsigned long long)flags[1]);return 1;
            }
            checks++;
        }
        if(mode==6)memory_fault();
        printf("MSG2_MODE_PASS:%u checks=4096\n",mode);gate(mode);
    }
    printf("MSG2_FIXTURE_PASS checks=%u\nFIXTURE_PASS\n",checks);fflush(stdout);return 0;
}
