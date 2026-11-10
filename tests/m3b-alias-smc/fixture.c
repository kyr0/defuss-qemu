#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <termios.h>
#include <sys/mman.h>
#include <errno.h>

extern unsigned char pressure_sentinel[],pressure_sentinel_end[];
enum { PAGE_BYTES=4096, CODE_BYTES=17, CASES=8 };
static const uint32_t iterations[CASES]={0,1,17,4096,100000,100003,100019,131071};
static unsigned char *rw,*rx;
static int gate_fd,pagemap_fd;
static unsigned checks,patches,sequence;
static uint64_t physical_frame;
static void fail(const char *why){fprintf(stderr,"M3B_ALIAS_FAIL:%s errno=%d\n",why,errno);fflush(stderr);exit(1);}
static void insist(int ok,const char *why){if(!ok)fail(why);}
static uint64_t pagemap(const void *p){
 uint64_t word=0;off_t offset=(off_t)(((uintptr_t)p/PAGE_BYTES)*8);
 insist(pread(pagemap_fd,&word,sizeof(word),offset)==sizeof(word),"read pagemap");
 insist((word>>63)==1&&!(word&(UINT64_C(1)<<62)),"present unswapped alias");
 insist((word&((UINT64_C(1)<<55)-1))!=0,"nonzero exposed PFN");return word;
}
static void hexbytes(const unsigned char *p){for(unsigned i=0;i<CODE_BYTES;i++)printf("%02x",p[i]);}
static void gate(const char *stage,const uint32_t *values){
 uint64_t a=pagemap(rx),b=pagemap(rw),mask=(UINT64_C(1)<<55)-1;
 insist((a&mask)==physical_frame&&(b&mask)==physical_frame,"same persistent physical page");
 insist(!memcmp(rx,rw,CODE_BYTES),"coherent alias code bytes");
 printf("M3B_ALIAS_GATE:{\"seq\":%u,\"stage\":\"%s\",\"checks\":%u,\"patches\":%u,\"rxPagemap\":\"0x%llx\",\"rwPagemap\":\"0x%llx\",\"rxHex\":\"",sequence++,stage,checks,patches,(unsigned long long)a,(unsigned long long)b);
 hexbytes(rx);printf("\",\"rwHex\":\"");hexbytes(rw);printf("\",\"values\":[");
 if(values)for(unsigned i=0;i<CASES;i++)printf("%s%u",i?",":"",values[i]);printf("]}\n");
 insist(write(gate_fd,"G",1)==1&&!tcdrain(gate_fd),"gate signal");char ack=0;insist(read(gate_fd,&ack,1)==1&&ack=='K',"exact gate ACK");
}
static void execute(int subtract,const char *stage){
 uint32_t values[CASES];uint32_t (*fn)(uint32_t,uint32_t)=(void*)rx;
 for(unsigned i=0;i<CASES;i++){
  uint32_t step=UINT32_C(0x9e3779b9)^(i*UINT32_C(0x10203041));
  uint32_t expected=(uint32_t)((uint64_t)iterations[i]*step);if(subtract)expected=0u-expected;
  values[i]=fn(iterations[i],step);checks++;insist(values[i]==expected,"exact alias-modified arithmetic");
 }
 gate(stage,values);
}
int main(void){
 setvbuf(stdout,NULL,_IONBF,0);gate_fd=open("/dev/ttyS0",O_RDWR|O_NOCTTY);insist(gate_fd>=0,"COM1 open");
 struct termios t;insist(!tcgetattr(gate_fd,&t),"COM1 attrs");cfmakeraw(&t);t.c_cflag|=CLOCAL|CREAD;t.c_cc[VMIN]=1;t.c_cc[VTIME]=0;
 insist(!cfsetispeed(&t,B115200)&&!cfsetospeed(&t,B115200)&&!tcsetattr(gate_fd,TCSANOW,&t),"COM1 configure");
 insist(sysconf(_SC_PAGESIZE)==PAGE_BYTES,"4 KiB guest pages");int fd=memfd_create("m3b-alias",MFD_CLOEXEC);insist(fd>=0&&!ftruncate(fd,PAGE_BYTES),"private memfd page");
 rw=mmap((void*)UINT64_C(0x21000000),PAGE_BYTES,PROT_READ|PROT_WRITE,MAP_SHARED|MAP_FIXED_NOREPLACE,fd,0);
 rx=mmap((void*)UINT64_C(0x20000000),PAGE_BYTES,PROT_READ|PROT_EXEC,MAP_SHARED|MAP_FIXED_NOREPLACE,fd,0);
 insist(rw==(void*)UINT64_C(0x21000000)&&rx==(void*)UINT64_C(0x20000000),"distinct exact shared mappings");
 insist(pressure_sentinel_end-pressure_sentinel==CODE_BYTES,"exact linked code template");memset(rw,0xcc,PAGE_BYTES);memcpy(rw,pressure_sentinel,CODE_BYTES);
 insist(!memcmp(rx,rw,CODE_BYTES)&&rx[9]==0x01,"initial coherent ADD code");pagemap_fd=open("/proc/self/pagemap",O_RDONLY);insist(pagemap_fd>=0,"pagemap open");
 physical_frame=pagemap(rx)&((UINT64_C(1)<<55)-1);insist(physical_frame*PAGE_BYTES<UINT64_C(512)*1024*1024,"guest RAM code frame");
 printf("M3B_ALIAS_LAYOUT:{\"schema\":1,\"rx\":\"0x20000000\",\"rw\":\"0x21000000\",\"a\":\"0x20000004\",\"b\":\"0x20000009\",\"back\":\"0x2000000e\",\"side\":\"0x20000010\",\"end\":\"0x20000011\",\"pageBytes\":4096,\"codeBytes\":17,\"physicalFrame\":\"0x%llx\"}\n",(unsigned long long)physical_frame);
 gate("layout",NULL);execute(0,"add-complete");
 ((volatile unsigned char*)rw)[9]=0x29;patches++;__asm__ __volatile__("":::"memory");insist(rx[9]==0x29,"SUB visible through RX alias");gate("sub-patched",NULL);execute(1,"sub-complete");
 ((volatile unsigned char*)rw)[9]=0x01;patches++;__asm__ __volatile__("":::"memory");insist(rx[9]==0x01,"ADD restored through RX alias");gate("add-patched",NULL);execute(0,"add-restored-complete");
 printf("M3B_ALIAS_PASS:{\"checks\":%u,\"calls\":24,\"patches\":%u}\n",checks,patches);return 0;
}
