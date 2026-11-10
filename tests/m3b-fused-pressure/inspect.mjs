#!/usr/bin/env node
// Offline only: invoke after the root-owned capture process/browser has closed.
import assert from 'node:assert/strict';
import {readFile,mkdir,open,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {parseArgs} from 'node:util';
import {PressureOracle} from './oracle.mjs';
import {verifyRuntimeBinding} from '../m3b-fallthrough/runtime-identity.mjs';
import {verifySources,validateImageClosure} from './identity.mjs';
import {validateImageBuild,validateSdkInvocation} from './build-provenance.mjs';
import {validateHostStatus} from '../../benchmarks/harness/m2-sustained-v2/host-condition.mjs';
import {limits,protocol,pressureSettings,argumentsFor} from './config.mjs';
import {validatePressureLayout} from './guest-contract.mjs';
import {validateQueue} from './journal.mjs';
import {assertInputBound,metadataLimit} from '../m3b-context-inspection-v6/input-bound.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const streamNames=['trace','serial','stderr'],jsonLines=b=>{assert.ok(!b.length||b.at(-1)===10,'Incomplete durable JSONL');return b.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);};

export function verifyChunkIndex(rows,files){
 assert.ok(Array.isArray(rows)&&rows.length<=100000);assert.deepEqual(Object.keys(files).sort(),[...streamNames].sort());
 const totals={trace:0,serial:0,stderr:0},prefixes=[{...totals}];
 for(let seq=0;seq<rows.length;seq++){
  const row=rows[seq];assert.deepEqual(Object.keys(row).sort(),['schema','seq','stream','offset','bytes','sha256'].sort());assert.equal(row.schema,1);assert.equal(row.seq,seq);
  assert.ok(streamNames.includes(row.stream));assert.equal(row.offset,totals[row.stream]);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=limits.chunk);
  const end=row.offset+row.bytes;assert.ok(end<=files[row.stream].length&&end<=limits[row.stream]);assert.equal(hash(files[row.stream].subarray(row.offset,end)),row.sha256);
  totals[row.stream]=end;prefixes.push({...totals});
 }
 for(const name of streamNames){assert.ok(files[name].length<=limits[name]);assert.equal(totals[name],files[name].length,'Unindexed durable stream tail');}
 return {chunks:rows.length,prefixes,files:Object.fromEntries(streamNames.map(name=>[name,{bytes:totals[name],sha256:hash(files[name])}]))};
}
export function verifyStreamSnapshot(snapshot,index){
 assert.ok(snapshot&&Number.isSafeInteger(snapshot.chunks)&&snapshot.chunks>=0&&snapshot.chunks<=index.chunks);assert.deepEqual(Object.keys(snapshot.streams).sort(),[...streamNames].sort());
 for(const name of streamNames)assert.deepEqual(snapshot.streams[name],{seen:index.prefixes[snapshot.chunks][name],queued:index.prefixes[snapshot.chunks][name]});
 validateQueue(snapshot,index.prefixes[snapshot.chunks]);
 return index.prefixes[snapshot.chunks];
}

// Stream validation reads each bounded raw serial/stderr chunk once; trace must remain empty.
export async function verifyChunkFiles(rows,{readRange,sizes}){
 assert.ok(Array.isArray(rows)&&rows.length<=100000);assert.deepEqual(Object.keys(sizes).sort(),[...streamNames].sort());
 const totals={trace:0,serial:0,stderr:0},prefixes=[{...totals}],hashes=Object.fromEntries(streamNames.map(n=>[n,createHash('sha256')]));
 for(let seq=0;seq<rows.length;seq++){
  const r=rows[seq];assert.deepEqual(Object.keys(r).sort(),['schema','seq','stream','offset','bytes','sha256'].sort());assert.equal(r.schema,1);assert.equal(r.seq,seq);assert.ok(streamNames.includes(r.stream));assert.equal(r.offset,totals[r.stream]);assert.ok(Number.isInteger(r.bytes)&&r.bytes>0&&r.bytes<=limits.chunk);
  const end=r.offset+r.bytes;assert.ok(end<=sizes[r.stream]&&end<=limits[r.stream]);const bytes=await readRange(r.stream,r.offset,end);assert.ok(bytes instanceof Uint8Array&&bytes.byteLength===r.bytes);assert.equal(hash(bytes),r.sha256);hashes[r.stream].update(bytes);totals[r.stream]=end;prefixes.push({...totals});
 }
 for(const n of streamNames)assert.equal(totals[n],sizes[n],'Unindexed stream tail');
 return {chunks:rows.length,prefixes,files:Object.fromEntries(streamNames.map(n=>[n,{bytes:totals[n],sha256:hashes[n].digest('hex')}]))};
}
async function main(){
 const {values}=parseArgs({options:{run:{type:'string'},output:{type:'string'}}});assert.ok(values.run&&values.output);
 const run=resolve(root,values.run),output=resolve(root,values.output);assert.equal(dirname(run),root+'/artifacts');assert.equal(dirname(output),root+'/artifacts');assert.notEqual(run,output);assert.equal(await realpath(run),run);
 const inventory={},sync=async p=>{const h=await open(p,'r');try{await h.sync();}finally{await h.close();}};
 await mkdir(output);await sync(dirname(output));
 const publish=async(name,value)=>{const h=await open(output+'/'+name,'wx');try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}await sync(output);};
 const fileHash=async p=>{const h=createHash('sha256');let bytes=0;for await(const b of createReadStream(p)){h.update(b);bytes+=b.length;}return {sha256:h.digest('hex'),bytes};};
 const verifiedInputs=new Map(),stamp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];
 const input=async(path,id,max)=>{const p=resolve(root,path);assert.ok(p.startsWith(root+'/'));assert.equal(await realpath(p),p);const s=await stat(p);assert.ok(s.isFile());const key=relative(root,p);assertInputBound(key,id,s.size,max);return {p,key,stamp:stamp(s)};};
 const remember=(key,actual,id,signature)=>{if(id){assert.equal(actual.sha256,id.sha256);if(id.bytes!==undefined)assert.equal(actual.bytes,id.bytes);}if(inventory[key])assert.deepEqual(inventory[key],actual);inventory[key]=actual;verifiedInputs.set(key,{actual,signature});};
 const verifyInput=async(path,id,max=metadataLimit)=>{const f=await input(path,id,max),cached=verifiedInputs.get(f.key);if(cached&&JSON.stringify(cached.signature)===JSON.stringify(f.stamp)){remember(f.key,cached.actual,id,f.stamp);return cached.actual;}const actual=await fileHash(f.p);assert.deepEqual(stamp(await stat(f.p)),f.stamp,'Input changed during hash');remember(f.key,actual,id,f.stamp);return actual;};
 const read=async(path,id,max=metadataLimit)=>{const f=await input(path,id,max),b=await readFile(f.p),actual={sha256:hash(b),bytes:b.length};assert.deepEqual(stamp(await stat(f.p)),f.stamp,'Input changed during read');remember(f.key,actual,id,f.stamp);return b;};
 const range=async(name,start,end)=>{assert.ok(streamNames.includes(name)&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>=start&&end-start<=limits.chunk);const h=await open(run+'/'+({trace:'native-trace.log',serial:'serial.log',stderr:'stderr.log'})[name],'r');try{assert.ok(end<=(await h.stat()).size);const b=Buffer.alloc(end-start);let at=0;while(at<b.length){const r=await h.read(b,at,b.length-at,start+at);assert.ok(r.bytesRead>0);at+=r.bytesRead;}return b;}finally{await h.close();}};
 try{
  const report=JSON.parse(await read(relative(root,run)+'/report.json'));assert.equal(report.schema,1);assert.equal(report.protocol,protocol);assert.equal(report.naturalLifetimeOnly,true);assert.equal(report.timingEligible,false);assert.equal(typeof report.enabled,'boolean');assert.ok(['failed','passed','incomplete'].includes(report.status));assert.deepEqual(report.inputRecheck,[]);assert.deepEqual(report.limits,limits);
  assert.equal(report.endStatus?.running,false);assert.equal(report.endStatus?.status,'paused');assert.equal(report.pauseFailure,undefined);assert.equal(report.drainFailure,undefined);
  for(const [name,value]of Object.entries({m3aEnabled:true,enabled:report.enabled,hotLimit:1500,flags:3,instanceLimit:12000}))assert.equal(report.configuration[name],value);assert.deepEqual(report.configuration.census,{enabled:true,phase:'preRun-before-vCPU',returnCode:0,status:3,abi:{version:2,words:2400,slots:4}});assert.ok(!/Cleanup:|I\/O:|Durable stream reconciliation:/.test(report.failure??''));
  for(const observation of [report.hostBefore,report.hostAfter]){assert.ok(observation&&typeof observation.stdout==='string');assert.deepEqual(JSON.parse(observation.stdout),observation.status);validateHostStatus(observation.status,report.hostCondition);assert.equal(observation.stderr,'');}
  assert.deepEqual(report.hostCondition.arguments,['list','builder','--json']);assert.deepEqual(report.hostCondition.environment,{LIMA_HOME:'/Users/admin/.defuss-vm-lima'});
  const proof=await verifyRuntimeBinding(root,report.runtimeProof.bindingPath);assert.deepEqual(proof.binding,report.runtimeProof.binding);assert.equal(proof.sourceFingerprint,report.runtimeProof.sourceFingerprint);proof.buffers.clear();
  for(const [path,id]of Object.entries(proof.inputs)){assert.deepEqual(report.inputs[path],id);inventory[path]=id;}
  const sourceProof=await verifySources({read,verifyInput,manifestPath:report.sourceProof.sourceManifest.path,reviewPath:report.sourceProof.sourceReview.path,binding:proof.binding});assert.deepEqual(sourceProof,report.sourceProof);
  assert.deepEqual(Object.keys(report.artifacts).sort(),['trace','serial','stderr','progress','chunks','events'].sort());const raw={},sizes={};
  for(const [name,id]of Object.entries(report.artifacts)){
   assert.equal(id.path,({trace:'native-trace.log',serial:'serial.log',stderr:'stderr.log',progress:'progress.jsonl',chunks:'chunks.jsonl',events:'events.jsonl'})[name]);const path=relative(root,run)+'/'+id.path,p=resolve(root,path);assert.equal(await realpath(p),p);const cap=limits[name]??(name==='progress'?16*1024*1024:name==='chunks'?32*1024*1024:1024*1024);assert.ok((await stat(p)).size<=cap);
   if(streamNames.includes(name)){sizes[name]=(await stat(p)).size;const actual=await fileHash(p);assert.deepEqual(actual,{sha256:id.sha256,bytes:id.bytes});inventory[path]=actual;if(name!=='trace')raw[name]=await readFile(p);}
   else raw[name]=await read(path,id,cap);
  }
  const index=await verifyChunkFiles(jsonLines(raw.chunks),{readRange:range,sizes});assert.deepEqual(report.streamsDurable,{chunks:index.chunks,files:index.files});verifyStreamSnapshot(report.streams,index);assert.equal(report.streams.chunks,index.chunks);
  const envelopes=jsonLines(raw.progress);assert.ok(envelopes.length>1&&envelopes.length<=limits.records);for(let i=0;i<envelopes.length;i++){assert.equal(envelopes[i].schema,1);assert.equal(envelopes[i].record,i);}
  const rows=envelopes.map(r=>r.observation),header=rows[0];assert.equal(header.event,'header');assert.equal(header.schema,1);assert.equal(header.protocol,protocol);assert.equal(header.enabled,report.enabled);
  for(const name of ['inputs','limits','settings','timeoutMs','sourceProof','fixtureProof','hostCondition','hostBefore','chrome'])assert.deepEqual(header[name],report[name]);assert.deepEqual(header.binding,proof.binding);assert.deepEqual(header.arguments,report.arguments);
  const layout=validatePressureLayout(report.layout);assert.deepEqual(report.settings,pressureSettings);assert.equal(report.timeoutMs,pressureSettings.timeoutMs);assert.deepEqual(report.arguments,argumentsFor());
  const fixture=dirname(report.fixtureProof.buildReport),build=JSON.parse(await read(report.fixtureProof.buildReport,report.inputs[report.fixtureProof.buildReport]));validateImageBuild(build,{fixture});validateImageClosure(build);
  for(const [path,id]of Object.entries(build.artifacts)){const name=fixture+'/'+path;assert.deepEqual(report.inputs[name],id);if(path==='initramfs.cpio.gz'||path==='fixture'){const actual=await fileHash(resolve(root,name));assert.deepEqual(actual,id);inventory[name]=actual;}else await read(name,id);}
  for(const [path,sha256]of Object.entries(build.sources))await read(path,{sha256});
  const start=JSON.parse(await read(fixture+'/sdk-invocation-start.json',report.inputs[fixture+'/sdk-invocation-start.json'])),completion=JSON.parse(await read(build.sdkInvocation.path,report.inputs[build.sdkInvocation.path]));validateSdkInvocation(start,completion,{root,fixture,path:build.sdkInvocation.path});
  const saved=report.fixtureProof.sdkCompletion;assert.equal(saved.path,'sdk-invocation-complete.json');const retainedCompletion=await read(relative(root,run)+'/'+saved.path,saved);assert.ok(retainedCompletion.equals(await read(build.sdkInvocation.path,report.inputs[build.sdkInvocation.path])),'Exact copied SDK completion bytes');
  const elf=JSON.parse(await read(fixture+'/layout.json',report.inputs[fixture+'/layout.json']));assert.deepEqual(elf,{schema:1,sentinel:layout.sentinel});assert.deepEqual(build.layout,elf);
  const serial=raw.serial.toString('utf8').replace(/\r/g,''),records=serial.split('\n').filter(l=>l.startsWith('M3B_PRESSURE_')).map(l=>{const m=/^M3B_PRESSURE_(LAYOUT|GATE|PASS):(.*)$/.exec(l);assert.ok(m);return {type:m[1],value:JSON.parse(m[2])};});assert.ok(!/M3B_PRESSURE_FAIL:|BUN_APP_FAILURE|Kernel panic/.test(serial));assert.deepEqual(records[0],{type:'LAYOUT',value:layout});assert.equal(records.filter(r=>r.type==='LAYOUT').length,1);
  const oracle=new PressureOracle({enabled:report.enabled,proof,layout:elf});
  const gates=rows.filter(r=>r.event==='gate');assert.deepEqual(records.filter(r=>r.type==='GATE').map(r=>r.value),gates.map(r=>r.gate));assert.equal(report.gates.length,gates.length);
  let failure=null,lastChunks=0;for(let i=1;i<rows.length;i++){
   const row=rows[i];verifyStreamSnapshot(row.streams,index);assert.ok(row.streams.chunks>=lastChunks);lastChunks=row.streams.chunks;
   if(row.event==='gate'){const {ackHostMs,contHostMs,...raw}=report.gates[row.seq];assert.deepEqual(raw,row);assert.equal(row.signalHostMs,report.signals[row.seq]);if(ackHostMs!==undefined)assert.ok(row.readHostMs<=ackHostMs&&ackHostMs<=contHostMs);}
   try{oracle.accept(row);}catch(error){failure={record:i,event:row.event,gate:row.gate??null,error:String(error.stack??error)};assert.equal(i,rows.length-1,'Records after refused observation');break;}
  }
  assert.deepEqual(report.lifetime,oracle.summary());assert.deepEqual(report.startup,rows.find(r=>r.event==='startup'));if(report.final)assert.deepEqual(report.final,rows.find(r=>r.event==='complete'));
  const events=jsonLines(raw.events);if(failure){assert.equal(report.status,'failed');assert.ok(report.oracleFailure);assert.equal(report.oracleFailure.atRecord,failure.record);assert.equal(report.oracleFailure.event,'oracle-failure');assert.equal(report.oracleFailure.observationEvent,failure.event);assert.equal(report.oracleFailure.phase,oracle.phase);assert.deepEqual(report.oracleFailure.gate,failure.gate);assert.equal(events.filter(r=>r.event==='oracle-failure').length,1);const {schema,utc,...rawFailure}=events.find(r=>r.event==='oracle-failure');assert.equal(schema,1);assert.ok(Number.isFinite(Date.parse(utc)));assert.deepEqual(rawFailure,report.oracleFailure);if(failure.event!=='complete')assert.equal(records.filter(r=>r.type==='PASS').length,0);if(['startup','gate','configured'].includes(failure.event))assert.equal(rows.filter(r=>r.event==='ack'&&r.seq===oracle.seq).length,0);}
  else{assert.equal(report.status,oracle.result);assert.ok(['passed','incomplete'].includes(report.status));assert.equal(report.oracleFailure,null);assert.equal(oracle.phase,'done');assert.equal(gates.length,oracle.seq);assert.equal(report.signals.length,oracle.seq);assert.deepEqual(records,[{type:'LAYOUT',value:layout},...oracle.gates.map(value=>({type:'GATE',value})),{type:'PASS',value:report.final.validation}]);assert.equal(events.length,0);}
  for(const [path,id]of Object.entries(report.inputs)){assert.deepEqual(await fileHash(resolve(root,path)),id);inventory[path]=id;}
  for(const [path,id]of Object.entries(report.served)){assert.deepEqual(report.inputs[path],id);}
  for(const name of ['tests/m3b-context-accounting-v2/census-browser.mjs','tests/m3b-fused-pressure/guest.mjs','tests/m3b-fused-pressure/config.mjs','tests/m3b-fused-pressure/guest-contract.mjs','tests/m3b-fused-pressure/transport.mjs','tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/reader.mjs','experiments/m3a-region/reader.mjs','host/browser/qmp.mjs','host/browser/machine.mjs','packaging/bun-app/serial.mjs',fixture+'/initramfs.cpio.gz',proof.runtime+'/qemu-system-x86_64.js',proof.runtime+'/qemu-system-x86_64.wasm',...Object.keys(proof.binding.assets)]){assert.ok(report.inputs[name]);assert.ok(report.served[name]);assert.deepEqual(report.served[name],report.inputs[name]);}
  for(const [path,id]of Object.entries(inventory))assert.deepEqual(await fileHash(resolve(root,path)),id);
  const result={schema:1,kind:'m3b-fused-pressure-capture-replay',status:failure?'reviewed-failed-capture':report.status,acceptance:!failure&&report.status==='passed',timingEligible:false,createdUtc:new Date().toISOString(),run:relative(root,run),captureStatus:report.status,failure,gateCount:gates.length,lifetime:oracle.summary(),inventory,scope:'Same-code offline replay of bounded raw streams, cumulative owner/tier census and guest multiplication checks. Independent review remains separate. No body-retirement, production128MiB, suspended-function or timing claim.'};await publish('report.json',result);console.log(JSON.stringify({status:result.status,output:relative(root,output),gateCount:gates.length}));
 }catch(error){await publish('failure.json',{schema:1,status:'failed-inspection',acceptance:false,error:String(error.stack??error),inventory});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
