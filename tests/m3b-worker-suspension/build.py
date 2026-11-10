#!/usr/bin/env python3
"""Build the isolated fused-sentinel pressure guest in the pinned Linux SDK."""
import argparse,datetime,gzip,hashlib,json,os,re,shutil,stat,struct,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
sys.dont_write_bytecode=True;sys.path.insert(0,str(ROOT/'packaging'))
from bun_app_package import unpack_cpio,write_cpio,PINS,sha
SDK='registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812'
SENTINEL_HEX='83f900740701f083e901ebf4'
def write(path,data):
 if not isinstance(data,bytes):data=(json.dumps(data,indent=2)+'\n').encode()
 with path.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 fd=os.open(path.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--output',required=True);args=ap.parse_args()
 out=(ROOT/args.output).resolve();assert out.is_relative_to(ROOT/'artifacts') and str(out.relative_to(ROOT))==args.output and not out.exists();out.mkdir(parents=True)
 fd=os.open(out.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
 scratch=Path(tempfile.mkdtemp(prefix='m3s-pressure-image-',dir=ROOT/'tmp'));env={**os.environ,'TMPDIR':str(scratch),'TMP':str(scratch),'TEMP':str(scratch)}
 paths=[HERE/'build.py',HERE/'fixture.c',HERE/'fixture.S',HERE/'guest-contract.mjs',ROOT/'experiments/m3b-fallthrough/predecode.h',ROOT/'packaging/bun_app_package.py',*(ROOT/'scripts'/n for n in ['sdk.py','build.py','container_engine.py','runtime_dependencies.py'])]
 source_bytes={str(p.relative_to(ROOT)):p.read_bytes() for p in paths};sources={name:hashlib.sha256(data).hexdigest() for name,data in source_bytes.items()};base=ROOT/'assets/bun/amd64/initramfs-virt';base_bytes=base.read_bytes();assert hashlib.sha256(base_bytes).hexdigest()==PINS[base]
 report={'schema':1,'kind':'m3b-worker-suspension-fixture-image','status':'failed','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':sources,'baseInitramfsSha256':hashlib.sha256(base_bytes).hexdigest(),'commands':[],'scratch':str(scratch.relative_to(ROOT)),'guestExecuted':False,'timingEligible':False}
 write(out/'started.json',report)
 def command(argv,timeout=90):
  p=subprocess.run(argv,cwd=ROOT,env=env,capture_output=True,timeout=timeout)
  row={'argv':list(map(str,argv)),'exitCode':p.returncode,'stdout':p.stdout.decode(errors='replace'),'stderr':p.stderr.decode(errors='replace')};report['commands'].append(row);write(out/f'command-{len(report["commands"]):02}.json',row)
  if p.returncode:raise ValueError('Command failed: '+str(argv))
  return p.stdout
 try:
  assert str(ROOT)=='/project' and sys.platform=='linux','Use the pinned scripts/sdk.py invocation'
  invocation_path=Path(os.environ.get('TMPDIR',''))/'invocation.json';assert invocation_path.parent.parent==ROOT/'tmp' and invocation_path.parent.name.startswith('sdk-')
  invocation_bytes=invocation_path.read_bytes();invocation=json.loads(invocation_bytes)
  assert invocation['schema']==1 and invocation['status']=='running' and invocation['sdk']==SDK
  assert invocation['containerScratch']==str(invocation_path.parent)
  host_scratch=Path(invocation['scratch']);host_root=host_scratch.parent.parent
  assert host_scratch.is_absolute() and host_scratch.parent.name=='tmp' and host_scratch.name==invocation_path.parent.name and '..' not in host_scratch.parts
  tail=['run','--rm','--platform','linux/amd64','--network','none',
        '-e','TMPDIR='+str(invocation_path.parent),'-e','TMP='+str(invocation_path.parent),'-e','TEMP='+str(invocation_path.parent),
        '-v',str(host_root)+':/project','-v','qemu-wasm-arm64-sdk-cache:/emsdk/upstream/emscripten/cache','-w','/project',SDK,
        'python3','tests/m3b-worker-suspension/build.py','--output',args.output]
  assert isinstance(invocation['command'],list) and len(invocation['command'])>len(tail) and invocation['command'][-len(tail):]==tail
  write(out/'sdk-invocation-start.json',invocation_bytes)
  report['sdk']=SDK;report['sdkInvocation']={'path':str(invocation_path.relative_to(ROOT)),'startArtifact':'sdk-invocation-start.json','completionRequired':True,'scope':'Invocation was running at image construction; launcher must bind completed wrapper evidence separately.'}
  tools={}
  for name in ['gcc','nm','objdump']:
   found=shutil.which(name);assert found,'Missing required SDK tool: '+name
   path=Path(found).resolve();tools[name]={'path':str(path),'sha256':sha(path),'bytes':path.stat().st_size}
   tools[name]['version']=command([str(path),'--version']).decode();assert tools[name]['version'].strip()
  report['tools']=tools;compiler=tools['gcc']['path']
  target=command([compiler,'-dumpmachine']).decode().strip();assert 'x86_64' in target and 'linux' in target,'Linux x86-64 compiler required';report['compilerTarget']=target
  copied={}
  for name,source in [('fixture.c','tests/m3b-worker-suspension/fixture.c'),('fixture.S','tests/m3b-worker-suspension/fixture.S'),('predecode.h','experiments/m3b-fallthrough/predecode.h')]:
   write(out/name,source_bytes[source]);assert sha(out/name)==sources[source]
   copied[source]={'artifact':name,'sha256':sources[source],'bytes':len(source_bytes[source])}
  report['copiedSources']=copied
  command([compiler,'-O2','-static','-fno-pie','-no-pie','-mno-red-zone','-fno-tree-vectorize','-fno-tree-slp-vectorize',str(out/'fixture.c'),str(out/'fixture.S'),'-o',str(out/'fixture')])
  binary=(out/'fixture').read_bytes();assert binary[:6]==b'\x7fELF\x02\x01' and struct.unpack_from('<HH',binary,16)==(2,62)
  phoff,shoff=struct.unpack_from('<QQ',binary,32);phsize,phnum,shsize,shnum,strings=struct.unpack_from('<HHHHH',binary,54)
  assert phsize==56 and shsize==64 and 0<shnum<4096
  assert all(struct.unpack_from('<I',binary,phoff+i*phsize)[0]!=3 for i in range(phnum)),'No dynamic interpreter'
  sections=[struct.unpack_from('<IIQQQQIIQQ',binary,shoff+i*64) for i in range(shnum)];st=sections[strings];names=binary[st[4]:st[4]+st[5]]
  text=next(s for s in sections if names[s[0]:].split(b'\0',1)[0]==b'.text');assert text[2]&4
  syms=command([tools['nm']['path'],'-n','--defined-only',str(out/'fixture')]);write(out/'symbols.txt',syms)
  symbols={m[2]:int(m[1],16) for line in syms.decode().splitlines() if (m:=re.fullmatch(r'([0-9a-fA-F]+)\s+\w\s+(\S+)',line))}
  dis=command([tools['objdump']['path'],'-d','-w','--no-show-raw-insn',str(out/'fixture')]);write(out/'disassembly.txt',dis)
  insns=[int(m[1],16) for line in dis.decode().splitlines() if (m:=re.match(r'^\s*([0-9a-fA-F]+):\s+\S',line))]
  fn,a,b,back,side,end=[symbols['pressure_sentinel'+suffix] for suffix in ['', '_loop','_b','_back','_side','_end']]
  assert text[3]<=fn<a<b<back<side<end<=text[3]+text[5]
  assert fn%4096==0 and a==fn+4 and b==a+5 and back==a+10 and side==a+12 and end==a+13
  code=binary[text[4]+a-text[3]:text[4]+side-text[3]];count=sum(a<=pc<side for pc in insns)
  assert code.hex()==SENTINEL_HEX and count==5 and a//4096==(end-1)//4096
  assert binary[text[4]+fn-text[3]:text[4]+a-text[3]]==bytes.fromhex('89f931c0')
  assert binary[text[4]+side-text[3]:text[4]+end-text[3]]==b'\xc3'
  sentinel={'a':hex(a),'b':hex(b),'back':hex(back),'side':hex(side),'end':hex(end),'ownerBytes':len(code),'codeHex':code.hex()}
  layout={'schema':1,'sentinel':sentinel}
  probe=['#include <assert.h>','#include "predecode.h"','int main(void){ struct m3b_plan p;',
    '{ const unsigned char code[]={'+','.join(map(str,code))+'};',
    f'assert(m3b_predecode(code,sizeof(code),{4096-(a&4095)},32,&p)==M3B_SHAPE_OK);',
    'assert(p.bytes==12 && p.count==5 && p.b_offset==5 && p.jcc_index==1 && p.jcc_target_offset==12 && p.backedge_offset==10);}',
    'const unsigned offsets[]={0,2,4,9,11,13};',
    'for (unsigned i=0;i<12000;i++) {',
    'unsigned char churn[]={0x89,0xf9,0x31,0xc0,0x05,0,0,0,0,0xff,0xc9,0x75,0xf7,0xc3};',
    'uint32_t step=UINT32_C(0x10203041)+i*2; memcpy(churn+5,&step,4);',
    'for (unsigned j=0;j<sizeof(offsets)/sizeof(offsets[0]);j++) { unsigned off=offsets[j];',
    'assert(m3b_predecode(churn+off,sizeof(churn)-off,4096-((i*64+off)&4095),32,&p)!=M3B_SHAPE_OK);',
    '}} return 0;}']
  write(out/'shape-probe.c',('\n'.join(probe)+'\n').encode())
  command([compiler,'-std=c11','-O2','-I'+str(out),str(out/'shape-probe.c'),'-o',str(scratch/'shape-probe')]);command([str(scratch/'shape-probe')])
  write(out/'layout.json',layout);entries=unpack_cpio(gzip.decompress(base_bytes))
  init=b'''#!/bin/busybox sh
export PATH=/bin:/sbin:/usr/bin:/sbin
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
/fixture
rc=$?
if [ "$rc" -ne 0 ]; then echo M3S_PRESSURE_FAIL:guest-exit-$rc; fi
while :; do sleep 1; done
'''
  entries['init']=(stat.S_IFREG|0o755,0,0,init,0,0);entries['fixture']=(stat.S_IFREG|0o755,0,0,binary,0,0);entries['TRAILER!!!']=(0,0,0,b'',0,0);write_cpio(entries,out/'initramfs.cpio.gz')
  for name,h in sources.items():assert sha(ROOT/name)==h,'Source changed: '+name
  for source,row in copied.items():assert sha(out/row['artifact'])==row['sha256'],'Copied compiler input changed: '+source
  for name,row in tools.items():assert sha(Path(row['path']))==row['sha256'],'SDK tool changed: '+name
  assert sha(base)==report['baseInitramfsSha256'],'Base initramfs changed'
  artifacts={}
  for name in ['fixture.c','fixture.S','predecode.h','sdk-invocation-start.json','fixture','initramfs.cpio.gz','disassembly.txt','symbols.txt','layout.json','shape-probe.c']:
   path=out/name
   with path.open('rb') as f:os.fsync(f.fileno())
   artifacts[name]={'sha256':sha(path),'bytes':path.stat().st_size}
  report.update(status='passed',binarySha256=artifacts['fixture']['sha256'],initramfsSha256=artifacts['initramfs.cpio.gz']['sha256'],artifacts=artifacts,hostShapeValidated=True,layout=layout,shapeEvidence={'sentinelBytes':12,'sentinelInstructions':5,'sentinelPredecode':'accept','churnNodes':12000,'entriesPerChurnNode':6,'churnPredecodeRejections':72000},scope='Exact ELF/disassembly and actual predecoder validation only; real fused selection, natural retirement and guest correctness remain unexecuted.')
 except Exception as e:report['failure']=repr(e)
 finally:write(out/'build-report.json',report)
 print(json.dumps({'status':report['status'],'output':str(out)}));return 0 if report['status']=='passed' else 1
if __name__=='__main__':raise SystemExit(main())
