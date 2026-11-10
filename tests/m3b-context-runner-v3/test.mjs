// Host source/corruption fixtures only; no VM execution is performed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ChunkLedger,validateQueue} from './journal.mjs';
import {traceSpec,argumentsFor,limits} from './config.mjs';
import {args} from '../m3b-fallthrough/guest.mjs';
import {validateSelectedWindow} from '../m3b-fallthrough/contract.mjs';
import {validateImageClosure,imageSources} from './identity.mjs';
import {recordObservation} from './transport.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const chunk=(seq=0,offset=0,bytes=[1,2,3])=>({schema:2,seq,stream:'trace',offset,bytes:bytes.length,base64:Buffer.from(bytes).toString('base64'),sha256:sha(Buffer.from(bytes))});
const queue=(n,chunks)=>({producedBytes:n,queuedBytes:n,acknowledgedBytes:n,acknowledgedChunks:chunks,pendingBytes:0,peakPendingBytes:n,windowPeakPendingBytes:n,sampledAtMs:3,lastAckMs:1,maxAckMs:1,maxEnqueueToAckMs:2,drains:1,lastDrainMs:1,maxDrainMs:1});
test('the retained guest row and durable observation contain the identical drained prefix, even on refusal',async()=>{
 const prefix={chunks:1,streams:{trace:{seen:3,queued:3},serial:{seen:0,queued:0},stderr:{seen:0,queued:0}}};
 for(const accepted of [true,false]){const row={event:'gate',gate:{seq:8}},saved=[];
  const action=recordObservation({drain:async()=>structuredClone(prefix)},async value=>{saved.push(structuredClone(value));return {accepted,failure:'strict oracle refusal'};},row);
  if(accepted)await action;else await assert.rejects(()=>action,/strict oracle refusal/);
  assert.deepEqual(row.streams,prefix);assert.deepEqual(saved,[row]);
 }
});
test('chunk ACK requires copied contiguous bytes and metadata durability, with exact prefix/hash',async()=>{
 const effects=[],ledger=new ChunkLedger({writeBytes:async(n,b,o)=>effects.push(['data',n,[...b],o]),writeMetadata:async r=>effects.push(['metadata',r])});
 assert.deepEqual(await ledger.accept(chunk()),{accepted:true,seq:0});assert.equal(effects[0][0],'data');assert.equal(effects[1][0],'metadata');
 const prefix={chunks:1,streams:{trace:{seen:3,queued:3},serial:{seen:0,queued:0},stderr:{seen:0,queued:0}},queue:queue(3,1)};ledger.verifyPrefix(prefix);
 assert.deepEqual(ledger.summary().files.trace,{bytes:3,sha256:sha(Buffer.from([1,2,3]))});
 await ledger.accept(chunk(1,3,[4]));ledger.verifyPrefix(prefix);assert.equal(ledger.summary().files.trace.bytes,4);
 for(const mutate of [x=>x.seq=1,x=>x.offset=0,x=>x.schema=1,x=>x.sha256='0'.repeat(64),x=>x.bytes=0,x=>x.bytes=2,x=>x.base64+='\n',x=>x.base64='AQID====',x=>x.extra=true,x=>x.stream='unknown']){const x=chunk(2,4);mutate(x);await assert.rejects(()=>ledger.accept(x));}
 const bad=structuredClone(prefix);bad.streams.trace.seen=2;assert.throws(()=>ledger.verifyPrefix(bad));
});
test('stopped queue evidence must prove complete host acknowledgment and bounded window peak',()=>{
 const snapshot={chunks:1,queue:queue(3,1)},prefix={trace:3,serial:0,stderr:0};validateQueue(snapshot,prefix);
 for(const mutate of [x=>delete x.queue,x=>x.queue.pendingBytes=1,x=>x.queue.acknowledgedBytes=2,x=>x.queue.acknowledgedChunks=0,x=>x.queue.windowPeakPendingBytes=67108865,x=>x.queue.lastDrainMs=2,x=>x.queue.maxAckMs=NaN]){const x=structuredClone(snapshot);mutate(x);assert.throws(()=>validateQueue(x,prefix));}
});
test('a failed durable-index write does not acknowledge or advance the ledger',async()=>{
 let wrote=false;const ledger=new ChunkLedger({writeBytes:async()=>{wrote=true;},writeMetadata:async()=>{throw Error('fsync failed');}});
 await assert.rejects(()=>ledger.accept(chunk()),/fsync failed/);assert.equal(wrote,true);assert.equal(ledger.count,0);assert.equal(ledger.totals.trace,0);
});
test('trace arguments add logging only, cover exact eleven ELF extents and never nochain',()=>{
 const layout=Array.from({length:11},(_,i)=>({name:'p'+i,a:'0x'+(0x401000+i*4096).toString(16),end:'0x'+(0x401014+i*4096).toString(16)})),spec=traceSpec(layout),argv=argumentsFor(spec);
 assert.deepEqual(argv.slice(0,args.length),[...args]);assert.deepEqual(argv.slice(args.length),['-d','exec,in_asm,cpu','-dfilter',spec.filter,'-D','/guest/m3b-tb.log']);assert.equal(spec.ranges.length,11);assert.equal(spec.ranges[0].last,'0x401013');assert.ok(!argv.includes('nochain'));
 for(const change of [x=>x.pop(),x=>x[0].end='0x500000',x=>x[1].a=x[0].a,x=>x[0].a='0x0']){const x=structuredClone(layout);change(x);assert.throws(()=>traceSpec(x));}
});
test('original ON01 gate8 still fails the unchanged B-attempt oracle',async()=>{
 const report=JSON.parse(await readFile(new URL('../../artifacts/m3b-fallthrough-on-01/report.json',import.meta.url))),bytes=await readFile(new URL('../../artifacts/m3b-fallthrough-on-01/progress.jsonl',import.meta.url));
 assert.equal(sha(bytes),report.artifacts.progress.sha256);const row=bytes.toString().trim().split('\n').map(JSON.parse).map(x=>x.observation).find(x=>x.event==='gate'&&x.gate.seq===8);
 assert.equal(row.gate.bodies,550);assert.equal(row.m3b.watches[0].BAttempts,485);assert.equal(row.m3a.watches[1].selectedEntries,65);
 assert.throws(()=>validateSelectedWindow({enabled:true,program:1,phase:'direct-b',gate:row.gate,m3aA:row.m3a.watches[0],m3aB:row.m3a.watches[1],fusedA:row.m3b.watches[0],fusedB:row.m3b.watches[1]}),/All intended fused B boundary attempts/);
});
test('fixture source closure cannot omit a source or substitute the original base rootfs',()=>{
 const good={sources:Object.fromEntries(imageSources.map(p=>[p,'a'.repeat(64)])),baseInitramfsSha256:'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9'};validateImageClosure(good);
 for(const p of imageSources){const x=structuredClone(good);delete x.sources[p];assert.throws(()=>validateImageClosure(x));}
 const x=structuredClone(good);x.baseInitramfsSha256='0'.repeat(64);assert.throws(()=>validateImageClosure(x));
});
test('new context parser preserves the frozen classifier with only the fixed512MiB capacity change',async()=>{
 const original=JSON.parse(await readFile(new URL('../../artifacts/m3b-forensic-source-01/manifest.json',import.meta.url)));
 for(const name of ['trace.mjs']){const path='tests/m3b-forensic/'+name,row=original.files.find(r=>r.path===path);assert.ok(row);
  const old=await readFile(new URL('../m3b-forensic/'+name,import.meta.url)),current=await readFile(new URL('./'+name,import.meta.url));assert.equal(sha(old),row.sha256);assert.equal(old.length,row.bytes);assert.equal(current.toString(),old.toString().replace('maxTraceBytes=256*1024*1024','maxTraceBytes=512*1024*1024'));assert.equal(limits.trace,512*1024*1024);assert.equal(limits.pending,64*1024*1024);
 }
});
