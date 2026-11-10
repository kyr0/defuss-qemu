// Prospective diagnostic contract only. It cannot grant baseline acceptance.
import assert from 'node:assert/strict';
import {parseTrace,classifyRfTransitions} from '../m3b-context-runner-v2/trace.mjs';
import {programs,referenceGates,validateLayout} from '../m3b-fallthrough/contract.mjs';
import {decodeM3b,stopped} from '../m3b-fallthrough/reader.mjs';
import {readM3Region} from '../../experiments/m3a-region/reader.mjs';
import {decodeCensus,validatePositiveCensus,matchCensusToRecordedA,requireCensusBinding,segmentFlagsMask} from './census-reader.mjs';

const RF=0x10000,STATUS=0x8d5,U32=0xffffffffn,U64=(1n<<64n)-1n;
const hex=n=>'0x'+n.toString(16),word=n=>(n&U64).toString(16).padStart(16,'0');
const watchFields=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
const censusRouteProof=Symbol('native census and fixed guest CFG');
export const normalKey=Object.freeze({csBase:'0x0',flags:0x18c0c2b3,cflags:0xff020000,efer:'0000000000000d01'});
export const unresolvedProof=Object.freeze([
 'Outer exec/cpu records omit internal normal Wasm/TCI chain entries. No current record binds every such entry to a physical code page and fused owner generation.',
 'Constant CR3/segments on recorded frames and equal aggregate selected counts do not establish the missing per-entry identity.',
 'A new reviewed source invariant or bounded native owner/context observation is required before this logical partition can replace any acceptance assertion.',
 'Full capture closure, exact build/image/source provenance and unchanged per-call guest checks must also be replayed by an independent capture verifier.',
]);

function segment(line,prefix){
 const m=new RegExp('^'+prefix+'([0-9a-f]{4}) ([0-9a-f]{16}) ([0-9a-f]{8}) ([0-9a-f]{8})(.*)$').exec(line);assert.ok(m,'Complete raw segment row '+prefix);
 const flags=Number.parseInt(m[4],16);assert.equal((flags&0x00ffff00)>>>0,flags,'Printed descriptor flags mask');let suffix='';
 if(flags&0x8000){
  suffix=' DPL='+((flags>>13)&3)+' ';
  if(flags&0x1000){
   if(flags&0x800)suffix+=(flags&0x200000?'CS64':flags&0x400000?'CS32':'CS16')+' ['+(flags&0x400?'C':'-')+(flags&0x200?'R':'-');
   else suffix+='DS   ['+(flags&0x400?'E':'-')+(flags&0x200?'W':'-');
   suffix+=(flags&0x100?'A':'-')+']';
  }else suffix+=['<hiword>','Reserved','LDT','Reserved','Reserved','Reserved','Reserved','Reserved','Reserved','TSS64-avl','Reserved','TSS64-busy','CallGate64','Reserved','IntGate64','TrapGate64'][(flags>>8)&15];
 }
 assert.equal(m[5],suffix,'Descriptor display must match its exact numeric flags');return {selector:m[1],base:m[2],limit:m[3],flags:m[4]};
}

// Native ABI2 stores the effective cache separately from raw descriptor bits.
// Printed rows remain exact and retained; only their redundant base/limit
// encoding bits are excluded from semantic equality. Selector, decoded base,
// decoded limit and every architectural access/type bit still compare exactly.
export function semanticTraceContext(context){
 return {cr0:context.cr0,cr2:context.cr2,cr3:context.cr3,cr4:context.cr4,
  segments:Object.fromEntries(Object.entries(context.segments).map(([name,value])=>[name,{...value,flags:((Number.parseInt(value.flags,16)&segmentFlagsMask)>>>0).toString(16).padStart(8,'0')}])),
  tables:context.tables,debug:context.debug};
}

// Extend the unchanged parser locally. Every printed segment/control/debug
// line is required; no context field is borrowed from another frame.
export function parseContextTrace(bytes,{offsetBase=0}={}){
 assert.ok(bytes instanceof Uint8Array&&bytes.byteLength<=64*1024*1024,'Bounded stopped trace window required');
 const parsed=parseTrace(bytes,{offsetBase}),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 for(const entry of parsed.entries){
  const frame=text.slice(entry.start-offsetBase,entry.end-offsetBase),lines=frame.split('\n');
  const control=lines.filter(x=>x.startsWith('CR0='));assert.equal(control.length,1);
  const m=/^CR0=([0-9a-f]{8}) CR2=([0-9a-f]{16}) CR3=([0-9a-f]{16}) CR4=([0-9a-f]{8})$/.exec(control[0]);assert.ok(m,'Complete raw control register row required');
  const prefixes=['ES =','CS =','SS =','DS =','FS =','GS =','LDT=','TR =','GDT=','IDT=','DR0=','DR6='];
  const segmentsDebug=prefixes.map(prefix=>{const found=lines.filter(x=>x.startsWith(prefix));assert.equal(found.length,1,'Exact raw context line '+prefix);return found[0];});
  const segments=Object.fromEntries(prefixes.slice(0,8).map((prefix,i)=>[prefix.slice(0,-1).trim(),segment(segmentsDebug[i],prefix)]));
  const tables={};for(const [i,name]of [[8,'GDT'],[9,'IDT']]){const row=new RegExp('^'+name+'=     ([0-9a-f]{16}) ([0-9a-f]{8})$').exec(segmentsDebug[i]);assert.ok(row,'Complete descriptor table row');tables[name]={base:row[1],limit:row[2]};}
  const dr03=/^DR0=([0-9a-f]{16}) DR1=([0-9a-f]{16}) DR2=([0-9a-f]{16}) DR3=([0-9a-f]{16}) $/.exec(segmentsDebug[10]);
  const dr67=/^DR6=([0-9a-f]{16}) DR7=([0-9a-f]{16})$/.exec(segmentsDebug[11]);assert.ok(dr03&&dr67,'Complete debug register rows');
  const debug=Object.fromEntries([0,1,2,3].map((n,i)=>['DR'+n,dr03[i+1]]));debug.DR6=dr67[1];debug.DR7=dr67[2];
  entry.fullContext={cr0:m[1],cr2:m[2],cr3:m[3],cr4:m[4],segments,tables,debug,segmentsDebug};
 }
 return {...parsed,contextSchema:1};
}

function snapshot(row){
 stopped(row.status);assert.deepEqual(row.captureErrors,[]);
 assert.ok(Array.isArray(row.m3aRaw)&&row.m3aRaw.length===96&&row.m3aRaw.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff));
 const a=readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>Uint32Array.from(row.m3aRaw)}),b=decodeM3b(row.m3bRaw,true);
 assert.equal(row.nativeStatus,b.status);assert.equal(a.enabled,true);assert.equal(a.started,true);assert.equal(a.saturated,false);
 for(const name of ['invalidMetadata','generationExhaustions','extraWorkerRejects','watchPcMismatches','injectedStaleInstances','injectedInvalidDescriptors','injectionRejects'])assert.equal(a.counters[name],0,name);
 assert.deepEqual(row.m3aRaw.slice(50,55),[0,0,0,0,0]);
 const idle=Array(256).fill(0);Object.assign(idle,{0:0x4d334253,1:1,6:256,7:64});assert.deepEqual(row.boundaryRaw,idle);
 assert.equal(row.pool.limit,12000);assert.ok(Number.isSafeInteger(row.pool.charged)&&row.pool.charged>=0&&row.pool.charged<=12000);assert.ok(Number.isSafeInteger(row.pool.linearMemoryBytes)&&row.pool.linearMemoryBytes>0);
 return {m3a:a,m3b:b};
}
function ranges(s,p,clear){
 for(let i=0;i<4;i++){
  const begin=i<2?p[i?'b':'a']:'0x0',end=i<2?hex(BigInt(begin)+1n):'0x0';
  for(const family of ['m3a','m3b']){const w=s[family].watches[i];assert.equal(w.begin,begin);assert.equal(w.end,end);}
  const a=s.m3a.watches[i],b=s.m3b.watches[i];assert.equal(a.enabled,i<2);
  if(a.selectedEntries)assert.equal(a.lastSelectedPC,begin);else assert.equal(a.lastSelectedPC,'0x0');
  if(clear||i>=2){assert.equal(a.selectedEntries,0);for(const key of watchFields)assert.equal(b[key],0,key);assert.equal(b.lastSelectedPC,'0x0');assert.equal(b.lastGeneration,'0x0');}
 }
}
function monotonic(a,b){for(const family of ['m3a','m3b'])for(const [key,value]of Object.entries(a[family].counters))assert.ok(b[family].counters[key]>=value,'Counter decreased: '+family+'.'+key);}
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
export function classifyContextWindow(input){return classifyRecordedWindow(input);}

/** Pure draft diagnostic. No boolean or caller assertion can enable acceptance.
 * ownerBaseline is the actual warm gate's raw bank, NOT a completeness claim.
 */
function validateRecordedWindow(input,proof=null){
 assert.deepEqual(Object.keys(input).sort(),['parsed','layout','window','gate','before','after','ownerBaseline'].sort());
 const {parsed,layout,window,gate,before,after,ownerBaseline}=input;
 assert.deepEqual(gate,referenceGates().gates[gate.seq],'Exact unchanged per-call oracle row');assert.ok(['side','body','direct-b'].includes(gate.phase));
 const spec=programs[gate.program],p=layout.programs[gate.program];assert.equal(spec?.expectation,'fused');assert.equal(p.name,spec.name);
 assert.deepEqual(after.gate,gate);assert.deepEqual(ownerBaseline.gate,referenceGates().gates[1+gate.program*4]);
 const warm=snapshot(ownerBaseline),pre=snapshot(before),post=snapshot(after);ranges(warm,p,false);ranges(pre,p,true);ranges(post,p,false);monotonic(warm,pre);monotonic(pre,post);
 assert.equal(warm.m3b.watchEpoch,4*(1+gate.program*4));assert.equal(warm.m3a.watchEpoch,warm.m3b.watchEpoch);
 for(const s of [pre,post]){assert.equal(s.m3b.watchEpoch,4*gate.seq);assert.equal(s.m3a.watchEpoch,s.m3b.watchEpoch);}
 const owner=warm.m3b.watches[0],f=post.m3b.watches[0];assert.equal(owner.predecodeAccepted,1);assert.equal(owner.emittedOwners,1);assert.equal(owner.IRRejected,0);assert.equal(owner.cleanRetries,0);assert.ok(owner.compiledEntries>0);
 assert.equal(f.lastGeneration,owner.lastGeneration);assert.equal(f.lastSelectedPC,p.a);assert.ok(f.compiledEntries>0);assert.equal(f.tciEntries,0);
 for(const name of ['predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'])assert.equal(f[name],0);
 for(const name of watchFields)assert.equal(post.m3b.watches[1][name],0,'B remains a distinct ordinary owner');
 for(const name of ['invalidRedispatches','staleInstanceMisses','instanceRetires','invalidations','flushes'])assert.equal(post.m3a.counters[name],pre.m3a.counters[name],name);
 const delta={};for(const [name,value]of Object.entries(pre.m3b.counters))delta[name]=post.m3b.counters[name]-value;
 for(const name of ['predecodeAccepted','formed','cleanRetries','entryRejects','tciEntries','debtErrors','backedgeTciReturns','IRRejected','emittedOwners'])assert.equal(delta[name],0,name);
 for(const name of ['compiledEntries','BAttempts','BRequested','servicePaid'])assert.equal(delta[name],f[name],'Exact watched/lifetime measured increment');
 // Both ordinary-TCI goto paths return to the outer guard before fused
 // target admission. This global routing counter is not a selected tier,
 // watched-owner attribution, B boundary attempt or additional body term.
 assert.ok(Number.isSafeInteger(delta.tciTargetReturns)&&delta.tciTargetReturns>=0,'Global guard redispatch count must be nonnegative');
 const globalGuardRedispatches={counter:'tciTargetReturns',before:pre.m3b.counters.tciTargetReturns,after:post.m3b.counters.tciTargetReturns,delta:delta.tciTargetReturns,scope:'Global ordinary-TCI routing returns before fused target guard/admission; no watched-owner attribution, selected-tier inference, service turn or logical-body term.'};
 const coverage=classifyRecordedWindow({parsed,layout,window,program:gate.program},proof);
 const F=f.BAttempts,P=f.BRequested,R=coverage.classification.rfAToB,D=gate.phase==='direct-b'?gate.calls:0;
 assert.ok(P<=F&&F<=f.compiledEntries);assert.equal(f.servicePaid,F);
 assert.equal(F+R+D,gate.bodies,'Proposed source-dependent logical partition still must conserve all bodies');
 const partition={fusedBoundaryAttempts:F,completedFusedBodyRoutes:F-P,requestedOrdinaryBodyRoutes:P,certifiedRfAtoBContinuations:R,initialDirectBRoutes:D,logicalRouteSum:F+R+D,expectedGuestBodies:gate.bodies,extraServiceTurns:F,ordinaryBSelectedAttempts:post.m3a.watches[1].selectedEntries};
 return {schema:1,kind:'m3b-context-accounting-draft',status:'blocked-owner-continuity',acceptance:false,timingEligible:false,gate,partition,coverage,nativeDelta:delta,globalGuardRedispatches,ownerGeneration:owner.lastGeneration,unresolvedProof:[...unresolvedProof],scope:'Recorded transitions and proposed logical routes only. Ordinary selected entries are never converted to retired bodies. The original failed oracle remains unchanged.'};
}
export function validateContextWindow(input){return validateRecordedWindow(input);}

/** New-runtime-only per-window validator. The outer runner still must verify
 * source/build bindings, every raw stream/gate and all original45 guest rows.
 * This entry point cannot consume the original runtime's missing census.
 */
export function validateCensusContextWindow(input){
 assert.deepEqual(Object.keys(input).sort(),['parsed','layout','window','gate','before','after','ownerBaseline','binding'].sort());
 const {binding,...base}=input;requireCensusBinding(binding);validateLayout(base.layout);
 const decode=row=>{const c=decodeCensus(row.censusRaw);assert.equal(row.censusNativeStatus,c.state);assert.equal(c.watchEpoch,row.m3bRaw[11]);assert.equal(c.watches[0].resetEpoch,c.watchEpoch-3,'Census slot0 must reset first in the exact four-slot epoch');return c;};
 const pre=decode(base.before),post=decode(base.after),warm=decode(base.ownerBaseline),m3b=decodeM3b(base.after.m3bRaw,true).watches[0],pc=base.layout.programs[base.gate.program].a;
 const entries=base.parsed.entries.filter(e=>e.start>=base.window.start&&e.start<base.window.end);
 const rfAFrames=entries.filter(e=>e.pc===pc&&(e.flags&RF)).length;
 const census=validatePositiveCensus({before:pre,after:post,warm,m3b,rfAFrames,pc}),recorded=matchCensusToRecordedA(post,entries,pc);
 const native=snapshot(base.after);assert.equal(post.watches[0].sites.compiled,native.m3a.watches[0].selectedEntries,'Census compiled A attempts must match existing M3a selected A');
 const proof={[censusRouteProof]:true,direct:base.gate.phase==='direct-b'?base.gate.calls:0,requested:m3b.BRequested};
 const diagnostic=validateRecordedWindow(base,proof);
 assert.equal(rfAFrames,diagnostic.coverage.classification.certificates.length+diagnostic.coverage.classification.refused.length,'Every RF A attempt must be classified exactly once');
 return {...diagnostic,status:'validated-census-window',windowAccepted:true,acceptance:false,census,recorded,unresolvedProof:[],continuationSourceProof:'Fixed immutable guest CFG: ordinary B can originate only from explicit direct-B calls, a counted private requested exit, or a certified RF A fallthrough. Exhaustive census excludes ordinary-normal A and other contexts; retries cannot add a route. Unassigned D/P groups are not individually attributed.',scope:'This one positive ON window has census-complete attempted-entry context and exact logical-route conservation. Full45-gate/capture/build acceptance remains the outer independently reviewed runner responsibility. Neither entry attempts nor RF certificates are presented as an independent retired-body measurement.'};
}
