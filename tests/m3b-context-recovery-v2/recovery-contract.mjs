// Prospective recovery contract. Raw observations remain immutable evidence.
// No runtime, guest, or host-test result is implied by this source file.
import assert from 'node:assert/strict';
import {programs,referenceGates,validateLayout} from '../m3b-fallthrough/contract.mjs';
import {decodeM3b,stopped} from '../m3b-fallthrough/reader.mjs';
import {readM3Region} from '../../experiments/m3a-region/reader.mjs';
import {decodeCensus,sameCensusContext,sameCensusTuple,matchCensusToRecordedA,requireCensusBinding} from '../m3b-context-accounting-v3/census-reader.mjs';
import {normalKey,semanticTraceContext} from '../m3b-context-accounting-v3/contract.mjs';
import {classifyRfTransitions} from '../m3b-context-runner-v5/trace.mjs';

const RF=0x10000,STATUS=0x8d5,U32=0xffffffffn,U64=(1n<<64n)-1n;
const hex=n=>'0x'+n.toString(16),word=n=>(n&U64).toString(16).padStart(16,'0');
const pair=(w,i)=>BigInt(w[i])|(BigInt(w[i+1])<<32n);
const uint=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const watchFields=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
const censusRouteProof=Symbol('recovery census and unchanged fixed guest CFG');
const idle=Array(256).fill(0);Object.assign(idle,{0:0x4d334253,1:1,6:256,7:64});
const stages=['startup','gate','configured','injection','complete'];

function expectedStage(enabled,stage,seq){
 assert.equal(typeof enabled,'boolean');assert.ok(stages.includes(stage));assert.ok(Number.isInteger(seq)&&seq>=0&&seq<=44);
 if(stage==='startup')assert.equal(seq,0);if(stage==='complete')assert.equal(seq,44);
 if(stage==='injection')assert.ok(enabled&&(seq===1||seq===5));
 const afterInjection=stage==='configured'||stage==='injection';
 return {stale:enabled&&(seq>1||seq===1&&afterInjection)?1:0,invalid:enabled&&(seq>5||seq===5&&afterInjection)?1:0,
  staleMiss:enabled&&seq>=2?1:0,fusedReject:enabled&&seq>=6?1:0,watchReject:enabled&&stage==='gate'&&seq===6?1:0};
}

/** Decode original paused banks with exact stage allowances. Only the two
 * already checked entry-rejection fields are zeroed for the legacy decoder;
 * its returned counters/raw are then restored. No tier, generation, census,
 * debt, service, fault, or guest data is altered. This is not a stage-machine:
 * the outer oracle must enforce the durable request/mutation/reset order.
 */
export function decodeRecoveryObservation(row,{enabled,stage,seq}){
 const expected=expectedStage(enabled,stage,seq),initial=stage==='startup';stopped(row.status,initial);assert.deepEqual(row.captureErrors,[]);
 assert.ok(Array.isArray(row.m3aRaw)&&row.m3aRaw.length===96&&row.m3aRaw.every(uint));
 assert.ok(Array.isArray(row.m3bRaw)&&row.m3bRaw.length===128&&row.m3bRaw.every(uint));
 const a=readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>Uint32Array.from(row.m3aRaw)});
 assert.equal(a.enabled,true);assert.equal(a.started,!initial);assert.equal(a.saturated,false);
 for(const name of ['invalidMetadata','generationExhaustions','extraWorkerRejects','watchPcMismatches','injectionRejects'])assert.equal(a.counters[name],0,name);
 assert.equal(a.counters.injectedStaleInstances,expected.stale);assert.equal(a.counters.injectedInvalidDescriptors,expected.invalid);
 assert.equal(a.counters.staleInstanceMisses,expected.staleMiss);assert.equal(a.counters.invalidRedispatches,0,'Fused early rejection bypasses the M3a redispatch counter');
 // Validate all actual rejection locations before making the neutral view.
 assert.equal(row.m3bRaw[19],expected.fusedReject,'Exact lifetime fused entry rejection');
 for(let slot=0;slot<4;slot++)assert.equal(row.m3bRaw[32+slot*20+12],slot===0?expected.watchReject:0,'Exact watched rejection scope');
 const view=[...row.m3bRaw];view[19]=0;view[44]=0;
 const b=decodeM3b(view,enabled);b.counters.entryRejects=row.m3bRaw[19];b.watches[0].entryRejects=row.m3bRaw[44];b.raw=[...row.m3bRaw];
 assert.equal(row.nativeStatus,b.status);assert.deepEqual(row.boundaryRaw,idle);
 const c=decodeCensus(row.censusRaw,{initial});assert.equal(row.censusNativeStatus,c.state);assert.equal(c.apiRejects,0);
 assert.equal(c.watchEpoch,b.watchEpoch);assert.equal(a.watchEpoch,b.watchEpoch);
 const injection=c.injection;assert.equal(injection.requests,expected.stale+expected.invalid);assert.equal(injection.staleSuccesses,expected.stale);assert.equal(injection.invalidSuccesses,expected.invalid);assert.equal(injection.rejects,0);
 if(!expected.stale){assert.deepEqual(injection.raw,Array(16).fill(0));assert.deepEqual(row.m3aRaw.slice(50,55),Array(5).fill(0));}
 else{
  const action=expected.invalid?2:1;assert.equal(injection.requestID,action);assert.equal(injection.action,action);assert.equal(injection.returnCode,1);assert.equal(injection.slot,0);
  assert.ok(BigInt(injection.pc)>=0x100000n&&BigInt(injection.pc)<0x100000000n);assert.ok(BigInt(injection.expectedGeneration)>0n);assert.equal(injection.actualGeneration,injection.expectedGeneration);
  assert.equal(injection.flags,normalKey.flags);assert.equal(injection.cflags,normalKey.cflags);
  assert.equal(a.testInjection.action,action);assert.equal(a.testInjection.lastPC,injection.pc);assert.equal(a.testInjection.lastGeneration,injection.expectedGeneration);
 }
 if(initial){assert.ok(Object.values(a.counters).every(n=>n===0));assert.ok(Object.values(a.fallbacks).every(n=>n===0));assert.ok(Object.values(b.counters).every(n=>n===0));assert.equal(a.watchEpoch,0);}
 assert.equal(row.pool.limit,12000);assert.ok(Number.isSafeInteger(row.pool.charged)&&row.pool.charged>=0&&row.pool.charged<=12000);assert.ok(Number.isSafeInteger(row.pool.linearMemoryBytes)&&row.pool.linearMemoryBytes>0);
 return {m3a:a,m3b:b,census:c,allowances:{...expected},scope:'Exact raw stage evidence; entry counts include refusals and are not retired bodies.'};
}

function ranges(snapshot,p,clear){
 for(let slot=0;slot<4;slot++){
  const begin=slot<2?p[slot?'b':'a']:'0x0',end=slot<2?hex(BigInt(begin)+1n):'0x0';
  for(const family of ['m3a','m3b']){const w=snapshot[family].watches[slot];assert.equal(w.begin,begin);assert.equal(w.end,end);}
  const a=snapshot.m3a.watches[slot],b=snapshot.m3b.watches[slot];assert.equal(a.enabled,slot<2);assert.equal(a.lastSelectedPC,a.selectedEntries?begin:'0x0');
  if(clear||slot>=2){assert.equal(a.selectedEntries,0);for(const name of watchFields)assert.equal(b[name],0,name);assert.equal(b.lastSelectedPC,'0x0');assert.equal(b.lastGeneration,'0x0');}
 }
 const c=snapshot.census;assert.equal(c.activeMask,1);assert.equal(c.watches[0].pc,p.a);assert.equal(c.watches[0].active,true);assert.equal(c.watches[0].requireFused,true);assert.equal(c.watches[0].resetEpoch,c.watchEpoch-3);
 if(clear)assert.equal(c.watches[0].totalAttempts,0);
}
function monotonic(first,last){for(const family of ['m3a','m3b'])for(const [name,value]of Object.entries(first[family].counters))assert.ok(last[family].counters[name]>=value,'Counter decreased: '+family+'.'+name);assert.ok(last.census.totalWatchedAttempts>=first.census.totalWatchedAttempts);}

// The strict recorded RF classifier follows the held ABI2 baseline contract
// (exactRefusal through classifyRecordedWindow). Its private census proof
// token is local; only redundant raw segment-encoding bits are canonicalized.
// Original native tuples and exact printed context remain retained evidence.
function exactRefusal(entry,stops){return stops.length===1&&stops[0].pointer===entry.pointer&&stops[0].pc===entry.pc;}
function subFlags(original,x,width){
 const mask=(1n<<BigInt(width))-1n,a=x&mask,r=(a-1n)&mask,sign=1n<<BigInt(width-1);let flags=0n;
 if(a<1n)flags|=1n;if(((a^1n^r)&16n)!==0n)flags|=16n;if(r===0n)flags|=64n;if(r&sign)flags|=128n;if(((a^1n)&(a^r)&sign)!==0n)flags|=2048n;
 let bits=0;for(let v=Number(r&255n);v;v>>=1)bits+=v&1;if(bits%2===0)flags|=4n;
 return Number((BigInt(original)&~BigInt(STATUS|RF))|flags);
}
function bodySuccessor(p,entry,next){
 const bOffset=Number(BigInt(p.b)-BigInt(p.a)),backOffset=Number(BigInt(p.back)-BigInt(p.a)),body=p.codeHex.slice(2*bOffset,2*backOffset);
 const expected={...entry.gpr};let counter,width;
 if(body==='83c03531d083e901'){
  width=32;counter='rcx';expected.rax=word(((BigInt('0x'+entry.gpr.rax)+53n)&U32)^(BigInt('0x'+entry.gpr.rdx)&U32));expected.rcx=word((BigInt('0x'+entry.gpr.rcx)-1n)&U32);
 }else if(body==='4d31ea4983c2114983e901'){
  width=64;counter='r9';expected.r10=word((BigInt('0x'+entry.gpr.r10)^BigInt('0x'+entry.gpr.r13))+17n);expected.r9=word(BigInt('0x'+entry.gpr.r9)-1n);
 }else throw Error('RF B body outside the exact source-bound register-only oracle');
 assert.equal(next.pc,p.a);assert.equal(next.flags,normalKey.flags);assert.deepEqual(next.gpr,expected,'Exact RF B GPR successor');
 assert.equal(next.cpu.rflags,subFlags(entry.cpu.rflags,BigInt('0x'+entry.gpr[counter]),width));
 assert.deepEqual(next.cc,{src:word(1n),dst:word(BigInt('0x'+entry.gpr[counter])-1n),op:width===32?'SUBL':'SUBQ'},'Exact full-width lazy SUB state');
 return {width,count:hex(BigInt('0x'+entry.gpr[counter])&((1n<<BigInt(width))-1n))};
}

/** Recorded-frame coverage, not hidden-chain completeness. Returns only if
 * every RF B record is connected to an already certified RF A continuation,
 * with any generic refusals checked before its exact body-to-A transition.
 * Such RF B completions NEVER add a new logical-body term.
 */
function classifyRecordedWindow({parsed,layout,window,program},proof=null){
 assert.equal(parsed.contextSchema,1);const {start,end}=window;
 const classification=classifyRfTransitions(parsed,{layout,start,end});assert.deepEqual(classification.unclassified,[],'Unclassified RF A');
 const p=layout.programs[program];assert.ok(p&&p.name===programs[program].name&&programs[program].expectation==='fused');
 const entries=parsed.entries.filter(x=>x.start>=start&&x.start<end);assert.ok(entries.length>0);
 const contexts=entries[0].fullContext,semanticContext=semanticTraceContext(contexts),pointers=new Map(),stopsFor=entry=>parsed.stops.filter(x=>x.precedingEntry===entry.index&&x.start>=start&&x.end<=end);
 for(const entry of entries){
  assert.ok([p.a,p.b,p.side].includes(entry.pc),'Unexpected/interior/other-program entry');
  assert.equal(entry.csBase,normalKey.csBase);assert.equal(entry.cflags,normalKey.cflags,'Exact full cflags including cluster and COUNT0');assert.equal(entry.efer,normalKey.efer);
  assert.equal((entry.flags&~RF)>>>0,normalKey.flags);assert.equal(Boolean(entry.flags&RF),Boolean(entry.cpu.rflags&RF));
  assert.deepEqual([entry.cpu.cpl,entry.cpu.interruptShadow,entry.cpu.a20,entry.cpu.smm,entry.cpu.halted],[3,0,1,0,0]);assert.equal(entry.cpu.rflags&0x20100,0);
  assert.ok(entry.fullContext);assert.deepEqual(semanticTraceContext(entry.fullContext),semanticContext,'Recorded semantic segment/control/debug context changed');
  const key=entry.pc+':'+entry.flags;if(pointers.has(key))assert.equal(pointers.get(key),entry.pointer,'Multiple pointers for one visible key');else pointers.set(key,entry.pointer);
  for(const stop of stopsFor(entry))assert.ok([p.a,p.b,p.side].includes(stop.pc),'Stopped chain escaped the bounded owner ranges');
 }
 const certifiedB=new Map(classification.certificates.filter(c=>c.transition==='rf-a-to-b').map(c=>[c.successorEntry,c]));
 const rfB=[],refusedRfB=[],unassigned=new Map();
 for(let i=0;i<entries.length;i++){
  const entry=entries[i];if(!(entry.flags&RF)||entry.pc===p.a)continue;
  assert.equal(entry.pc,p.b,'RF side/interior contexts require another proof');
  let origin=i-1;while(origin>=0&&entries[origin].pc===p.b&&(entries[origin].flags&RF))origin--;
  const normalB=origin>=0&&entries[origin].pc===p.b&&entries[origin].flags===normalKey.flags?entries[origin]:null;
  const certificate=normalB?certifiedB.get(normalB.index):null;
  if(!certificate){assert.ok(proof?.[censusRouteProof]===true&&proof.direct+proof.requested>0,'RF B has no preceding certified A-to-B continuation or complete census/CFG origin proof');}
  const first=normalB?origin:origin+1,routeOffset=entries[first].start;
  if(!certificate&&!unassigned.has(routeOffset))unassigned.set(routeOffset,{offset:routeOffset,completed:false,origin:'Fixed initial-direct or private-request route set; no individual D/P attribution',addsLogicalBodyTerm:false});
  for(let j=first;j<i;j++){
   assert.ok(exactRefusal(entries[j],stopsFor(entries[j])),'B retry lacks exact generic-entry refusal');assert.deepEqual(entries[j].gpr,entry.gpr);assert.equal(entries[j].cpu.rflags&~RF,entry.cpu.rflags&~RF);
  }
  const stops=stopsFor(entry);
  if(stops.length){
   assert.ok(exactRefusal(entry,stops));assert.ok(i+1<entries.length,'Unclosed RF B refusal');const retry=entries[i+1];
   assert.equal(retry.pc,p.b,'RF B refusal must continue at the same B');assert.equal(retry.flags,entry.flags,'RF B refusal requires another supported RF B retry');assert.deepEqual(retry.gpr,entry.gpr);assert.equal(retry.cpu.rflags,entry.cpu.rflags);
   refusedRfB.push({offset:entry.start,originCertificate:certificate?.offset??null,unassignedRoute:certificate?null:routeOffset});continue;
  }
  assert.ok(i+1<entries.length,'Unclosed RF B completion');const next=entries[i+1],detail=bodySuccessor(p,entry,next);
  if(!certificate){assert.equal(unassigned.get(routeOffset).completed,false);unassigned.get(routeOffset).completed=true;}
  rfB.push({offset:entry.start,successorOffset:next.start,originCertificate:certificate?.offset??null,unassignedRoute:certificate?null:routeOffset,...detail,addsLogicalBodyTerm:false});
 }
 if(unassigned.size){assert.ok(unassigned.size<=proof.direct+proof.requested,'More unassigned RF B continuation groups than fixed D/P routes');assert.ok([...unassigned.values()].every(x=>x.completed));}
 return {classification,recordedContext:contexts,semanticRecordedContext:semanticContext,visiblePointers:Object.fromEntries(pointers),rfBCompletions:rfB,refusedRfB,unassignedDpContinuations:[...unassigned.values()],recordedFrames:entries.length,hiddenChainCoverage:false};
}

function rejectionProjection(parsed,window,warm,p,firstFresh,fresh){
 const old=warm.census.watches[0].tuples.fusedNormal;
 const entries=parsed.entries.filter(e=>e.start>=window.start&&e.start<window.end);
 const oldFrames=entries.filter(e=>e.pc===p.a&&e.pointer===old.code);
 const stops=parsed.stops.filter(s=>s.start>=window.start&&s.end<=window.end&&s.pc===p.a&&s.pointer===old.code);
 if(!firstFresh){if(fresh){assert.equal(oldFrames.length,0,'Old owner cannot reappear after first recovery');assert.equal(stops.length,0,'Old-owner stop cannot recur after first recovery');}return {parsed,rejection:null};}
 assert.equal(stops.length,1,'The one early fused rejection needs its exact old-owner stopped-chain record');assert.ok(oldFrames.length<=1,'Only one rejected old-owner frame is allowed');
 const frame=oldFrames[0]??null,stop=stops[0];
 if(frame){
  assert.equal(frame.flags,normalKey.flags);assert.equal(frame.cflags,normalKey.cflags);assert.equal(stop.precedingEntry,frame.index);assert.ok(stop.start>=frame.end);
  assert.deepEqual(parsed.stops.filter(s=>s.precedingEntry===frame.index),[stop],'Projected old-owner frame must have only its exact rejection stop');
  // Reuse the exact per-frame tuple comparison. The zero RF total is the
  // declared size of this normal-only comparison subset, not a census bank
  // mutation or a claim about the complete warm window.
  const subset={watches:[{...warm.census.watches[0],architecturalRfAttempts:0}]};matchCensusToRecordedA(subset,[frame],p.a);
  const index=entries.indexOf(frame);if(index>0)assert.equal(entries[index-1].flags&RF,0,'Do not splice across an unresolved RF transition');
 }
 const projected={...parsed,entries:parsed.entries.filter(e=>e!==frame),stops:parsed.stops.filter(s=>s!==stop)};
 return {parsed:projected,rejection:{kind:frame?'outer-old-owner-refusal':'hidden-chain-old-owner-refusal',oldPC:p.a,oldCode:old.code,oldGeneration:old.generation,frame:frame?{index:frame.index,start:frame.start,end:frame.end}:null,stop:{...stop},addsLogicalBodyTerm:false,scope:'Exact one source-defined fused guard rejection before generated code/census entry. Original raw frame/stop remain retained; this projection changes no executed-entry or body count.'}};
}

/** Positive ON recovery window. The native current-owner tuple supplies the
 * real tier; a fresh TCI owner is never relabeled as compiled for validation.
 * freshOwnerBaseline is null at gate6, and the actual accepted gate6 row at
 * gates7/8. Other positive windows use their original accepted warm row.
 */
export function validateRecoveryWindow(input){
 assert.deepEqual(Object.keys(input).sort(),['parsed','layout','window','gate','before','after','ownerBaseline','freshOwnerBaseline','binding'].sort());
 const {parsed,layout,window,gate,before,after,ownerBaseline,freshOwnerBaseline,binding}=input;requireCensusBinding(binding);validateLayout(layout);
 assert.deepEqual(gate,referenceGates().gates[gate.seq]);assert.ok(['side','body','direct-b'].includes(gate.phase));assert.equal(programs[gate.program]?.expectation,'fused');assert.deepEqual(after.gate,gate);
 const p=layout.programs[gate.program],warmSeq=1+4*gate.program;assert.deepEqual(ownerBaseline.gate,referenceGates().gates[warmSeq]);
 const read=(row,stage,seq)=>decodeRecoveryObservation(row,{enabled:true,stage,seq});
 const warm=read(ownerBaseline,'gate',warmSeq),pre=read(before,'configured',gate.seq-1),post=read(after,'gate',gate.seq);
 ranges(warm,p,false);ranges(pre,p,true);ranges(post,p,false);monotonic(warm,pre);monotonic(pre,post);
 assert.equal(warm.m3b.watchEpoch,4*warmSeq);assert.equal(pre.m3b.watchEpoch,4*gate.seq);assert.equal(post.m3b.watchEpoch,4*gate.seq);
 assert.deepEqual(pre.census.injection.raw,post.census.injection.raw,'No mutation during a running recovery window');
 const old=warm.census.watches[0],oldF=warm.m3b.watches[0],current=post.census.watches[0],f=post.m3b.watches[0];
 assert.ok(old.tuples.fusedNormal&&oldF.compiledEntries>0);assert.equal(oldF.predecodeAccepted,1);assert.equal(oldF.emittedOwners,1);assert.equal(oldF.IRRejected,0);assert.equal(oldF.cleanRetries,0);
 assert.equal(old.tuples.fusedNormal.generation,oldF.lastGeneration);assert.equal(old.tuples.fusedNormal.pc,p.a);assert.equal(old.counts.fusedNormal.compiled,oldF.compiledEntries);assert.equal(old.counts.fusedNormal.tci,oldF.tciEntries);
 assert.ok(current.tuples.fusedNormal,'Actual selected fresh/same fused owner required');const owner=current.tuples.fusedNormal;
 assert.equal(owner.pc,p.a);assert.equal(owner.translationPC,p.a);assert.ok(BigInt(owner.page0)<512n*1024n*1024n);assert.equal(BigInt(owner.page1),U64);assert.equal(owner.flags,normalKey.flags);assert.equal(owner.cflags,normalKey.cflags);
 sameCensusContext(old.tuples.fusedNormal,owner);
 const fresh=gate.program===1,firstFresh=gate.seq===6;
 if(fresh){
  assert.ok(BigInt(owner.generation)>BigInt(old.tuples.fusedNormal.generation),'Invalid descriptor must produce a newer owner generation');
  assert.notEqual(owner.code,old.tuples.fusedNormal.code,'Old/new code alias is outside the bounded rejection proof');
  assert.equal(pre.census.injection.pc,p.a);assert.equal(pre.census.injection.expectedGeneration,old.tuples.fusedNormal.generation);
  if(firstFresh)assert.equal(freshOwnerBaseline,null);
  else{
   assert.ok(freshOwnerBaseline);assert.deepEqual(freshOwnerBaseline.gate,referenceGates().gates[6]);const first=read(freshOwnerBaseline,'gate',6);ranges(first,p,false);monotonic(first,pre);
   sameCensusTuple(owner,first.census.watches[0].tuples.fusedNormal);
   if(first.census.watches[0].tuples.ordinaryRF&&current.tuples.ordinaryRF)sameCensusTuple(current.tuples.ordinaryRF,first.census.watches[0].tuples.ordinaryRF);
  }
 }else{assert.equal(freshOwnerBaseline,null);sameCensusTuple(owner,old.tuples.fusedNormal);assert.ok(f.compiledEntries>0);assert.equal(f.tciEntries,0);}
 if(old.tuples.ordinaryRF&&current.tuples.ordinaryRF)sameCensusTuple(current.tuples.ordinaryRF,old.tuples.ordinaryRF);
 if(gate.program===0){assert.equal(pre.census.injection.pc,p.a);assert.equal(pre.census.injection.expectedGeneration,old.tuples.fusedNormal.generation);}
 assert.equal(f.lastGeneration,owner.generation);assert.equal(f.lastSelectedPC,p.a);assert.equal(current.counts.fusedNormal.compiled,f.compiledEntries);assert.equal(current.counts.fusedNormal.tci,f.tciEntries);
 assert.equal(current.counts.ordinaryNormal.total,0);assert.equal(current.counts.other.total,0);assert.ok(current.counts.fusedNormal.total>0);
 assert.equal(current.sites.compiled,post.m3a.watches[0].selectedEntries,'All compiled A attempts, including RF, agree with old native selector');
 assert.equal(post.census.totalWatchedAttempts-pre.census.totalWatchedAttempts,current.totalAttempts);
 for(const name of watchFields)assert.equal(post.m3b.watches[1][name],0,'B remains an ordinary owner');
 const delta={},aDelta={};for(const [name,value]of Object.entries(pre.m3b.counters))delta[name]=post.m3b.counters[name]-value;for(const [name,value]of Object.entries(pre.m3a.counters))aDelta[name]=post.m3a.counters[name]-value;
 assert.equal(aDelta.staleInstanceMisses,gate.seq===2?1:0);assert.equal(aDelta.invalidRedispatches,0);
 for(const name of ['instanceRetires','flushes','injectedStaleInstances','injectedInvalidDescriptors','injectionRejects'])assert.equal(aDelta[name],0,name);
 // The typed injector already cleared d.valid. defuss_m3_invalidated only
 // counts a prior valid=1; this recovery is evidenced by the exact fused
 // rejection and fresh generation, not a fabricated M3a invalidation delta.
 assert.equal(aDelta.invalidations,0,'No additional live-descriptor invalidation');
 for(const name of ['IRRejected','cleanRetries','debtErrors'])assert.equal(delta[name],0,name);
 for(const name of ['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','entryRejects','predecodeAccepted','emittedOwners','IRRejected','cleanRetries','backedgeTciReturns'])assert.equal(delta[name],f[name],'Exact watched/lifetime recovery increment: '+name);
 assert.equal(f.entryRejects,firstFresh?1:0);assert.equal(f.predecodeAccepted,firstFresh?1:0);assert.equal(f.emittedOwners,firstFresh?1:0);assert.equal(delta.formed,firstFresh?1:0);
 // Ordinary-TCI routing to a fused target returns before its guard/admission.
 // This global counter supplies no selected-tier, watched-owner or body term.
 assert.ok(Number.isSafeInteger(delta.tciTargetReturns)&&delta.tciTargetReturns>=0,'Global guard redispatch count must be nonnegative');
 const globalGuardRedispatches={counter:'tciTargetReturns',before:pre.m3b.counters.tciTargetReturns,after:post.m3b.counters.tciTargetReturns,delta:delta.tciTargetReturns,scope:'Global ordinary-TCI routing returns before fused target guard/admission; no watched-owner attribution, selected-tier inference, service turn or logical-body term.'};
 if(!fresh){assert.equal(f.backedgeTciReturns,0);}else assert.ok(f.backedgeTciReturns<=f.BAttempts,'Cold closing returns cannot exceed attempted B boundaries');
 const projection=rejectionProjection(parsed,window,warm,p,firstFresh,fresh),selectedTrace=projection.parsed;
 const entries=selectedTrace.entries.filter(e=>e.start>=window.start&&e.start<window.end),rfAFrames=entries.filter(e=>e.pc===p.a&&(e.flags&RF)).length;
 assert.equal(current.architecturalRfAttempts,rfAFrames,'Complete native RF A attempts need exact raw frames');const recorded=matchCensusToRecordedA(post.census,entries,p.a);
 const proof={[censusRouteProof]:true,direct:gate.phase==='direct-b'?gate.calls:0,requested:f.BRequested};
 const coverage=classifyRecordedWindow({parsed:selectedTrace,layout,window,program:gate.program},proof);
 assert.equal(rfAFrames,coverage.classification.certificates.length+coverage.classification.refused.length,'Every RF A attempt classified exactly once');
 const F=f.BAttempts,P=f.BRequested,R=coverage.classification.rfAToB,D=proof.direct;assert.ok(P<=F&&F<=f.compiledEntries+f.tciEntries);assert.equal(f.servicePaid,F);assert.equal(F+R+D,gate.bodies,'Strict logical route conservation');
 return {schema:1,kind:'m3b-context-recovery-window-v2',status:'validated-recovery-window',windowAccepted:true,acceptance:false,timingEligible:false,gate,
  partition:{fusedBoundaryAttempts:F,completedFusedBodyRoutes:F-P,requestedOrdinaryBodyRoutes:P,certifiedRfAtoBContinuations:R,initialDirectBRoutes:D,logicalRouteSum:F+R+D,expectedGuestBodies:gate.bodies,extraServiceTurns:F,ordinaryBSelectedAttempts:post.m3a.watches[1].selectedEntries},
  census:{totalAttempts:current.totalAttempts,fusedNormal:current.counts.fusedNormal,ordinaryRF:current.counts.ordinaryRF,owner},recorded,coverage,rejectionCertificate:projection.rejection,nativeDelta:delta,globalGuardRedispatches,m3aDelta:aDelta,
  recovery:{kind:fresh?'fresh-descriptor':gate.program===0?'same-descriptor-stale-instance':'unmutated-owner',oldGeneration:old.tuples.fusedNormal.generation,generation:owner.generation,observedCompiled:f.compiledEntries,observedTci:f.tciEntries,freshCompiledObserved:fresh&&f.compiledEntries>0},
  scope:'One positive ON recovery window only. Original raw banks, exact full guest oracle and all census/trace/owner proofs remain required by the outer capture replay. D/P and RF transitions are source-qualified logical routes, not B entry-attempt retirements; fresh compilation is claimed only when the new-generation native compiled tier is observed.'};
}
