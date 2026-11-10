// Entirely SYNTHETIC raw banks/CPU dumps. These are corruption tests, never
// guest evidence. No historical capture or mutable external fixture is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeRecoveryObservation,validateRecoveryWindow} from './recovery-contract.mjs';
import {parseContextTrace,normalKey} from '../m3b-context-accounting-v3/contract.mjs';
import {segmentFlagsMask} from '../m3b-context-accounting-v3/census-reader.mjs';
import {programs,referenceGates} from '../m3b-fallthrough/contract.mjs';
const refs=referenceGates().gates,RF=0x10000,U64=(1n<<64n)-1n;
const word=x=>(BigInt(x)&U64).toString(16).padStart(16,'0'),hex=x=>'0x'+BigInt(x).toString(16);
const put=(w,i,n)=>{n=BigInt(n);w[i]=Number(n&0xffffffffn);w[i+1]=Number(n>>32n);};
const binding={schema:1,kind:'m3b-differential-runtime-binding-v1',status:'passed',timingEligible:false,variant:'m3b-context-census-v2',diagnosticExtensions:['context-entry-census-v2','generation-specific-injection-v1'],censusAbi:{version:2,words:2400,slots:4}};
function makeLayout(){
 return {schema:1,programs:programs.map((spec,i)=>{
  let a=0x400000+i*0x10000,code=i===1?'4983f900740d4d31ea4983c2114983e901ebed':'83f900740a83c03531d083e901ebf1',b=i===1?6:5,back=i===1?17:13;
  if(i===7){code='49b8dfb628054eac3971'.repeat(11)+'909090'+'83f900740a83c03531d083e901eb80';b=118;back=126;}
  if(i===8){code='49b8dfb628054eac3971'.repeat(11)+'90'+'83f900740d83c03531d083e901e97fffffff';b=116;back=124;}
  const size=code.length/2;if(i===9)a+=4096-size;if(i===10)a+=4096-8;
  return {name:spec.name,expectation:spec.expectation,a:hex(a),b:hex(a+b),back:hex(a+back),side:hex(a+size),end:hex(a+size+5),ownerBytes:size,codeHex:code};
 })};
}
const layout=makeLayout(),names=['rax','rbx','rcx','rdx','rsi','rdi','rbp','rsp','r8','r9','r10','r11','r12','r13','r14','r15'];
function frame(program,{rf=false,count=0,pointer=rf?'0x21000':'0x20000',pc=layout.programs[program].a,accessOnly=false}={}){
 const gpr=Object.fromEntries(names.map((name,i)=>[name,word(0x71820000n+BigInt(i))]));gpr[program?'r9':'rcx']=word(program?BigInt(count):0x1234567800000000n+BigInt(count));
 return {pc,pointer,accessOnly,flags:normalKey.flags|(rf?RF:0),gpr,rflags:0x202|(rf?RF:0),cc:{src:word(0),dst:word(0),op:'EFLAGS'}};
}
function dump(x){
 const gpr=[['rax','rbx','rcx','rdx'],['rsi','rdi','rbp','rsp'],['r8','r9','r10','r11'],['r12','r13','r14','r15']].map(row=>row.map(n=>n.toUpperCase().padEnd(3,' ')+'='+x.gpr[n]).join(' ')).join('\n');
 const display=[[0x400,'D'],[0x800,'O'],[0x80,'S'],[0x40,'Z'],[0x10,'A'],[4,'P'],[1,'C']].map(([bit,c])=>x.rflags&bit?c:'-').join('');
 return `Trace 0: ${x.pointer} [00000000/${word(x.pc)}/${x.flags.toString(16).padStart(8,'0')}/${normalKey.cflags.toString(16)}] \n${gpr}\nRIP=${word(x.pc)} RFL=${x.rflags.toString(16).padStart(8,'0')} [${display}] CPL=3 II=0 A20=1 SMM=0 HLT=0\nES =0000 0000000000000000 00000000 00000000\nCS =0033 0000000000000000 ffffffff ${x.accessOnly?'00a0fb00':'00affb00'} DPL=3 CS64 [-RA]\nSS =002b 0000000000000000 ffffffff ${x.accessOnly?'00c0f300':'00cff300'} DPL=3 DS   [-WA]\nDS =0000 0000000000000000 00000000 00000000\nFS =0000 0000000000450000 00000000 00000000\nGS =0000 0000000000000000 00000000 00000000\nLDT=0000 0000000000000000 00000000 00008200 DPL=0 LDT\nTR =0040 fffffe111cfb3000 00004087 00008900 DPL=0 TSS64-avl\nGDT=     fffffe111cfb1000 0000007f\nIDT=     fffffe0000000000 00000fff\nCR0=80050033 CR2=00000000004c4f58 CR3=0000000001234000 CR4=00350eb0\nDR0=0000000000000000 DR1=0000000000000000 DR2=0000000000000000 DR3=0000000000000000 \nDR6=00000000ffff0ff0 DR7=0000000000000400\nCCS=${x.cc.src} CCD=${x.cc.dst} CCO=${x.cc.op}\nEFER=${normalKey.efer}\n`;
}
const stop=x=>`Stopped execution of TB chain before ${x.pointer} [${word(x.pc)}] \n`;
function tuple(program,kind,generation,code){
 const entry=parseContextTrace(new TextEncoder().encode(dump(frame(program,{rf:kind===1,pointer:code})))).entries[0],w=Array(112).fill(0),c=entry.fullContext;
 put(w,0,entry.pc);put(w,2,0x10000+generation*0x100);put(w,4,generation);put(w,6,code);put(w,8,entry.pc);put(w,10,0x123000+program*0x1000);put(w,12,U64);w[14]=entry.flags;w[15]=normalKey.cflags;w[16]=kind===0?1:0;w[17]=normalKey.flags;w[19]=0x200|(kind===1?RF:0);
 for(const [at,key]of [[20,'cr0'],[22,'cr3'],[24,'cr4']])put(w,at,BigInt('0x'+c[key]));put(w,26,0xd01);
 for(const [index,[name,at]]of [['ES',28],['CS',33],['SS',38],['DS',43],['FS',48],['GS',53],['LDT',64],['TR',69]].entries()){const s=c.segments[name],rawFlags=parseInt(s.flags,16);w[at]=parseInt(s.selector,16);put(w,at+1,BigInt('0x'+s.base));w[at+3]=parseInt(s.limit,16);w[at+4]=(rawFlags&segmentFlagsMask)>>>0;w[90+index]=rawFlags;}
 for(const [name,at]of [['GDT',58],['IDT',61]]){put(w,at,BigInt('0x'+c.tables[name].base));w[at+2]=parseInt(c.tables[name].limit,16);}
 for(const [name,value]of Object.entries(c.debug))put(w,74+2*Number(name.slice(2)),BigInt('0x'+value));return w;
}
function applyStage(row,stage,seq,enabled=true){
 const injected=stage==='configured'||stage==='injection';const stale=enabled&&(seq>1||seq===1&&injected)?1:0,invalid=enabled&&(seq>5||seq===5&&injected)?1:0,reject=enabled&&seq>=6?1:0;
 row.m3aRaw[34]=stale;row.m3aRaw[35]=invalid;row.m3aRaw[22]=enabled&&seq>=2?1:0;row.m3aRaw[21]=0;row.m3bRaw[19]=reject;row.m3bRaw[44]=enabled&&stage==='gate'&&seq===6?1:0;
 row.censusRaw.fill(0,16,32);row.m3aRaw.fill(0,50,55);
 if(stale){const action=invalid?2:1,pc=layout.programs[invalid?1:0].a;Object.assign(row.censusRaw,{16:stale+invalid,17:stale,18:invalid,20:action,21:action,22:1,23:0,30:normalKey.flags,31:normalKey.cflags});put(row.censusRaw,24,pc);put(row.censusRaw,26,100);put(row.censusRaw,28,100);put(row.m3aRaw,50,pc);put(row.m3aRaw,52,100);row.m3aRaw[54]=action;}
 row.m3bRaw[2]=enabled?63:62;row.nativeStatus=row.m3bRaw[2];
 return row;
}
function observation(program,{seq,stage,epoch,compiled=0,tci=0,rf=0,generation=100,code='0x20000',F=0,P=0,emission=0,warm=false}={}){
 const p=layout.programs[program],a=Array(96).fill(0),b=Array(128).fill(0),c=Array(2400).fill(0),boundary=Array(256).fill(0),total=compiled+tci+rf;
 Object.assign(a,{0:0x4d335231,1:1,2:1,3:1,5:256,6:64,7:32,8:4,9:64,10:8,11:epoch,16:100000,17:100000,18:30000+seq*1000+compiled+rf,19:30000+seq*1000+compiled+rf});
 Object.assign(b,{0:0x4d334231,1:1,2:63,5:1,6:32,7:128,8:12,9:32,10:20,11:epoch,12:4,16:10+emission,17:10+emission,20:30000+seq*1000+compiled,21:2000+seq*1000+tci,22:20000+seq*1000+F,23:P,24:20000+seq*1000+F,29:10+emission});
 Object.assign(c,{0:0x4d334343,1:2,2:7,5:2400,6:4,7:32,8:592,9:112,10:epoch,12:100000+seq*1000+total,13:1});put(c,32,p.a);Object.assign(c,{34:1,35:1,36:epoch-3,38:total,39:rf,40:compiled,41:tci,42:rf,52:compiled+rf,53:tci});
 if(compiled+tci){c[48]|=1;c.splice(64,112,...tuple(program,0,generation,code));c[50]=0;c[51]=tci?1:0;}
 if(rf){c[48]|=2;c.splice(176,112,...tuple(program,1,101,'0x21000'));c[50]=1;c[51]=0;}
 for(let slot=0;slot<2;slot++){
  const begin=p[slot?'b':'a'],at=64+slot*8,bt=32+slot*20;put(a,at,begin);put(a,at+2,BigInt(begin)+1n);a[at+7]=1;put(b,bt,begin);put(b,bt+2,BigInt(begin)+1n);
 }
 a[68]=compiled+rf;if(a[68])put(a,69,p.a);
 Object.assign(b,{36:compiled,37:tci,38:F,39:P,40:F,41:emission,43:emission});if(compiled+tci){put(b,48,p.a);put(b,50,generation);}
 if(warm){b[41]=b[43]=1;a[18]-=compiled+rf;a[19]-=compiled+rf;b[20]-=compiled;b[21]-=tci;b[22]-=F;b[24]-=F;c[12]-=total;}
 Object.assign(boundary,{0:0x4d334253,1:1,6:256,7:64});
 return applyStage({event:stage,seq,status:{running:false,status:'paused'},captureErrors:[],nativeStatus:63,censusNativeStatus:7,m3aRaw:a,m3bRaw:b,censusRaw:c,boundaryRaw:boundary,pool:{limit:12000,charged:4000,linearMemoryBytes:268435456}},stage,seq);
}
function fixture(seq=6,{compiled=0,rf=false,hiddenRejection=false,accessOnly=false}={}){
 const program=seq<5?0:1,gate=refs[seq],fresh=program===1,generation=fresh?200:100,code=fresh?'0x24000':'0x20000',p=layout.programs[program],R=rf&&gate.phase!=='side'?1:0,D=gate.phase==='direct-b'?64:0,F=gate.bodies-R-D;
 const total=gate.phase==='side'?64:614,selectedCompiled=fresh?compiled:total,tci=total-selectedCompiled;
 const warm=observation(program,{seq:1+program*4,stage:'gate',epoch:4*(1+program*4),compiled:20000,tci:1500,F:16384,warm:true});warm.gate=refs[1+program*4];
 const before=observation(program,{seq:seq-1,stage:'configured',epoch:4*seq});
 // Use the same cumulative origin as before; only actual phase increments.
 const after=observation(program,{seq:seq-1,stage:'configured',epoch:4*seq,compiled:selectedCompiled,tci,rf:rf?1:0,generation,code,F,emission:seq===6?1:0});applyStage(after,'gate',seq);after.event='gate';after.seq=seq;after.gate=gate;
 // Gate6 published the fresh owner once. Later synthetic snapshots retain
 // those lifetime trial/formation/publication increments even after watches reset.
 if(seq>6)for(const row of [before,after])for(const at of [16,17,29])row.m3bRaw[at]++;
 const old=frame(program),normal=frame(program,{pointer:code,accessOnly});let text=seq===6?(hiddenRejection?'':dump(old))+stop(old):'';
 text+=dump(normal);
 if(rf){const entry=frame(program,{rf:true,count:gate.phase==='side'?0:3}),next={...structuredClone(entry),pc:gate.phase==='side'?p.side:p.b,pointer:gate.phase==='side'?'0x23000':'0x22000',flags:normalKey.flags,rflags:gate.phase==='side'?0x246:0x206,cc:{src:word(0),dst:entry.gpr[program?'r9':'rcx'],op:program?'SUBQ':'SUBL'}};text+=dump(entry)+dump(next);}
 const bytes=new TextEncoder().encode(text),parsed=parseContextTrace(bytes);let freshOwnerBaseline=null;
 if(seq===7||seq===8)freshOwnerBaseline=fixture(6).after;
 return {parsed,layout,window:{start:0,end:bytes.length},gate,before,after,ownerBaseline:warm,freshOwnerBaseline,binding:structuredClone(binding)};
}

test('exact stage allowances retain original raw rejection evidence and reject unrelated counters',()=>{
 const f=fixture(),before=structuredClone(f.after),r=decodeRecoveryObservation(f.after,{enabled:true,stage:'gate',seq:6});assert.equal(r.m3b.counters.entryRejects,1);assert.equal(r.m3b.watches[0].entryRejects,1);assert.equal(r.m3a.counters.invalidRedispatches,0);assert.deepEqual(f.after,before);assert.deepEqual(r.m3b.raw,before.m3bRaw);
 for(const change of [x=>x.m3bRaw[19]++,x=>x.m3bRaw[44]=0,x=>x.m3bRaw[64]=1,x=>x.m3bRaw[25]=1,x=>x.m3aRaw[21]=1,x=>x.m3aRaw[22]=2,x=>x.m3aRaw[36]=1,x=>x.censusRaw[19]=1,x=>x.censusRaw[3]=1]){const row=structuredClone(f.after);change(row);assert.throws(()=>decodeRecoveryObservation(row,{enabled:true,stage:'gate',seq:6}));}
 assert.throws(()=>decodeRecoveryObservation(f.after,{enabled:false,stage:'gate',seq:6}));assert.throws(()=>decodeRecoveryObservation(f.after,{enabled:true,stage:'configured',seq:6}));
});
test('stale instance recovery needs exactly one miss and preserves the actual compiled owner',()=>{
 const f=fixture(2),r=validateRecoveryWindow(f);assert.equal(r.windowAccepted,true);assert.equal(r.acceptance,false);assert.equal(r.m3aDelta.staleInstanceMisses,1);assert.equal(r.recovery.generation,'0x64');assert.equal(r.recovery.observedTci,0);
 for(const change of [x=>x.after.m3aRaw[22]=0,x=>x.after.censusRaw[68]++,x=>x.after.m3aRaw[25]=1]){const bad=structuredClone(f);change(bad);assert.throws(()=>validateRecoveryWindow(bad));}
});
test('first fresh owner may be entirely TCI, while an old RF owner supplies compiled selections',()=>{
 for(const rf of [false,true])for(const hiddenRejection of [false,true]){
  const f=fixture(6,{rf,hiddenRejection}),r=validateRecoveryWindow(f);assert.equal(r.windowAccepted,true);assert.equal(r.recovery.observedCompiled,0);assert.equal(r.recovery.observedTci,64);assert.equal(r.recovery.freshCompiledObserved,false);assert.equal(r.census.ordinaryRF.compiled,rf?1:0);assert.equal(r.m3aDelta.invalidRedispatches,0);assert.equal(r.m3aDelta.invalidations,0);assert.equal(r.rejectionCertificate.addsLogicalBodyTerm,false);assert.equal(r.partition.logicalRouteSum,0);
 }
});
test('subsequent fresh-owner windows preserve actual mixed tiers and RF logical conservation',()=>{
 for(const seq of [7,8])for(const compiled of [0,11,614]){
  const f=fixture(seq,{compiled,rf:true});for(const at of [16,17,29]){assert.equal(f.before.m3bRaw[at],f.freshOwnerBaseline.m3bRaw[at]);assert.equal(f.after.m3bRaw[at],f.before.m3bRaw[at]);}assert.equal(f.after.m3bRaw[41],0);assert.equal(f.after.m3bRaw[43],0);const r=validateRecoveryWindow(f);assert.equal(r.partition.logicalRouteSum,550);assert.equal(r.partition.certifiedRfAtoBContinuations,1);assert.equal(r.partition.initialDirectBRoutes,seq===8?64:0);assert.equal(r.recovery.observedCompiled,compiled);assert.equal(r.recovery.observedTci,614-compiled);assert.equal(r.recovery.freshCompiledObserved,compiled>0);
 }
});
test('fresh generation, physical mapping, original context and first-fresh witness are mandatory',()=>{
 const decreased=fixture(7);decreased.before.m3bRaw[16]--;assert.throws(()=>validateRecoveryWindow(decreased),/Counter decreased: m3b.predecodeAccepted/);
 for(const change of [x=>x.after.censusRaw[68]=100,x=>x.after.censusRaw[74]++,x=>x.after.censusRaw[86]++,x=>x.freshOwnerBaseline=null,x=>x.freshOwnerBaseline.censusRaw[68]++,x=>x.binding.variant='old',x=>x.after.gate={...x.gate,digest:'0'.repeat(16)}]){const f=fixture(7);change(f);assert.throws(()=>validateRecoveryWindow(f));}
});
test('early invalid-owner rejection is not silently counted as a selected execution',()=>{
 const f=fixture();assert.equal(validateRecoveryWindow(f).rejectionCertificate.kind,'outer-old-owner-refusal');
 for(const change of [x=>x.parsed.stops=[],x=>x.parsed.stops.push({...x.parsed.stops[0]}),x=>x.parsed.stops[0].pointer='0xdead',x=>x.parsed.entries[0].fullContext.cr3='000000000bad0000',x=>x.parsed.entries[0].flags|=RF,x=>x.parsed.entries[0].pointer='0xdead']){const bad=structuredClone(f);change(bad);assert.throws(()=>validateRecoveryWindow(bad));}
});
test('projecting an old-owner frame cannot orphan another attached stop',()=>{
 for(const change of [s=>s.pointer='0xdead',s=>s.pc=layout.programs[1].b,s=>{s.pointer='0xdead';s.pc=layout.programs[1].b;}]){
  const f=fixture(),extra={...f.parsed.stops[0]};change(extra);f.parsed.stops.push(extra);
  assert.throws(()=>validateRecoveryWindow(f),/Projected old-owner frame must have only its exact rejection stop/);
 }
 const hidden=fixture(6,{hiddenRejection:true});assert.equal(validateRecoveryWindow(hidden).rejectionCertificate.kind,'hidden-chain-old-owner-refusal');
});
test('census completeness and untouched service/body oracle reject undercounted recovery',()=>{
 for(const change of [x=>x.after.censusRaw[39]--,x=>x.after.m3aRaw[68]++,x=>x.after.m3bRaw[38]--,x=>x.after.m3bRaw[40]--,x=>x.after.censusRaw[41]++,x=>x.after.m3aRaw[26]++,x=>x.after.m3aRaw[24]++,x=>x.after.m3bRaw[43]++]){const f=fixture(7,{rf:true});change(f);assert.throws(()=>validateRecoveryWindow(f));}
});
test('first-only rejection/emission allowances cannot be reused by later or unmutated windows',()=>{
 for(const seq of [2,7,8]){const f=fixture(seq);f.after.m3bRaw[44]=1;assert.throws(()=>validateRecoveryWindow(f));}
 const f=fixture(7);f.after.m3bRaw[16]++;f.after.m3bRaw[41]++;assert.throws(()=>validateRecoveryWindow(f));
 const oldStop=fixture(7);oldStop.parsed.stops.push({start:oldStop.window.end-1,end:oldStop.window.end,pc:layout.programs[1].a,pointer:'0x20000',precedingEntry:0});assert.throws(()=>validateRecoveryWindow(oldStop),/Old-owner stop/);
 const malformed=fixture();malformed.ownerContinuityProven=true;assert.throws(()=>validateRecoveryWindow(malformed));
});


test('ABI2 recovery permits only redundant segment representation changes and retains the raw evidence',()=>{
 for(const seq of [2,6,7,8]){
  // Mix a SYSRET-style access-only normal frame with full descriptor RF
  // frames. Native first tuples independently retain their own raw form.
  const f=fixture(seq,{rf:true,accessOnly:true});
  for(const tupleAt of [64,176])for(const rawAt of [91,92])f.after.censusRaw[tupleAt+rawAt]&=~0x000f0000;
  const original=structuredClone(f),r=validateRecoveryWindow(f);
  assert.equal(r.windowAccepted,true);assert.equal(r.acceptance,false);
  assert.equal(r.coverage.semanticRecordedContext.segments.CS.flags,'00a0fb00');
  assert.equal(r.coverage.semanticRecordedContext.segments.SS.flags,'00c0f300');
  assert.deepEqual(f,original,'Validation never rewrites retained banks or printed context');
 }
});
test('ABI2 recovery rejects semantic segment changes, invalid canonical copies, reserved words and old ABI',()=>{
 const corruptions=[
  x=>x.after.censusRaw[64+37]^=0x100,
  x=>{x.after.censusRaw[64+37]^=0x100;x.after.censusRaw[64+91]^=0x100;},
  x=>x.after.censusRaw[64+33]^=1,
  x=>x.after.censusRaw[64+34]^=1,
  x=>x.after.censusRaw[64+36]^=1,
  x=>x.after.censusRaw[64+98]=1,
  x=>x.after.censusRaw[1]=1,
  x=>x.binding.censusAbi.version=1,
  x=>x.binding.diagnosticExtensions[0]='context-entry-census-v1',
  x=>x.parsed.entries[1].fullContext.segments.CS.flags='00aff900',
 ];
 for(const mutate of corruptions){const f=fixture(7,{rf:true});mutate(f);assert.throws(()=>validateRecoveryWindow(f));}
});
test('global pre-admission guard returns are separately reported for same and fresh recovery owners',()=>{
 for(const seq of [2,3,4,6,7,8])for(const delta of [0,1,7]){
  const f=fixture(seq,{compiled:seq>=6?11:0}),baseline=validateRecoveryWindow(f);f.before.m3bRaw[26]=11;f.after.m3bRaw[26]=11+delta;
  const original=structuredClone(f),r=validateRecoveryWindow(f);assert.equal(r.windowAccepted,true);assert.equal(r.acceptance,false);assert.deepEqual(f,original);
  assert.deepEqual(r.partition,baseline.partition);assert.deepEqual(r.census,baseline.census);assert.deepEqual(r.recovery,baseline.recovery);assert.deepEqual(r.coverage,baseline.coverage);
  assert.equal(r.nativeDelta.tciTargetReturns,delta);assert.deepEqual(r.globalGuardRedispatches,{counter:'tciTargetReturns',before:11,after:11+delta,delta,scope:'Global ordinary-TCI routing returns before fused target guard/admission; no watched-owner attribution, selected-tier inference, service turn or logical-body term.'});
 }
});
test('global guard returns cannot pardon counter decreases, selected tiers, backedges, service or body errors',()=>{
 const routed=seq=>{const f=fixture(seq);f.after.m3bRaw[26]=1;return f;};
 for(const seq of [2,7]){
  const decreased=routed(seq);decreased.before.m3bRaw[26]=2;assert.throws(()=>validateRecoveryWindow(decreased),/Counter decreased: m3b.tciTargetReturns/);
  for(const value of [-1,0.5,0x100000000]){const bad=routed(seq);bad.after.m3bRaw[26]=value;assert.throws(()=>validateRecoveryWindow(bad));}
 }
 const nonfresh=routed(3);nonfresh.after.m3bRaw[21]++;nonfresh.after.m3bRaw[37]++;for(const at of [12,38,41,53])nonfresh.after.censusRaw[at]++;assert.throws(()=>validateRecoveryWindow(nonfresh));
 const oldBackedge=routed(3);oldBackedge.after.m3bRaw[27]++;oldBackedge.after.m3bRaw[46]++;assert.throws(()=>validateRecoveryWindow(oldBackedge));
 const freshBackedge=routed(6);freshBackedge.after.m3bRaw[27]++;freshBackedge.after.m3bRaw[46]++;assert.throws(()=>validateRecoveryWindow(freshBackedge),/Cold closing returns cannot exceed/);
 for(const seq of [3,7]){
  const service=routed(seq);service.after.m3bRaw[24]++;service.after.m3bRaw[40]++;assert.throws(()=>validateRecoveryWindow(service),/service accounting/);
  const body=routed(seq);for(const at of [22,24,38,40])body.after.m3bRaw[at]++;assert.throws(()=>validateRecoveryWindow(body),/Strict logical route conservation/);
 }
 const typed=routed(2);typed.after.censusRaw[17]++;assert.throws(()=>validateRecoveryWindow(typed));
});
