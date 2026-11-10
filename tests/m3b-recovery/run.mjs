#!/usr/bin/env node
// Host-only recovery derivative: unchanged runtime, guest image and 45 oracles.
import assert from 'node:assert/strict';
import {readFile,mkdir,open,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {validateSdkInvocation,validateImageBuild} from '../m3b-fallthrough/build-provenance.mjs';
import {verifyRuntimeBinding} from '../m3b-fallthrough/runtime-identity.mjs';
import {referenceGates} from '../m3b-fallthrough/contract.mjs';
import {RecoveryReplay,protocol,openGates} from './replay.mjs';
import {verifyRecoverySources,recoverySources,validateFixtureClosure} from './identity.mjs';
import {args as guestArguments} from './guest.mjs';
import {hostConditionIdentity,observeHostCondition} from '../../benchmarks/harness/m2-sustained-v2/host-condition.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const {values}=parseArgs({options:{binding:{type:'string'},fixture:{type:'string'},'source-manifest':{type:'string'},'source-review':{type:'string'},enabled:{type:'string'},output:{type:'string'},timeout:{type:'string',default:'600000'}}});
assert.ok(values.binding&&values.fixture&&values.output&&values['source-manifest']&&values['source-review']&&['0','1'].includes(values.enabled));const enabled=values.enabled==='1',timeoutMs=Number(values.timeout);
assert.ok(Number.isInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=1800000);
for(const key of ['TMPDIR','TMP','TEMP'])assert.ok(process.env[key]&&(await realpath(process.env[key])).startsWith(root+'/tmp/'),'Use scripts/with-tmp.py');
const output=resolve(root,values.output);assert.equal(dirname(output),root+'/artifacts');assert.equal(await realpath(root+'/artifacts'),root+'/artifacts');await mkdir(output);
const syncDir=async p=>{const h=await open(p,'r');try{await h.sync();}finally{await h.close();}};await syncDir(dirname(output));
const durable=async(name,data)=>{const f=await open(resolve(output,name),'wx');try{await f.writeFile(typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');await f.sync();}finally{await f.close();}await syncDir(output);};
let report={schema:1,protocol,status:'failed',enabled,timingEligible:false},proof,server,browser,context,watchdog,journal,chain=Promise.resolve(),logFailure,closing=false,hostCondition,hostBefore,hostAfter,chrome,fixtureProvenance,recoveryProvenance,replay;
let entries=0,eventBytes=0,reference,layout,expectedLayout,phase='startup';const journalRows=[],partitions=[],inputs={},files=new Map(),served={};
let rejectFatal;const fatal=new Promise((_,reject)=>rejectFatal=reject);fatal.catch(()=>{});
const read=async(name,id)=>{const p=resolve(root,name);assert.ok(p.startsWith(root+'/'));assert.equal(await realpath(p),p);const b=await readFile(p),actual={sha256:sha(b),bytes:b.length};
 if(id){assert.equal(actual.sha256,id.sha256);if(id.bytes!==undefined)assert.equal(actual.bytes,id.bytes);}const key=relative(root,p);if(inputs[key])assert.deepEqual(inputs[key],actual);inputs[key]=actual;files.set(key,b);return b;};
function validateEvent(row){replay.accept(row);phase=replay.phase;layout=replay.layout;partitions.splice(0,partitions.length,...replay.partitions);}
const record=async row=>{
 const task=chain.then(async()=>{
  if(logFailure)throw logFailure;const bytes=Buffer.from(JSON.stringify({schema:1,record:entries,utc:new Date().toISOString(),observation:row})+'\n');
  assert.ok(entries<160&&bytes.length<=1024*1024&&eventBytes+bytes.length<=16*1024*1024);entries++;eventBytes+=bytes.length;await journal.writeFile(bytes);await journal.sync();journalRows.push(row);
  if(row.event!=='header')validateEvent(row);
 });chain=task.catch(e=>{logFailure=e;rejectFatal(e);});return task;
};
await durable('request.json',{schema:1,protocol,createdUtc:new Date().toISOString(),pid:process.pid,argv:process.argv,enabled,timeoutMs,binding:values.binding,fixture:values.fixture,sourceManifest:values['source-manifest'],sourceReview:values['source-review'],scope:'Fresh diagnostic recovery guest only; all post-start failures retained, no automatic retry.'});
try{
 journal=await open(resolve(output,'progress.jsonl'),'wx');await syncDir(output);
 assert.ok(process.env.DEFUSS_VM_CHROME,'Explicit DEFUSS_VM_CHROME is required');const executable=resolve(process.env.DEFUSS_VM_CHROME),binaryPath=await realpath(executable),chromeBytes=await readFile(binaryPath);chrome={executable,binaryPath,sha256:sha(chromeBytes),bytes:chromeBytes.length};
 hostCondition=await hostConditionIdentity();hostBefore=await observeHostCondition(hostCondition);
 proof=await verifyRuntimeBinding(root,values.binding);Object.assign(inputs,proof.inputs);for(const [path,bytes]of proof.buffers)files.set(path,bytes);
 recoveryProvenance=await verifyRecoverySources({read,manifestPath:values['source-manifest'],reviewPath:values['source-review'],binding:proof.binding});
 const fixture=relative(root,resolve(root,values.fixture));assert.ok(fixture.startsWith('artifacts/'));
 const build=JSON.parse(await read(fixture+'/build-report.json'));validateImageBuild(build,{fixture});
 for(const [path,id]of Object.entries(build.artifacts))await read(fixture+'/'+path,id);
 for(const [path,h]of Object.entries(build.sources))await read(path,{sha256:h});
 const sdkStart=JSON.parse(files.get(fixture+'/sdk-invocation-start.json')),sdkCompleteBytes=await read(build.sdkInvocation.path),sdkComplete=JSON.parse(sdkCompleteBytes);
 validateSdkInvocation(sdkStart,sdkComplete,{root,fixture,path:build.sdkInvocation.path});await durable('sdk-invocation-complete.json',sdkCompleteBytes.toString('utf8'));
 fixtureProvenance={buildReport:fixture+'/build-report.json',sdkInvocation:build.sdkInvocation.path,sdkCompletion:{path:'sdk-invocation-complete.json',sha256:sha(sdkCompleteBytes),bytes:sdkCompleteBytes.length},copiedSources:build.copiedSources,tools:build.tools};
 for(const path of ['tests/m3b-fallthrough/fixture.c','tests/m3b-fallthrough/fixture.S','tests/m3b-fallthrough/build.py','tests/m3b-fallthrough/contract.mjs','experiments/m3b-fallthrough/predecode.h'])assert.match(build.sources[path],/^[a-f0-9]{64}$/);
 assert.equal(build.initramfsSha256,inputs[fixture+'/initramfs.cpio.gz'].sha256);assert.equal(build.binarySha256,inputs[fixture+'/fixture'].sha256);
 expectedLayout=JSON.parse(files.get(fixture+'/layout.json')).programs;assert.deepEqual(expectedLayout,build.layout);reference=referenceGates();replay=new RecoveryReplay({enabled,proof,expectedLayout});
 validateFixtureClosure(build);
 const browserSources=['tests/m3b-recovery/guest.mjs','tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/reader.mjs','experiments/m3a-region/reader.mjs','host/browser/qmp.mjs','host/browser/machine.mjs','packaging/bun-app/serial.mjs'];
 const sourceNames=['run.mjs','runtime-identity.mjs','build-provenance.mjs','contract.mjs','README.md','build.py','fixture.c','fixture.S'].map(n=>'tests/m3b-fallthrough/'+n);
 for(const path of [...browserSources,...sourceNames,...recoverySources,'scripts/with-tmp.py','benchmarks/harness/m2-sustained-v2/host-condition.mjs','package.json','package-lock.json'])await read(path);
 const assets=['assets/bun/amd64/vmlinuz-virt',...['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'].map(n=>'engine/qemu/pc-bios/'+n)];
 for(const path of assets){assert.ok(proof.binding.assets?.[path]);await read(path,proof.binding.assets[path]);}
 await record({event:'header',schema:1,protocol,enabled,timeoutMs,inputs,binding:proof.binding,fixtureProvenance,recoveryProvenance,hostCondition,hostBefore,chrome,scope:'Crash partial record only; cannot substitute for complete raw report and replay.'});
 const allowed=new Set([...browserSources,...assets,fixture+'/initramfs.cpio.gz',...Object.keys(inputs).filter(p=>p.startsWith(dirname(proof.runtime)+'/'))]);
 server=createServer((req,res)=>{
  for(const[k,v]of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}))res.setHeader(k,v);
  try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);if(path===''){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>M3b recovery diagnostic fixture</title>');return;}
   if(!allowed.has(path)){res.writeHead(404);res.end();return;}const bytes=files.get(path);assert.ok(bytes);served[path]=inputs[path];res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'})[extname(path)]??'application/octet-stream');res.end(bytes);
  }catch(e){rejectFatal(e);res.writeHead(500);res.end();}
 });
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 watchdog=setTimeout(()=>rejectFatal(Error('Host diagnostic deadline exceeded')),timeoutMs+20000);browser=await chromium.launch({headless:true,timeout:60000,executablePath:chrome.executable});
 context=await browser.newContext();const page=await context.newPage();page.on('pageerror',e=>rejectFatal(e));page.on('crash',()=>rejectFatal(Error('Page crash')));browser.on('disconnected',()=>{if(!closing)rejectFatal(Error('Browser disconnected'));});
 await page.exposeFunction('__recordM3bRecovery',record);
 await page.goto('http://127.0.0.1:'+server.address().port+'/',{timeout:60000});
 report=await Promise.race([fatal,page.evaluate(async({runtime,fixture,enabled,timeoutMs})=>{
  const {runGuest}=await import('/tests/m3b-recovery/guest.mjs');const get=async p=>{const r=await fetch('/'+p);if(!r.ok)throw Error(p);return r.arrayBuffer();};const roms={};for(const n of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'])roms[n]=await get('engine/qemu/pc-bios/'+n);
  return runGuest({runtimeUrl:new URL('/'+runtime+'/qemu-system-x86_64.js',location.href).href,kernel:await get('assets/bun/amd64/vmlinuz-virt'),initramfs:await get(fixture+'/initramfs.cpio.gz'),roms,enabled,timeoutMs});
 },{runtime:proof.runtime,fixture,enabled,timeoutMs})]);
 await chain;if(logFailure)throw logFailure;assert.equal(report.status,'passed',report.failure);assert.equal(report.schema,1);assert.equal(report.protocol,protocol);assert.equal(report.timingEligible,false);assert.equal(phase,'done');assert.equal(report.enabled,enabled);assert.deepEqual(report.arguments,guestArguments);
 assert.equal(report.configuration.m3aEnabled,true);assert.equal(report.configuration.enabled,enabled);assert.equal(report.configuration.hotLimit,1500);assert.equal(report.configuration.flags,2);assert.equal(report.configuration.instanceLimit,12000);
 assert.deepEqual(report.layout,layout);assert.equal(report.gates.length,45);assert.equal(report.signals.length,45);
 const raw=report.serial.replace(/\r/g,'');assert.ok(!/M3B_FAIL:|BUN_APP_FAILURE|Kernel panic/.test(raw));const lines=raw.split('\n');assert.equal(lines.filter(x=>x.startsWith('M3B_LAYOUT:')).length,1);assert.equal(lines.filter(x=>x.startsWith('M3B_PASS:')).length,1);
 assert.ok(lines.every(x=>!x.startsWith('M3B_')||['M3B_LAYOUT:','M3B_GATE:','M3B_PASS:'].some(p=>x.startsWith(p))));assert.deepEqual(JSON.parse(lines.find(x=>x.startsWith('M3B_LAYOUT:')).slice(11)),layout);
 assert.deepEqual(lines.filter(x=>x.startsWith('M3B_GATE:')).map(x=>JSON.parse(x.slice(9))),reference.gates);assert.deepEqual(JSON.parse(lines.find(x=>x.startsWith('M3B_PASS:')).slice(9)),reference.pass);
 for(let i=0;i<45;i++){const row=report.gates[i],saved=journalRows.find(r=>r.event==='gate'&&r.gate.seq===i);const {ackHostMs,contHostMs,...before}=row;assert.deepEqual(before,saved);assert.equal(row.signalHostMs,report.signals[i]);assert.ok(row.readHostMs<=ackHostMs&&ackHostMs<=contHostMs);if(i)assert.ok(report.gates[i-1].ackHostMs<=row.signalHostMs);}
 assert.deepEqual(report.startup,journalRows.find(r=>r.event==='startup'));assert.deepEqual(report.final,journalRows.find(r=>r.event==='complete'));
 assert.deepEqual(report.injections,journalRows.filter(r=>r.event==='injection'));assert.equal(report.injections.length,enabled?2:0);
 for(const path of [...browserSources,...assets,fixture+'/initramfs.cpio.gz',proof.runtime+'/qemu-system-x86_64.js',proof.runtime+'/qemu-system-x86_64.wasm'])assert.deepEqual(served[path],inputs[path]);report.browser=browser.version();
}catch(e){report.status='failed';report.failure=String(e.stack??e);}
finally{
 clearTimeout(watchdog);closing=true;for(const close of [()=>context?.close(),()=>browser?.close(),async()=>{if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}}])try{await close();}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nCleanup: '+e;}
 if(hostCondition)try{hostAfter=await observeHostCondition(hostCondition);}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nHost condition: '+e;hostAfter=e.observation??null;}
 if(chrome)try{assert.equal(await realpath(chrome.executable),chrome.binaryPath);assert.equal(sha(await readFile(chrome.binaryPath)),chrome.sha256);}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nChrome identity changed: '+e;}
 try{await chain;if(logFailure)throw logFailure;}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nProgress: '+e;}if(journal)await journal.close();
 report.inputRecheck=[];for(const [path,id]of Object.entries(inputs))try{assert.equal(sha(await readFile(resolve(root,path))),id.sha256);}catch(e){report.inputRecheck.push({path,error:String(e)});}
 if(report.inputRecheck.length){report.status='failed';report.failure=(report.failure??'')+'\nInput changed';}
 report.recoveryProvenance=recoveryProvenance;report.recovery=replay?.results??null;
 report.fixtureProvenance=fixtureProvenance;report.sourceDerivedBodyPartitions=partitions;report.hostCondition=hostCondition;report.hostBefore=hostBefore;report.hostAfter=hostAfter;report.chrome=chrome;report.schema=1;report.protocol=protocol;report.enabled=enabled;report.timingEligible=false;report.inputs=inputs;report.served=served;report.timeoutMs=timeoutMs;report.completedUtc=new Date().toISOString();report.openGates=openGates;report.runtimeProvenance=proof?{binding:proof.binding,sourceFingerprint:proof.sourceFingerprint,graph:proof.graph,objects:proof.objects}:null;
 const serial=report.serial??'';await durable('serial.log',serial);delete report.serial;report.artifacts={serial:{path:'serial.log',sha256:sha(serial),bytes:Buffer.byteLength(serial)}};
 if(journal){const data=await readFile(resolve(output,'progress.jsonl'));report.artifacts.progress={path:'progress.jsonl',sha256:sha(data),bytes:data.length,records:entries};}
 await durable('report.json',report);console.log(JSON.stringify({status:report.status,output:relative(root,output),failure:report.failure}));
}
process.exitCode=report.status==='passed'?0:1;
