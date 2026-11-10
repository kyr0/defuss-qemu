// Synthetic corruption tests only. Not guest execution or a substitute for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeM3b} from '../m3b-fallthrough/reader.mjs';
import {programs,referenceGates} from '../m3b-fallthrough/contract.mjs';
import {RecoveryReplay,decodeRecovery,decodeSnapshot,injectionFor,rejectionAllowance,validateColdWindow,validateMutation} from './replay.mjs';
import {verifyRecoverySources,recoverySources,fixtureSources,validateFixtureClosure} from './identity.mjs';
import {createHash} from 'node:crypto';
const copy=structuredClone,hash=b=>createHash('sha256').update(b).digest('hex');
const proof={graph:{text:'synthetic graph\n'},objects:{text:'synthetic objects\n'}};
const reference=referenceGates();
function banks(enabled=true){
 const a=Array(96).fill(0),b=Array(128).fill(0),boundary=Array(256).fill(0);
 Object.assign(a,{0:0x4d335231,1:1,2:1,5:128,6:64,7:32,8:4,9:64,10:8});
 Object.assign(b,{0:0x4d334231,1:1,2:enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,12:4});
 Object.assign(boundary,{0:0x4d334253,1:1,6:256,7:64});
 return {status:{running:false,status:'prelaunch'},captureErrors:[],m3aRaw:a,m3bRaw:b,boundaryRaw:boundary,nativeStatus:b[2],pool:{limit:12000,charged:100,linearMemoryBytes:1024*1024}};
}
function layout(){return {schema:1,programs:programs.map((p,i)=>{
 const length=i===7?128:i===8?129:10,base=0x401000+i*0x3000;
 const a=i===9?base+4096-length:i===10?base+4090:base,b=a+4,back=a+length-(length===129?5:2),side=a+length;
 const raw=Buffer.alloc(length,0x90);raw[back-a]=length===129?0xe9:0xeb;
 if(length===129)raw.writeInt32LE(-length,length-4);else raw.writeInt8(-length,length-1);
 const hex=n=>'0x'+n.toString(16);
 return {...p,a:hex(a),b:hex(b),back:hex(back),side:hex(side),end:hex(side+1),ownerBytes:length,codeHex:raw.toString('hex')};
})};}
function mutate(before,seq,pc,generation){
 const after=copy(before),action=injectionFor(seq),a=after.m3aRaw;const p=BigInt(pc),g=BigInt(generation);
 a[action==='stale-instance'?34:35]++;a[50]=Number(p&0xffffffffn);a[51]=Number(p>>32n);a[52]=Number(g&0xffffffffn);a[53]=Number(g>>32n);a[54]=seq===1?1:2;
 return {after,mutation:{action,slot:0,pc,mutations:1}};
}
function sequence(enabled){
 const l=layout(),state=banks(enabled),rows=[{event:'startup',hostMs:0,...copy(state),startupCpus:[{'cpu-index':0}],startupFailure:null,graphRaw:Array.from(Buffer.from(proof.graph.text)),objectsRaw:Array.from(Buffer.from(proof.objects.text))}];
 state.status.status='paused';state.m3aRaw[3]=1;
 const watchGlobals=[20,21,22,23,24,16,28,29,19,18,27];let epoch=0;
 for(const gate of reference.gates){
  if(gate.seq){
   const cold=enabled&&gate.program===1&&gate.phase!=='warm',p=programs[gate.program],positive=p.expectation==='fused',warm=gate.phase==='warm';
   const selectedA=cold?0:64,selectedB=warm||gate.phase==='direct-b'?64:0;
   state.m3aRaw[68]=selectedA;state.m3aRaw[69]=selectedA?Number(BigInt(l.programs[gate.program].a)):0;
   state.m3aRaw[76]=selectedB;state.m3aRaw[77]=selectedB?Number(BigInt(l.programs[gate.program].b)):0;
   state.m3aRaw[18]+=selectedA+selectedB;state.m3aRaw[19]+=selectedA+selectedB;state.m3aRaw[23]+=5;
   if(enabled){
    const a=state.m3bRaw;
    if(positive){
     a[cold?37:36]=64;
     const attempted=gate.bodies-(gate.phase==='direct-b'?gate.calls:0);a[38]=a[40]=attempted;
     if(cold)a[46]=attempted;
     if(warm||gate.seq===6){a[41]=a[43]=1;a[17]++;}
     a[48]=Number(BigInt(l.programs[gate.program].a));a[50]=cold?2000:1000+gate.program;
     if(gate.seq===6){a[44]=1;state.m3aRaw[25]++;}
    }else if(warm&&p.expectation==='ir-retry')a[41]=a[42]=a[45]=1;
    for(let i=0;i<watchGlobals.length;i++)a[watchGlobals[i]]+=a[36+i];
    if(gate.seq===2)state.m3aRaw[22]++;
   }
  }
  rows.push({event:'gate',gate:copy(gate),...(gate.seq===0?{layout:copy(l)}:{}),signalHostMs:rows.length,readHostMs:rows.length+0.5,...copy(state)});
  const next=gate.phase==='layout'?0:gate.phase==='direct-b'?gate.program+1:gate.program,program=next<11?next:null;
  state.m3aRaw.fill(0,64);state.m3bRaw.fill(0,32,112);
  if(program!==null)for(let slot=0;slot<2;slot++){
   const pc=Number(BigInt(l.programs[program][slot?'b':'a'])),a=64+slot*8,b=32+slot*20;
   state.m3aRaw[a]=state.m3bRaw[b]=pc;state.m3aRaw[a+2]=state.m3bRaw[b+2]=pc+1;state.m3aRaw[a+7]=1;
  }
  epoch+=4;state.m3aRaw[11]=state.m3bRaw[11]=epoch;
  rows.push({event:'configured',seq:gate.seq,program,hostMs:rows.length,...copy(state)});
  if(enabled&&injectionFor(gate.seq)){
   const pc=l.programs[gate.seq===1?0:1].a,generation='0x'+(gate.seq===1?1000:1001).toString(16),before=copy(state),m=mutate(before,gate.seq,pc,generation);
   rows.push({event:'injection-request',seq:gate.seq,action:injectionFor(gate.seq),slot:0,pc,before:copy(before),hostMs:rows.length});
   rows.push({event:'injection',seq:gate.seq,before,after:m.after,mutation:m.mutation,returnCode:1,nativeCalls:1,failure:null,statusFailure:null,hostMs:rows.length});Object.assign(state,copy(m.after));
  }
  rows.push({event:'ack',seq:gate.seq,hostMs:rows.length,watchEpoch:{m3a:epoch,m3b:epoch}});
 }
 rows.push({event:'complete',validation:copy(reference.pass),hostMs:rows.length,...copy(state)});
 return {rows,layout:l};
}
function replay(sample,enabled){const r=new RecoveryReplay({enabled,proof,expectedLayout:sample.layout.programs});for(const row of sample.rows)r.accept(row);return r;}
test('all45 unchanged guest oracles replay for off and both exact on recoveries',()=>{
 const off=replay(sequence(false),false);assert.equal(off.phase,'done');assert.deepEqual(off.results,{stale:null,invalid:null});
 const on=replay(sequence(true),true);assert.equal(on.phase,'done');assert.equal(on.injections.length,2);assert.equal(on.results.stale.generation,'0x3e8');assert.equal(on.results.stale.staleInstanceMisses,1);
 assert.equal(on.results.invalid.oldGeneration,'0x3e9');assert.equal(on.results.invalid.newGeneration,'0x7d0');assert.equal(on.results.invalid.recompiled,false);assert.equal(on.results.invalid.watchedEntryRejections,1);
 assert.equal(reference.pass.checks,943364);assert.equal(reference.gates.length,45);
});
test('exact expected rejection is retained, never accepted by the original global-zero decoder',()=>{
 const w=banks().m3bRaw;w[19]=w[44]=1;w[32]=0x401000;w[34]=0x401001;
 assert.throws(()=>decodeM3b(w,true));const allowance=rejectionAllowance(true,'gate',6),decoded=decodeRecovery(w,true,allowance);
 assert.equal(decoded.counters.entryRejects,1);assert.equal(decoded.watches[0].entryRejects,1);assert.deepEqual(decoded.raw,w);
 for(const [event,seq]of [['gate',5],['configured',6],['gate',7],['complete',45]])assert.throws(()=>decodeRecovery(w,true,rejectionAllowance(true,event,seq)));
 for(const change of [x=>x[19]=2,x=>x[44]=2,x=>{x[44]=0;x[64]=1;},x=>x[25]=1,x=>x[3]=1,x=>x[4]=1]){const x=copy(w);change(x);assert.throws(()=>decodeRecovery(x,true,allowance));}
 assert.throws(()=>decodeRecovery(w,false,allowance));
 const off=copy(w);off[2]=62;assert.throws(()=>decodeRecovery(off,false,allowance));
});
test('paused mutation changes only one injection count and exact PC/owner-generation evidence',()=>{
 for(const seq of [1,5]){
  const before=banks();before.status.status='paused';before.m3aRaw[3]=1;
  const pc='0x401000',oldGeneration='0x100000008',m=mutate(before,seq,pc,oldGeneration);
  validateMutation(before,m.after,m.mutation,{seq,pc,oldGeneration});
  for(const change of [x=>x.after.m3aRaw[52]++,x=>x.after.m3aRaw[23]++,x=>x.after.m3bRaw[16]++,x=>x.mutation.mutations=2,x=>x.mutation.slot=1,x=>x.after.pool.charged++,x=>x.after.status.running=true]){
   const x=copy(m);change(x);assert.throws(()=>validateMutation(before,x.after,x.mutation,{seq,pc,oldGeneration}));
  }
 }
});
test('raw read failure, wrong pause, armed boundary and counter corruption are rejected',()=>{
 const s=banks();decodeSnapshot(s,true,'startup',-1);
 for(const change of [x=>x.captureErrors.push({key:'m3bRaw',error:'missing'}),x=>x.status.running=true,x=>x.status.status='paused',x=>x.m3aRaw[4]=1,x=>x.boundaryRaw[8]=1,x=>x.pool.charged=12001,x=>x.nativeStatus=62]){
  const x=copy(s);change(x);assert.throws(()=>decodeSnapshot(x,true,'startup',-1));
 }
});
function cold(phase='body'){
 const z=decodeM3b(banks().m3bRaw,true).watches[0],initial=phase==='direct-b'?64:0,bodies=phase==='side'?0:550,attempts=bodies-initial;
 return {gate:{program:1,phase,calls:64,bodies},m3aA:{selectedEntries:0},m3aB:{selectedEntries:phase==='direct-b'?64:0},
  fusedA:{...z,tciEntries:64,BAttempts:attempts,servicePaid:attempts,backedgeTciReturns:attempts,entryRejects:phase==='side'?1:0,predecodeAccepted:phase==='side'?1:0,emittedOwners:phase==='side'?1:0,lastGeneration:'0x200'},fusedB:{...z}};
}
test('startup requires the completed one-CPU fence, raw graph and exact zero templates',()=>{
 const sample=sequence(true),start=sample.rows[0];
 for(const change of [x=>x.startupCpus=[],x=>x.startupFailure='query failed',x=>x.graphRaw[0]++,x=>x.m3aRaw[50]=1,x=>{x.m3bRaw[32]=0x401000;x.m3bRaw[34]=0x401001;},x=>{x.m3aRaw[64]=0x401000;x.m3aRaw[66]=0x401001;x.m3aRaw[71]=1;}]){
  const x=copy(start);change(x);const r=new RecoveryReplay({enabled:true,proof,expectedLayout:sample.layout.programs});assert.throws(()=>r.accept(x));
 }
});
test('cold fallback cannot be relabeled compiled reentry, old-owner use or unexplained service',()=>{
 for(const phase of ['side','body','direct-b'])validateColdWindow(cold(phase),'0x100',null);
 for(const change of [x=>x.fusedA.tciEntries=0,x=>x.fusedA.compiledEntries=1,x=>x.m3aA.selectedEntries=1,x=>x.fusedA.lastGeneration='0x100',x=>x.fusedA.entryRejects=1,x=>x.fusedA.predecodeAccepted=1,x=>x.fusedA.servicePaid--,x=>x.fusedA.backedgeTciReturns--,x=>x.fusedB.tciEntries=1]){
  const x=cold();change(x);assert.throws(()=>validateColdWindow(x,'0x100','0x200'));
 }
 const requested=cold();requested.fusedA.BRequested=7;requested.fusedA.backedgeTciReturns-=7;assert.equal(validateColdWindow(requested,'0x100','0x200').resumedOrdinaryBBodies,7);
 assert.throws(()=>validateColdWindow(cold(),'0x100','0x201'));
});
test('full journal cannot omit/duplicate mutation, substitute digest or silently change stale owner',()=>{
 for(const change of [
  x=>x.rows.splice(x.rows.findIndex(r=>r.event==='injection'),1),
  x=>{const i=x.rows.findIndex(r=>r.event==='injection');x.rows.splice(i,0,copy(x.rows[i]));},
  x=>x.rows.find(r=>r.event==='gate'&&r.gate.seq===2).gate.digest='0000000000000000',
  x=>x.rows.find(r=>r.event==='gate'&&r.gate.seq===2).m3bRaw[50]++,
  x=>x.rows.find(r=>r.event==='gate'&&r.gate.seq===2).m3aRaw[22]++,
  x=>x.rows.find(r=>r.event==='gate'&&r.gate.seq===6).m3bRaw[19]++,
  x=>x.rows.find(r=>r.event==='injection').returnCode=-2,
  x=>x.rows.find(r=>r.event==='injection').nativeCalls=2,
  x=>x.rows.find(r=>r.event==='configured').hostMs=0,
  x=>x.rows.find(r=>r.event==='gate'&&r.gate.seq===1).signalHostMs=0,
 ]){const x=sequence(true);change(x);assert.throws(()=>replay(x,true));}
});
test('unchanged image requires all ten source identities and the exact retained base initramfs',()=>{
 const good={sources:Object.fromEntries(fixtureSources.map(n=>[n,'a'.repeat(64)])),baseInitramfsSha256:'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9'};
 validateFixtureClosure(good);
 for(const name of fixtureSources){const x=copy(good);delete x.sources[name];assert.throws(()=>validateFixtureClosure(x));}
 for(const change of [x=>x.sources.extra='a'.repeat(64),x=>x.sources[fixtureSources[0]]=true,x=>x.baseInitramfsSha256='0'.repeat(64)]){const x=copy(good);change(x);assert.throws(()=>validateFixtureClosure(x));}
});
function sourceEvidence(){
 const table=new Map(),put=(name,value)=>{const data=Buffer.from(typeof value==='string'?value:JSON.stringify(value));table.set(name,data);return {path:name,sha256:hash(data),bytes:data.length};};
 const binding={sourceManifest:put('base-manifest.json','base'),sourceReview:put('base-review.json','review')};
 const manifestPath='artifacts/recovery-source/manifest.json',reviewPath='artifacts/recovery-review/review.json';
 const files=recoverySources.map(path=>{const archive='artifacts/recovery-source/source/'+path,id=put(path,path);put(archive,path);return {...id,archive};});
 const dependencies=Object.fromEntries(['tests/m3b-fallthrough/run.mjs','tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/reader.mjs','tests/m3b-fallthrough/contract.mjs','tests/m3b-fallthrough/runtime-identity.mjs','experiments/m3a-region/reader.mjs'].map(n=>[n,put(n,n)]));
 const manifest={schema:1,kind:'m3b-recovery-source-freeze',status:'frozen',timingEligible:false,baseSourceManifest:binding.sourceManifest,baseSourceReview:binding.sourceReview,files,dependencies};
 const id=put(manifestPath,manifest);put(reviewPath,{status:'passed',sourceManifest:id,sourceBlockers:[]});
 const read=async(name,id)=>{assert.ok(table.has(name));const data=table.get(name);if(id){assert.equal(hash(data),id.sha256);if(id.bytes!==undefined)assert.equal(data.length,id.bytes);}return data;};
 return {table,put,binding,manifest,manifestPath,reviewPath,read};
}
test('new source closure requires exact frozen files/archives, reviewed base and corruption-free inputs',async()=>{
 const ok=sourceEvidence();await verifyRecoverySources(ok);
 for(const change of [x=>x.table.set(recoverySources[0],Buffer.from('changed')),x=>x.table.delete('artifacts/recovery-source/source/'+recoverySources[0]),x=>x.binding.sourceManifest.sha256='0'.repeat(64),x=>x.put(x.reviewPath,{status:'passed',sourceManifest:{path:x.manifestPath,sha256:'0'.repeat(64)},sourceBlockers:[]})]){
  const x=sourceEvidence();change(x);await assert.rejects(()=>verifyRecoverySources(x));
 }
});
