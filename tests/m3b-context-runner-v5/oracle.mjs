import assert from 'node:assert/strict';
import {decodeM3b,stopped} from '../m3b-fallthrough/reader.mjs';
import {readM3Region} from '../../experiments/m3a-region/reader.mjs';
import {programs,referenceGates,validateLayout,validateSelectedWindow} from '../m3b-fallthrough/contract.mjs';
import {decodeCensus,requireCensusBinding} from '../m3b-context-accounting-v3/census-reader.mjs';
import {validateCensusContextWindow} from '../m3b-context-accounting-v3/contract.mjs';
const watchNames=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
export class ForensicOracle{
 constructor({enabled,proof,layout}){assert.equal(typeof enabled,'boolean');requireCensusBinding(proof.binding);this.enabled=enabled;this.proof=proof;this.expectedLayout=layout;this.reference=referenceGates();this.phase='startup';this.seq=0;this.epoch=0;this.program=null;this.previous=null;this.clock=0;this.lastAck=0;this.layout=null;this.partitions=[];this.before=null;this.warm=new Map();}
 snapshot(row,initial=false){
  stopped(row.status,initial);assert.deepEqual(row.captureErrors,[]);assert.ok(Array.isArray(row.m3aRaw)&&row.m3aRaw.length===96&&row.m3aRaw.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff));
  const a=readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>Uint32Array.from(row.m3aRaw)}),b=decodeM3b(row.m3bRaw,this.enabled);
  assert.equal(a.enabled,true);assert.equal(a.started,!initial);assert.equal(a.saturated,false);assert.equal(row.nativeStatus,b.status);
  for(const n of ['watchPcMismatches','invalidMetadata','generationExhaustions','extraWorkerRejects','injectedStaleInstances','injectedInvalidDescriptors','injectionRejects'])assert.equal(a.counters[n],0);
  const idle=Array(256).fill(0);Object.assign(idle,{0:0x4d334253,1:1,6:256,7:64});assert.deepEqual(row.boundaryRaw,idle);
  assert.equal(row.pool.limit,12000);assert.ok(Number.isSafeInteger(row.pool.charged)&&row.pool.charged>=0&&row.pool.charged<=12000);assert.ok(Number.isSafeInteger(row.pool.linearMemoryBytes)&&row.pool.linearMemoryBytes>0);
  const c=decodeCensus(row.censusRaw,{initial});assert.equal(row.censusNativeStatus,c.state);assert.equal(c.apiRejects,0);assert.deepEqual(c.injection.raw,Array(16).fill(0));assert.equal(c.watchEpoch,this.epoch);
  const s={m3a:a,m3b:b,census:c};if(this.previous){for(const name of ['m3a','m3b'])for(const [k,v]of Object.entries(s[name].counters))assert.ok(v>=this.previous[name].counters[k]);assert.ok(c.totalWatchedAttempts>=this.previous.census.totalWatchedAttempts);}this.previous=s;
  assert.equal(a.watchEpoch,this.epoch);assert.equal(b.watchEpoch,this.epoch);return s;
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
     const result=validateCensusContextWindow({parsed:window.parsed,layout:this.layout,window:{start:window.summary.start,end:window.summary.end},gate:row.gate,before:this.before,after:row,ownerBaseline:this.warm.get(this.program),binding:this.proof.binding});
     assert.equal(result.windowAccepted,true);assert.equal(result.acceptance,false);this.partitions.push({seq:this.seq,...result});
    }else{
     validateSelectedWindow({enabled:this.enabled,program:row.gate.program,phase:row.gate.phase,gate:row.gate,m3aA:s.m3a.watches[0],m3aB:s.m3a.watches[1],fusedA:s.m3b.watches[0],fusedB:s.m3b.watches[1]});
    }
    if(row.gate.phase==='warm')this.warm.set(this.program,row);
   }
   this.phase='configured';return;
  }
  if(row.event==='configured'){
   assert.equal(this.phase,'configured');assert.equal(row.seq,this.seq);const gate=this.reference.gates[this.seq],next=gate.phase==='layout'?0:gate.phase==='direct-b'?gate.program+1:gate.program;
   assert.equal(row.program,next<programs.length?next:null);const previousTotal=this.previous.census.totalWatchedAttempts;this.epoch+=4;const s=this.snapshot(row);assert.equal(s.census.totalWatchedAttempts,previousTotal,'Paused reset cannot execute entries');this.ranges(s,row.program,true);this.program=row.program;this.before=row;this.phase='ack';return;
  }
  if(row.event==='ack'){assert.equal(this.phase,'ack');assert.equal(row.seq,this.seq);assert.deepEqual(row.watchEpoch,{m3a:this.epoch,m3b:this.epoch,census:this.epoch});this.lastAck=row.hostMs;this.seq++;this.phase=this.seq===45?'complete':'gate';return;}
  if(row.event==='complete'){assert.equal(this.phase,'complete');assert.deepEqual(row.validation,this.reference.pass);assert.equal(row.censusRaw?.[12],this.previous.census.totalWatchedAttempts,'No watched attempts after final disabled reset');const s=this.snapshot(row);this.ranges(s,null,true);this.phase='done';return;}
  throw Error('Unexpected forensic protocol event');
 }
}
