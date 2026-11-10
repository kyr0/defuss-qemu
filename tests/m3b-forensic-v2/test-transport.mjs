// Source-only until root runs in the serialized validation gap. No guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BytePipe} from './transport.mjs';
import {limits} from './config.mjs';
import {validateQueue} from './journal.mjs';
const hash=async bytes=>createHash('sha256').update(bytes).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return {promise,resolve};};
const accepted=row=>({accepted:true,seq:row.seq});
const decoded=row=>Array.from(Buffer.from(row.base64,'base64'));
const assertDrained=snapshot=>{const total=Object.values(snapshot.streams).reduce((n,s)=>{assert.equal(s.seen,s.queued);return n+s.queued;},0);assert.equal(snapshot.queue.pendingBytes,0);assert.equal(snapshot.queue.producedBytes,total);assert.equal(snapshot.queue.queuedBytes,total);assert.equal(snapshot.queue.acknowledgedBytes,total);assert.equal(snapshot.queue.acknowledgedChunks,snapshot.chunks);validateQueue(snapshot,Object.fromEntries(Object.entries(snapshot.streams).map(([k,v])=>[k,v.seen])));};

test('shared subview bytes are copied before mutation and exact final partial chunks drain',async()=>{
 const sent=[];
 const pipe=new BytePipe({hash:async bytes=>{assert.ok(!(bytes.buffer instanceof SharedArrayBuffer));return hash(bytes);},send:async row=>{sent.push(row);return accepted(row);}});
 const shared=new Uint8Array(new SharedArrayBuffer(10)),view=new Uint8Array(shared.buffer,3,4);view.set([1,2,3,4]);
 pipe.push('serial',view,0);view.fill(255);
 const snapshot=await pipe.drain();
 assert.equal(sent.length,1);assert.deepEqual(sent[0],{schema:2,seq:0,stream:'serial',offset:0,bytes:4,base64:'AQIDBA==',sha256:await hash(Uint8Array.of(1,2,3,4))});
 assert.deepEqual({chunks:snapshot.chunks,streams:snapshot.streams},{chunks:1,streams:{trace:{seen:0,queued:0},serial:{seen:4,queued:4},stderr:{seen:0,queued:0}}});assertDrained(snapshot);assert.equal(snapshot.queue.peakPendingBytes,4);
 assert.equal(pipe.pending,0);const again=await pipe.drain();assert.deepEqual(again.streams,snapshot.streams);assert.equal(again.chunks,snapshot.chunks);assert.equal(again.queue.drains,snapshot.queue.drains+1);assertDrained(again);assert.equal(sent.length,1);
});

test('full chunks share one ordered acknowledgment chain across streams',async()=>{
 const one=deferred(),two=deferred(),releaseOne=deferred(),releaseTwo=deferred(),sent=[];
 const pipe=new BytePipe({hash,send:async row=>{
  sent.push(row);if(sent.length===1){one.resolve();await releaseOne.promise;}else if(sent.length===2){two.resolve();await releaseTwo.promise;}
  return accepted(row);
 }});
 const first=new Uint8Array(limits.chunk).fill(17),second=new Uint8Array(limits.chunk).fill(34);
 pipe.push('trace',first,0);pipe.push('serial',second,0);
 await one.promise;assert.equal(sent.length,1);assert.equal(pipe.pending,2*limits.chunk);
 first.fill(0);second.fill(0);releaseOne.resolve();await two.promise;
 assert.equal(sent.length,2);assert.equal(pipe.pending,limits.chunk);releaseTwo.resolve();
 const snapshot=await pipe.drain();
 assert.deepEqual(sent.map(row=>[row.seq,row.stream,row.offset,row.bytes]),[[0,'trace',0,limits.chunk],[1,'serial',0,limits.chunk]]);
 assert.ok(decoded(sent[0]).every(n=>n===17)&&decoded(sent[1]).every(n=>n===34));assert.equal(pipe.pending,0);
 assert.equal(snapshot.streams.trace.queued,limits.chunk);assert.equal(snapshot.streams.serial.queued,limits.chunk);
});

test('multiple writes form contiguous chunks and preserve hash/offset/order',async()=>{
 const sent=[],pipe=new BytePipe({hash,send:async row=>{sent.push(row);return accepted(row);}});
 const a=new Uint8Array(limits.chunk-3).fill(7),b=Uint8Array.of(8,9,10,11,12,13,14);
 pipe.push('trace',a,0);pipe.push('trace',b,a.length);pipe.push('stderr',Uint8Array.of(21,22),0);
 const result=await pipe.drain();
 assert.deepEqual(sent.map(row=>[row.seq,row.stream,row.offset,row.bytes]),[[0,'trace',0,limits.chunk],[1,'trace',limits.chunk,4],[2,'stderr',0,2]]);
 assert.deepEqual(decoded(sent[0]).slice(-4),[7,8,9,10]);assert.deepEqual(decoded(sent[1]),[11,12,13,14]);
 for(const row of sent)assert.equal(row.sha256,await hash(Buffer.from(row.base64,'base64')));
 assert.equal(result.streams.trace.seen,a.length+b.length);assert.equal(result.streams.trace.queued,a.length+b.length);
});

test('drain waits for bytes and a partial tail arriving while an earlier ACK is pending',async()=>{
 const firstSeen=deferred(),secondSeen=deferred(),firstAck=deferred(),secondAck=deferred(),sent=[];
 const pipe=new BytePipe({hash,send:async row=>{
  sent.push(row);if(row.seq===0){firstSeen.resolve();await firstAck.promise;}
  if(row.seq===1){secondSeen.resolve();await secondAck.promise;}
  return accepted(row);
 }});
 pipe.push('trace',new Uint8Array(limits.chunk).fill(3),0);await firstSeen.promise;
 let settled=false;const draining=pipe.drain().then(result=>{settled=true;return result;});
 pipe.push('serial',new Uint8Array(limits.chunk+3).fill(4),0);
 firstAck.resolve();await secondSeen.promise;
 assert.equal(settled,false,'A previous ACK is not a complete stream drain');
 secondAck.resolve();const result=await draining;
 assert.deepEqual(sent.map(row=>[row.seq,row.stream,row.offset,row.bytes]),
  [[0,'trace',0,limits.chunk],[1,'serial',0,limits.chunk],[2,'serial',limits.chunk,3]]);
 assert.deepEqual(result.streams.serial,{seen:limits.chunk+3,queued:limits.chunk+3});assert.equal(pipe.pending,0);
});

test('wrong positions, unknown streams and per-stream byte overflow reject synchronously',()=>{
 const pipe=new BytePipe({hash,send:async row=>accepted(row)});
 pipe.push('serial',Uint8Array.of(1),0);
 for(const position of [0,2,-1,0.5,NaN,Infinity])assert.throws(()=>pipe.push('serial',Uint8Array.of(2),position),/Stream position\/byte bound/);
 assert.throws(()=>pipe.push('missing',Uint8Array.of(1),0),/Stream position\/byte bound/);
 assert.throws(()=>pipe.push('trace',[1],0),/Stream position\/byte bound/);
 assert.throws(()=>pipe.push('stderr',new Uint8Array(limits.stderr+1),0),/Stream position\/byte bound/);
 assert.deepEqual(pipe.snapshot().streams.stderr,{seen:0,queued:0});
});

test('pending bound emits exact numeric evidence without allocating64MiB in a host test',()=>{
 const pipe=new BytePipe({hash,clock:()=>123,send:async row=>accepted(row)});
 // Direct-state capacity test only: model an already-owned64MiB queue. The
 // separate real-buffer tests establish copying, ordering and ACK accounting.
 // This adds no production capacity override or synthetic runtime switch.
 pipe.pending=limits.pending;pipe.peakPending=limits.pending;pipe.windowPeakPending=limits.pending;
 pipe.seq=limits.pending/limits.chunk;pipe.streams.trace.seen=limits.pending;pipe.streams.trace.queued=limits.pending;
 let failure;try{pipe.push('trace',Uint8Array.of(1),limits.pending);pipe.flush();}catch(error){failure=error;}
 assert.ok(failure instanceof Error);assert.match(failure.message,/^Unacknowledged byte bound /);
 const detail=JSON.parse(failure.message.slice('Unacknowledged byte bound '.length));
 assert.equal(detail.pending,limits.pending);assert.equal(detail.chunk,1);assert.equal(detail.limit,64*1024*1024);
 assert.equal(detail.producedBytes,limits.pending+1);assert.equal(detail.queuedBytes,limits.pending);assert.equal(detail.acknowledgedBytes,0);
 assert.equal(detail.pendingBytes,limits.pending);assert.equal(detail.peakPendingBytes,limits.pending);assert.equal(detail.windowPeakPendingBytes,limits.pending);
 assert.equal(detail.sampledAtMs,123);
 assert.equal(pipe.seq,limits.pending/limits.chunk);
});

test('a gate accepts only a fully acknowledged bounded queue snapshot',async()=>{
 const pipe=new BytePipe({hash,send:async row=>accepted(row)});pipe.push('trace',Uint8Array.of(1,2,3),0);
 const snapshot=await pipe.drain(),prefix={trace:3,serial:0,stderr:0};assertDrained(snapshot);
 for(const alter of [q=>q.pendingBytes=1,q=>q.acknowledgedBytes=2,q=>q.producedBytes=4,q=>q.queuedBytes=4,
                    q=>q.acknowledgedChunks=false,q=>q.peakPendingBytes=limits.pending+1,q=>q.windowPeakPendingBytes=q.peakPendingBytes+1,
                    q=>q.maxAckMs=Infinity,q=>q.lastDrainMs=q.maxDrainMs+1,q=>q.drains=0,
                    q=>q.sampledAtMs=q.lastAckMs-1,q=>q.maxEnqueueToAckMs=-1]){
  const bad=structuredClone(snapshot);alter(bad.queue);assert.throws(()=>validateQueue(bad,prefix));
 }
});

test('telemetry separates pre-send queue/hash delay, send ACK delay and stopped drain time',async()=>{
 let now=10;const hashEntered=deferred(),hashReady=deferred(),sendEntered=deferred(),ack=deferred();
 const bytes=new Uint8Array(limits.chunk).fill(29);
 const pipe=new BytePipe({clock:()=>now,hash:async()=>{hashEntered.resolve();return hashReady.promise;},
  send:async row=>{sendEntered.resolve();await ack.promise;return accepted(row);}});
 pipe.push('trace',bytes,0);now=20;const draining=pipe.drain();
 await hashEntered.promise;now=30;hashReady.resolve(await hash(bytes));await sendEntered.promise;
 assert.equal(pipe.telemetry().acknowledgedBytes,0);now=55;ack.resolve();const first=await draining;
 assertDrained(first);assert.equal(first.queue.lastAckMs,55);assert.equal(first.queue.sampledAtMs,55);
 assert.equal(first.queue.maxAckMs,25);assert.equal(first.queue.maxEnqueueToAckMs,45);assert.equal(first.queue.lastDrainMs,35);
 assert.equal(first.queue.windowPeakPendingBytes,limits.chunk);assert.equal(first.queue.peakPendingBytes,limits.chunk);
 now=100;const second=await pipe.drain();assertDrained(second);
 assert.equal(second.queue.sampledAtMs,100);assert.equal(second.queue.lastAckMs,55);
 assert.equal(second.queue.windowPeakPendingBytes,0);assert.equal(second.queue.peakPendingBytes,limits.chunk);
 assert.equal(second.queue.maxDrainMs,35);assert.equal(second.queue.maxEnqueueToAckMs,45);
});

for(const [name,send] of [
 ['refusal',async row=>({accepted:false,seq:row.seq})],
 ['wrong-sequence',async row=>({accepted:true,seq:row.seq+1})],
 ['boolean-sequence',async()=>({accepted:true,seq:false})],
 ['rejected-promise',async()=>{throw Error('durable writer failed');}],
])test('durable '+name+' is latched and drain cannot report success',async()=>{
 const failures=[],pipe=new BytePipe({hash,send,onFailure:e=>failures.push(e)});
 pipe.push('serial',Uint8Array.of(1,2),0);
 await assert.rejects(pipe.drain(),/Durable chunk acknowledgment rejected|durable writer failed/);
 assert.ok(failures.length>=1);assert.equal(pipe.pending,0);assert.ok(pipe.error instanceof Error);
 assert.throws(()=>pipe.push('serial',Uint8Array.of(3),2),/Durable chunk acknowledgment rejected|durable writer failed/);
 await assert.rejects(pipe.drain(),/Durable chunk acknowledgment rejected|durable writer failed/);
});
