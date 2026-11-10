import assert from 'node:assert/strict';
import {decodePressure} from '../m3b-fused-pressure/oracle.mjs';
import {requireCensusBinding} from '../m3b-context-accounting-v2/census-reader.mjs';
import {stopped} from '../m3b-fallthrough/reader.mjs';
import {validateLayout,validateGate,validatePass,codeAdd} from './guest-contract.mjs';
const watchNames=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
const zero=xs=>assert.ok(xs.every(n=>n===0));
function jit(row,state){
 assert.equal(row.jitError,null);stopped(row.jitStatus);const text=row.jitRaw?.['human-readable-text'];assert.ok(typeof text==='string'&&text.length<=32768);
 const get=re=>{const xs=[...text.matchAll(re)];assert.equal(xs.length,1);return xs[0].slice(1).map(Number);};
 const [used,capacity]=get(/^gen code size\s+(\d+)\/(\d+)[ \t]*\r?$/gm),[count]=get(/^TB count\s+(\d+)[ \t]*\r?$/gm),[flushes]=get(/^TB flush count\s+(\d+)[ \t]*\r?$/gm);
 assert.ok(capacity>127*1048576&&capacity<=128*1048576&&used<=capacity&&count>0);assert.equal(flushes,0);assert.equal(state.m3a.counters.flushes,0);
 return {usedBytes:used,capacityBytes:capacity,tbCount:count,flushCount:flushes};
}
export function watched(s,layout,{enabled,epoch,clear=false}){
 assert.equal(s.census.activeMask,1);
 for(let slot=0;slot<4;slot++){
  const pc=slot===0?layout.a:'0x0',end=slot===0?'0x20000005':'0x0',a=s.m3a.watches[slot],b=s.m3b.watches[slot],c=s.census.watches[slot];
  for(const w of [a,b]){assert.equal(w.begin,pc);assert.equal(w.end,end);}
  assert.equal(a.enabled,slot===0);assert.equal(c.pc,pc);assert.equal(c.active,slot===0);assert.equal(c.requireFused,slot===0&&enabled);assert.equal(c.resetEpoch,epoch-3+slot);
  if(clear||slot!==0){zero([a.selectedEntries,c.totalAttempts,...watchNames.map(k=>b[k])]);assert.equal(a.lastSelectedPC,'0x0');}
 }
 const a=s.m3a.watches[0],b=s.m3b.watches[0],c=s.census.watches[0];assert.equal(c.sites.compiled,a.selectedEntries);assert.equal(c.counts.fusedNormal.compiled,b.compiledEntries);assert.equal(c.counts.fusedNormal.tci,b.tciEntries);assert.equal(c.counts.other.total,0);
 assert.equal(c.counts[enabled?'ordinaryNormal':'fusedNormal'].total,0);
 for(const t of Object.values(c.tuples).filter(Boolean)){
  assert.equal(t.pc,layout.a);assert.equal(t.translationPC,layout.a);assert.equal(BigInt(t.page0)&~4095n,BigInt(layout.physicalFrame)*4096n);assert.equal(t.page1,'0xffffffffffffffff');
 }
 return s;
}
export class PressureOracle{
 constructor({enabled,proof,layout}){
  assert.equal(typeof enabled,'boolean');requireCensusBinding(proof.binding);assert.equal(layout.schema,1);assert.equal('89f931c0'+layout.sentinel.codeHex+'c3',codeAdd);
  this.enabled=enabled;this.proof=proof;this.phase='startup';this.seq=0;this.clock=0;this.lastAck=0;this.epoch=0;this.gates=[];this.epochs=[];this.resets=[];
 }
 snapshot(row,initial=false){
  const s=decodePressure(row,{enabled:this.enabled,initial,epoch:this.epoch});
  if(this.previous){for(const family of ['m3a','m3b'])for(const [k,v]of Object.entries(s[family].counters))assert.ok(v>=this.previous[family].counters[k],k);assert.ok(s.census.totalWatchedAttempts>=this.previous.census.totalWatchedAttempts);}
  this.previous=s;return s;
 }
 accept(row){
  const time=row.event==='gate'?row.readHostMs:row.hostMs;assert.ok(Number.isFinite(time)&&time>=this.clock);this.clock=time;
  if(row.event==='startup'){
   assert.equal(this.phase,'startup');assert.equal(row.startupFailure,null);assert.equal(row.startupCpus.length,1);assert.equal(row.startupCpus[0]['cpu-index'],0);const s=this.snapshot(row,true);
   for(const family of ['m3a','m3b'])zero(Object.values(s[family].counters));for(const name of ['graph','objects'])assert.deepEqual(row[name+'Raw'],Array.from(Buffer.from(this.proof[name].text)));this.phase='gate';return;
  }
  if(row.event==='configured'){
   assert.equal(this.phase,'configured');assert.equal(row.seq,this.seq);assert.equal(this.seq,0);const before=this.previous;this.epoch+=4;const s=watched(this.snapshot(row),this.layout,{enabled:this.enabled,epoch:this.epoch,clear:true});assert.equal(s.census.totalWatchedAttempts,before.census.totalWatchedAttempts);
   this.resets.push({seq:this.seq,epoch:this.epoch});this.phase='ack';return;
  }
  if(row.event==='ack'){
   assert.equal(this.phase,'ack');assert.equal(row.seq,this.seq);assert.equal(row.ack,'K');assert.deepEqual(row.watchEpoch,{m3a:this.epoch,m3b:this.epoch,census:this.epoch});this.lastAck=time;this.seq++;this.phase=this.seq===10?'complete':'gate';return;
  }
  if(row.event==='complete'){
   assert.equal(this.phase,'complete');validatePass(row.validation);const old=this.previous,s=watched(this.snapshot(row),this.layout,{enabled:this.enabled,epoch:this.epoch});jit(row,s);assert.deepEqual(s.census.watches[0].raw,old.census.watches[0].raw);assert.deepEqual(s.m3b.watches[0],old.m3b.watches[0]);assert.equal(this.epochs.length,9);this.result='passed';this.phase='done';return {result:this.result};
  }
  assert.equal(row.event,'gate');assert.equal(this.phase,'gate');assert.equal(row.seq,this.seq);assert.equal(row.gate.seq,this.seq);assert.ok(row.signalHostMs>=this.lastAck&&row.readHostMs>=row.signalHostMs);
  const prior=this.previous,s=this.snapshot(row),storage=jit(row,s);
  if(this.seq===0){this.layout=validateLayout(row.layout);assert.equal(s.census.activeMask,0);this.phase='configured';}
  else{
   watched(s,this.layout,{enabled:this.enabled,epoch:this.epoch});
   const c=s.census.watches[0],kind=this.enabled?'fusedNormal':'ordinaryNormal',t=c.tuples[kind],old=this.epochs.at(-1);
   assert.ok(t&&c.counts[kind].compiled>(old?.compiled??0),'Positive compiled exact-PC exposure in every call');assert.equal(t.flags,0x18c0c2b3);assert.equal(t.cflags,0xff020000);
   if(this.enabled){const b=s.m3b.watches[0];assert.ok(b.compiledEntries>0&&b.BAttempts>0);assert.equal(b.BAttempts,b.servicePaid);assert.equal(b.emittedOwners,1);assert.equal(b.lastGeneration,t.generation);}
   if(old)for(const k of ['owner','code','generation','page0'])assert.equal(t[k],old.owner[k],'Same warmed owner '+k);
   this.epochs.push({seq:this.seq,epoch:this.epoch,owner:t,compiled:c.counts[kind].compiled,tci:c.counts[kind].tci,BAttempts:s.m3b.watches[0].BAttempts,servicePaid:s.m3b.watches[0].servicePaid,storage});this.phase='ack';
  }
  validateGate(row.gate,this.layout);this.gates.push(structuredClone(row.gate));return {ack:'K'};
 }
 summary(){return {status:this.result??'failed',enabled:this.enabled,resets:this.resets,epochs:this.epochs,scope:'Natural guest timer contexts and resume in positive compiled windows; exact native tier at each signal, native B-poll attribution, full XSTATE and performance remain outside scope.'};}
}
