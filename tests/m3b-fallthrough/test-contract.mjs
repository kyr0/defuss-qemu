// Synthetic host-only corruption fixtures. Do not run during timing collection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeM3b} from './reader.mjs';
import {referenceGates,validateSelectedWindow,programs} from './contract.mjs';
import {normalizeSource,assertRuntimeFiles,runtimeFiles} from './runtime-identity.mjs';
function raw(enabled=true){const w=Array(128).fill(0);Object.assign(w,{0:0x4d334231,1:1,2:enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,12:4});return w;}
function watched(){const w=raw();w[32]=0x401000;w[34]=0x401001;w[36]=3;w[38]=7;w[39]=2;w[40]=7;w[48]=0x401000;w[50]=4;w[20]=3;w[22]=7;w[23]=2;w[24]=7;return w;}
test('stopped128-word bank decodes exact selected PC/generation and attempted service partition',()=>{
 const r=decodeM3b(watched(),true);assert.equal(r.watches[0].compiledEntries,3);assert.equal(r.watches[0].BAttempts-r.watches[0].BRequested,5);assert.equal(r.watches[0].lastGeneration,'0x4');assert.equal(decodeM3b(raw(false),false).status,62);
});
test('bank refuses unpinned/faulted/wrong-mode, layout, stale PC/generation and counter corruption',()=>{
 for(const mutate of [w=>w[2]=30,w=>w[2]|=64,w=>w[3]=1,w=>w[4]=1,w=>w[8]=16,w=>w[30]=1,w=>w[47]=1,w=>w[112]=1,
  w=>w[24]=6,w=>w[25]=1,w=>w[39]=8,w=>w[40]=6,w=>w[48]=0x401001,w=>w[50]=0,w=>w[36]=0,w=>w[32]=0,w=>w[19]=1]){
  const w=watched();mutate(w);assert.throws(()=>decodeM3b(w,true));
 }
 assert.throws(()=>decodeM3b(watched(),false));assert.throws(()=>decodeM3b(raw(),1));const inconsistent=watched();inconsistent[20]=0;assert.throws(()=>decodeM3b(inconsistent,true));assert.throws(()=>decodeM3b(raw().slice(1),true));const w=raw();w[16]=true;assert.throws(()=>decodeM3b(w,true));
});
test('fixed oracle includes every warm/side/body/directB invocation and all45 gates',()=>{
 const r=referenceGates();assert.equal(r.gates.length,45);assert.deepEqual(r.gates[0],{seq:0,program:-1,phase:'layout',calls:0,bodies:0,checks:4,digest:'cbf29ce484222325'});
 assert.equal(r.pass.programs,11);assert.equal(r.pass.checks,943364);assert.equal(r.gates.reduce((n,g)=>n+g.calls,0),47168);
 for(const gate of r.gates){assert.match(gate.digest,/^[0-9a-f]{16}$/);if(['body','direct-b'].includes(gate.phase))assert.equal(gate.bodies,550);}
 assert.equal(programs.find(p=>p.name==='m3b_page_end').expectation,'ir-retry');
});
function window(){const r=decodeM3b(raw(),true),a={...r.watches[0],compiledEntries:64,BAttempts:550,servicePaid:550};return {enabled:true,program:0,phase:'body',gate:{seq:3,program:0,phase:'body',calls:64,bodies:550},m3aA:{selectedEntries:64},m3aB:{selectedEntries:0},fusedA:a,fusedB:r.watches[1]};}
test('actual measured fusion gate requires correct identity, compiled exposure and exact body/service counts',()=>{
 validateSelectedWindow(window());const requested=window();requested.fusedA.BRequested=7;assert.deepEqual(validateSelectedWindow(requested),{attemptedFusedBBoundaries:550,completedFusedBBodies:543,resumedOrdinaryBBodies:7,initialOrdinaryBBodies:0,allBodies:550,serviceTurns:550});
 for(const mutate of [x=>x.gate.program=1,x=>x.gate.phase='side',x=>x.gate.calls=63,x=>x.gate.bodies=549,x=>x.gate.bodies=true,
  x=>x.fusedA.compiledEntries=0,x=>{x.fusedA.BAttempts=549;x.fusedA.servicePaid=549;},x=>x.fusedA.servicePaid=549,x=>x.fusedB.compiledEntries=1,x=>x.m3aA.selectedEntries=0]){
  const x=window();mutate(x);assert.throws(()=>validateSelectedWindow(x));
 }
 const x=window();x.phase=x.gate.phase='direct-b';x.gate.seq=4;x.m3aB.selectedEntries=64;x.fusedA.BAttempts=x.fusedA.servicePaid=486;validateSelectedWindow(x);
});
test('accepted byte predecode alone cannot pass helper-IR fallback or selected-fusion evidence',()=>{
 const x=window(),zero=decodeM3b(raw(),true).watches[0];x.program=x.gate.program=2;x.phase=x.gate.phase='warm';x.gate={seq:9,program:2,phase:'warm',calls:4096,bodies:16384};x.m3aB.selectedEntries=2;x.fusedA={...zero,predecodeAccepted:1,IRRejected:1,cleanRetries:1};validateSelectedWindow(x);
 for(const field of ['predecodeAccepted','IRRejected','cleanRetries']){const y=structuredClone(x);y.fusedA[field]=0;assert.throws(()=>validateSelectedWindow(y));}
 const y=structuredClone(x);y.fusedA.compiledEntries=1;assert.throws(()=>validateSelectedWindow(y));
});

test('SDK source normalization is exact and companion runtime omissions cannot agree away',()=>{
 const root='/workspace/defuss-vm',wanted=root+'/artifacts/m3b-source/source';
 for(const value of ['/project/artifacts/m3b-source/source',wanted,'artifacts/m3b-source/source'])assert.equal(normalizeSource(root,value),wanted);
 for(const value of ['/other/artifacts/m3b-source/source','/project/../artifacts/m3b-source/source','artifacts//source','./artifacts/source','/project/engine/qemu'])assert.throws(()=>normalizeSource(root,value));
 const artifacts=Object.fromEntries(runtimeFiles.map(name=>[name,{}]));assertRuntimeFiles(artifacts,artifacts);
 for(const name of runtimeFiles){const omitted={...artifacts};delete omitted[name];assert.throws(()=>assertRuntimeFiles(omitted,omitted));}
});
