// Source-only until root runs in the serialized validation gap. No guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BytePipe} from './transport.mjs';
import {limits} from './config.mjs';
const hash=async bytes=>createHash('sha256').update(bytes).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return {promise,resolve};};
const accepted=row=>({accepted:true,seq:row.seq});

test('shared subview bytes are copied before mutation and exact final partial chunks drain',async()=>{
 const sent=[];
 const pipe=new BytePipe({hash:async bytes=>{assert.ok(!(bytes.buffer instanceof SharedArrayBuffer));return hash(bytes);},send:async row=>{sent.push(row);return accepted(row);}});
 const shared=new Uint8Array(new SharedArrayBuffer(10)),view=new Uint8Array(shared.buffer,3,4);view.set([1,2,3,4]);
 pipe.push('serial',view,0);view.fill(255);
 const snapshot=await pipe.drain();
 assert.equal(sent.length,1);assert.deepEqual(sent[0],{schema:1,seq:0,stream:'serial',offset:0,bytes:[1,2,3,4],sha256:await hash(Uint8Array.of(1,2,3,4))});
 assert.deepEqual(snapshot,{chunks:1,streams:{trace:{seen:0,queued:0},serial:{seen:4,queued:4},stderr:{seen:0,queued:0}}});
 assert.equal(pipe.pending,0);assert.deepEqual(await pipe.drain(),snapshot);assert.equal(sent.length,1);
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
 assert.deepEqual(sent.map(row=>[row.seq,row.stream,row.offset,row.bytes.length]),[[0,'trace',0,limits.chunk],[1,'serial',0,limits.chunk]]);
 assert.ok(sent[0].bytes.every(n=>n===17)&&sent[1].bytes.every(n=>n===34));assert.equal(pipe.pending,0);
 assert.equal(snapshot.streams.trace.queued,limits.chunk);assert.equal(snapshot.streams.serial.queued,limits.chunk);
});

test('multiple writes form contiguous chunks and preserve hash/offset/order',async()=>{
 const sent=[],pipe=new BytePipe({hash,send:async row=>{sent.push(row);return accepted(row);}});
 const a=new Uint8Array(limits.chunk-3).fill(7),b=Uint8Array.of(8,9,10,11,12,13,14);
 pipe.push('trace',a,0);pipe.push('trace',b,a.length);pipe.push('stderr',Uint8Array.of(21,22),0);
 const result=await pipe.drain();
 assert.deepEqual(sent.map(row=>[row.seq,row.stream,row.offset,row.bytes.length]),[[0,'trace',0,limits.chunk],[1,'trace',limits.chunk,4],[2,'stderr',0,2]]);
 assert.deepEqual(sent[0].bytes.slice(-4),[7,8,9,10]);assert.deepEqual(sent[1].bytes,[11,12,13,14]);
 for(const row of sent)assert.equal(row.sha256,await hash(Uint8Array.from(row.bytes)));
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
 assert.deepEqual(sent.map(row=>[row.seq,row.stream,row.offset,row.bytes.length]),
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

test('bounded unacknowledged bytes cannot silently enter the send queue',async()=>{
 const entered=deferred(),release=deferred();let sent=0;
 const pipe=new BytePipe({hash,send:async row=>{sent++;if(sent===1){entered.resolve();await release.promise;}return accepted(row);}});
 const chunk=new Uint8Array(limits.chunk);
 for(let n=0;n<limits.pending/limits.chunk;n++)pipe.push('trace',chunk,n*limits.chunk);
 assert.equal(pipe.pending,limits.pending);
 assert.throws(()=>{pipe.push('trace',Uint8Array.of(1),limits.pending);pipe.flush();},/Unacknowledged byte bound/);
 await entered.promise;assert.equal(sent,1);assert.equal(pipe.seq,limits.pending/limits.chunk);
 // The caller has already received the synchronous fatal bound error. Let
 // accepted earlier chunks settle; this test does not claim a passing drain.
 release.resolve();await pipe.chain;assert.equal(pipe.pending,0);assert.equal(sent,limits.pending/limits.chunk);
 assert.equal(pipe.snapshot().streams.trace.queued,limits.pending);
 assert.equal(pipe.snapshot().streams.trace.seen,limits.pending+1);
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
