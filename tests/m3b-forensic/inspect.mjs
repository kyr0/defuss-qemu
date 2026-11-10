#!/usr/bin/env node
// Offline only: invoke after the root-owned capture process/browser has closed.
import assert from 'node:assert/strict';
import {readFile,mkdir,open,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {parseTrace,classifyRfTransitions} from './trace.mjs';
import {limits,protocol,traceSpec,argumentsFor} from './config.mjs';
import {referenceGates,validateLayout} from '../m3b-fallthrough/contract.mjs';
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
 return index.prefixes[snapshot.chunks];
}

async function main(){
 const {values}=parseArgs({options:{run:{type:'string'},output:{type:'string'}}});assert.ok(values.run&&values.output);
 const run=resolve(root,values.run),output=resolve(root,values.output);assert.equal(dirname(run),root+'/artifacts');assert.equal(dirname(output),root+'/artifacts');assert.notEqual(run,output);assert.equal(await realpath(run),run);
 const inventory={},sync=async p=>{const h=await open(p,'r');try{await h.sync();}finally{await h.close();}};
 await mkdir(output);await sync(dirname(output));
 const publish=async(name,value)=>{const h=await open(output+'/'+name,'wx');try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}await sync(output);};
 const read=async(path,id,max=32*1024*1024)=>{const p=resolve(root,path);assert.ok(p.startsWith(root+'/'));assert.equal(await realpath(p),p);assert.ok((await stat(p)).size<=max,'Input byte bound');const b=await readFile(p),actual={sha256:hash(b),bytes:b.length};if(id)assert.deepEqual(actual,{sha256:id.sha256,bytes:id.bytes});inventory[relative(root,p)]=actual;return b;};
 try{
  const report=JSON.parse(await read(relative(root,run)+'/report.json'));assert.equal(report.schema,1);assert.equal(report.protocol,protocol);assert.equal(report.timingEligible,false);assert.equal(typeof report.enabled,'boolean');assert.ok(['failed','passed'].includes(report.status));assert.deepEqual(report.inputRecheck,[]);assert.deepEqual(report.limits,limits);assert.ok(Number.isFinite(Date.parse(report.completedUtc)));
  assert.equal(report.endStatus?.running,false);assert.equal(report.endStatus?.status,'paused');assert.equal(report.pauseFailure,undefined);assert.equal(report.drainFailure,undefined);assert.ok(!/Cleanup:|I\/O:|Durable stream reconciliation:/.test(report.failure??''),'Capture closure/I/O unresolved');
  assert.deepEqual(Object.keys(report.artifacts).sort(),['trace','serial','stderr','progress','chunks','events'].sort());const raw={};
  for(const [name,id]of Object.entries(report.artifacts)){assert.equal(id.path,({trace:'native-trace.log',serial:'serial.log',stderr:'stderr.log',progress:'progress.jsonl',chunks:'chunks.jsonl',events:'events.jsonl'})[name]);raw[name]=await read(relative(root,run)+'/'+id.path,id,limits[name]??(name==='progress'?16*1024*1024:name==='chunks'?32*1024*1024:1024*1024));}
  const index=verifyChunkIndex(jsonLines(raw.chunks),Object.fromEntries(streamNames.map(n=>[n,raw[n]])));assert.deepEqual(report.streamsDurable,{chunks:index.chunks,files:index.files});verifyStreamSnapshot(report.streams,index);assert.equal(report.streams.chunks,index.chunks);
  const envelopes=jsonLines(raw.progress);assert.ok(envelopes.length>1&&envelopes.length<=limits.records);for(let i=0;i<envelopes.length;i++){assert.equal(envelopes[i].schema,1);assert.equal(envelopes[i].record,i);}
  const rows=envelopes.map(r=>r.observation),header=rows[0];assert.equal(header.event,'header');assert.equal(header.protocol,protocol);assert.equal(header.enabled,report.enabled);
  for(const name of ['inputs','limits','trace','timeoutMs','sourceProof','fixtureProof','hostCondition','hostBefore','chrome'])assert.deepEqual(header[name],report[name]);assert.deepEqual(header.binding,report.runtimeProof.binding);assert.deepEqual(header.arguments,report.arguments);
  const layout=validateLayout(report.layout);assert.deepEqual(report.trace,traceSpec(layout.programs));assert.deepEqual(report.arguments,argumentsFor(report.trace));
  const fixtureLayoutPath=report.fixtureProof.buildReport.replace(/build-report\.json$/,'layout.json');assert.ok(report.inputs[fixtureLayoutPath]);const elf=JSON.parse(await read(fixtureLayoutPath,report.inputs[fixtureLayoutPath]));
  for(let i=0;i<layout.programs.length;i++)for(const key of ['name','a','b','back','side','end','ownerBytes','codeHex'])assert.deepEqual(layout.programs[i][key],elf.programs[i][key]);
  for(const path of ['tests/m3b-forensic/trace.mjs','tests/m3b-forensic/inspect.mjs','tests/m3b-forensic/config.mjs','tests/m3b-fallthrough/contract.mjs']){assert.ok(report.inputs[path]);await read(path,report.inputs[path]);}
  for(const proof of [report.sourceProof.sourceManifest,report.sourceProof.sourceReview])await read(proof.path,proof);
  const serial=raw.serial.toString('utf8').replace(/\r/g,''),records=serial.split('\n').filter(l=>l.startsWith('M3B_')).map(l=>{const m=/^M3B_(LAYOUT|GATE|PASS):(.*)$/.exec(l);assert.ok(m,'Unexpected serial marker');return {type:m[1],value:JSON.parse(m[2])};});
  assert.ok(!/M3B_FAIL:|BUN_APP_FAILURE|Kernel panic/.test(serial));assert.deepEqual(records[0],{type:'LAYOUT',value:layout});assert.equal(records.filter(r=>r.type==='LAYOUT').length,1);
  const gates=rows.filter(r=>r.event==='gate'),reference=referenceGates();assert.ok(gates.length>0&&gates.length<=45);assert.deepEqual(records.filter(r=>r.type==='GATE').map(r=>r.value),gates.map(r=>r.gate));assert.equal(report.gates.length,gates.length);
  let lastChunks=0,lastTrace=0;for(const row of rows.slice(1)){const prefix=verifyStreamSnapshot(row.streams,index);assert.ok(row.streams.chunks>=lastChunks&&prefix.trace>=lastTrace);lastChunks=row.streams.chunks;lastTrace=prefix.trace;}
  // Low virtual addresses may have matched boot/decompressor code before the
  // guest's layout gate. Retain/hash all bytes; parse only the prospectively
  // fixed user-work horizon after the first acknowledged layout gate.
  const layoutAck=rows.find(r=>r.event==='ack'&&r.seq===0);assert.ok(layoutAck,'No acknowledged user-work start');
  const analysisStart=layoutAck.streams.streams.trace.seen;assert.ok(analysisStart===0||raw.trace[analysisStart-1]===10,'User-work offset must end a complete log line');
  const parsed=parseTrace(raw.trace.subarray(analysisStart),{offsetBase:analysisStart}); // Exactly once, after closure.
  const windows=[];let start=0,expected=0,awaiting='startup',lastGate=null;
  for(let i=1;i<rows.length;i++){
   const row=rows[i],end=row.streams.streams.trace.seen;
   if(row.event==='startup'){assert.equal(awaiting,'startup');assert.equal(row.status?.status,'prelaunch');assert.equal(row.status?.running,false);start=end;awaiting='gate';continue;}
   if(row.event==='gate'){
    assert.equal(awaiting,'gate');assert.deepEqual(row.gate,reference.gates[expected]);assert.equal(row.status?.status,'paused');assert.equal(row.status?.running,false);assert.deepEqual(row.captureErrors,[]);
    const {ackHostMs,contHostMs,...saved}=report.gates[expected];assert.deepEqual(saved,row);assert.equal(row.signalHostMs,report.signals[expected]);
    const classification=expected===0?{status:'boot-prefix-not-analyzed',start,end,acceptance:false,rfAToB:0,rfAToSide:0,scope:'Boot bytes remain hash-bound. No RF/64-bit execution claim is made for the prefix before acknowledged layout gate0.'}:classifyRfTransitions(parsed,{layout,start,end});
    windows.push({gate:row.gate,traceStart:start,traceEnd:end,streams:row.streams,classification});lastGate=row;awaiting='configured';continue;
   }
   if(row.event==='configured'){assert.equal(awaiting,'configured');assert.equal(row.seq,expected);assert.equal(end,lastGate.streams.streams.trace.seen,'Native trace changed while paused');awaiting='ack';continue;}
   if(row.event==='ack'){assert.equal(awaiting,'ack');assert.equal(row.seq,expected);assert.equal(end,lastGate.streams.streams.trace.seen,'ACK cannot execute paused guest');start=end;expected++;awaiting=expected===45?'complete':'gate';continue;}
   assert.equal(row.event,'complete');assert.equal(awaiting,'complete');assert.deepEqual(row.validation,reference.pass);awaiting='done';
  }
  const events=jsonLines(raw.events);if(report.oracleFailure){assert.equal(report.status,'failed');assert.equal(awaiting,'configured','Only a retained refused gate can delimit this diagnosis');assert.deepEqual(report.oracleFailure.gate,lastGate.gate);assert.equal(report.oracleFailure.atRecord,rows.length-1);assert.equal(events.filter(x=>x.event==='oracle-failure').length,1);const {schema,utc,...failure}=events.find(x=>x.event==='oracle-failure');assert.equal(schema,1);assert.deepEqual(failure,report.oracleFailure);assert.equal(records.filter(r=>r.type==='PASS').length,0);}
  else{assert.equal(report.status,'passed');assert.equal(awaiting,'done');assert.deepEqual(records.at(-1),{type:'PASS',value:reference.pass});}
  const result={schema:1,kind:'m3b-forensic-offline-rf-classification',status:'diagnostic-only',createdUtc:new Date().toISOString(),run:relative(root,run),captureStatus:report.status,oracleFailure:report.oracleFailure??null,acceptance:false,timingEligible:false,inventory,layout,trace:report.trace,retainedUnparsedBoot:{bytes:analysisStart,sha256:hash(raw.trace.subarray(0,analysisStart)),boundary:'Acknowledged layout gate0; fixed before user-work execution.'},parsedRange:{start:analysisStart,end:raw.trace.length},rawEntries:parsed.entries.length,rawStoppedChainMessages:parsed.stops.length,windows,
   provenance:{runtimeProof:report.runtimeProof,sourceProof:report.sourceProof,fixtureProof:report.fixtureProof,scope:'Bound retained raw capture references. This tool does not recompute the complete runtime/source/SDK build proof.'},
   limits:['Original strict baseline acceptance is unchanged; a failed capture remains failed.','Non-recurrence is inconclusive and never replaces the original ON01 failure.','An RF A certificate proves its exact prelude exit to B/side only. It is not a retired B body or descriptor-generation measurement.','Only adjacent complete outer CPU entries inside one acknowledged window qualify; ambiguous contexts/stops/missing successors remain explicit.','No timing, promotion or general architectural-state acceptance claim.']};
  // Recheck the small metadata and source inputs; stream bytes were hash-bound
  // before parsing. Final raw file identities are rehashed once to detect change.
  for(const [path,id]of Object.entries(inventory)){const b=await readFile(resolve(root,path));assert.equal(hash(b),id.sha256);assert.equal(b.length,id.bytes);}
  await publish('report.json',result);console.log(JSON.stringify({status:result.status,output:relative(root,output),windows:windows.length,rfAToB:windows.reduce((n,w)=>n+w.classification.rfAToB,0)}));
 }catch(error){await publish('failure.json',{schema:1,status:'failed-inspection',acceptance:false,error:String(error.stack??error),inventory});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
