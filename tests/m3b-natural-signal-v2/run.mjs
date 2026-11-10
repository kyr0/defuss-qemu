#!/usr/bin/env node
// Fresh bounded natural-lifetime capture, diagnostic256MiB only.
import assert from 'node:assert/strict';
import {readFile,mkdir,open,realpath,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,dirname,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {validateSdkInvocation,validateImageBuild} from './build-provenance.mjs';
import {verifyRuntimeBinding} from '../m3b-fallthrough/runtime-identity.mjs';
import {hostConditionIdentity,observeHostCondition} from '../../benchmarks/harness/m2-sustained-v2/host-condition.mjs';
import {PressureOracle} from './oracle.mjs';
import {ChunkLedger} from './journal.mjs';
import {files as sourceFiles,verifySources,validateImageClosure} from './identity.mjs';
import {protocol,limits,pressureSettings,argumentsFor} from './config.mjs';
import {requireCensusBinding} from '../m3b-context-accounting-v2/census-browser.mjs';
import {assertInputBound,metadataLimit} from '../m3b-context-inspection-v6/input-bound.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const {values}=parseArgs({options:{binding:{type:'string'},fixture:{type:'string'},'source-manifest':{type:'string'},enabled:{type:'string'},output:{type:'string'},timeout:{type:'string',default:'1800000'}}});
assert.ok(values.binding&&values.fixture&&values.output&&values['source-manifest']&&['0','1'].includes(values.enabled));
const enabled=values.enabled==='1',timeoutMs=Number(values.timeout);assert.ok(timeoutMs===pressureSettings.timeoutMs);
for(const name of ['TMPDIR','TMP','TEMP'])assert.ok(process.env[name]&&(await realpath(process.env[name])).startsWith(root+'/tmp/'),'Use scripts/with-tmp.py');
const output=resolve(root,values.output);assert.equal(dirname(output),root+'/artifacts');assert.equal(await realpath(root+'/artifacts'),root+'/artifacts');await mkdir(output);
const syncDir=async p=>{const h=await open(p,'r');try{await h.sync();}finally{await h.close();}};await syncDir(dirname(output));
const durable=async(name,value)=>{const h=await open(resolve(output,name),'wx');try{await h.writeFile(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}await syncDir(output);};
const hashFile=async path=>{const h=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path)){h.update(chunk);bytes+=chunk.length;}return {sha256:h.digest('hex'),bytes};};
const inputs={},buffers=new Map(),served={},journalRows=[],handles={},streamNames={trace:'native-trace.log',serial:'serial.log',stderr:'stderr.log'};
let report={schema:1,protocol,status:'failed',enabled,timingEligible:false},proof,sourceProof,fixtureProof,oracle,server,browser,context,watchdog,hostCondition,hostBefore,hostAfter,chrome;
let chain=Promise.resolve(),ioFailure,oracleFailure=null,closing=false,progressCount=0,progressBytes=0,chunkMetadataBytes=0,eventBytes=0,ledger;
let rejectFatal;const fatal=new Promise((_,reject)=>rejectFatal=reject);fatal.catch(()=>{});
const enqueue=fn=>{const task=chain.then(()=>{if(ioFailure)throw ioFailure;return fn();});chain=task.catch(e=>{ioFailure=e;rejectFatal(e);});return task;};
const verifiedInputs=new Map(),stamp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];
const input=async(name,id,max)=>{const p=resolve(root,name);assert.ok(p.startsWith(root+'/'));assert.equal(await realpath(p),p);const s=await stat(p);assert.ok(s.isFile());const key=relative(root,p);assertInputBound(key,id,s.size,max);return {p,key,stamp:stamp(s)};};
const remember=(key,actual,id,signature)=>{if(id){assert.equal(actual.sha256,id.sha256);if(id.bytes!==undefined)assert.equal(actual.bytes,id.bytes);}if(inputs[key])assert.deepEqual(inputs[key],actual);inputs[key]=actual;verifiedInputs.set(key,{actual,signature});};
// Identity-only provenance is streamed, never retained as browser buffers.
const verifyInput=async(name,id,max=metadataLimit)=>{const f=await input(name,id,max),cached=verifiedInputs.get(f.key);if(cached&&JSON.stringify(cached.signature)===JSON.stringify(f.stamp)){remember(f.key,cached.actual,id,f.stamp);return cached.actual;}const actual=await hashFile(f.p);assert.deepEqual(stamp(await stat(f.p)),f.stamp,'Input changed during hash');remember(f.key,actual,id,f.stamp);return actual;};
const read=async(name,id,max=metadataLimit)=>{const f=await input(name,id,max),bytes=await readFile(f.p),actual={sha256:sha(bytes),bytes:bytes.length};assert.deepEqual(stamp(await stat(f.p)),f.stamp,'Input changed during read');remember(f.key,actual,id,f.stamp);buffers.set(f.key,bytes);return bytes;};
const appendJson=async(name,row,max)=>{const bytes=Buffer.from(JSON.stringify(row)+'\n');assert.ok(bytes.length<=max);await handles[name].writeFile(bytes);await handles[name].sync();return bytes.length;};
const record=row=>enqueue(async()=>{
 const envelope={schema:1,record:progressCount,utc:new Date().toISOString(),observation:row};assert.ok(progressCount<limits.records);
 const size=Buffer.byteLength(JSON.stringify(envelope))+1;assert.ok(size<=1024*1024&&progressBytes+size<=16*1024*1024);await appendJson('progress',envelope,1024*1024);progressCount++;progressBytes+=size;journalRows.push(row);
 if(row.event==='header')return {accepted:true};
 if(oracleFailure)return {accepted:false,failure:oracleFailure.failure};
 try{ledger.verifyPrefix(row.streams);assert.equal(row.streams.streams.trace.seen,0);const decision=oracle.accept(row);return {accepted:true,...decision};}
 catch(error){
  // This refusal is deliberately NOT a fatal-race rejection. The browser
  // remains alive, paused, to drain serial/trace and return its failure report.
  oracleFailure={event:'oracle-failure',observationEvent:row.event,phase:oracle.phase,atRecord:progressCount-1,gate:row.gate??null,failure:String(error.stack??error),streams:row.streams};
  await appendJson('events',{schema:1,utc:new Date().toISOString(),...oracleFailure},1024*1024);return {accepted:false,failure:oracleFailure.failure};
 }
});
const browserEvent=(kind,error)=>{
 // A stuck chunk write must not prevent the watchdog from rejecting the
 // active browser operation. Journal the event best-effort on the I/O queue.
 rejectFatal(error);
 enqueue(async()=>{const row={schema:1,kind,utc:new Date().toISOString(),error:String(error.stack??error).slice(0,65536)},size=Buffer.byteLength(JSON.stringify(row))+1;assert.ok(eventBytes+size<=1024*1024);eventBytes+=size;await appendJson('events',row,131072);}).catch(()=>{});
};
await durable('request.json',{schema:1,protocol,argv:process.argv,pid:process.pid,createdUtc:new Date().toISOString(),enabled,timeoutMs,limits,settings:pressureSettings,scope:'Fixed single-shot virtual timer signals with original128MiB runtime; no retry or timing claim.'});
try{
 for(const [name,file]of Object.entries({...streamNames,progress:'progress.jsonl',chunks:'chunks.jsonl',events:'events.jsonl'}))handles[name]=await open(resolve(output,file),'wx');await syncDir(output);
 ledger=new ChunkLedger({writeBytes:async(name,bytes,offset)=>{let at=0;while(at<bytes.length){const r=await handles[name].write(bytes,at,bytes.length-at,offset+at);assert.ok(r.bytesWritten>0);at+=r.bytesWritten;}await handles[name].sync();},writeMetadata:async row=>{const size=Buffer.byteLength(JSON.stringify(row))+1;assert.ok(chunkMetadataBytes+size<=32*1024*1024);chunkMetadataBytes+=size;await appendJson('chunks',row,4096);}});
 assert.ok(process.env.DEFUSS_VM_CHROME);const executable=resolve(process.env.DEFUSS_VM_CHROME),binaryPath=await realpath(executable),id=await hashFile(binaryPath);chrome={executable,binaryPath,...id};
 hostCondition=await hostConditionIdentity();hostBefore=await observeHostCondition(hostCondition);
 proof=await verifyRuntimeBinding(root,values.binding);requireCensusBinding(proof.binding);Object.assign(inputs,proof.inputs);for(const [p,b]of proof.buffers)if(p.startsWith(dirname(proof.runtime)+'/'))buffers.set(p,b);proof.buffers.clear();
 sourceProof=await verifySources({read,verifyInput,manifestPath:values['source-manifest'],binding:proof.binding});
 const fixture=relative(root,resolve(root,values.fixture));assert.ok(fixture.startsWith('artifacts/'));
 const build=JSON.parse(await read(fixture+'/build-report.json'));validateImageBuild(build,{fixture});validateImageClosure(build);
 for(const [p,id]of Object.entries(build.artifacts))await read(fixture+'/'+p,id);for(const [p,h]of Object.entries(build.sources))await read(p,{sha256:h});
 const sdkStart=JSON.parse(buffers.get(fixture+'/sdk-invocation-start.json')),sdkBytes=await read(build.sdkInvocation.path),sdkComplete=JSON.parse(sdkBytes);validateSdkInvocation(sdkStart,sdkComplete,{root,fixture,path:build.sdkInvocation.path});await durable('sdk-invocation-complete.json',sdkBytes.toString('utf8'));
 fixtureProof={buildReport:fixture+'/build-report.json',sdkInvocation:build.sdkInvocation.path,sdkCompletion:{path:'sdk-invocation-complete.json',sha256:sha(sdkBytes),bytes:sdkBytes.length},copiedSources:build.copiedSources,tools:build.tools};
 assert.equal(build.initramfsSha256,inputs[fixture+'/initramfs.cpio.gz'].sha256);assert.equal(build.binarySha256,inputs[fixture+'/fixture'].sha256);
 const layout=JSON.parse(buffers.get(fixture+'/layout.json'));assert.deepEqual(layout,build.layout);oracle=new PressureOracle({enabled,proof,layout});
 const browserSources=['tests/m3b-context-accounting-v2/census-browser.mjs','tests/m3b-natural-signal-v2/guest.mjs','tests/m3b-natural-signal-v2/config.mjs','tests/m3b-natural-signal-v2/guest-contract.mjs','tests/m3b-natural-signal-v2/transport.mjs','tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/reader.mjs','experiments/m3a-region/reader.mjs','host/browser/qmp.mjs','host/browser/machine.mjs','packaging/bun-app/serial.mjs'];
 for(const p of [...browserSources,...sourceFiles,'scripts/with-tmp.py','benchmarks/harness/m2-sustained-v2/host-condition.mjs','package.json','package-lock.json'])await read(p);
 const assets=['assets/bun/amd64/vmlinuz-virt',...['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'].map(n=>'engine/qemu/pc-bios/'+n)];for(const p of assets){assert.ok(proof.binding.assets?.[p]);await read(p,proof.binding.assets[p]);}
 await record({event:'header',schema:1,protocol,enabled,timeoutMs,limits,settings:pressureSettings,arguments:argumentsFor(),inputs,binding:proof.binding,sourceProof,fixtureProof,hostCondition,hostBefore,chrome});
 const allowed=new Set([...browserSources,...assets,fixture+'/initramfs.cpio.gz',...Object.keys(inputs).filter(p=>p.startsWith(dirname(proof.runtime)+'/'))]);
 server=createServer((req,res)=>{for(const [k,v]of Object.entries({'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'}))res.setHeader(k,v);
  try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);if(!p){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>M3b natural signal diagnostics</title>');return;}if(!allowed.has(p)){res.writeHead(404);res.end();return;}const b=buffers.get(p);assert.ok(b);served[p]=inputs[p];res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'})[extname(p)]??'application/octet-stream');res.end(b);}catch(e){res.writeHead(500);res.end();rejectFatal(e);}
 });await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 watchdog=setTimeout(()=>browserEvent('deadline',Error('Host bounded pressure deadline exceeded')),timeoutMs+20000);
 browser=await chromium.launch({headless:true,timeout:60000,executablePath:chrome.executable});context=await browser.newContext();const page=await context.newPage();
 page.on('pageerror',e=>browserEvent('pageerror',e));page.on('crash',()=>browserEvent('crash',Error('Page crash')));browser.on('disconnected',()=>{if(!closing)browserEvent('disconnected',Error('Browser disconnected'));});
 await page.exposeFunction('__m3bForensicChunk',row=>enqueue(()=>ledger.accept(row)));await page.exposeFunction('__m3bForensicRecord',record);await page.goto('http://127.0.0.1:'+server.address().port+'/',{timeout:60000});
 report=await Promise.race([fatal,page.evaluate(async({runtime,fixture,enabled,timeoutMs,binding})=>{const {runGuest}=await import('/tests/m3b-natural-signal-v2/guest.mjs'),get=async p=>{const r=await fetch('/'+p);if(!r.ok)throw Error(p);return r.arrayBuffer();},roms={};for(const n of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'])roms[n]=await get('engine/qemu/pc-bios/'+n);return runGuest({runtimeUrl:new URL('/'+runtime+'/qemu-system-x86_64.js',location.href).href,kernel:await get('assets/bun/amd64/vmlinuz-virt'),initramfs:await get(fixture+'/initramfs.cpio.gz'),roms,enabled,timeoutMs,binding});},{runtime:proof.runtime,fixture,enabled,timeoutMs,binding:proof.binding})]);
 await chain;if(ioFailure)throw ioFailure;
 assert.equal(report.schema,1);assert.equal(report.protocol,protocol);assert.equal(report.enabled,enabled);assert.equal(report.timingEligible,false);assert.deepEqual(report.arguments,argumentsFor());ledger.verifyPrefix(report.streams);
 assert.equal(report.pauseFailure,undefined);assert.equal(report.drainFailure,undefined);assert.equal(report.endStatus?.running,false);assert.equal(report.endStatus?.status,'paused');
 for(const [k,v]of Object.entries({m3aEnabled:true,enabled,hotLimit:1500,flags:2,instanceLimit:12000}))assert.equal(report.configuration[k],v);assert.deepEqual(report.configuration.census,{enabled:true,phase:'preRun-before-vCPU',returnCode:0,status:3,abi:{version:2,words:2400,slots:4}});
 const serial=(await readFile(resolve(output,'serial.log'))).toString('utf8').replace(/\r/g,'');assert.ok(!/M3B_SIGNAL_FAIL:|BUN_APP_FAILURE|Kernel panic/.test(serial));
 const records=serial.split('\n').filter(x=>x.startsWith('M3B_SIGNAL_')).map(x=>{const m=/^M3B_SIGNAL_(LAYOUT|GATE|PASS):(.*)$/.exec(x);assert.ok(m);return {type:m[1],value:JSON.parse(m[2])};});
 const gateRows=journalRows.filter(r=>r.event==='gate');assert.equal(records.filter(r=>r.type==='LAYOUT').length,1);assert.deepEqual(records[0],{type:'LAYOUT',value:report.layout});assert.deepEqual(records.filter(r=>r.type==='GATE').map(r=>r.value),gateRows.map(r=>r.gate));
 for(let i=0;i<report.gates.length;i++){const {ackHostMs,contHostMs,...raw}=report.gates[i];assert.deepEqual(raw,gateRows[i]);assert.equal(raw.signalHostMs,report.signals[i]);if(ackHostMs!==undefined)assert.ok(raw.readHostMs<=ackHostMs&&ackHostMs<=contHostMs);}
 if(oracleFailure){assert.equal(report.status,'failed');assert.equal(oracle.phase,oracleFailure.phase);if(oracleFailure.observationEvent!=='complete')assert.equal(records.filter(r=>r.type==='PASS').length,0);if(['startup','gate','configured'].includes(oracleFailure.observationEvent))assert.equal(journalRows.filter(r=>r.event==='ack'&&r.seq===oracle.seq).length,0);}
 else{assert.equal(oracle.phase,'done');assert.equal(report.status,oracle.result,report.failure);assert.ok(['passed','incomplete'].includes(report.status));assert.equal(gateRows.length,oracle.seq);assert.equal(report.signals.length,oracle.seq);assert.deepEqual(records,[{type:'LAYOUT',value:oracle.layout},...oracle.gates.map(value=>({type:'GATE',value})),{type:'PASS',value:report.final.validation}]);}
 assert.deepEqual(report.startup,journalRows.find(r=>r.event==='startup'));if(report.final)assert.deepEqual(report.final,journalRows.find(r=>r.event==='complete'));
 for(const p of [...browserSources,...assets,fixture+'/initramfs.cpio.gz',proof.runtime+'/qemu-system-x86_64.js',proof.runtime+'/qemu-system-x86_64.wasm'])assert.deepEqual(served[p],inputs[p]);report.browser=browser.version();
}catch(error){report.status='failed';report.failure=(report.failure??'')+'\n'+String(error.stack??error);}
finally{
 clearTimeout(watchdog);closing=true;for(const close of [()=>context?.close(),()=>browser?.close(),async()=>{if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}}])try{await close();}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nCleanup: '+e;}
 try{await chain;if(ioFailure)throw ioFailure;}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nI/O: '+e;}for(const h of Object.values(handles))try{await h.sync();await h.close();}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nFile close: '+e;}
 if(hostCondition)try{hostAfter=await observeHostCondition(hostCondition);}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nHost condition: '+e;hostAfter=e.observation??null;}
 if(chrome)try{assert.equal(await realpath(chrome.executable),chrome.binaryPath);assert.deepEqual(await hashFile(chrome.binaryPath),{sha256:chrome.sha256,bytes:chrome.bytes});}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nChrome changed: '+e;}
 report.inputRecheck=[];for(const [p,id]of Object.entries(inputs))try{assert.deepEqual(await hashFile(resolve(root,p)),id);}catch(e){report.inputRecheck.push({path:p,error:String(e)});}if(report.inputRecheck.length)report.status='failed';
 Object.assign(report,{schema:1,protocol,enabled,timingEligible:false,limits,settings:pressureSettings,timeoutMs,completedUtc:new Date().toISOString(),inputs,served,sourceProof,fixtureProof,hostCondition,hostBefore,hostAfter,chrome,oracleFailure,lifetime:oracle?.summary()??null,streamsDurable:ledger?.summary()??null,runtimeProof:proof?{bindingPath:values.binding,binding:proof.binding,sourceFingerprint:proof.sourceFingerprint}:null,
  naturalGuestTimerOnly:true,
  conclusion:'Original128MiB/flags2 runtime with natural guest timer signals, precise integer contexts and resume in positive compiled windows. Exact native tier at each delivery and timing remain outside scope.'});
 report.artifacts={};for(const [name,file]of Object.entries({...streamNames,progress:'progress.jsonl',chunks:'chunks.jsonl',events:'events.jsonl'}))if(handles[name])report.artifacts[name]={path:file,...await hashFile(resolve(output,file))};
 if(ledger)for(const name of Object.keys(streamNames))try{const {path,...actual}=report.artifacts[name];assert.deepEqual(actual,report.streamsDurable.files[name]);}catch(e){report.status='failed';report.failure=(report.failure??'')+'\nDurable stream reconciliation: '+e;}
 await durable('report.json',report);console.log(JSON.stringify({status:report.status,output:relative(root,output),oracleFailure:oracleFailure?.failure,failure:report.failure}));
}
process.exitCode=report.status==='passed'?0:report.status==='incomplete'?2:1;
