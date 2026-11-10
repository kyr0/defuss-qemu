import assert from 'node:assert/strict';
import {decodeM3b,stopped} from '../m3b-fallthrough/reader.mjs';
import {readM3Region} from '../../experiments/m3a-region/reader.mjs';
import {decodeCensus,requireCensusBinding,sameCensusTuple} from '../m3b-context-accounting-v2/census-reader.mjs';
import {parseTranslationBuffer} from '../regions-pressure/jit.mjs';
import {validatePressureLayout,expectedPressureGate,expectedPressurePass,pressureSettings} from './guest-contract.mjs';
import {decodeSuspension} from './suspension.mjs';
const watchNames=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
const uint=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const idleBoundary=()=>Object.assign(Array(256).fill(0),{0:0x4d334253,1:1,6:256,7:64});
export function decodePressure(row,{enabled,initial=false,epoch=4}){
 stopped(row.status,initial);assert.deepEqual(row.captureErrors,[]);assert.ok(Array.isArray(row.m3aRaw)&&row.m3aRaw.length===96&&row.m3aRaw.every(uint));
 const a=readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>Uint32Array.from(row.m3aRaw)}),b=decodeM3b(row.m3bRaw,enabled),c=decodeCensus(row.censusRaw,{initial});
 assert.equal(a.enabled,true);assert.equal(a.started,!initial);assert.equal(a.saturated,false);assert.equal(row.nativeStatus,b.status);assert.equal(row.censusNativeStatus,c.state);
 for(const n of ['watchPcMismatches','invalidMetadata','generationExhaustions','extraWorkerRejects','injectedStaleInstances','injectedInvalidDescriptors','injectionRejects','invalidRedispatches'])assert.equal(a.counters[n],0,n);
 assert.deepEqual(row.m3aRaw.slice(50,55),Array(5).fill(0));assert.deepEqual(row.boundaryRaw,idleBoundary());assert.equal(c.apiRejects,0);assert.deepEqual(c.injection.raw,Array(16).fill(0));
 for(const x of [a,b,c])assert.equal(x.watchEpoch,epoch);assert.equal(row.pool.limit,12000);assert.ok(Number.isSafeInteger(row.pool.charged)&&row.pool.charged>=0&&row.pool.charged<=12000);assert.ok(Number.isSafeInteger(row.pool.linearMemoryBytes)&&row.pool.linearMemoryBytes>0);
 assert.equal(row.suspensionAbi,1);const suspension=decodeSuspension(row.suspensionRaw,{enabled});
 return {m3a:a,m3b:b,census:c,pool:row.pool,suspension};
}
export function validateLifetimeObservation(s,layout,{enabled,epoch=4,clear=false}){
 for(let slot=0;slot<4;slot++){
  const begin=slot===0?BigInt(layout.sentinel.a):slot===1?BigInt(layout.generated[0]):0n,end=slot===0?begin+1n:slot===1?BigInt(layout.generated[1]):0n;
  const a=s.m3a.watches[slot],b=s.m3b.watches[slot];for(const w of [a,b]){assert.equal(BigInt(w.begin),begin);assert.equal(BigInt(w.end),end);}
  assert.equal(a.enabled,begin!==0n);if(a.selectedEntries)assert.ok(BigInt(a.lastSelectedPC)>=begin&&BigInt(a.lastSelectedPC)<end);else assert.equal(a.lastSelectedPC,'0x0');
  if(clear||slot>1){assert.equal(a.selectedEntries,0);for(const name of watchNames)assert.equal(b[name],0);assert.equal(b.lastSelectedPC,'0x0');assert.equal(b.lastGeneration,'0x0');}
  const c=s.census.watches[slot];assert.equal(c.pc,slot===0?layout.sentinel.a:'0x0');assert.equal(c.active,slot===0);assert.equal(c.requireFused,slot===0&&enabled);assert.equal(c.resetEpoch,epoch-3+slot);if(clear||slot!==0)assert.equal(c.totalAttempts,0);
 }
 const a=s.m3a.watches[0],b=s.m3b.watches[0],c=s.census.watches[0];assert.equal(c.sites.compiled,a.selectedEntries,'Complete compiled A census equals selected M3a A');
 assert.equal(c.counts.fusedNormal.compiled,b.compiledEntries);assert.equal(c.counts.fusedNormal.tci,b.tciEntries);assert.equal(s.census.totalWatchedAttempts,c.totalAttempts,'One cumulative watched A; no reset');
 assert.equal(c.counts.other.total,0);assert.equal(c.counts[enabled?'ordinaryNormal':'fusedNormal'].total,0);
 if(enabled&&c.tuples.fusedNormal){const t=c.tuples.fusedNormal;assert.equal(t.pc,layout.sentinel.a);assert.equal(t.translationPC,layout.sentinel.a);assert.ok(BigInt(t.page0)>0n&&BigInt(t.page0)<512n*1024n*1024n);assert.equal(t.page1,'0xffffffffffffffff');assert.equal(t.flags,0x18c0c2b3);assert.equal(t.cflags,0xff020000);assert.equal(t.generation,b.lastGeneration);assert.equal(t.pc,b.lastSelectedPC);}
 // Generated one-block loops must never form fused owners.
 const churn=s.m3b.watches[1];for(const name of ['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','emittedOwners'])assert.equal(churn[name],0);
 return s;
}
export function requireSameOwners(first,last){
 for(const kind of ['fusedNormal','ordinaryRF','ordinaryNormal']){const a=first.census.watches[0].tuples[kind],b=last.census.watches[0].tuples[kind];if(a){assert.ok(b,'Previously observed owner vanished');sameCensusTuple(a,b);}}
}
export class PressureOracle{
 constructor({enabled,proof,layout}){assert.equal(typeof enabled,'boolean');requireCensusBinding(proof.binding);assert.equal(layout.schema,1);this.enabled=enabled;this.proof=proof;this.expectedLayout=layout;this.phase='startup';this.work='new';this.seq=0;this.clock=0;this.lastAck=0;this.epoch=0;this.nodes=0;this.attempts=0;this.gates=[];this.fullCapWithoutNewCompiledObservation=false;this.snapshots=[];}
 snapshot(row,initial=false){
  const s=decodePressure(row,{enabled:this.enabled,initial,epoch:this.epoch});
  if(this.previous){for(const family of ['m3a','m3b']){for(const [k,v]of Object.entries(s[family].counters))assert.ok(v>=this.previous[family].counters[k],k);if(this.epoch)for(let i=0;i<4;i++){const keys=family==='m3a'?['selectedEntries']:watchNames;for(const k of keys)assert.ok(s[family].watches[i][k]>=this.previous[family].watches[i][k]);}}assert.ok(s.census.totalWatchedAttempts>=this.previous.census.totalWatchedAttempts);}
  if(this.previous){const old=this.previous.suspension;assert.ok(s.suspension.count>=old.count);assert.ok(s.suspension.overflow>=old.overflow);for(let i=0;i<old.count;i++)assert.deepEqual(s.suspension.slots[i],old.slots[i],'Completed episode is immutable');}
  for(const x of s.suspension.slots){assert.ok(x.Bafter<=s.m3b.counters.BAttempts&&x.paidAfter<=s.m3b.counters.servicePaid&&x.requestedAfter<=s.m3b.counters.BRequested);}
  this.previous=s;return s;
 }
 jit(row,s){assert.equal(row.jitError,null);stopped(row.jitStatus);const jit=parseTranslationBuffer(row.jitRaw);assert.equal(jit.flushCount,s.m3a.counters.flushes);if(this.previousJit){assert.equal(jit.capacityBytes,this.previousJit.capacityBytes);if(jit.flushCount===this.previousJit.flushCount)assert.ok(jit.usedBytes>=this.previousJit.usedBytes);}this.previousJit=jit;if(this.warm)assert.equal(jit.flushCount,this.warm.state.m3a.counters.flushes,'No post-warm global flush');return jit;}
 accept(row){
  const time=row.event==='gate'?row.readHostMs:row.hostMs;assert.ok(Number.isFinite(time)&&time>=this.clock);this.clock=time;
  if(row.event==='startup'){
   assert.equal(this.phase,'startup');assert.equal(row.startupFailure,null);assert.ok(Array.isArray(row.startupCpus)&&row.startupCpus.length===1);assert.equal(row.startupCpus[0]['cpu-index'],0);const s=this.snapshot(row,true);
   for(const family of ['m3a','m3b']){assert.ok(Object.values(s[family].counters).every(n=>n===0));for(const w of s[family].watches){assert.equal(w.begin,'0x0');assert.equal(w.end,'0x0');assert.equal(w.lastSelectedPC,'0x0');}}for(const name of ['graph','objects'])assert.deepEqual(row[name+'Raw'],Array.from(Buffer.from(this.proof[name].text)));this.phase='gate';return null;
  }
  if(row.event==='gate'){
   assert.equal(this.phase,'gate');assert.equal(row.seq,this.seq);assert.ok(row.signalHostMs>=this.lastAck&&row.readHostMs>=row.signalHostMs);const g=row.gate;assert.deepEqual(g,expectedPressureGate({stage:g.stage,nodes:g.nodes,attempt:g.attempt}));const s=this.snapshot(row),jit=this.jit(row,s);let ack='K';
   if(g.stage==='layout'){
    assert.equal(this.work,'new');assert.equal(this.seq,0);this.layout=validatePressureLayout(row.layout);assert.deepEqual({schema:1,sentinel:this.layout.sentinel},this.expectedLayout);
    for(const family of ['m3a','m3b'])for(const w of s[family].watches){assert.equal(w.begin,'0x0');assert.equal(w.end,'0x0');}assert.equal(s.census.activeMask,0);this.work='prefill';this.phase='configured';
   }else{
    validateLifetimeObservation(s,this.layout,{enabled:this.enabled});if(this.warm)requireSameOwners(this.warm.state,s);
    if(g.stage==='prefill'){
     assert.equal(this.work,'prefill');assert.equal(g.nodes,Math.min(this.nodes+64,12000));this.nodes=g.nodes;
     assert.equal(s.m3a.counters.instanceRetires,0);assert.equal(s.m3a.watches[0].selectedEntries,0);assert.equal(s.census.watches[0].totalAttempts,0);
     assert.ok(s.m3a.counters.instanceInstalls<11000,'Prefill must leave normal capacity for warming');
     if(s.m3a.counters.instanceInstalls>=pressureSettings.prefillInstalls){this.work='warm';ack='R';}
     else assert.ok(g.nodes<12000,'Bounded prefill absent');
    }else if(g.stage==='warm'){
     assert.equal(this.work,'warm');assert.equal(g.nodes,this.nodes);const c=s.m3a.counters;assert.equal(c.instanceRetires,0);assert.ok(c.instanceInstalls>=pressureSettings.prefillInstalls&&c.instanceInstalls<11000);assert.equal(s.pool.charged,c.instanceInstalls);assert.ok(s.m3a.watches[0].selectedEntries>0);
     if(this.enabled){assert.ok(s.m3b.watches[0].compiledEntries>0);assert.ok(s.m3b.watches[0].BAttempts>0);assert.equal(s.m3b.watches[0].emittedOwners,1);}else assert.ok(s.census.watches[0].counts.ordinaryNormal.compiled>0);
     this.warm={row,state:s};this.work='churn';
    }else if(g.stage==='churn'){
     assert.equal(this.work,'churn');assert.equal(g.nodes,Math.min(this.nodes+64,12000));this.nodes=g.nodes;assert.ok(s.m3a.watches[1].selectedEntries>0);
     // Sentinel is never called between warm and first retirement.
     assert.deepEqual(s.m3a.watches[0],this.warm.state.m3a.watches[0]);assert.deepEqual(s.m3b.watches[0],this.warm.state.m3b.watches[0]);assert.deepEqual(s.census.watches[0].raw,this.warm.state.census.watches[0].raw);
     if(s.m3a.counters.instanceRetires===6000){this.retirement={row,state:s};this.work='revisit';ack='R';}else{assert.equal(s.m3a.counters.instanceRetires,0);assert.ok(g.nodes<12000,'Bounded first retirement missing');}
    }else{
     assert.equal(g.stage,'revisit');assert.equal(this.work,'revisit');assert.equal(g.nodes,this.nodes);assert.equal(g.attempt,this.attempts);this.attempts++;assert.equal(s.m3a.counters.instanceRetires,6000);
     const base=this.retirement.state,selected=this.enabled?s.m3b.watches[0].compiledEntries-base.m3b.watches[0].compiledEntries:s.census.watches[0].counts.ordinaryNormal.compiled-base.census.watches[0].counts.ordinaryNormal.compiled;
     assert.ok(selected>=0);if(selected===0&&s.pool.charged===12000)this.fullCapWithoutNewCompiledObservation=true;
     if(selected>0)this.selectedAfterRetirement=true;
     if(this.attempts===pressureSettings.retries)this.work='complete';
    }
    this.phase='ack';
   }
   this.gates.push(structuredClone(g));this.snapshots.push({seq:this.seq,stage:g.stage,nodes:g.nodes,attempt:g.attempt,pool:s.pool,jit,counters:s.m3a.counters,sentinelM3b:s.m3b.watches[0],sentinelCensus:s.census.watches[0],suspension:s.suspension});this.ack=ack;return {ack};
  }
  if(row.event==='configured'){
   assert.equal(this.phase,'configured');assert.equal(row.seq,0);assert.equal(this.epoch,0);const oldTotal=this.previous.census.totalWatchedAttempts;this.epoch=4;const s=this.snapshot(row);validateLifetimeObservation(s,this.layout,{enabled:this.enabled,clear:true});assert.equal(s.census.totalWatchedAttempts,oldTotal);this.phase='ack';return null;
  }
  if(row.event==='ack'){assert.equal(this.phase,'ack');assert.equal(row.seq,this.seq);assert.equal(row.ack,this.ack);assert.deepEqual(row.watchEpoch,{m3a:4,m3b:4,census:4});this.lastAck=time;this.seq++;this.phase=['complete','incomplete'].includes(this.work)?'complete':'gate';return null;}
  if(row.event==='complete'){
   assert.equal(this.phase,'complete');assert.deepEqual(row.validation,expectedPressurePass({nodes:this.nodes,attempts:this.attempts}));const prior=this.previous;const s=this.snapshot(row);this.jit(row,s);validateLifetimeObservation(s,this.layout,{enabled:this.enabled});requireSameOwners(this.warm.state,s);assert.deepEqual(s.m3a.watches[0],prior.m3a.watches[0]);assert.deepEqual(s.m3b.watches[0],prior.m3b.watches[0]);assert.deepEqual(s.census.watches[0].raw,prior.census.watches[0].raw);assert.equal(s.m3a.counters.instanceRetires,6000);this.episodes=s.suspension.slots.filter(x=>x.token>this.retirement.state.suspension.count&&x.compiled&&x.pc===this.layout.sentinel.a&&x.generation===s.m3b.watches[0].lastGeneration&&x.code===s.census.watches[0].tuples.fusedNormal?.code&&x.owner===s.census.watches[0].tuples.fusedNormal?.owner);this.result=this.selectedAfterRetirement&&(!this.enabled||this.episodes.length>0)?'passed':'incomplete';this.phase='done';return {result:this.result};
  }
  throw Error('Unexpected pressure observation');
 }
 summary(){return {status:this.result??'failed',enabled:this.enabled,scope:'Bounded256MiB/flags3 natural retirement and actual native service continuation on the owning worker only; no per-body retirement, timing, production128MiB, or active generated-function claim.',nodes:this.nodes,attempts:this.attempts,fullCapWithoutNewCompiledObservation:this.fullCapWithoutNewCompiledObservation,warmSeq:this.warm?.row.seq??null,retirementSeq:this.retirement?.row.seq??null,qualifyingEpisodes:this.episodes??[],observer:this.previous?.suspension??null,selectedAfterRetirement:this.selectedAfterRetirement??false,snapshots:this.snapshots};}
}
