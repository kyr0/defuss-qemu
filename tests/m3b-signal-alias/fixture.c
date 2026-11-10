#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <termios.h>
#include <sys/mman.h>
#include <sys/time.h>
#include <signal.h>
#include <ucontext.h>
#include <errno.h>
struct arch_state { uint64_t gpr[16],rflags; };
_Static_assert(sizeof(struct arch_state)==136,"assembly state ABI");
_Alignas(16) struct arch_state m3i_initial,m3i_observed;
_Alignas(16) static unsigned char guest_stack[32768],signal_stack[65536];
extern unsigned char pressure_sentinel[],pressure_sentinel_end[];
extern void m3i_invoke(const void *);
static int gate_fd;static unsigned sequence;
static unsigned char *rx,*rw;
static int pagemap_fd;
static volatile sig_atomic_t patches;
static uint64_t physical_frame;
static volatile sig_atomic_t signal_count;
static volatile struct { int signo,code,error;uint64_t pc,gpr[16],rflags;unsigned char before_rx[17],before_rw[17],after_rx[17],after_rw[17]; } sample;
static const int greg_index[16]={REG_RAX,REG_RBX,REG_RCX,REG_RDX,REG_RSI,REG_RDI,REG_RBP,REG_RSP,REG_R8,REG_R9,REG_R10,REG_R11,REG_R12,REG_R13,REG_R14,REG_R15};
static void fail(const char *s){fprintf(stderr,"M3B_SIGNAL_ALIAS_FAIL:%s errno=%d\n",s,errno);exit(1);}
static void need(int ok,const char *s){if(!ok)fail(s);}
static void handler(int signo,siginfo_t *info,void *opaque){
 ucontext_t *u=opaque;signal_count++;
 if(signal_count!=1)return;
 sample.signo=signo;sample.code=info->si_code;sample.error=info->si_errno;
 sample.pc=(uint64_t)u->uc_mcontext.gregs[REG_RIP];sample.rflags=(uint64_t)u->uc_mcontext.gregs[REG_EFL];
 for(unsigned i=0;i<16;i++)sample.gpr[i]=(uint64_t)u->uc_mcontext.gregs[greg_index[i]];
 for(unsigned i=0;i<17;i++){sample.before_rx[i]=((volatile unsigned char*)rx)[i];sample.before_rw[i]=((volatile unsigned char*)rw)[i];}
 ((volatile unsigned char*)rw)[9]=sample.before_rw[9]==0x01?0x29:0x01;patches++;
 __asm__ __volatile__("":::"memory");
 for(unsigned i=0;i<17;i++){sample.after_rx[i]=((volatile unsigned char*)rx)[i];sample.after_rw[i]=((volatile unsigned char*)rw)[i];}
}
static unsigned parity(uint32_t x){x^=x>>4;x&=15;return !((0x6996u>>x)&1);}
static uint64_t flags(uint32_t a,uint32_t b,int sub){
 uint32_t z=sub?a-b:a+b;unsigned cf=sub?a<b:(uint64_t)a+b>UINT32_MAX;
 unsigned of=(((sub?(a^b):~(a^b))&(a^z))>>31)&1;
 return UINT64_C(0x202)|cf|(parity(z)<<2)|(((a^b^z)>>4&1)<<4)|((z==0)<<6)|((z>>31)<<7)|(of<<11);
}
static void words(const volatile uint64_t *p,unsigned n){printf("[");for(unsigned i=0;i<n;i++)printf("%s\"0x%llx\"",i?",":"",(unsigned long long)p[i]);printf("]");}
static void state(const struct arch_state *p){printf("{\"gpr\":");words(p->gpr,16);printf(",\"rflags\":\"0x%llx\"}",(unsigned long long)p->rflags);}
static uint64_t pagemap(const void *address){
 uint64_t word=0;need(pread(pagemap_fd,&word,8,((uintptr_t)address/4096)*8)==8,"actual pagemap");
 need(word>>63==1&&!(word&(UINT64_C(1)<<62)),"present unswapped alias");
 need((word&((UINT64_C(1)<<55)-1))==physical_frame,"persistent actual physical frame");return word;
}
static void hexbytes(const volatile unsigned char *p){for(unsigned i=0;i<17;i++)printf("%02x",p[i]);}
static void gate(int index,unsigned n,uint32_t step){
 uint64_t pa=pagemap(rx),pb=pagemap(rw);need(!memcmp(rx,rw,17),"coherent alias bytes");
 printf("M3B_SIGNAL_ALIAS_GATE:{\"seq\":%u,\"stage\":\"%s\",\"case\":%d,\"iterations\":%u,\"step\":%u,\"deliveries\":%d,\"initial\":",sequence++,index==-2?"layout":index==-1?"warm":"signal",index,n,step,(int)signal_count);state(&m3i_initial);printf(",\"observed\":");state(&m3i_observed);
 printf(",\"sample\":");if(!signal_count)printf("null");else{printf("{\"signo\":%d,\"code\":%d,\"error\":%d,\"pc\":\"0x%llx\",\"gpr\":",sample.signo,sample.code,sample.error,(unsigned long long)sample.pc);words(sample.gpr,16);printf(",\"rflags\":\"0x%llx\"",(unsigned long long)sample.rflags);printf(",\"beforeRxHex\":\"");hexbytes(sample.before_rx);printf("\",\"beforeRwHex\":\"");hexbytes(sample.before_rw);printf("\",\"afterRxHex\":\"");hexbytes(sample.after_rx);printf("\",\"afterRwHex\":\"");hexbytes(sample.after_rw);printf("\"}");}
 printf(",\"patches\":%d,\"rxPagemap\":\"0x%llx\",\"rwPagemap\":\"0x%llx\",\"rxHex\":\"",(int)patches,(unsigned long long)pa,(unsigned long long)pb);hexbytes(rx);printf("\",\"rwHex\":\"");hexbytes(rw);printf("\"}\n");
 need(write(gate_fd,"G",1)==1&&!tcdrain(gate_fd),"gate signal");char ack=0;need(read(gate_fd,&ack,1)==1&&ack=='K',"gate ACK");
}
static void execute(int index){
 unsigned n=index<0?100000:1000000+1009u*index;uint32_t step=UINT32_C(0x9e3779b9)^((unsigned)(index+1)*UINT32_C(0x10203041));
 for(unsigned i=0;i<16;i++)m3i_initial.gpr[i]=UINT64_C(0x1122334455667788)^((uint64_t)(i+1)*UINT64_C(0x0102030405060708))^((uint64_t)(index+2)*UINT64_C(0x102030405060708));
 m3i_initial.gpr[0]=0;m3i_initial.gpr[2]=n;m3i_initial.gpr[4]=step;m3i_initial.gpr[5]=n;m3i_initial.gpr[7]=(uintptr_t)(guest_stack+sizeof(guest_stack)-256);m3i_initial.rflags=0x202;
 memset(&m3i_observed,0,sizeof(m3i_observed));memset((void*)&sample,0,sizeof(sample));signal_count=0;
 struct itimerval timer={0};if(index>=0)timer.it_value.tv_usec=10000;
 need(!setitimer(ITIMER_VIRTUAL,&timer,NULL),"arm single shot virtual timer");m3i_invoke(rx);
 memset(&timer,0,sizeof(timer));need(!setitimer(ITIMER_VIRTUAL,&timer,NULL),"disarm timer");
 /* Retain the complete result before validation or any host ACK. */
 gate(index,n,step);
 need(signal_count==(index>=0),"exactly one natural timer delivery");
 uint32_t expected_final=(uint32_t)((uint64_t)n*step);
 if(index>=0){
  uint64_t off=sample.pc-(uintptr_t)rx,left=sample.gpr[2];
  need(signal_count==1&&patches==index+1,"one patch per actual signal");
  need((off==4||off==7||off==9||off==11||off==14)&&left>=4096&&left<n,"strict interrupted work window");
  uint32_t remaining=(uint32_t)(left-(off==11));
  uint32_t tail=(uint32_t)((uint64_t)remaining*step);
  expected_final=(uint32_t)sample.gpr[0]+((index&1)?tail:0u-tail);
 }
 for(unsigned i=0;i<16;i++){uint64_t expected=i==0?expected_final:i==2?0:m3i_initial.gpr[i];need(m3i_observed.gpr[i]==expected,"final mixed-operation GPR after resume");}
 need(m3i_observed.rflags==0x246,"final RFLAGS");
 if(index>=0){
  need(sample.signo==SIGVTALRM&&sample.code==SI_KERNEL&&sample.error==0,"natural kernel virtual timer signal");
  uint64_t off=sample.pc-(uintptr_t)rx;need(off==4||off==7||off==9||off==11||off==14||off==16,"exact instruction boundary");
  uint64_t left=sample.gpr[2];need(left<=n,"bounded progress");if(off==9||off==11)need(left>0,"B has positive count");if(off==16)need(left==0,"side exit count");
  uint32_t acc=(uint32_t)((uint64_t)(n-left)*step);if(index&1)acc=0u-acc;uint64_t expected_flags;
  if(off==11){expected_flags=flags(acc,step,index&1);acc=(index&1)?acc-step:acc+step;}
  else if(off==4)expected_flags=left==n?0x246:flags((uint32_t)left+1,1,1);
  else if(off==14)expected_flags=flags((uint32_t)left+1,1,1);
  else expected_flags=flags((uint32_t)left,0,1);
  for(unsigned i=0;i<16;i++){uint64_t expected=i==0?acc:i==2?left:i==7?m3i_initial.gpr[i]-8:m3i_initial.gpr[i];need(sample.gpr[i]==expected,"interrupted GPR relation");}
  need(sample.rflags==(expected_flags|UINT64_C(0x10000)),"interrupted exact RFLAGS");
 }
}
int main(void){
 setvbuf(stdout,NULL,_IONBF,0);gate_fd=open("/dev/ttyS0",O_RDWR|O_NOCTTY);need(gate_fd>=0,"COM1 open");struct termios t;need(!tcgetattr(gate_fd,&t),"COM1 attrs");cfmakeraw(&t);t.c_cflag|=CLOCAL|CREAD;t.c_cc[VMIN]=1;t.c_cc[VTIME]=0;need(!cfsetispeed(&t,B115200)&&!cfsetospeed(&t,B115200)&&!tcsetattr(gate_fd,TCSANOW,&t),"COM1 configure");
 need(sysconf(_SC_PAGESIZE)==4096,"guest pages");int fd=memfd_create("m3b-signal-alias",MFD_CLOEXEC);need(fd>=0&&!ftruncate(fd,4096),"private shared code page");
 rw=mmap((void*)UINT64_C(0x21000000),4096,PROT_READ|PROT_WRITE,MAP_SHARED|MAP_FIXED_NOREPLACE,fd,0);
 rx=mmap((void*)UINT64_C(0x20000000),4096,PROT_READ|PROT_EXEC,MAP_SHARED|MAP_FIXED_NOREPLACE,fd,0);
 need(rw==(void*)UINT64_C(0x21000000)&&rx==(void*)UINT64_C(0x20000000),"exact shared aliases");need(pressure_sentinel_end-pressure_sentinel==17,"exact code template");memset(rw,0xcc,4096);memcpy(rw,pressure_sentinel,17);need(!memcmp(rx,rw,17),"initial alias code");
 pagemap_fd=open("/proc/self/pagemap",O_RDONLY);uint64_t word=0;need(pagemap_fd>=0&&pread(pagemap_fd,&word,8,((uintptr_t)rx/4096)*8)==8,"initial pagemap");physical_frame=word&((UINT64_C(1)<<55)-1);need(physical_frame&&physical_frame*4096<UINT64_C(512)*1024*1024,"bounded actual code PFN");pagemap(rx);pagemap(rw);
 stack_t ss={.ss_sp=signal_stack,.ss_size=sizeof(signal_stack)};need(!sigaltstack(&ss,NULL),"alternate signal stack");struct sigaction sa={0};sa.sa_sigaction=handler;sa.sa_flags=SA_SIGINFO|SA_ONSTACK;sigemptyset(&sa.sa_mask);need(!sigaction(SIGVTALRM,&sa,NULL),"natural signal handler");
 printf("M3B_SIGNAL_ALIAS_LAYOUT:{\"schema\":1,\"rx\":\"0x20000000\",\"rw\":\"0x21000000\",\"a\":\"0x20000004\",\"b\":\"0x20000009\",\"back\":\"0x2000000e\",\"side\":\"0x20000010\",\"end\":\"0x20000011\",\"physicalFrame\":\"0x%llx\",\"timer\":\"ITIMER_VIRTUAL\",\"timerUsec\":10000,\"cases\":8,\"codeHex\":\"89f931c083f900740701f083e901ebf4c3\"}\n",(unsigned long long)physical_frame);
 gate(-2,0,0);execute(-1);for(int i=0;i<8;i++)execute(i);printf("M3B_SIGNAL_ALIAS_PASS:{\"calls\":9,\"signals\":8,\"contexts\":8,\"patches\":8}\n");return 0;
}
