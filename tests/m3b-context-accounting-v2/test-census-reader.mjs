// Synthetic native banks only; neither ABI execution nor guest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCensus,readCensusRaw,configureCensus,requireCensusBinding,validatePositiveCensus,matchCensusToRecordedA,sameCensusTuple,segmentFlagsMask} from './census-reader.mjs';
const pc=0x405000n,baseFlags=0x18c0c2b3,RF=0x10000;
function put(w,at,value){value=BigInt(value);w[at]=Number(value&0xffffffffn);w[at+1]=Number(value>>32n);}
function tuple(kind){
 const w=Array(112).fill(0);put(w,0,pc);put(w,2,0x10000+kind*0x100);put(w,4,100+kind);put(w,6,0x20000+kind*0x100);put(w,8,pc);put(w,10,0x123000);put(w,12,(1n<<64n)-1n);
 w[14]=baseFlags|(kind===1?RF:0);w[15]=0xff020000;w[16]=kind===0?1:0;w[17]=baseFlags;w[18]=0x400;w[19]=0x200|(kind===1?RF:0);put(w,20,0x80050033);put(w,22,0x2534000);put(w,24,0x350eb0);put(w,26,0xd01);
 for(const at of [28,33,38,43,48,53,64,69]){w[at]=0;put(w,at+1,0);w[at+3]=0;w[at+4]=0;}
 w[33]=0x33;w[36]=0xffffffff;w[37]=0x00affb00;w[38]=0x2b;w[41]=0xffffffff;w[42]=0x00cff300;
 put(w,58,0x1234);w[60]=0x7f;put(w,61,0x5678);w[63]=0xfff;put(w,86,0xffff0ff0);put(w,88,0x400);
 for(const [i,at]of [28,33,38,43,48,53,64,69].entries()){w[90+i]=w[at+4];w[at+4]=(w[at+4]&segmentFlagsMask)>>>0;}return w;
}
function bank({initial=false,requireFused=true,counts=[612,0,83,0,0,0,0,0],epoch=4,total=null}={}){
 const w=Array(2400).fill(0);Object.assign(w,{0:0x4d334343,1:2,2:initial?3:7,5:2400,6:4,7:32,8:592,9:112});if(initial)return w;
 w[10]=epoch;w[13]=1;const at=32;put(w,at,pc);w[at+2]=1;w[at+3]=requireFused?1:0;w[at+4]=epoch-3;
 w[at+6]=counts.reduce((a,b)=>a+b,0);w[at+7]=counts[2]+counts[3];w.splice(at+8,8,...counts);w[12]=total??w[at+6];
 for(let k=0;k<4;k++)if(counts[2*k]+counts[2*k+1]){w[at+16]|=1<<k;w.splice(at+32+k*112,112,...tuple(k));w[at+18]=k;w[at+19]=counts[2*k+1]?1:0;}
 w[at+20]=counts.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0);w[at+21]=counts.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0);return w;
}
const binding={schema:1,kind:'m3b-differential-runtime-binding-v1',status:'passed',timingEligible:false,variant:'m3b-context-census-v2',diagnosticExtensions:['context-entry-census-v2','generation-specific-injection-v1'],censusAbi:{version:2,words:2400,slots:4}};
const stopped={running:false,status:'paused'};

test('exact kind/tier/site partitions retain RF attempts without calling them bodies',()=>{
 const s=decodeCensus(bank());assert.equal(s.watches[0].totalAttempts,695);assert.equal(s.watches[0].architecturalRfAttempts,83);assert.equal(s.watches[0].counts.fusedNormal.compiled,612);assert.equal(s.watches[0].tuples.fusedNormal.generation,'0x64');assert.match(s.scope,/not completed/);
 const off=decodeCensus(bank({requireFused:false,counts:[0,0,2,1,8,3,0,0]}));assert.equal(off.watches[0].counts.ordinaryNormal.total,11);
});
test('faulted, partial, saturated, writer and contradictory banks fail closed',()=>{
 const good=bank();for(const change of [w=>w.pop(),w=>w[1]=1,w=>w[2]=15,w=>w[3]=16,w=>w[4]=1,w=>w[5]=2399,w=>w[14]=1,w=>w[32+5]=8,w=>w[32+6]++,w=>w[32+7]++,w=>w[32+20]++,w=>w[32+16]=1,w=>w[32+18]=3,w=>w[32+27]=1,w=>w[32+480]=1,w=>w[32+32+98]=1,w=>w[13]=0,w=>w[12]=1]){const w=structuredClone(good);change(w);assert.throws(()=>decodeCensus(w));}
 assert.throws(()=>decodeCensus(bank({requireFused:true,counts:[0,0,0,0,1,0,0,0]})),/ordinary normal/);
 assert.throws(()=>decodeCensus(bank({requireFused:false,counts:[0,0,0,0,0,0,1,0]})),/Unexpected/);
});
test('cross-kind comparison masks RF only and keeps full page/context fields',()=>{
 const good=bank(),rf=32+32+112;
 for(const index of [8,10,12,14,15,18,20,22,24,26,29,58,74]){const w=structuredClone(good);w[rf+index]^=index===14?0x100:1;w[rf+index]>>>=0;assert.throws(()=>decodeCensus(w));}
 const w=structuredClone(good);w[rf+19]&=~RF;assert.throws(()=>decodeCensus(w),/RF context/);
});
test('ABI2 retains raw descriptor encodings while comparing exact effective segment caches',()=>{
 const first=bank(),changed=structuredClone(first);
 for(const at of [64,176]){changed[at+91]^=0x000f0000;changed[at+92]^=0x000f0000;}
 const a=decodeCensus(first),b=decodeCensus(changed);sameCensusTuple(a.watches[0].tuples.fusedNormal,b.watches[0].tuples.fusedNormal);
 assert.notEqual(a.watches[0].tuples.fusedNormal.segments.CS.rawFlags,b.watches[0].tuples.fusedNormal.segments.CS.rawFlags);
 assert.equal(a.watches[0].tuples.fusedNormal.segments.CS.flags,b.watches[0].tuples.fusedNormal.segments.CS.flags);
 for(const [i,at]of [28,33,38,43,48,53,64,69].entries()){
  const inconsistent=structuredClone(first);inconsistent[64+90+i]^=0x100;assert.throws(()=>decodeCensus(inconsistent),/Canonical native/);
  // A single-kind bank isolates full owner continuity from cross-kind checks.
  for(const bit of [0x100,0x200,0x400,0x800,0x1000,0x2000,0x4000,0x8000,0x100000,0x200000,0x400000,0x800000]){
   const one=bank({counts:[612,0,0,0,0,0,0,0]});one[64+90+i]^=bit;one[64+at+4]^=bit;
   assert.throws(()=>sameCensusTuple(a.watches[0].tuples.fusedNormal,decodeCensus(one).watches[0].tuples.fusedNormal),/semantic tuple/);
  }
 }
 for(const at of [28,29,31,33,34,36,38,39,41,43,44,46,48,49,51,53,54,56,64,65,67,69,70,72]){
  const one=bank({counts:[612,0,0,0,0,0,0,0]});one[64+at]^=1;
  assert.throws(()=>sameCensusTuple(a.watches[0].tuples.fusedNormal,decodeCensus(one).watches[0].tuples.fusedNormal));
 }
});
test('absent kinds and disabled slots cannot hide nonzero tuples or activity',()=>{
 const good=bank();for(const at of [32+32+2*112,32+592,32+592+6,32+592+32]){const w=structuredClone(good);w[at]=1;assert.throws(()=>decodeCensus(w));}
});
test('positive window demands native RF coverage, old tier equality and stable warm tuple',()=>{
 const warm=decodeCensus(bank({counts:[100,0,20,0,0,0,0,0],epoch:4,total:120}));
 const before=decodeCensus(bank({counts:Array(8).fill(0),epoch:12,total:120}));const after=decodeCensus(bank({epoch:12,total:815}));const input={before,after,warm,m3b:{compiledEntries:612,tciEntries:0,lastGeneration:'0x64',lastSelectedPC:'0x405000'},rfAFrames:83,pc:'0x405000'};
 assert.equal(validatePositiveCensus(input).totalAttempts,695);
 const encodingOnly=bank({epoch:12,total:815});for(const at of [64,176]){encodingOnly[at+91]^=0xf0000;encodingOnly[at+92]^=0xf0000;}assert.equal(validatePositiveCensus({...input,after:decodeCensus(encodingOnly)}).totalAttempts,695);
 assert.throws(()=>validatePositiveCensus({...input,rfAFrames:82}),/raw trace/);assert.throws(()=>validatePositiveCensus({...input,m3b:{compiledEntries:611,tciEntries:0}}));
 const changed=bank({epoch:12,total:815});changed[32+32+4]++;assert.throws(()=>validatePositiveCensus({...input,after:decodeCensus(changed)}),/generation/);
 const injection=bank({epoch:12,total:815});injection[16]=1;injection[19]=1;injection[22]=0xffffffff;assert.throws(()=>validatePositiveCensus({...input,after:decodeCensus(injection)}));
});
test('guard rejections are readable without being consumed injection requests',()=>{
 const raw=bank();raw[19]=1;raw[22]=0xfffffffc;const rejected=decodeCensus(raw);assert.equal(rejected.injection.requests,0);assert.equal(rejected.injection.rejects,1);assert.equal(rejected.injection.returnCode,-4);
 const impossible=bank();impossible[16]=1;assert.throws(()=>decodeCensus(impossible),/rejection evidence/);
 const overSuccess=bank();overSuccess[17]=1;assert.throws(()=>decodeCensus(overSuccess),/successes/);
});
test('recorded A pointers and every printed context field bind to native tuples',()=>{
 const census=decodeCensus(bank({counts:[2,0,1,0,0,0,0,0]})),hexWord=(s,width)=>BigInt(s).toString(16).padStart(width,'0');
 const frame=t=>({pc:t.pc,pointer:t.code,flags:t.flags,cflags:t.cflags,efer:hexWord(t.efer,16),cpu:{rflags:t.controlEflags|4|2},fullContext:{segmentsDebug:Array.from({length:12},(_,i)=>'synthetic-'+i),cr2:'0000000000000000',cr0:hexWord(t.cr0,8),cr3:hexWord(t.cr3,16),cr4:hexWord(t.cr4,8),segments:Object.fromEntries(Object.entries(t.segments).map(([name,s])=>[name,{selector:s.selector.toString(16).padStart(4,'0'),base:hexWord(s.base,16),limit:s.limit.toString(16).padStart(8,'0'),flags:((s.flags&0x00ffff00)>>>0).toString(16).padStart(8,'0')}])),tables:Object.fromEntries(Object.entries(t.tables).map(([name,s])=>[name,{base:hexWord(s.base,16),limit:s.limit.toString(16).padStart(8,'0')}])),debug:Object.fromEntries([0,1,2,3,6,7].map(n=>['DR'+n,hexWord(t.debug['DR'+n],16)]))}});
 const frames=[frame(census.watches[0].tuples.fusedNormal),frame(census.watches[0].tuples.ordinaryRF)];assert.equal(matchCensusToRecordedA(census,frames,'0x405000').unloggedNormalAttempts,1);
 const alternate=structuredClone(frames);for(const e of alternate){e.fullContext.segments.CS.flags='00affb00';e.fullContext.segments.SS.flags='00cff300';}assert.equal(matchCensusToRecordedA(census,alternate,'0x405000').recordedOrdinaryRfA,1);
 for(const change of [e=>e.pointer='0xdead',e=>e.fullContext.cr3='000000000bad0000',e=>e.fullContext.segments.CS.limit='00000000',e=>e.fullContext.debug.DR7='0000000000000401',e=>e.cpu.rflags^=0x200,e=>delete e.fullContext.cr3,e=>delete e.fullContext.segments.CS,e=>delete e.fullContext.tables.IDT,e=>delete e.fullContext.debug.DR7,e=>e.fullContext.segments.CS.selector='0033junk']){const f=structuredClone(frames);change(f[0]);assert.throws(()=>matchCensusToRecordedA(census,f,'0x405000'));}
 assert.throws(()=>matchCensusToRecordedA(census,frames.slice(0,1),'0x405000'),/RF A attempts/);
});
test('binding and configuration reject old runtime identity and repeated choice',()=>{
 requireCensusBinding(binding);for(const change of [b=>delete b.variant,b=>b.variant='m3b-old',b=>b.diagnosticExtensions.reverse(),b=>b.censusAbi.words=128,b=>b.timingEligible=0]){const b=structuredClone(binding);change(b);assert.throws(()=>requireCensusBinding(b));}
 let state=0,calls=0;const mod={_defuss_m3cc_abi:()=>2,_defuss_m3cc_status:()=>state,_defuss_m3cc_configure:n=>{calls++;assert.equal(n,1);state=3;return 0;}};
 assert.equal(configureCensus(mod,binding).status,3);assert.throws(()=>configureCensus(mod,binding));assert.equal(calls,1);
});
test('raw snapshot is bounded and refuses to touch native data while running',()=>{
 let calls=0;const memory=new Uint32Array(2401);memory.set(bank(),1);const mod={_defuss_m3cc_abi:()=>2,_defuss_m3cc_status:()=>7,_defuss_m3cc_data:()=>{calls++;return 4n;},pcProfileWords:()=>memory};
 assert.throws(()=>readCensusRaw(mod,{running:true,status:'running'}));assert.equal(calls,0);assert.equal(readCensusRaw(mod,stopped).raw.length,2400);assert.equal(calls,1);
 assert.throws(()=>readCensusRaw({...mod,_defuss_m3cc_data:()=>0n},stopped));assert.throws(()=>readCensusRaw({...mod,_defuss_m3cc_data:()=>8n},stopped));
});
test('prelaunch census is an exact empty chosen state',()=>{
 assert.equal(decodeCensus(bank({initial:true}),{initial:true}).locked,false);
 for(const change of [w=>w[2]=7,w=>w[11]=1,w=>w[16]=1,w=>w[32+4]=1]){const w=bank({initial:true});change(w);assert.throws(()=>decodeCensus(w,{initial:true}));}
});
