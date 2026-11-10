import assert from 'node:assert/strict';
import {decodeM3b,stopped} from '../m3b-fallthrough/reader.mjs';
import {readM3Region} from '../../experiments/m3a-region/reader.mjs';
import {programs,referenceGates,validateLayout,validateSelectedWindow} from '../m3b-fallthrough/contract.mjs';
import {decodeCensus,requireCensusBinding} from '../m3b-context-accounting-v3/census-reader.mjs';
import {decodeRecoveryObservation,validateRecoveryWindow} from './recovery-contract.mjs';
import {validateTypedMutation} from './mutation.mjs';
const watchNames=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
export class ForensicOracle{
 constructor({enabled,proof,layout}){assert.equal(typeof enabled,'boolean');requireCensusBinding(proof.binding);this.enabled=enabled;this.proof=proof;this.expectedLayout=layout;this.reference=referenceGates();this.phase='startup';this.seq=0;this.epoch=0;this.program=null;this.previous=null;this.clock=0;this.lastAck=0;this.layout=null;this.partitions=[];this.before=null;this.warm=new Map();this.lastGate=null;this.freshOwner=null;this.recoveryBaseline=null;this.request=null;this.recovery={injections:[],stale:null,invalid:null};}
 snapshot(row,initial=false,stage=initial?'startup':'gate'){
  const seq=stage==='complete'?44:this.seq,s=decodeRecoveryObservation(row,{enabled:this.enabled,stage,seq}),c=s.census;
  assert.equal(c.watchEpoch,this.epoch);assert.equal(s.m3a.watchEpoch,this.epoch);assert.equal(s.m3b.watchEpoch,this.epoch);
  if(this.previous){for(const name of ['m3a','m3b'])for(const [k,v]of Object.entries(s[name].counters))assert.ok(v>=this.previous[name].counters[k]);assert.ok(c.totalWatchedAttempts>=this.previous.census.totalWatchedAttempts);}
  if(this.enabled&&this.recoveryBaseline&&seq<=8)for(const name of ['flushes','instanceRetires','invalidations'])assert.equal(s.m3a.counters[name],this.recoveryBaseline.m3a.counters[name],'No competing lifetime event during typed recovery');
  this.previous=s;return s;
 }
 ranges(s,program,clear){
  for(let i=0;i<4;i++){
   const p=program===null?null:this.layout.programs[program],start=p&&i<2?BigInt(p[i?'b':'a']):0n,end=start?start+1n:0n,a=s.m3a.watches[i],b=s.m3b.watches[i];
   for(const w of [a,b]){assert.equal(BigInt(w.begin),start);assert.equal(BigInt(w.end),end);}assert.equal(a.enabled,start!==0n);
   if(a.selectedEntries)assert.ok(BigInt(a.lastSelectedPC)>=start&&BigInt(a.lastSelectedPC)<end);else assert.equal(a.lastSelectedPC,'0x0');
   if(clear){assert.equal(a.selectedEntries,0);for(const name of watchNames)assert.equal(b[name],0);assert.equal(b.lastSelectedPC,'0x0');assert.equal(b.lastGeneration,'0x0');}
   const c=s.census.watches[i],cpc=p&&i===0?BigInt(p.a):0n;assert.equal(BigInt(c.pc),cpc);assert.equal(c.active,cpc!==0n);assert.equal(c.requireFused,Boolean(cpc&&this.enabled&&p.expectation==='fused'));
   assert.equal(c.resetEpoch,this.epoch?this.epoch-3+i:0);if(clear)assert.equal(c.totalAttempts,0);if(cpc===0n)assert.equal(c.totalAttempts,0);
   if(cpc!==0n){assert.equal(c.sites.compiled,a.selectedEntries);assert.equal(c.counts.fusedNormal.compiled,b.compiledEntries);assert.equal(c.counts.fusedNormal.tci,b.tciEntries);}
  }
 }
 accept(row,window=null){
  const clock=row.event==='gate'?row.readHostMs:row.hostMs;assert.ok(typeof clock==='number'&&Number.isFinite(clock)&&clock>=this.clock);this.clock=clock;
  if(row.event==='startup'){
   assert.equal(this.phase,'startup');assert.equal(row.startupFailure,null);assert.ok(Array.isArray(row.startupCpus)&&row.startupCpus.length===1);assert.equal(row.startupCpus[0]['cpu-index'],0);
   const s=this.snapshot(row,true);for(const family of ['m3a','m3b'])assert.ok(Object.values(s[family].counters).every(x=>x===0));this.ranges(s,null,true);
   for(const name of ['graph','objects'])assert.deepEqual(row[name+'Raw'],Array.from(Buffer.from(this.proof[name].text)));
   assert.deepEqual(row.m3aRaw.slice(50,55),Array(5).fill(0));this.phase='gate';return;
  }
  if(row.event==='gate'){
   assert.equal(this.phase,'gate');assert.deepEqual(row.gate,this.reference.gates[this.seq]);assert.ok(row.signalHostMs>=this.lastAck&&row.readHostMs>=row.signalHostMs);const s=this.snapshot(row);
   if(this.seq===0){this.layout=validateLayout(row.layout);for(let i=0;i<11;i++)for(const k of ['name','a','b','back','side','end','ownerBytes','codeHex'])assert.deepEqual(this.layout.programs[i][k],this.expectedLayout[i][k]);this.ranges(s,null,true);}
   else{assert.equal(row.gate.program,this.program);this.ranges(s,this.program,false);assert.equal(s.census.totalWatchedAttempts-this.before.censusRaw[12],s.census.watches[0].totalAttempts,'Exact census window lifetime delta');
    if(this.enabled&&programs[this.program].expectation==='fused'&&row.gate.phase!=='warm'){
     assert.ok(window?.parsed&&window.summary.seq===this.seq);assert.ok(this.before&&this.warm.has(this.program));
     const result=validateRecoveryWindow({parsed:window.parsed,layout:this.layout,window:{start:window.summary.start,end:window.summary.end},gate:row.gate,before:this.before,after:row,ownerBaseline:this.warm.get(this.program),binding:this.proof.binding,freshOwnerBaseline:this.program===1?this.freshOwner:null});
     assert.equal(result.windowAccepted,true);assert.equal(result.acceptance,false);this.partitions.push({seq:this.seq,...result});
    }else{
     validateSelectedWindow({enabled:this.enabled,program:row.gate.program,phase:row.gate.phase,gate:row.gate,m3aA:s.m3a.watches[0],m3aB:s.m3a.watches[1],fusedA:s.m3b.watches[0],fusedB:s.m3b.watches[1]});
    }
    if(row.gate.phase==='warm')this.warm.set(this.program,row);
    if(this.enabled&&this.seq===1)this.recoveryBaseline=s;
    if(this.enabled&&this.seq===2){
     const warm=this.warm.get(0),generation='0x'+(BigInt(warm.m3bRaw[50])|(BigInt(warm.m3bRaw[51])<<32n)).toString(16);
     assert.equal(s.m3b.watches[0].lastGeneration,generation);assert.ok(s.m3a.counters.instanceInstalls>warm.m3aRaw[23],'Stale instance must be reinstalled');
     this.recovery.stale={generation,staleInstanceMisses:s.m3a.counters.staleInstanceMisses,observedFusedCompiled:s.census.watches[0].counts.fusedNormal.compiled,scope:'Same retained owner; global installation delta is not exclusively attributed.'};
    }
    if(this.enabled&&this.seq===6){
     this.freshOwner=row;const warm=this.warm.get(1),oldGeneration='0x'+(BigInt(warm.m3bRaw[50])|(BigInt(warm.m3bRaw[51])<<32n)).toString(16),fresh=s.census.watches[0].tuples.fusedNormal;
     assert.ok(fresh&&BigInt(fresh.generation)>BigInt(oldGeneration));
     this.recovery.invalid={oldGeneration,newGeneration:fresh.generation,watchedEntryRejections:s.m3b.watches[0].entryRejects,tiers:{...s.census.watches[0].counts.fusedNormal},scope:'Fresh owner observed in actual selected tiers; no natural SMC or pressure claim.'};
    }else if(this.enabled&&[7,8].includes(this.seq)){
     const t=s.census.watches[0].counts.fusedNormal;for(const name of ['compiled','tci','total'])this.recovery.invalid.tiers[name]+=t[name];
    }
   }
   this.lastGate=row;this.phase=this.enabled&&(this.seq===1||this.seq===5)?'injection-request':'configured';return;
  }
  if(row.event==='injection-request'){
   assert.equal(this.phase,'injection-request');assert.equal(row.seq,this.seq);assert.ok(this.enabled&&(this.seq===1||this.seq===5));
   const expected={requestID:this.seq===1?1:2,action:this.seq===1?'stale-instance':'invalid-descriptor',slot:0,pc:this.layout.programs[this.seq===1?0:1].a,generation:'0x'+(BigInt(this.lastGate.m3bRaw[50])|(BigInt(this.lastGate.m3bRaw[51])<<32n)).toString(16)};
   for(const [key,value]of Object.entries(expected))assert.equal(row[key],value);assert.deepEqual(row.before,this.lastGate);
   this.request=expected;this.phase='injection';return;
  }
  if(row.event==='injection'){
   assert.equal(this.phase,'injection');assert.equal(row.seq,this.seq);assert.equal(row.failure,null);assert.equal(row.statusFailure,null);assert.equal(row.returnCode,1);assert.equal(row.nativeCalls,1);assert.deepEqual(row.before,this.lastGate);
   const result=validateTypedMutation(row.before,row.after,row.mutation,{seq:this.seq,pc:this.request.pc,generation:this.request.generation});
   this.snapshot(row.after,false,'injection');this.recovery.injections.push({seq:this.seq,...result});this.request=null;this.phase='configured';return;
  }
  if(row.event==='configured'){
   assert.equal(this.phase,'configured');assert.equal(row.seq,this.seq);const gate=this.reference.gates[this.seq],next=gate.phase==='layout'?0:gate.phase==='direct-b'?gate.program+1:gate.program;
   assert.equal(row.program,next<programs.length?next:null);const previousTotal=this.previous.census.totalWatchedAttempts;this.epoch+=4;const s=this.snapshot(row,false,'configured');assert.equal(s.census.totalWatchedAttempts,previousTotal,'Paused reset cannot execute entries');this.ranges(s,row.program,true);this.program=row.program;this.before=row;this.phase='ack';return;
  }
  if(row.event==='ack'){assert.equal(this.phase,'ack');assert.equal(row.seq,this.seq);assert.deepEqual(row.watchEpoch,{m3a:this.epoch,m3b:this.epoch,census:this.epoch});this.lastAck=row.hostMs;this.seq++;this.phase=this.seq===45?'complete':'gate';return;}
  if(row.event==='complete'){assert.equal(this.phase,'complete');assert.deepEqual(row.validation,this.reference.pass);assert.equal(row.censusRaw?.[12],this.previous.census.totalWatchedAttempts,'No watched attempts after final disabled reset');const s=this.snapshot(row,false,'complete');this.ranges(s,null,true);assert.equal(this.recovery.injections.length,this.enabled?2:0);if(this.enabled){assert.ok(this.recovery.stale&&this.recovery.invalid);this.recovery.invalid.compiledFreshOwnerObserved=this.recovery.invalid.tiers.compiled>0;}this.phase='done';return;}
  throw Error('Unexpected forensic protocol event');
 }
}
