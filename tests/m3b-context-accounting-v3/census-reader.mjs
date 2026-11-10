// Census ABI2 semantic segment caches. Native observation at confirmed stops.
import assert from 'node:assert/strict';
import {censusAbi,readCensusRaw} from './census-browser.mjs';
export {censusAbi,requireCensusBinding,configureCensus,readCensusRaw,watchCensus} from './census-browser.mjs';

export const censusKinds=Object.freeze(['fusedNormal','ordinaryRF','ordinaryNormal','other']);
export const censusSites=Object.freeze(['compiled','outerTCI','internalGotoTb','internalGotoPtr']);
const U64=(1n<<64n)-1n,RF=0x10000,offset=32,stride=592,tupleWords=112;
export const segmentFlagsMask=0x00f0ff00;
const segmentOffsets=[28,33,38,43,48,53,64,69];
const uint=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const hex=n=>'0x'+n.toString(16),pair=(w,i)=>BigInt(w[i])|(BigInt(w[i+1])<<32n);
const zero=values=>assert.ok(values.every(n=>n===0),'Reserved/absent census data must be zero');
const exactKeys=(object,names)=>{assert.ok(object&&typeof object==='object'&&!Array.isArray(object));assert.deepEqual(Object.keys(object).sort(),[...names].sort());};

function segmentIdentity(raw){
 assert.ok(Array.isArray(raw)&&raw.length===tupleWords&&raw.every(uint));zero(raw.slice(98));
 for(let i=0;i<segmentOffsets.length;i++)assert.equal(raw[segmentOffsets[i]+4],(raw[90+i]&segmentFlagsMask)>>>0,'Canonical native segment flags must match retained raw copy');
}
function tuple(raw,kind,pc){
 segmentIdentity(raw);assert.equal(pair(raw,0),BigInt(pc));
 for(const at of [2,4,6])assert.ok(pair(raw,at)>0n,'Native owner/generation/code identity required');
 assert.equal(raw[16],kind===0?1:0,'Exact tuple fused bit');
 assert.equal((raw[19]&0x73300)>>>0,raw[19],'Exact native control-EFLAGS mask');
 const rf=kind===1;assert.equal(Boolean(raw[14]&RF),rf);assert.equal(Boolean(raw[19]&RF),rf,'TB and architectural RF context differ');
 const segment=at=>({selector:raw[at],base:hex(pair(raw,at+1)),limit:raw[at+3],flags:raw[at+4],rawFlags:raw[90+segmentOffsets.indexOf(at)]});
 const segments=Object.fromEntries(['ES','CS','SS','DS','FS','GS'].map((name,i)=>[name,segment(28+5*i)]));segments.LDT=segment(64);segments.TR=segment(69);
 for(const value of Object.values(segments))assert.ok(value.selector<=0xffff,'Native selector width');
 return {pc:hex(pair(raw,0)),owner:hex(pair(raw,2)),generation:hex(pair(raw,4)),code:hex(pair(raw,6)),translationPC:hex(pair(raw,8)),page0:hex(pair(raw,10)),page1:hex(pair(raw,12)),flags:raw[14],cflags:raw[15],fused:Boolean(raw[16]),hflags:raw[17],hflags2:raw[18],controlEflags:raw[19],cr0:hex(pair(raw,20)),cr3:hex(pair(raw,22)),cr4:hex(pair(raw,24)),efer:hex(pair(raw,26)),segments,tables:{GDT:{base:hex(pair(raw,58)),limit:raw[60]},IDT:{base:hex(pair(raw,61)),limit:raw[63]}},debug:Object.fromEntries(Array.from({length:8},(_,i)=>['DR'+i,hex(pair(raw,74+2*i))])),raw:[...raw]};
}
export function sameCensusContext(first,second){
 segmentIdentity(first.raw);segmentIdentity(second.raw);
 for(let i=8;i<tupleWords;i++){
  if(i===16||i>=90&&i<98)continue;let a=first.raw[i],b=second.raw[i];if([14,17,19].includes(i)){a=(a&~RF)>>>0;b=(b&~RF)>>>0;}
  assert.equal(a,b,'Native cross-kind context mismatch at word'+i);
 }
}
export function sameCensusTuple(first,second){
 segmentIdentity(first.raw);segmentIdentity(second.raw);
 for(let i=0;i<tupleWords;i++)if(i<90||i>=98)assert.equal(first.raw[i],second.raw[i],'Native owner/generation/semantic tuple changed at word'+i);
}

// Rejects faulted observations; caller must persist the original raw bank
// BEFORE decoding so a failure remains reviewable. API/injection rejection
// counters are reported, not silently zeroed; the caller's stage contract
// must check their exact expected deltas.
export function decodeCensus(raw,{initial=false}={}){
 assert.equal(typeof initial,'boolean');assert.ok(Array.isArray(raw)&&raw.length===2400&&raw.every(uint),'Exact2400 uint32 census bank required');
 assert.equal(raw[0],0x4d334343);assert.equal(raw[1],2);assert.equal(raw[2],initial?3:7,'Census enabled/chosen/lock state, without writer');assert.equal(raw[3],0,'Sticky census fault');assert.equal(raw[4],0,'Census saturation');
 assert.deepEqual(raw.slice(5,10),[2400,4,32,592,112]);zero(raw.slice(14,16));assert.ok(raw[13]<=15);
 const injection={requests:raw[16],staleSuccesses:raw[17],invalidSuccesses:raw[18],rejects:raw[19],requestID:raw[20],action:raw[21],returnCode:raw[22]|0,slot:raw[23],pc:hex(pair(raw,24)),expectedGeneration:hex(pair(raw,26)),actualGeneration:hex(pair(raw,28)),flags:raw[30],cflags:raw[31],raw:raw.slice(16,32)};
 const successes=injection.staleSuccesses+injection.invalidSuccesses;
 assert.ok(successes<=injection.requests,'Injection successes exceed consumed requests');assert.ok(injection.requests-successes<=injection.rejects,'Completed unsuccessful requests need rejection evidence');
 const watches=[];let activeMask=0,currentTotal=0;
 for(let slot=0;slot<4;slot++){
  const w=raw.slice(offset+slot*stride,offset+(slot+1)*stride),pc=pair(w,0);assert.ok(w[2]<=1&&w[3]<=1);assert.ok(w[4]<=raw[10]);assert.equal(w[5],0,'Sticky watched census fault');zero([w[17],w[24],w[25],w[26],w[27],...w.slice(28,32)]);zero(w.slice(480));
  if(w[2]){assert.ok(pc>=0x100000n&&pc<0x100000000n);activeMask|=1<<slot;}else{assert.equal(pc,0n);assert.equal(w[3],0);zero(w.slice(5));}
  assert.equal(w[6],w.slice(8,16).reduce((a,b)=>a+b,0),'Class/tier partition');assert.equal(w[6],w.slice(20,24).reduce((a,b)=>a+b,0),'Actual-site partition');
  assert.equal(w[20],w[8]+w[10]+w[12]+w[14]);assert.equal(w[21]+w[22]+w[23],w[9]+w[11]+w[13]+w[15]);
  assert.equal(w[14]+w[15],0,'Unexpected category cannot be accepted');assert.equal(w[7],w[10]+w[11],'Architectural RF attempts equal ordinaryRF category');
  if(w[3])assert.equal(w[12]+w[13],0,'Required fused A encountered ordinary normal owner');
  assert.ok(w[16]<=15);let expectedMask=0;const counts={},tuples={};
  for(let kind=0;kind<4;kind++){
   const compiled=w[8+2*kind],tci=w[9+2*kind];counts[censusKinds[kind]]={compiled,tci,total:compiled+tci};const r=w.slice(32+kind*112,32+(kind+1)*112);
   if(compiled+tci){expectedMask|=1<<kind;tuples[censusKinds[kind]]=tuple(r,kind,pc);}else{zero(r);tuples[censusKinds[kind]]=null;}
  }
  assert.equal(w[16],expectedMask,'Every observed kind needs exactly one first tuple');
  const present=Object.values(tuples).filter(Boolean);for(let i=1;i<present.length;i++)sameCensusContext(present[0],present[i]);
  if(w[6]){assert.ok(w[18]<4&&w[19]<2);assert.ok(w[8+2*w[18]+w[19]]>0,'Last category/tier was not observed');}else{zero([w[7],w[16],w[18],w[19]]);}
  currentTotal+=w[6];watches.push({slot,pc:hex(pc),active:Boolean(w[2]),requireFused:Boolean(w[3]),resetEpoch:w[4],faults:0,totalAttempts:w[6],architecturalRfAttempts:w[7],counts,sites:Object.fromEntries(censusSites.map((name,i)=>[name,w[20+i]])),lastKind:w[6]?censusKinds[w[18]]:null,lastTier:w[6]?(w[19]?'tci':'compiled'):null,tuples,raw:w});
 }
 assert.equal(raw[13],activeMask);assert.ok(currentTotal<=raw[12],'Current slot totals exceed cumulative watched attempts');
 if(initial){assert.equal(raw[10],0);assert.equal(raw[11],0);assert.equal(raw[12],0);assert.equal(raw[13],0);zero(raw.slice(16));}
 return {abi:2,enabled:true,locked:!initial,state:raw[2],faults:0,saturated:false,watchEpoch:raw[10],apiRejects:raw[11],totalWatchedAttempts:raw[12],activeMask,injection,watches,raw:[...raw],scope:'Actual selected-tier attempts before generated prologue, including refusals; not completed instructions or retired bodies. Segment raw flags are retained separately from exact selector/base/limit/access semantics.'};
}
export function readCensus(mod,status,options={}){
 const captured=readCensusRaw(mod,status,options),decoded=decodeCensus(captured.raw,options);assert.equal(captured.nativeStatus,decoded.state);assert.equal(mod._defuss_m3cc_status(),decoded.state);return decoded;
}

// Used only for the positive ON measured windows. OFF/rejected shapes may
// legitimately contain ordinaryNormal and retain their original oracle.
export function validatePositiveCensus({before,after,warm,m3b,rfAFrames,pc}){
 assert.ok(Number.isSafeInteger(rfAFrames)&&rfAFrames>=0);const a=before.watches[0],b=after.watches[0],owner=warm.watches[0];
 for(const s of [before,after,warm]){assert.equal(s.apiRejects,0);zero(s.injection.raw);assert.equal(s.activeMask,1);}
 for(const w of [a,b,owner]){assert.equal(w.active,true);assert.equal(w.requireFused,true);assert.equal(w.pc,pc);}
 assert.equal(before.watchEpoch,after.watchEpoch);assert.equal(a.resetEpoch,b.resetEpoch);assert.equal(a.totalAttempts,0);assert.equal(a.architecturalRfAttempts,0);
 assert.ok(before.totalWatchedAttempts<=after.totalWatchedAttempts);assert.equal(after.totalWatchedAttempts-before.totalWatchedAttempts,b.totalAttempts);
 assert.ok(owner.tuples.fusedNormal&&b.tuples.fusedNormal);sameCensusTuple(b.tuples.fusedNormal,owner.tuples.fusedNormal);
 if(owner.tuples.ordinaryRF&&b.tuples.ordinaryRF)sameCensusTuple(b.tuples.ordinaryRF,owner.tuples.ordinaryRF);
 const tuple=b.tuples.fusedNormal;assert.equal(tuple.pc,pc);assert.equal(tuple.translationPC,pc);assert.ok(BigInt(tuple.page0)<512n*1024n*1024n);assert.equal(BigInt(tuple.page1),U64);
 assert.equal(tuple.generation,m3b.lastGeneration);assert.equal(tuple.pc,m3b.lastSelectedPC);
 assert.equal(tuple.flags,0x18c0c2b3);assert.equal(tuple.cflags,0xff020000);
 assert.equal(b.counts.ordinaryNormal.total,0);assert.equal(b.counts.other.total,0);
 assert.equal(b.counts.fusedNormal.compiled,m3b.compiledEntries);assert.equal(b.counts.fusedNormal.tci,m3b.tciEntries);
 assert.equal(b.architecturalRfAttempts,rfAFrames,'Every native RF A attempt needs a complete raw trace record');
 return {totalAttempts:b.totalAttempts,fusedNormal:b.counts.fusedNormal,ordinaryRF:b.counts.ordinaryRF,ordinaryNormal:b.counts.ordinaryNormal,other:b.counts.other,owner:tuple,rfTraceAttempts:rfAFrames,scope:'Census accounts for actual selected-tier entries, including hidden chains and generic prologue refusals; body routes still require certificates and the guest oracle.'};
}

export function matchCensusToRecordedA(census,entries,pc){
 const watched=census.watches[0],frames=entries.filter(e=>e.pc===pc);let ordinaryRf=0,normal=0;
 for(const entry of frames){
  const rf=Boolean(entry.flags&RF),native=watched.tuples[rf?'ordinaryRF':'fusedNormal'];assert.ok(native,'Missing native kind for a recorded A');
  assert.equal(native.pc,entry.pc);assert.equal(native.code,entry.pointer,'Trace code/header identity differs from native tuple');assert.equal(native.flags,entry.flags);assert.equal(native.cflags,entry.cflags);
  assert.equal(native.efer,hex(BigInt('0x'+entry.efer)));assert.equal(native.controlEflags,(entry.cpu.rflags&0x73300)>>>0,'Exact IOPL/TF/RF/VM/AC/IF context');
  const context=entry.fullContext;exactKeys(context,['cr0','cr2','cr3','cr4','segments','tables','debug','segmentsDebug']);
  for(const name of ['cr0','cr2','cr3','cr4'])assert.match(context[name],new RegExp('^[0-9a-f]{'+(['cr0','cr4'].includes(name)?8:16)+'}$'));
  exactKeys(context.segments,['ES','CS','SS','DS','FS','GS','LDT','TR']);exactKeys(context.tables,['GDT','IDT']);exactKeys(context.debug,['DR0','DR1','DR2','DR3','DR6','DR7']);assert.ok(Array.isArray(context.segmentsDebug)&&context.segmentsDebug.length===12&&context.segmentsDebug.every(x=>typeof x==='string'&&x.length>0));
  for(const name of ['cr0','cr3','cr4'])assert.equal(native[name],hex(BigInt('0x'+context[name])));
  for(const [name,segment]of Object.entries(context.segments)){
   exactKeys(segment,['selector','base','limit','flags']);for(const [key,width]of [['selector',4],['base',16],['limit',8],['flags',8]])assert.match(segment[key],new RegExp('^[0-9a-f]{'+width+'}$'));
   const value=native.segments[name];assert.equal(value.selector,Number.parseInt(segment.selector,16));assert.equal(value.base,hex(BigInt('0x'+segment.base)));assert.equal(value.limit,Number.parseInt(segment.limit,16));assert.equal(value.flags,(Number.parseInt(segment.flags,16)&segmentFlagsMask)>>>0,'Exact semantic segment access flags');
  }
  for(const [name,table]of Object.entries(context.tables)){exactKeys(table,['base','limit']);assert.match(table.base,/^[0-9a-f]{16}$/);assert.match(table.limit,/^[0-9a-f]{8}$/);assert.equal(native.tables[name].base,hex(BigInt('0x'+table.base)));assert.equal(native.tables[name].limit,Number.parseInt(table.limit,16));}
  for(const [name,value]of Object.entries(context.debug)){assert.match(value,/^[0-9a-f]{16}$/);assert.equal(native.debug[name],hex(BigInt('0x'+value)));}
  if(rf)ordinaryRf++;else normal++;
 }
 assert.equal(ordinaryRf,watched.architecturalRfAttempts,'All actual RF A attempts must be outer-visible');assert.ok(normal<=watched.counts.fusedNormal.total,'Recorded normal A entries exceed native attempted entries');
 return {recordedNormalA:normal,recordedOrdinaryRfA:ordinaryRf,unloggedNormalAttempts:watched.counts.fusedNormal.total-normal,scope:'The native census covers all actual entry sites; the printed subset binds their exact tuple and context. These remain attempted entries.'};
}
