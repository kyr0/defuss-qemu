// NON-EVIDENCE unit fixtures: historical raw frames + FABRICATED census banks.
// No new census runtime has executed. Passing these tests is not a guest result.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,open} from 'node:fs/promises';
import {parseContextTrace,validateCensusContextWindow,validateContextWindow} from './contract.mjs';
import {referenceGates} from '../m3b-fallthrough/contract.mjs';
const url=p=>new URL('../../'+p,import.meta.url),json=async p=>JSON.parse(await readFile(url(p),'utf8'));
const inspection=await json('artifacts/m3b-forensic-v3-inspection-01/report.json');
const rows=(await readFile(url('artifacts/m3b-forensic-v2-on-01/progress.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s).observation);
const historical=inspection.windows[3],bytes=Buffer.alloc(historical.traceEnd-historical.traceStart),handle=await open(url('artifacts/m3b-forensic-v2-on-01/native-trace.log'),'r');
try{const {bytesRead}=await handle.read(bytes,0,bytes.length,historical.traceStart);assert.equal(bytesRead,bytes.length);}finally{await handle.close();}
const parsed=parseContextTrace(bytes,{offsetBase:historical.traceStart}),layout=inspection.layout,pc=layout.programs[0].a;
const normal=parsed.entries.find(e=>e.pc===pc&&!(e.flags&0x10000)),rf=parsed.entries.find(e=>e.pc===pc&&(e.flags&0x10000));
const beforeOriginal=rows.find(r=>r.event==='configured'&&r.seq===2),afterOriginal=rows.find(r=>r.event==='gate'&&r.gate.seq===3),warmOriginal=rows.find(r=>r.event==='gate'&&r.gate.seq===1);
const binding={schema:1,kind:'m3b-differential-runtime-binding-v1',status:'passed',timingEligible:false,variant:'m3b-context-census-v1',diagnosticExtensions:['context-entry-census-v1','generation-specific-injection-v1'],censusAbi:{version:1,words:2400,slots:4}};
const put=(w,at,x)=>{x=BigInt(x);w[at]=Number(x&0xffffffffn);w[at+1]=Number(x>>32n);};
function fakeTuple(entry,kind){
 const w=Array(112).fill(0),c=entry.fullContext;put(w,0,BigInt(pc));put(w,2,0x1000000+kind*0x100);put(w,4,87942+kind);put(w,6,BigInt(entry.pointer));put(w,8,BigInt(pc));put(w,10,0x123000);put(w,12,(1n<<64n)-1n);
 w[14]=entry.flags;w[15]=entry.cflags;w[16]=kind===0?1:0;w[17]=entry.flags&~0x10000;w[18]=0;w[19]=entry.cpu.rflags&0x73300;for(const [at,name]of [[20,'cr0'],[22,'cr3'],[24,'cr4']])put(w,at,BigInt('0x'+c[name]));put(w,26,BigInt('0x'+entry.efer));
 for(const [name,at]of [['ES',28],['CS',33],['SS',38],['DS',43],['FS',48],['GS',53],['LDT',64],['TR',69]]){const s=c.segments[name];w[at]=parseInt(s.selector,16);put(w,at+1,BigInt('0x'+s.base));w[at+3]=parseInt(s.limit,16);w[at+4]=parseInt(s.flags,16);}
 for(const [name,at]of [['GDT',58],['IDT',61]]){put(w,at,BigInt('0x'+c.tables[name].base));w[at+2]=parseInt(c.tables[name].limit,16);}
 for(const [name,value]of Object.entries(c.debug))put(w,74+2*Number(name.slice(2)),BigInt('0x'+value));return w;
}
function fakeBank({epoch,compiled=0,tci=0,rfAttempts=0,total}){
 const w=Array(2400).fill(0),n=compiled+tci+rfAttempts;Object.assign(w,{0:0x4d334343,1:1,2:7,5:2400,6:4,7:32,8:592,9:112,10:epoch,12:total,13:1});put(w,32,BigInt(pc));Object.assign(w,{34:1,35:1,36:epoch-3,38:n,39:rfAttempts,40:compiled,41:tci,42:rfAttempts,52:compiled+rfAttempts,53:tci});
 if(compiled+tci){w[48]|=1;w.splice(64,112,...fakeTuple(normal,0));w[50]=0;w[51]=tci?1:0;}
 if(rfAttempts){w[48]|=2;w.splice(176,112,...fakeTuple(rf,1));w[50]=1;w[51]=0;}return w;
}
function fixture(){
 const before=structuredClone(beforeOriginal),after=structuredClone(afterOriginal),ownerBaseline=structuredClone(warmOriginal);
 for(const row of [before,after,ownerBaseline])row.censusNativeStatus=7;
 ownerBaseline.censusRaw=fakeBank({epoch:4,compiled:16912,tci:1500,total:18412});before.censusRaw=fakeBank({epoch:12,total:50000});after.censusRaw=fakeBank({epoch:12,compiled:612,rfAttempts:83,total:50695});
 return {parsed,layout,window:{start:historical.traceStart,end:historical.traceEnd},gate:after.gate,before,after,ownerBaseline,binding};
}
function traceFrame(entry){return bytes.subarray(entry.start-historical.traceStart,entry.end-historical.traceStart).toString();}
function unassignedFixture({requested=false,includeNormalB=true,refuseNormalB=true}={}){
 const i=parsed.entries.findIndex((e,n)=>e.pc===layout.programs[0].b&&(e.flags&0x10000)&&!parsed.stops.some(s=>s.precedingEntry===e.index)&&parsed.entries[n+1]?.pc===pc);
 const rfB=parsed.entries[i],next=parsed.entries[i+1];let j=i-1;while(parsed.entries[j].flags&0x10000)j--;const b=parsed.entries[j];
 const stop=`Stopped execution of TB chain before ${b.pointer} [${BigInt(b.pc).toString(16).padStart(16,'0')}] \n`;
 const text=(includeNormalB?traceFrame(b)+(refuseNormalB?stop:''):'')+traceFrame(rfB)+traceFrame(next),raw=new TextEncoder().encode(text),f=fixture();f.parsed=parseContextTrace(raw);f.window={start:0,end:raw.length};
 const seq=requested?3:4;f.gate=referenceGates().gates[seq];f.after.gate=f.gate;
 for(const row of [f.before,f.after]){row.m3aRaw[11]=row.m3bRaw[11]=seq*4;}
 // Keep cumulative bookkeeping valid while constructing a synthetic route case.
 const F=requested?550:486;f.after.m3bRaw[22]=f.before.m3bRaw[22]+F;f.after.m3bRaw[24]=f.before.m3bRaw[24]+F;f.after.m3bRaw[38]=F;f.after.m3bRaw[40]=F;
 f.after.m3bRaw[23]=f.before.m3bRaw[23]+(requested?1:0);f.after.m3bRaw[39]=requested?1:0;
 f.after.m3aRaw[68]=612;f.before.censusRaw=fakeBank({epoch:seq*4,total:50000});f.after.censusRaw=fakeBank({epoch:seq*4,compiled:612,total:50612});return f;
}

test('fabricated complete census exercises acceptance plumbing without becoming runtime evidence',()=>{
 const f=fixture(),r=validateCensusContextWindow(f);assert.equal(r.windowAccepted,true);assert.equal(r.acceptance,false);assert.equal(r.partition.logicalRouteSum,550);assert.equal(r.partition.certifiedRfAtoBContinuations,64);assert.equal(r.recorded.unloggedNormalAttempts,60);
 const {binding:unused,...old}=f;assert.equal(validateContextWindow(old).status,'blocked-owner-continuity');
});
test('integrated native/trace proof rejects coverage, generation, source, raw-state and guest-row corruption',()=>{
 for(const change of [f=>delete f.after.censusRaw,f=>f.binding={...binding,variant:'old'},f=>f.after.censusRaw[39]--,f=>f.after.censusRaw[52]++,f=>f.after.censusRaw[64+4]++,f=>f.after.m3aRaw[68]--,f=>f.after.m3bRaw[50]++,f=>f.after.censusRaw[64+22]++,f=>f.after.censusRaw[64+6]++,f=>f.after.censusRaw[11]=1,f=>f.after.gate={...f.after.gate,digest:'0'.repeat(16)}]){const f=fixture();change(f);assert.throws(()=>validateCensusContextWindow(f));}
});
test('fixed-CFG D/P source sets admit exact unassigned RF B continuations only with complete census',()=>{
 for(const requested of [false,true])for(const includeNormalB of [false,true]){
  const f=unassignedFixture({requested,includeNormalB}),r=validateCensusContextWindow(f);assert.equal(r.partition.logicalRouteSum,550);assert.equal(r.coverage.unassignedDpContinuations.length,1);assert.equal(r.coverage.unassignedDpContinuations[0].addsLogicalBodyTerm,false);assert.equal(r.partition.certifiedRfAtoBContinuations,0);
  const {binding:unused,...old}=f;assert.throws(()=>validateContextWindow(old),/origin proof/);
 }
});
test('unassigned continuations reject absent D/P routes and ambiguous prior successful B',()=>{
 const f=unassignedFixture({requested:true});f.after.m3bRaw[23]=f.before.m3bRaw[23];f.after.m3bRaw[39]=0;assert.throws(()=>validateCensusContextWindow(f),/origin proof/);
 assert.throws(()=>validateCensusContextWindow(unassignedFixture({refuseNormalB:false})),/refusal/);
});
