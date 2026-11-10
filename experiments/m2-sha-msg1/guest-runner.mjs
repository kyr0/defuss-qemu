#!/usr/bin/env node
// Shared MSG1-only ISA runner. Entry points require a switch or diagnostic build explicitly.
// One owned Node/QEMU guest process. Root serializes this with measurements.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';
import {checkExposure,fixtureSourceSha256,expectedInstructionCounts,fixtureContract,exposureContract,validateCumulative,checkSerial,faultPass} from './fixture-check.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function runGuest({diagnostic,entrypoint}) {
assert.equal(typeof diagnostic,'boolean');
const {values}=parseArgs({options:{runtime:{type:'string'},fixture:{type:'string'},output:{type:'string'},enabled:{type:'string'},cold:{type:'boolean',default:false}}});
assert.ok(['on','off'].includes(values.enabled));
const path=value=>{assert.ok(value);const result=resolve(root,value);assert.ok(result.startsWith(root+'/'));return result;};
const runtime=path(values.runtime),fixture=path(values.fixture),output=path(values.output);
assert.ok(output.startsWith(resolve(root,'artifacts')+'/'));mkdirSync(dirname(output),{recursive:true});mkdirSync(output);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs=[runtime,runtime.replace(/\.js$/,'.wasm'),resolve(fixture,'initramfs.cpio.gz'),resolve(fixture,'build-report.json'),resolve(root,'assets/bun/amd64/vmlinuz-virt'),fileURLToPath(import.meta.url),fileURLToPath(entrypoint),fileURLToPath(new URL('./fixture-check.mjs',import.meta.url)),resolve(fixture,'guest-fixture.c'),resolve(root,'host/browser/qmp.mjs'),resolve(root,'host/browser/machine.mjs'),resolve(fixture,'fixture'),resolve(fixture,'fixture.disassembly.txt'),resolve(root,'packaging/bun-app/serial.mjs')];
const enabled=values.enabled==='on',hotLimit=values.cold?65535:1500;
const report={schema:1,status:'running',protocol:diagnostic?'defuss-m2-msg1-diagnostic-isa-v1':'defuss-m2-msg1-isa-v1',timingEligible:false,fixtureContract,exposureContract:diagnostic?exposureContract:null,expectedInstructionCounts,enabled:values.enabled,cold:values.cold,node:process.version,gates:[],signals:[],stderr:[],
  settings:{hotLimit,runtimeFlags:2,pressureAdmission:false,smp:1,ramMiB:512,tbMiB:128},
  inputHashes:{},
  scope:'Node Emscripten full-system MSG1 ISA correctness; exact counters only with the diagnostic runtime. Modes0..5 each4096, mode6 includes4096 fault warmups for8192; faulting operand load contributes zero. Fixture flags2 disables pressure admission; this is not production Bun exposure or timing evidence.'};
const qmp=new Qmp(),decoder=new TextDecoder();let mod,port,finish,tail='',serial='',marker=null,signal=false,chain=Promise.resolve(),previous=null;
const done=new Promise(ok=>finish=ok),timer=setTimeout(()=>finish('deadline exceeded'),300000);
function counters(){
  const ptr=Number(mod._defuss_m2_msg1_counts(0)),memory=mod.pcProfileWords().buffer;
  assert.ok(Number.isSafeInteger(ptr)&&ptr>=0&&ptr%8===0&&ptr+24<=memory.byteLength,'Invalid MSG1 counter pointer');
  assert.ok(memory instanceof SharedArrayBuffer,'Shared counter memory required');const words=new BigUint64Array(memory,ptr,3);return Array.from({length:3},(_,i)=>String(Atomics.load(words,i)));
}
function pump(){
  if(marker===null||!signal)return;const kind=marker;marker=null;signal=false;
  chain=chain.then(async()=>{
    await qmp.send('stop');assert.equal((await qmp.send('query-status')).running,false);
    assert.equal(kind,report.gates.length-1,'Gate order differs');
    const row={kind,stopped:true,status:mod._defuss_m2_msg1_status(),pool:mod.pcJitPool?.()};
    assert.equal(row.status,enabled?0x10004:0x10003,'Runtime mode changed');
    if(typeof mod._defuss_m2_msg1_counts==='function'){
      row.counters=counters();validateCumulative(row.counters,{enabled,cold:values.cold});
      if(previous){
        row.delta=row.counters.map((x,i)=>String(BigInt(x)-BigInt(previous[i])));
        row.exposure=checkExposure(row.delta,{enabled,cold:values.cold,mode:kind});
      }
      previous=row.counters;
    }
    report.gates.push(row);port.write('K');await qmp.send('cont');
  }).catch(error=>finish(String(error.stack||error)));
}
function line(text){
  if(text.includes('FIXTURE_FAIL')||text.includes('Kernel panic'))finish(text);
  const gate=text.match(/^MSG1_GATE:(-?\d+)$/);
  if(gate){if(marker!==null){finish('Overlapping gate marker');return;}marker=Number(gate[1]);pump();}
  if(text.startsWith('MSG1_FIXTURE_PASS'))report.fixturePass=text;
  if(text.startsWith('MSG1_FAULT_PASS')){assert.equal(report.faultPass,undefined,'Repeated fault success marker');report.faultPass=text;}
  if(text==='FIXTURE_PASS')finish('pass');
}
try{
  for(const input of inputs)report.inputHashes[relative(root,input)]=sha(readFileSync(input));
const fixtureReport=JSON.parse(readFileSync(resolve(fixture,'build-report.json')));
assert.equal(fixtureReport.status,'passed');assert.equal(sha(readFileSync(resolve(fixture,'initramfs.cpio.gz'))),fixtureReport.initramfsSha256);
assert.equal(fixtureReport.inputHashes['experiments/m2-sha-msg1/guest-fixture.c'],fixtureSourceSha256,'Unknown fixture source/count contract');
assert.equal(sha(readFileSync(resolve(fixture,'guest-fixture.c'))),fixtureSourceSha256,'Archived guest source changed');
assert.equal(fixtureReport.modes,7);assert.equal(fixtureReport.checksPerMode,4096);assert.equal(fixtureReport.totalChecks,28672);
assert.equal(fixtureReport.memoryFault?.warmup,4096);assert.equal(fixtureReport.memoryFault?.faults,1);
  assert.equal(fixtureReport.fixtureContract,fixtureContract);assert.equal(fixtureReport.instruction,'sha256msg1');
  assert.equal(fixtureReport.successfulInstructions,32768);assert.deepEqual(fixtureReport.expectedInstructionCounts,expectedInstructionCounts.map(Number));
  assert.equal(fixtureReport.memoryFault.successfulFaultingInstructions,0);
  assert.equal(sha(readFileSync(resolve(fixture,'fixture'))),fixtureReport.binarySha256);
  assert.equal(fixtureReport.staticInstructions.sha256msg1,8);assert.equal(fixtureReport.staticInstructions.sha256msg2,0);
  assert.equal(sha(readFileSync(resolve(fixture,'fixture.disassembly.txt'))),fixtureReport.staticInstructions.disassemblySha256);
  for(const [name,digest] of Object.entries(fixtureReport.inputHashes)){
    const input=path(name);assert.equal(sha(readFileSync(input)),digest,'Fixture build input changed: '+name);report.inputHashes[relative(root,input)]=digest;
  }
  const build=resolve(dirname(runtime),'../..'),buildReportPath=resolve(build,'build-report.json');
  assert.equal(runtime,resolve(build,'runtime/x86_64/qemu-system-x86_64.js'),'Use a fresh SDK build runtime path');
  const buildReport=JSON.parse(readFileSync(buildReportPath));assert.equal(buildReport.status,'passed');assert.ok(buildReport.targets.includes('x86_64-softmmu'));
  report.inputHashes[relative(root,buildReportPath)]=sha(readFileSync(buildReportPath));
  for(const [name,identity] of Object.entries(buildReport.artifacts)){
    const input=resolve(build,name);assert.ok(input.startsWith(resolve(build,'runtime')+'/'));
    const bytes=readFileSync(input);assert.equal(bytes.length,identity.bytes);assert.equal(sha(bytes),identity.sha256,'Runtime build artifact changed');report.inputHashes[relative(root,input)]=identity.sha256;
  }
  const source=path(buildReport.source.startsWith('/project/')?buildReport.source.slice('/project/'.length):buildReport.source);
  const overlayPath=source+'-m2-msg1-overlay.json',overlay=JSON.parse(readFileSync(overlayPath));
  assert.equal(overlay.experiment,'m2-sha-msg1');assert.equal(overlay.mode,diagnostic?'diagnostic':'switch');
  assert.equal(overlay.kind,diagnostic?'diagnostic-only':'uninstrumented');assert.equal(overlay.configAbi,1);assert.equal(overlay.defaultEnabled,false);
  report.inputHashes[relative(root,overlayPath)]=sha(readFileSync(overlayPath));
  const implementationPath=resolve(root,'artifacts/m2-msg1-implementation-01/manifest.json');
  const implementationBytes=readFileSync(implementationPath),implementation=JSON.parse(implementationBytes);
  assert.equal(sha(implementationBytes),'b04500ea12e5719bfa3ff317b28fd0d31ddf292f8b4b318303f3517bd987a874','Reviewed MSG1 implementation identity changed');
  report.inputHashes[relative(root,implementationPath)]=sha(implementationBytes);
  for(const name of ['prepare.py','config.c.inc','lowering.c.inc']){
    const input=resolve(root,'experiments/m2-sha-msg1',name),key=relative(root,input),digest=sha(readFileSync(input));
    assert.equal(digest,implementation.files[key].sha256);assert.equal(overlay.inputs[name],digest,'Runtime overlay uses a different MSG1 implementation');report.inputHashes[key]=digest;
  }
  for(const change of overlay.changes){
    const input=resolve(source,change.path);assert.ok(input.startsWith(source+'/'));
    assert.equal(sha(readFileSync(input)),change.after,'Prepared MSG1 overlay changed');report.inputHashes[relative(root,input)]=change.after;
  }
  report.runtimeBuild={path:relative(root,buildReportPath),sourceFingerprint:buildReport.sourceFingerprint,overlay:relative(root,overlayPath),mode:overlay.mode};
  for(const name of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin']){
    const input=resolve(root,'engine/qemu/pc-bios',name);report.inputHashes[relative(root,input)]=sha(readFileSync(input));
  }
  writeFileSync(resolve(output,'request.json'),JSON.stringify({...report,entrypoint:relative(root,fileURLToPath(entrypoint)),runtime:relative(root,runtime),fixture:relative(root,fixture)},null,2)+'\n',{flag:'wx'});
  const {default:factory}=await import(pathToFileURL(runtime));
  factory({mainScriptUrlOrBlob:runtime,arguments:['-nodefaults','-machine','pc,acpi=off','-cpu','max','-accel','tcg,tb-size=128','-smp','1','-m','512','-display','none','-monitor','none','-qmp','stdio',
    '-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1','-serial','file:/guest/console.log','-parallel','none','-no-reboot','-L','/rom',
    '-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on'],
    printErr:text=>report.stderr.push(String(text)),onAbort:error=>finish('Abort: '+error),
    preRun:[m=>{
      mod=m;assert.equal(typeof m._defuss_m2_msg1_counts==='function',diagnostic,'Wrong MSG1 switch/diagnostic build');assert.equal(typeof m._defuss_m2_msg2_status,'undefined','Combined MSG2 runtime is not this experiment');assert.equal(m._defuss_m2_msg1_status(),0x10000);assert.equal(m._defuss_m2_msg1_config(enabled?1:0),0);
      report.configuredStatus=m._defuss_m2_msg1_status();assert.equal(report.configuredStatus,enabled?0x10002:0x10001);
      m._defuss_set_hot_limit(hotLimit);m._defuss46_settings(2); // Disable pressure admission for ISA exposure.
      m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',readFileSync(resolve(root,'assets/bun/amd64/vmlinuz-virt')));
      m.FS.writeFile('/guest/initramfs',readFileSync(resolve(fixture,'initramfs.cpio.gz')));
      for(const name of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin']){const p=resolve(root,'engine/qemu/pc-bios',name);const bytes=readFileSync(p);report.inputHashes[relative(root,p)]=sha(bytes);m.FS.writeFile('/rom/'+name,bytes);}
      port=attachCom1(m,data=>{if(data.length!==1||data[0]!==71||signal){finish('Invalid COM1 gate');return;}report.signals.push(71);signal=true;pump();});
      m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops;
      node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});serial+=text;tail+=text;if(serial.length>16777216||tail.length>1048576){finish('Unbounded guest console');return count;}let end;while((end=tail.indexOf('\n'))>=0){const part=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);line(part);}return count;}};
      m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
      m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(b.subarray(o,o+n));return n;}return original(s,b,o,n,p);};
    }]}).catch(error=>finish(String(error.stack||error)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  assert.equal(await done,'pass');await chain;await qmp.send('stop');assert.equal((await qmp.send('query-status')).running,false);
  assert.equal(report.gates.length,8);assert.equal(report.fixturePass,'MSG1_FIXTURE_PASS checks=28672');
  assert.equal(report.faultPass,faultPass);report.serialContract=checkSerial(serial);assert.equal(report.signals.length,8);
  report.lateConfigurationResult=mod._defuss_m2_msg1_config(enabled?0:1);assert.equal(report.lateConfigurationResult,-1,'Late mode change must be rejected');
  report.finalStatus=mod._defuss_m2_msg1_status();assert.equal(report.finalStatus,enabled?0x10004:0x10003);report.executionCounts=typeof mod._defuss_m2_msg1_counts==='function';report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack||error);}
clearTimeout(timer);
try{for(const [p,hash] of Object.entries(report.inputHashes))assert.equal(sha(readFileSync(resolve(root,p))),hash,'Input changed: '+p);}catch(error){report.status='failed';report.failure??=String(error.stack||error);}
writeFileSync(resolve(output,'serial.log'),serial,{flag:'wx'});writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,output,fixturePass:report.fixturePass,executionCounts:report.executionCounts,failure:report.failure}));
process.exit(report.status==='passed'?0:1);

}
