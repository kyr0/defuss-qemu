// Synthetic host evidence only; source drafted during repeat03, not executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {reference,validateLayout,validateNativeProbe} from './contract.mjs';
import {decodeComplete,validateIdle,validateArmed} from './reader.mjs';
import {layout,fixture,idle,put} from './test-data.mjs';
test('fixed protocol includes all8196 calls/four nonzero probes/eleven stopped gates',()=>{
 validateLayout(layout);const r=reference(layout);assert.equal(r.pass.calls,8196);assert.equal(r.pass.checks,163923);assert.equal(r.gates.length,11);assert.equal(r.inputs.length,4);assert.equal(r.results.length,4);assert.equal(r.order.length,20);
 assert.deepEqual(r.inputs.map(i=>[i.program,i.mode,i.count]),[[0,1,3],[0,2,5],[1,1,3],[1,2,5]]);
 for(const input of r.inputs.filter(x=>x.program===0)){assert.ok(BigInt('0x'+input.initial.gpr[2])>>32n);assert.ok(BigInt('0x'+input.initial.gpr[0])>>32n);}
 for(let i=0;i<4;i++){assert.equal(r.results[i].priorAfter,r.inputs[i].priorBefore+1);assert.equal(r.results[i].observed.rflags,'0000000000000246');}
});
test('synthetic native states enforce one body or only A plus exact service-return equality',()=>{
 for(const input of reference(layout).inputs){const w=fixture(input),bank=validateNativeProbe(w,input,layout,{generation:'0x11'});assert.equal(bank.before.eip,layout.programs[input.program].a);assert.equal(bank.postCall.eip,layout.programs[input.program][input.mode===1?'a':'b']);assert.equal(bank.suspensionObserved,false);}
});
test('bank rejects wrong owner/request/return/debt/service/duplicate/completion/reserved state',()=>{
 const input=reference(layout).inputs[0];for(const at of [0,1,2,3,4,5,6,7,8,10,12,13,14,15,16,17,18,19,20,21,23,25,27,28,29,30,31,67,92,224]){
  const w=fixture(input);w[at]++;assert.throws(()=>validateNativeProbe(w,input,layout,{generation:'0x11'}),'word'+at);
 }
 const w=fixture(input);w[176]++;assert.throws(()=>validateNativeProbe(w,input,layout,{generation:'0x11'}),'postservice drift');const bool=fixture(input);bool[17]=true;assert.throws(()=>validateNativeProbe(bool,input,layout,{generation:'0x11'}));
});
test('self-consistent copied third snapshot cannot hide wrong intermediate architectural or lazy state',()=>{
 const input=reference(layout).inputs[1];for(const at of [96,100,112,128,130,132,134,136,140,141,142,144,146,148,150,152,154]){
  const w=fixture(input);w[at]^=1;for(let i=0;i<64;i++)w[160+i]=w[96+i];assert.throws(()=>validateNativeProbe(w,input,layout,{generation:'0x11'}),'postcall word'+at);
 }
 // A self-consistent third state must not hide truncation of live raw
 // ccDst. Both32-bit probes deliberately seed nonzero upper RCX bits.
 for(const probe of reference(layout).inputs.filter(x=>x.program===0)){
  const w=fixture(probe);w[135]=0;for(let i=0;i<64;i++)w[160+i]=w[96+i];assert.throws(()=>validateNativeProbe(w,probe,layout,{generation:'0x11'}),/Full-width lazy result/);
 }
 const wrong=structuredClone(input);wrong.count=3;assert.throws(()=>validateNativeProbe(fixture(input),wrong,layout,{generation:'0x11'}));
 const before=fixture(input);before[32]^=1;assert.throws(()=>validateNativeProbe(before,input,layout,{generation:'0x11'}));
});
test('OFF idle and fresh armed banks cannot retain previous state or accept incomplete capture',()=>{
 const w=idle();validateIdle(w);const armed=[...w];armed[2]=1;armed[3]=1;armed[4]=1;put(armed,8,0x401000n);validateArmed(armed,{request:1,mode:1,a:'0x401000'});
 const stale=[...armed];stale[32]=1;assert.throws(()=>validateArmed(stale,{request:1,mode:1,a:'0x401000'}));assert.throws(()=>validateIdle(armed));assert.throws(()=>decodeComplete(armed,{request:1,mode:1,a:'0x401000',b:'0x401005',ownerBytes:15}));
});
