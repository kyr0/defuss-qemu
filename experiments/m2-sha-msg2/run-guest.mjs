#!/usr/bin/env node
// One owned Node/QEMU guest process. Root must serialize this with measurements.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';
import {checkExposure} from './fixture-check.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const {values}=parseArgs({options:{runtime:{type:'string'},fixture:{type:'string'},output:{type:'string'},enabled:{type:'string'},cold:{type:'boolean',default:false}}});
assert.ok(['on','off'].includes(values.enabled));
const path=value=>{assert.ok(value);const result=resolve(root,value);assert.ok(result.startsWith(root+'/'));return result;};
const runtime=path(values.runtime),fixture=path(values.fixture),output=path(values.output);
assert.ok(output.startsWith(resolve(root,'artifacts')+'/'));mkdirSync(dirname(output),{recursive:true});mkdirSync(output);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs=[runtime,runtime.replace(/\.js$/,'.wasm'),resolve(fixture,'initramfs.cpio.gz'),resolve(fixture,'build-report.json'),resolve(root,'assets/bun/amd64/vmlinuz-virt'),fileURLToPath(import.meta.url),fileURLToPath(new URL('./fixture-check.mjs',import.meta.url))];
const fixtureReport=JSON.parse(readFileSync(resolve(fixture,'build-report.json')));
assert.equal(fixtureReport.status,'passed');assert.equal(sha(readFileSync(resolve(fixture,'initramfs.cpio.gz'))),fixtureReport.initramfsSha256);
const enabled=values.enabled==='on',hotLimit=values.cold?65535:1500;
const report={schema:1,status:'running',enabled:values.enabled,cold:values.cold,node:process.version,gates:[],stderr:[],
  settings:{hotLimit,runtimeFlags:2,pressureAdmission:false,smp:1,ramMiB:512,tbMiB:128},
  inputHashes:Object.fromEntries(inputs.map(p=>[relative(root,p),sha(readFileSync(p))])),
  scope:'Full-system SHA256MSG2 ISA correctness; performance build exposure is translation/configuration evidence only; diagnostic builds additionally count execution'};
const qmp=new Qmp(),decoder=new TextDecoder();let mod,port,finish,tail='',serial='',marker=null,signal=false,chain=Promise.resolve(),previous=null;
const done=new Promise(ok=>finish=ok),timer=setTimeout(()=>finish('deadline exceeded'),300000);
function counters(){
  const ptr=Number(mod._defuss_m2_msg2_counts(0)),memory=mod.pcProfileWords().buffer;
  assert.ok(Number.isSafeInteger(ptr)&&ptr>=0&&ptr%8===0&&ptr+24<=memory.byteLength,'Invalid MSG2 counter pointer');
  const words=new BigUint64Array(memory,ptr,3);return Array.from({length:3},(_,i)=>String(Atomics.load(words,i)));
}
function pump(){
  if(marker===null||!signal)return;const kind=marker;marker=null;signal=false;
  chain=chain.then(async()=>{
    await qmp.send('stop');assert.equal((await qmp.send('query-status')).running,false);
    assert.equal(kind,report.gates.length-1,'Gate order differs');
    const row={kind,status:mod._defuss_m2_msg2_status(),pool:mod.pcJitPool?.()};
    assert.equal(row.status,enabled?0x10004:0x10003,'Runtime mode changed');
    if(typeof mod._defuss_m2_msg2_counts==='function'){
      row.counters=counters();
      if(previous){
        row.delta=row.counters.map((x,i)=>String(BigInt(x)-BigInt(previous[i])));
        checkExposure(row.delta,{enabled,cold:values.cold});
      }
      previous=row.counters;
    }
    report.gates.push(row);port.write('K');await qmp.send('cont');
  }).catch(error=>finish(String(error.stack||error)));
}
function line(text){
  if(text.includes('FIXTURE_FAIL')||text.includes('Kernel panic'))finish(text);
  const gate=text.match(/^MSG2_GATE:(-?\d+)$/);
  if(gate){if(marker!==null){finish('Overlapping gate marker');return;}marker=Number(gate[1]);pump();}
  if(text.startsWith('MSG2_FIXTURE_PASS'))report.fixturePass=text;
  if(text.startsWith('MSG2_FAULT_PASS')){assert.equal(report.faultPass,undefined,'Repeated fault success marker');report.faultPass=text;}
  if(text==='FIXTURE_PASS')finish('pass');
}
try{
  const {default:factory}=await import(pathToFileURL(runtime));
  factory({mainScriptUrlOrBlob:runtime,arguments:['-nodefaults','-machine','pc,acpi=off','-cpu','max','-accel','tcg,tb-size=128','-smp','1','-m','512','-display','none','-monitor','none','-qmp','stdio',
    '-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1','-serial','file:/guest/console.log','-parallel','none','-no-reboot','-L','/rom',
    '-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on'],
    printErr:text=>report.stderr.push(String(text)),onAbort:error=>finish('Abort: '+error),
    preRun:[m=>{
      mod=m;assert.equal(m._defuss_m2_msg2_status(),0x10000);assert.equal(m._defuss_m2_msg2_config(enabled?1:0),0);
      report.configuredStatus=m._defuss_m2_msg2_status();assert.equal(report.configuredStatus,enabled?0x10002:0x10001);
      m._defuss_set_hot_limit(hotLimit);m._defuss46_settings(2); // Disable pressure admission for ISA exposure.
      m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',readFileSync(resolve(root,'assets/bun/amd64/vmlinuz-virt')));
      m.FS.writeFile('/guest/initramfs',readFileSync(resolve(fixture,'initramfs.cpio.gz')));
      for(const name of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin']){const p=resolve(root,'engine/qemu/pc-bios',name);const bytes=readFileSync(p);report.inputHashes[relative(root,p)]=sha(bytes);m.FS.writeFile('/rom/'+name,bytes);}
      port=attachCom1(m,data=>{if(data.length!==1||data[0]!==71||signal){finish('Invalid COM1 gate');return;}signal=true;pump();});
      m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops;
      node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});serial+=text;tail+=text;let end;while((end=tail.indexOf('\n'))>=0){const part=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);line(part);}return count;}};
      m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
      m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(b.subarray(o,o+n));return n;}return original(s,b,o,n,p);};
    }]}).catch(error=>finish(String(error.stack||error)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  assert.equal(await done,'pass');await chain;await qmp.send('stop');assert.equal((await qmp.send('query-status')).running,false);
  assert.equal(report.gates.length,8);assert.equal(report.fixturePass,'MSG2_FIXTURE_PASS checks=28672');
  assert.equal(report.faultPass,'MSG2_FAULT_PASS warmup=4096 faults=1 state=ymm0-2,flags pc=exact address=exact sideEffect=once');
  assert.equal(mod._defuss_m2_msg2_config(enabled?0:1),-1,'Late mode change must be rejected');
  report.finalStatus=mod._defuss_m2_msg2_status();report.executionCounts=typeof mod._defuss_m2_msg2_counts==='function';report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack||error);}
clearTimeout(timer);
for(const [p,hash] of Object.entries(report.inputHashes))if(sha(readFileSync(resolve(root,p)))!==hash){report.status='failed';report.failure='Input changed: '+p;}
writeFileSync(resolve(output,'serial.log'),serial,{flag:'wx'});writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,output,fixturePass:report.fixturePass,executionCounts:report.executionCounts,failure:report.failure}));
process.exit(report.status==='passed'?0:1);
