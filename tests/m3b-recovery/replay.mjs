// Isolated host oracle for the existing paused diagnostic cache APIs.
// Synthetic tests of this module never count as QEMU execution evidence.
import assert from 'node:assert/strict';
import {decodeM3b,stopped} from '../m3b-fallthrough/reader.mjs';
import {readM3Region} from '../../experiments/m3a-region/reader.mjs';
import {programs,referenceGates,validateLayout,validateSelectedWindow} from '../m3b-fallthrough/contract.mjs';
export const protocol='defuss-m3b-recovery-fixture-v1';
export const openGates=Object.freeze([
 'The existing diagnostic API deliberately changes cache metadata while paused; this is not natural code invalidation or FIFO retirement.',
 'The new descriptor generation is expected to execute cold TCI within the unchanged bounded guest work; recompilation of that generation is not claimed.',
 'Global installation changes include guest/kernel work; only at least one installation accompanies the isolated stale-instance case.',
 'Natural interrupt delivery, fused-code SMC and natural-pressure owning-worker Asyncify remain separate gates.',
]);
const fields=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
export const injectionFor=seq=>seq===1?'stale-instance':seq===5?'invalid-descriptor':null;
export function rejectionAllowance(enabled,event,seq){
 assert.equal(typeof enabled,'boolean');
 const global=enabled&&(event==='complete'||seq>=6)?1:0;
 return {global,watches:[enabled&&event==='gate'&&seq===6?1:0,0,0,0]};
}
export function decodeRecovery(raw,enabled,allowance){
 assert.ok(Array.isArray(raw)&&raw.length===128);
 assert.ok(allowance&&[0,1].includes(allowance.global)&&Array.isArray(allowance.watches)&&allowance.watches.length===4);
 assert.ok(allowance.watches.every(n=>n===0||n===1));assert.ok(allowance.watches.reduce((a,b)=>a+b,0)<=allowance.global);
 if(!enabled)assert.equal(allowance.global,0,'Disabled mode never permits rejection activity');
 // Check the original counts BEFORE making the zero-rejection view consumed
 // by the unchanged strict decoder. Never silently forgive an extra rejection.
 assert.equal(raw[19],allowance.global,'Exact lifetime entry rejection count');
 for(let i=0;i<4;i++)assert.equal(raw[44+i*20],allowance.watches[i],'Exact scoped watch entry rejection count');
 const neutral=[...raw];neutral[19]=0;for(let i=0;i<4;i++)neutral[44+i*20]=0;
 const value=decodeM3b(neutral,enabled);
 value.counters.entryRejects=raw[19];for(let i=0;i<4;i++)value.watches[i].entryRejects=raw[44+i*20];
 value.raw=[...raw];return value;
}
export function decodeSnapshot(row,enabled,event,seq){
 stopped(row.status,event==='startup');assert.deepEqual(row.captureErrors,[],'Raw capture failed');
 const raw=row.m3aRaw;assert.ok(Array.isArray(raw)&&raw.length===96&&raw.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff));
 const m3a=readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>Uint32Array.from(raw)});
 assert.equal(m3a.enabled,true);assert.equal(m3a.started,event!=='startup');assert.equal(m3a.saturated,false);
 for(const name of ['watchPcMismatches','invalidMetadata','generationExhaustions','extraWorkerRejects','injectionRejects'])assert.equal(m3a.counters[name],0,name);
 const m3b=decodeRecovery(row.m3bRaw,enabled,rejectionAllowance(enabled,event,seq));assert.equal(row.nativeStatus,m3b.status);
 const boundary=row.boundaryRaw;assert.ok(Array.isArray(boundary)&&boundary.length===256&&boundary.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff));
 const idle=Array(256).fill(0);idle[0]=0x4d334253;idle[1]=1;idle[6]=256;idle[7]=64;
 assert.deepEqual(boundary,idle,'Recovery never arms the separate boundary selector');
 assert.equal(row.pool.limit,12000);assert.ok(Number.isSafeInteger(row.pool.charged)&&row.pool.charged>=0&&row.pool.charged<=12000);
 assert.ok(Number.isSafeInteger(row.pool.linearMemoryBytes)&&row.pool.linearMemoryBytes>0);
 return {m3a,m3b,pool:row.pool,status:row.status};
}
function rangeCheck(s,layout,program,cleared){
 for(let slot=0;slot<4;slot++){
  const p=program===null?null:layout.programs[program],begin=p&&slot<2?BigInt(p[slot===0?'a':'b']):0n,end=begin?begin+1n:0n;
  for(const w of [s.m3a.watches[slot],s.m3b.watches[slot]]){assert.equal(BigInt(w.begin),begin);assert.equal(BigInt(w.end),end);}
  const a=s.m3a.watches[slot];assert.equal(a.enabled,begin!==0n);
  if(a.selectedEntries)assert.ok(BigInt(a.lastSelectedPC)>=begin&&BigInt(a.lastSelectedPC)<end);
  else assert.equal(a.lastSelectedPC,'0x0','Unselected M3a watch retains no selected PC');
  if(cleared){assert.equal(a.selectedEntries,0);assert.equal(a.lastSelectedPC,'0x0');for(const k of fields)assert.equal(s.m3b.watches[slot][k],0);assert.equal(s.m3b.watches[slot].lastSelectedPC,'0x0');assert.equal(s.m3b.watches[slot].lastGeneration,'0x0');}
 }
}
export function validateColdWindow({gate,m3aA,m3aB,fusedA,fusedB},oldGeneration,newGeneration){
 assert.equal(gate.program,1);assert.ok(['side','body','direct-b'].includes(gate.phase));
 assert.equal(fusedA.entryRejects,gate.phase==='side'?1:0);
 for(const k of fields)assert.equal(fusedB[k],0,'B remains ordinary: '+k);
 assert.equal(m3aA.selectedEntries,0,'No new-generation compiled A claim');assert.equal(fusedA.compiledEntries,0);
 assert.ok(fusedA.tciEntries>0,'Actual cold fused TCI exposure required');
 assert.equal(fusedA.IRRejected,0);assert.equal(fusedA.cleanRetries,0);
 assert.equal(fusedA.predecodeAccepted,gate.phase==='side'?1:0);assert.equal(fusedA.emittedOwners,gate.phase==='side'?1:0);
 assert.ok(BigInt(fusedA.lastGeneration)>BigInt(oldGeneration),'Fresh generation after invalidation');
 if(newGeneration!==null)assert.equal(fusedA.lastGeneration,newGeneration,'Fresh owner stable through remaining calls');
 if(gate.phase==='direct-b')assert.ok(m3aB.selectedEntries>0,'Ordinary B remains compiled');
 const initial=gate.phase==='direct-b'?gate.calls:0;
 assert.equal(fusedA.BAttempts,gate.bodies-initial);assert.ok(fusedA.BRequested<=fusedA.BAttempts);
 assert.equal(fusedA.servicePaid,fusedA.BAttempts);assert.equal(fusedA.backedgeTciReturns,fusedA.BAttempts-fusedA.BRequested);
 return {attemptedFusedBBoundaries:fusedA.BAttempts,completedFusedBBodies:fusedA.BAttempts-fusedA.BRequested,
  resumedOrdinaryBBodies:fusedA.BRequested,initialOrdinaryBBodies:initial,allBodies:gate.bodies,serviceTurns:fusedA.servicePaid,
  tier:'cold-tci',oldGeneration,newGeneration:fusedA.lastGeneration};
}
export function validateMutation(before,after,mutation,{seq,pc,oldGeneration}){
 const action=injectionFor(seq);assert.ok(action);assert.deepEqual(mutation,{action,slot:0,pc,mutations:1});
 assert.deepEqual(after.m3bRaw,before.m3bRaw);assert.deepEqual(after.boundaryRaw,before.boundaryRaw);
 assert.equal(after.nativeStatus,before.nativeStatus);assert.deepEqual(after.pool,before.pool);assert.deepEqual(after.status,before.status);
 const expected=[...before.m3aRaw],counter=action==='stale-instance'?34:35;
 assert.ok(expected[counter]<0xffffffff);expected[counter]++;
 const address=BigInt(pc),generation=BigInt(oldGeneration);
 expected[50]=Number(address&0xffffffffn);expected[51]=Number(address>>32n);
 expected[52]=Number(generation&0xffffffffn);expected[53]=Number(generation>>32n);expected[54]=action==='stale-instance'?1:2;
 assert.deepEqual(after.m3aRaw,expected,'Only the designed paused mutation evidence may change');
}
export class RecoveryReplay{
 constructor({enabled,proof,expectedLayout}){
  assert.equal(typeof enabled,'boolean');this.enabled=enabled;this.proof=proof;this.expectedLayout=expectedLayout;
  this.reference=referenceGates();this.phase='startup';this.seq=0;this.watchEpoch=0;this.configuredProgram=null;
  this.layout=null;this.last=null;this.configured=null;this.warm=new Map();this.injections=[];this.partitions=[];
  this.results={stale:null,invalid:null};this.freshGeneration=null;this.recoveryBaseline=null;this.lastClock=0;this.lastAck=0;
 }
 snapshot(row,event,seq){
  const s=decodeSnapshot(row,this.enabled,event,seq);
  if(this.last)for(const family of ['m3a','m3b'])for(const [key,n]of Object.entries(s[family].counters))assert.ok(n>=this.last[family].counters[key],'Lifetime counter decreased: '+family+'.'+key);
  if(event==='startup')for(const family of ['m3a','m3b'])assert.ok(Object.values(s[family].counters).every(n=>n===0));
  // Bound each introduced mutation to its exact expected phase. All other
  // global entry rejections remain forbidden by decodeRecovery.
  const stale=this.enabled&&(seq>=2||event==='complete')?1:0;
  assert.equal(s.m3a.counters.staleInstanceMisses,stale,'Exact sole cached-generation mismatch');
  assert.equal(s.m3a.counters.invalidRedispatches,0,'Fused guard handles descriptor rejection before M3a compiled dispatch');
  const injectedStale=this.enabled&&(seq>1||event==='injection'&&seq===1||event==='complete')?1:0;
  const injectedInvalid=this.enabled&&(seq>5||event==='injection'&&seq===5||event==='complete')?1:0;
  assert.equal(s.m3a.counters.injectedStaleInstances,injectedStale);assert.equal(s.m3a.counters.injectedInvalidDescriptors,injectedInvalid);
  if(this.recoveryBaseline&&seq<=8){
   for(const name of ['flushes','instanceRetires'])assert.equal(s.m3a.counters[name],this.recoveryBaseline.m3a.counters[name],'No competing flush/retirement in recovery interval');
  }
  this.last=s;return s;
 }
 accept(row){
  for(const key of ['hostMs','signalHostMs','readHostMs'])if(row[key]!==undefined)assert.ok(typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0);
  const clock=row.event==='gate'?row.readHostMs:row.hostMs;assert.ok(typeof clock==='number'&&Number.isFinite(clock)&&clock>=this.lastClock,'Required monotonic observation clock');this.lastClock=clock;
  if(row.event==='startup'){
   assert.equal(this.phase,'startup');const s=this.snapshot(row,'startup',-1);
   assert.equal(row.startupFailure,null);assert.ok(Array.isArray(row.startupCpus)&&row.startupCpus.length===1);assert.equal(row.startupCpus[0]['cpu-index'],0);
   for(const name of ['graph','objects'])assert.deepEqual(row[name+'Raw'],Array.from(Buffer.from(this.proof[name].text)));
   const zero=Array(128).fill(0);Object.assign(zero,{0:0x4d334231,1:1,2:this.enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,12:4});assert.deepEqual(row.m3bRaw,zero,'Exact initial M3b template');
   assert.deepEqual(row.m3aRaw.slice(50,55),Array(5).fill(0));assert.deepEqual(row.m3aRaw.slice(64),Array(32).fill(0));
   assert.equal(s.m3a.watchEpoch,0);assert.equal(s.m3b.watchEpoch,0);this.phase='gate';return;
  }
  if(row.event==='gate'){
   assert.equal(this.phase,'gate');assert.deepEqual(row.gate,this.reference.gates[this.seq]);const s=this.snapshot(row,'gate',this.seq);
   assert.equal(s.m3a.watchEpoch,this.watchEpoch);assert.equal(s.m3b.watchEpoch,this.watchEpoch);assert.ok(row.signalHostMs>=this.lastAck&&row.readHostMs>=row.signalHostMs);
   if(this.seq===0){this.layout=validateLayout(row.layout);for(let i=0;i<programs.length;i++)for(const key of ['name','a','b','back','side','end','ownerBytes','codeHex'])assert.deepEqual(this.layout.programs[i][key],this.expectedLayout[i][key]);rangeCheck(s,this.layout,null,true);}
   else{
    assert.equal(this.configuredProgram,row.gate.program);rangeCheck(s,this.layout,this.configuredProgram,false);
    const window={enabled:this.enabled,program:row.gate.program,phase:row.gate.phase,gate:row.gate,m3aA:s.m3a.watches[0],m3aB:s.m3a.watches[1],fusedA:s.m3b.watches[0],fusedB:s.m3b.watches[1]};
    let partition;
    if(this.enabled&&row.gate.program===1&&row.gate.phase!=='warm'){
     partition=validateColdWindow(window,this.warm.get(5).m3b.watches[0].lastGeneration,this.freshGeneration);
     this.freshGeneration=partition.newGeneration;
     if(this.seq===6){assert.ok(s.m3a.counters.invalidations>this.warm.get(5).m3a.counters.invalidations);this.results.invalid={oldGeneration:partition.oldGeneration,newGeneration:partition.newGeneration,watchedEntryRejections:s.m3b.watches[0].entryRejects,coldEntries:s.m3b.watches[0].tciEntries,recompiled:false};}
    }else partition=validateSelectedWindow(window);
    if(partition)this.partitions.push({seq:this.seq,program:row.gate.program,phase:row.gate.phase,...partition});
    if(this.enabled&&injectionFor(this.seq)){
     assert.ok(s.m3b.watches[0].compiledEntries>0);assert.ok(BigInt(s.m3b.watches[0].lastGeneration)>0n);this.warm.set(this.seq,s);
     if(this.seq===1)this.recoveryBaseline=s;
    }
    if(this.enabled&&this.seq===2){
     const before=this.warm.get(1),w=s.m3b.watches[0];assert.equal(w.lastGeneration,before.m3b.watches[0].lastGeneration);
     for(const key of ['predecodeAccepted','emittedOwners','IRRejected','cleanRetries'])assert.equal(w[key],0,'Cached instance recovery keeps its owner');
     assert.ok(s.m3a.counters.instanceInstalls>before.m3a.counters.instanceInstalls);
     this.results.stale={generation:w.lastGeneration,watchedCompiledEntries:w.compiledEntries,staleInstanceMisses:1,totalInstallationDelta:s.m3a.counters.instanceInstalls-before.m3a.counters.instanceInstalls,scope:'At least one global install; no exact global attribution.'};
    }
   }
   this.phase='configured';return;
  }
  if(row.event==='configured'){
   assert.equal(this.phase,'configured');assert.equal(row.seq,this.seq);const gate=this.reference.gates[this.seq],next=gate.phase==='layout'?0:gate.phase==='direct-b'?gate.program+1:gate.program;
   assert.equal(row.program,next<programs.length?next:null);const s=this.snapshot(row,'configured',this.seq);this.watchEpoch+=4;
   assert.equal(s.m3a.watchEpoch,this.watchEpoch);assert.equal(s.m3b.watchEpoch,this.watchEpoch);rangeCheck(s,this.layout,row.program,true);
   this.configuredProgram=row.program;this.configured=structuredClone(row);this.phase=this.enabled&&injectionFor(this.seq)?'injection-request':'ack';return;
  }
  if(row.event==='injection-request'){
   assert.equal(this.phase,'injection-request');assert.equal(row.seq,this.seq);assert.equal(row.action,injectionFor(this.seq));assert.equal(row.slot,0);assert.equal(row.pc,this.layout.programs[this.seq===1?0:1].a);
   assert.deepEqual(row.before,Object.fromEntries(Object.entries(this.configured).filter(([k])=>!['event','seq','program','hostMs'].includes(k))));
   this.phase='injection';return;
  }
  if(row.event==='injection'){
   assert.equal(this.phase,'injection');assert.equal(row.seq,this.seq);assert.deepEqual(row.before,Object.fromEntries(Object.entries(this.configured).filter(([k])=>!['event','seq','program','hostMs'].includes(k))));
   assert.equal(row.returnCode,1);assert.equal(row.nativeCalls,1);assert.equal(row.failure,null);assert.equal(row.statusFailure,null);
   const pc=this.layout.programs[this.seq===1?0:1].a,oldGeneration=this.warm.get(this.seq).m3b.watches[0].lastGeneration;
   validateMutation(row.before,row.after,row.mutation,{seq:this.seq,pc,oldGeneration});this.snapshot(row.after,'injection',this.seq);
   this.injections.push({seq:this.seq,pc,oldGeneration,...row.mutation});this.phase='ack';return;
  }
  if(row.event==='ack'){
   assert.equal(this.phase,'ack');assert.equal(row.seq,this.seq);assert.deepEqual(row.watchEpoch,{m3a:this.watchEpoch,m3b:this.watchEpoch});this.lastAck=row.hostMs;this.seq++;this.phase=this.seq===45?'complete':'gate';return;
  }
  if(row.event==='complete'){
   assert.equal(this.phase,'complete');assert.equal(this.seq,45);const s=this.snapshot(row,'complete',45);assert.equal(s.m3a.watchEpoch,this.watchEpoch);assert.equal(s.m3b.watchEpoch,this.watchEpoch);assert.deepEqual(row.validation,this.reference.pass);rangeCheck(s,this.layout,null,true);
   assert.equal(this.injections.length,this.enabled?2:0);if(this.enabled){assert.ok(this.results.stale&&this.results.invalid);assert.ok(this.freshGeneration);}this.phase='done';return;
  }
  throw Error('Unknown recovery event: '+row.event);
 }
}
