#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <termios.h>
#include <sys/mman.h>
#include <time.h>
#include <errno.h>

enum { NODES=12000, STRIDE=64, ITERATIONS=100000, BATCH=64, RETRIES=16 };
extern uint32_t pressure_sentinel(uint32_t,uint32_t);
extern char pressure_sentinel_loop,pressure_sentinel_b,pressure_sentinel_back;
extern char pressure_sentinel_side,pressure_sentinel_end;
static int gate_fd;
static uint64_t checks;
static void fail(const char *s){fprintf(stderr,"M3S_PRESSURE_FAIL:%s errno=%d\n",s,errno);fflush(stderr);exit(1);}
static void require(int ok,const char *s){checks++;if(!ok)fail(s);}
static char gate(const char *stage,unsigned nodes,unsigned attempt){
 printf("M3S_PRESSURE_GATE:{\"stage\":\"%s\",\"nodes\":%u,\"attempt\":%u,\"checks\":%llu}\n",stage,nodes,attempt,(unsigned long long)checks);
 if(write(gate_fd,"G",1)!=1||tcdrain(gate_fd))fail("gate signal");
 char ack=0;if(read(gate_fd,&ack,1)!=1||(ack!='K'&&ack!='R'))fail("gate ACK");return ack;
}
static void sentinel(void){
 const uint32_t step=UINT32_C(0x9e3779b9);
 require(pressure_sentinel(ITERATIONS,step)==(uint32_t)((uint64_t)ITERATIONS*step),"sentinel arithmetic");
}
int main(void){
 setvbuf(stdout,NULL,_IONBF,0);gate_fd=open("/dev/ttyS0",O_RDWR|O_NOCTTY);if(gate_fd<0)fail("COM1 open");
 struct termios t;if(tcgetattr(gate_fd,&t))fail("COM1 attrs");cfmakeraw(&t);t.c_cflag|=CLOCAL|CREAD;t.c_cc[VMIN]=1;t.c_cc[VTIME]=0;
 if(cfsetispeed(&t,B115200)||cfsetospeed(&t,B115200)||tcsetattr(gate_fd,TCSANOW,&t))fail("COM1 configure");
 const size_t bytes=NODES*STRIDE;uint8_t *code=mmap(NULL,bytes,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 require(code!=MAP_FAILED,"code mapping");memset(code,0xcc,bytes);
 for(unsigned i=0;i<NODES;i++){
  uint32_t step=UINT32_C(0x10203041)+i*2;uint8_t *p=code+i*STRIDE;
  p[0]=0x89;p[1]=0xf9; // mov edi,ecx
  p[2]=0x31;p[3]=0xc0; // xor eax,eax
  p[4]=0x05;memcpy(p+5,&step,4); // add immediate,eax: loop entry
  p[9]=0xff;p[10]=0xc9; // dec ecx
  p[11]=0x75;p[12]=0xf7; // jnz loop entry at offset4
  p[13]=0xc3;
 }
 require(!mprotect(code,bytes,PROT_READ|PROT_EXEC),"publish generated loops");
 printf("M3S_PRESSURE_LAYOUT:{\"schema\":1,\"sentinel\":{\"a\":\"0x%llx\",\"b\":\"0x%llx\",\"back\":\"0x%llx\",\"side\":\"0x%llx\",\"end\":\"0x%llx\",\"ownerBytes\":%llu,\"codeHex\":\"",
  (unsigned long long)(uintptr_t)&pressure_sentinel_loop,(unsigned long long)(uintptr_t)&pressure_sentinel_b,
  (unsigned long long)(uintptr_t)&pressure_sentinel_back,(unsigned long long)(uintptr_t)&pressure_sentinel_side,
  (unsigned long long)(uintptr_t)&pressure_sentinel_end,
  (unsigned long long)((uintptr_t)&pressure_sentinel_side-(uintptr_t)&pressure_sentinel_loop));
 for(unsigned i=0;i<12;i++)printf("%02x",((const unsigned char*)&pressure_sentinel_loop)[i]);
 printf("\"},\"generated\":[\"0x%llx\",\"0x%llx\"],\"maxNodes\":%u,\"batch\":%u,\"iterations\":%u,\"retries\":%u,\"sleepNs\":1000000000}\n",
  (unsigned long long)(uintptr_t)code,(unsigned long long)(uintptr_t)(code+bytes),NODES,BATCH,ITERATIONS,RETRIES);
 if(gate("layout",0,0)!='K')fail("layout ACK");
 unsigned used=0;int warmed=0,retired=0;
 for(unsigned i=0;i<NODES;i++){
  uint32_t step=UINT32_C(0x10203041)+i*2;uint32_t (*fn)(uint32_t)=(void*)(code+i*STRIDE);
  require(fn(ITERATIONS)==(uint32_t)((uint64_t)ITERATIONS*step),"generated-loop arithmetic");used=i+1;
  if(used%BATCH==0||used==NODES){
   if(gate(warmed?"churn":"prefill",used,0)=='R'){
    if(warmed){retired=1;break;}
    for(unsigned j=0;j<8;j++)sentinel();
    if(gate("warm",used,0)!='K')fail("warm ACK");warmed=1;
   }
  }
 }
 if(!retired)fail("bounded churn did not reach ordinary retirement");
 unsigned attempts=0;
 for(unsigned attempt=0;attempt<RETRIES;attempt++){
  if(attempt){struct timespec delay={1,0};int rc;do{rc=nanosleep(&delay,&delay);}while(rc&&errno==EINTR);if(rc)fail("sleep");}
  sentinel();attempts=attempt+1;if(gate("revisit",used,attempt)!='K')fail("fixed revisit ACK");
 }
 printf("M3S_PRESSURE_PASS:{\"checks\":%llu,\"nodes\":%u,\"attempts\":%u}\n",(unsigned long long)checks,used,attempts);
 return 0;
}
