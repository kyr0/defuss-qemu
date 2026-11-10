import test from 'node:test';
import assert from 'node:assert/strict';
import {configureFifo,readFifoPerformance,readFifoSnapshot,decodeFifoSnapshot,fifoMagic} from './reader.mjs';
const paused=async()=>({status:'paused',running:false});
function module({diagnostic=1,enabled=true,complete=true}={}){
 const buffer=new SharedArrayBuffer(1024),words=new Uint32Array(buffer,256,64);let status=0,execution=0;
 const m={HEAPU8:new Uint8Array(buffer),words,_defuss_fifo_abi:()=>1,_defuss_fifo_diagnostic:()=>diagnostic,_defuss_fifo_status:()=>status,_defuss_fifo_state:()=>execution,_defuss_fifo_rejections:()=>0,
  _defuss_fifo_configure:value=>{if(status)return -1;status=value?5:4;return 0;},_defuss_fifo_data:()=>diagnostic?256n:0n,
  lock(){status|=2;execution=enabled?3:0;},
  _defuss_fifo_request:sequence=>{Atomics.store(words,2,sequence);if(complete)queueMicrotask(()=>{
   words[0]=fifoMagic;words[1]=1;words[4]=0;words[5]=status;words[8]=100;words[9]=80;words[10]=20;words[11]=5;words[12]=12000;words[13]=12;words[14]=1;words[37]=20;words[38]=100;words[39]=80;words[40]=enabled?1:0;words[41]=enabled?0:1<<14;Atomics.store(words,3,sequence);
  });return 0;}};return m;
}
function ready(options={}){const m=module(options);configureFifo(m,options.enabled??true,{diagnostic:Boolean(options.diagnostic??1)});m.lock();return m;}
test('pre-vCPU one-time configuration and effective locked performance mode',()=>{
 for(const enabled of [false,true]){const m=ready({diagnostic:0,enabled});assert.equal(readFifoPerformance(m,enabled).effective,enabled);assert.throws(()=>configureFifo(m,enabled));assert.throws(()=>readFifoPerformance(m,!enabled));}
 const m=ready({diagnostic:0});m._defuss_fifo_state=()=>1;assert.throws(()=>readFifoPerformance(m,true),/ineffective/);
 assert.throws(()=>configureFifo(module(),true),/artifact kind/);
});
test('fresh owning-worker snapshots use new coherent IDs and shared-buffer fallback',async()=>{
 const m=ready();const first=await readFifoSnapshot(m,{enabled:true,queryStatus:paused});assert.equal(first.sequence,1);assert.equal(first.charged,100);assert.equal(first.activePolicy,true);
 const buffer=m.HEAPU8.buffer;delete m.HEAPU8;m.pcProfileWords=()=>new Uint32Array(buffer);
 assert.equal((await readFifoSnapshot(m,{enabled:true,queryStatus:paused})).sequence,2);
 const off=ready({enabled:false});assert.deepEqual((await readFifoSnapshot(off,{enabled:false,queryStatus:paused})).rejectionReasons,['disabled']);
});
test('cached/pending/replaced and wrong owning-CPU snapshots are rejected',async()=>{
 const pending=ready();pending.words[2]=2;await assert.rejects(readFifoSnapshot(pending,{enabled:true,queryStatus:paused}),/pending/);
 const replaced=ready();replaced._defuss_fifo_request=sequence=>{Atomics.store(replaced.words,2,sequence+1);return 0;};await assert.rejects(readFifoSnapshot(replaced,{enabled:true,queryStatus:paused}),/replaced/);
 const wrong=ready();await readFifoSnapshot(wrong,{enabled:true,queryStatus:paused});const raw=Array.from(wrong.words);raw[6]=1;assert.throws(()=>decodeFifoSnapshot(raw,1,true),/owner/);
});
test('accounting, saturation, effective mode and reserved words fail closed',async()=>{
 const m=ready();await readFifoSnapshot(m,{enabled:true,queryStatus:paused});const good=Array.from(m.words);
 for(const [index,value] of [[8,101],[11,21],[12,12001],[13,257],[15,1],[40,0],[42,1],[38,99]]){const raw=[...good];raw[index]=value;assert.throws(()=>decodeFifoSnapshot(raw,1,true));}
 const raw=[...good];raw[4]=(-3)>>>0;assert.throws(()=>decodeFifoSnapshot(raw,1,true),error=>error.observation.status===-3);
 for(const mutate of [raw=>{raw[40]=0;raw[41]=1<<15;},raw=>{raw[30]=1;},raw=>{raw[40]=0;raw[41]=1<<14;}]){
  const bad=[...good];mutate(bad);assert.throws(()=>decodeFifoSnapshot(bad,1,true),error=>Boolean(error.observation?.raw));
 }
});
test('running VM, native rejection and sequence wrap are never accepted',async()=>{
 await assert.rejects(readFifoSnapshot(ready(),{enabled:true,queryStatus:async()=>({running:true,status:'running'})}),/paused/);
 const rejected=ready();rejected._defuss_fifo_request=()=>-2;await assert.rejects(readFifoSnapshot(rejected,{enabled:true,queryStatus:paused}),error=>error.observation.nativeResult===-2);
 const wrapped=ready();wrapped.words[2]=wrapped.words[3]=0xffffffff;await assert.rejects(readFifoSnapshot(wrapped,{enabled:true,queryStatus:paused}),/exhausted/);
});
test('bounded timeout poisons outstanding state and no cached completion can rescue it',async()=>{
 const m=ready({complete:false});await assert.rejects(readFifoSnapshot(m,{enabled:true,queryStatus:paused,timeoutMs:10,pollMs:1}),/deadline/);m.words[3]=m.words[2];await assert.rejects(readFifoSnapshot(m,{enabled:true,queryStatus:paused}),/previous failure/);
});
test('overlapping reads and lost post-read paused state reject',async()=>{
 const m=ready({complete:false});const first=readFifoSnapshot(m,{enabled:true,queryStatus:paused,timeoutMs:10});await assert.rejects(readFifoSnapshot(m,{enabled:true,queryStatus:paused}),/concurrency/);await assert.rejects(first,/deadline/);
 let calls=0;await assert.rejects(readFifoSnapshot(ready(),{enabled:true,queryStatus:async()=>++calls===1?{running:false,status:'paused'}:{running:true,status:'running'}}),/outside paused/);
});
