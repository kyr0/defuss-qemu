import assert from 'node:assert/strict';
import {decodeObservation,delta} from '../../benchmarks/harness/m3b-code-attribution/oracle.mjs';
import {codeDelta} from '../../benchmarks/harness/m3b-code-attribution/code.mjs';
import {requireCensusBinding} from '../m3b-context-accounting-v2/census-reader.mjs';
import {stopped} from '../m3b-fallthrough/reader.mjs';
import {validateLayout,validateGate,validatePass,codeAdd,codeSub} from './guest-contract.mjs';
function jit(row,s){
 assert.equal(row.jitError,null);stopped(row.jitStatus);const text=row.jitRaw?.['human-readable-text'];assert.ok(typeof text==='string'&&text.length<=32768);
 const get=re=>{const xs=[...text.matchAll(re)];assert.equal(xs.length,1);return xs[0].slice(1).map(Number);};
 const [used,capacity]=get(/^gen code size\s+(\d+)\/(\d+)[ \t]*\r?$/gm),[count]=get(/^TB count\s+(\d+)[ \t]*\r?$/gm),[flushes]=get(/^TB flush count\s+(\d+)[ \t]*\r?$/gm);
 assert.ok(capacity>127*1048576&&capacity<=128*1048576&&used<=capacity&&count>0);assert.equal(flushes,0);assert.equal(s.m3a.flushes,0);return {usedBytes:used,capacityBytes:capacity,tbCount:count,flushCount:flushes};
}
export class PressureOracle{
 constructor({enabled,proof,layout}){
  assert.equal(typeof enabled,'boolean');requireCensusBinding(proof.binding);assert.equal(layout.schema,1);assert.equal('89f931c0'+layout.sentinel.codeHex+'c3',codeAdd);
  Object.assign(this,{enabled,proof,phase:'startup',seq:0,clock:0,lastAck:0,epoch:0,gates:[],epochs:[],resets:[],previous:null});
 }
 snapshot(row,initial=false){
  assert.deepEqual(row.captureErrors,[]);const s=decodeObservation(row,this.enabled,initial);
  if(this.previous){delta(this.previous.m3a,s.m3a);delta(this.previous.m3b,s.m3b);codeDelta(this.previous.code,s.code);}this.previous=s;return s;
 }
 accept(row){
  const time=row.event==='gate'?row.readHostMs:row.hostMs;assert.ok(Number.isFinite(time)&&time>=this.clock);this.clock=time;
  if(row.event==='startup'){
   assert.equal(this.phase,'startup');assert.equal(row.startupFailure,null);assert.equal(row.startupCpus.length,1);assert.equal(row.startupCpus[0]['cpu-index'],0);const s=this.snapshot(row,true);
   for(const family of ['m3a','m3b'])assert.ok(Object.values(s[family]).every(n=>n===0));for(const n of ['graph','objects'])assert.deepEqual(row[n+'Raw'],[...Buffer.from(this.proof[n].text)]);this.phase='gate';return;
  }
  if(row.event==='ack'){
   assert.equal(this.phase,'ack');assert.equal(row.seq,this.seq);assert.equal(row.ack,'K');assert.deepEqual(row.watchEpoch,{m3a:0,m3b:0,census:0});this.lastAck=time;this.seq++;this.phase=this.seq===10?'complete':'gate';return;
  }
  if(row.event==='complete'){
   assert.equal(this.phase,'complete');validatePass(row.validation);const old=this.previous,s=this.snapshot(row);jit(row,s);assert.deepEqual(s.code,old.code);assert.equal(this.epochs.length,9);this.result='passed';this.phase='done';return {result:'passed'};
  }
  assert.equal(row.event,'gate');assert.equal(this.phase,'gate');assert.equal(row.seq,this.seq);assert.equal(row.gate.seq,this.seq);assert.ok(row.signalHostMs>=this.lastAck&&row.readHostMs>=row.signalHostMs);
  const prior=this.previous,s=this.snapshot(row),storage=jit(row,s);
  if(!this.seq){this.layout=validateLayout(row.layout);assert.equal(s.code.formed,0);}
  validateGate(row.gate,this.layout);
  if(this.seq){
   const target=s.code.records.filter(r=>r.translationPC===this.layout.a),old=prior.code.records.filter(r=>r.translationPC===this.layout.a);
   if(this.enabled){
    assert.equal(target.length,this.seq,'Exactly one fresh target generation per patch');assert.equal(old.length,this.seq-1);
    for(let i=0;i<target.length;i++){
     const t=target[i];assert.equal(t.status,'entered');assert.equal(t.flags,0x18c0c2b3);assert.equal(t.cflags,0xff020000);assert.equal(t.bytes,12);assert.equal(t.bOffset,5);assert.equal(t.bytesHex,(i%2?codeSub:codeAdd).slice(8,-2));assert.equal(BigInt(t.page0),BigInt(this.layout.physicalFrame)*4096n+4n);assert.ok(t.compiled>0);
     if(i)assert.ok(BigInt(t.generation)>BigInt(target[i-1].generation));
     if(i<old.length-1){assert.equal(t.compiled,old[i].compiled,'Retired target remains quiescent');assert.equal(t.tci,old[i].tci);}
    }
    if(old.length){assert.ok(target.at(-2).compiled>old.at(-1).compiled,'Old warmed generation executes before patch');assert.ok(s.m3a.invalidations>prior.m3a.invalidations,'Guest code invalidation observed');}
    assert.ok(s.m3b.BAttempts>prior.m3b.BAttempts);assert.equal(s.m3b.BAttempts,s.m3b.servicePaid);
   }else assert.deepEqual(target,[]);
   this.epochs.push({seq:this.seq,patches:row.gate.patches,code:codeDelta(prior.code,s.code),target,storage});
  }
  this.phase='ack';this.gates.push(structuredClone(row.gate));return {ack:'K'};
 }
 summary(){return {status:this.result??'failed',enabled:this.enabled,resets:[],epochs:this.epochs,scope:'Natural guest handler alias writes during an interrupted call, exact integer contexts/results, and compiled replacement generations. No active generated-WASM-frame or Asyncify-suspended-owner mutation, exact B-poll, full XSTATE or timing claim.'};}
}
