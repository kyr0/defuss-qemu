import test from 'node:test';
import assert from 'node:assert/strict';
import {caps,seeded,compare,state} from './xstate.mjs';
import {referenceGates} from './contract.mjs';
const c={schema:1,mask:519,size:2696,ymmOffset:576,pkruOffset:2688,patterns:2};
const actual=(p,configuration=c)=>{const b=seeded(configuration,p);b.writeUInt32LE(0xffff,28);return b;};
const record=(gate,configuration=c)=>{const n=(gate.checks-4)/20;return {seq:gate.seq,invocations:n,samples:[0,1].map(p=>({pattern:p,invocation:n?n-1+p:0,before:(n?actual(p,configuration):Buffer.alloc(configuration.size)).toString('hex'),after:(n?actual(p,configuration):Buffer.alloc(configuration.size)).toString('hex')}))};};
test('both explicit enabled user-component profiles and every legacy fixture gate',()=>{
 for(const conf of [c,{...c,mask:7,size:832,pkruOffset:0}])for(const gate of referenceGates().gates)assert.equal(state(record(gate,conf),conf,gate).invocations,(gate.checks-4)/20);
 assert.equal(referenceGates().pass.checks,943364);
});
test('every required component detects corruption in both seed patterns',()=>{
 for(const p of [0,1])for(const offset of [0,2,4,6,8,16,24,32,40,48,152,160,415,512,520,576,831,2688]){const b=actual(p);b[offset]^=1;assert.throws(()=>compare(b,c,p),'required byte '+offset);}
 for(const p of [0,1]){const b=actual(p);b.writeUInt32LE(0,28);assert.throws(()=>compare(b,c,p));}
});
test('reserved legacy bytes and upper reserved PKRU bytes are not state',()=>{
 const b=actual(1);for(const offset of [5,7,42,43,416,511,528,575,2692,2695])b[offset]^=0x80;
 assert.doesNotThrow(()=>compare(b,c,1));
});
test('unknown or inconsistent component layout fails',()=>{
 for(const bad of [{mask:3},{mask:543},{size:4097},{ymmOffset:577},{pkruOffset:2696},{patterns:1},{extra:1}])assert.throws(()=>caps({...c,...bad}));
});
test('missing, reordered, stale and truncated observations fail',()=>{
 const gate=referenceGates().gates[2],good=record(gate);
 for(const edit of [r=>r.seq++,r=>r.invocations--,r=>r.samples.reverse(),r=>r.samples.pop(),r=>r.samples[0].invocation--,r=>r.samples[1].after=r.samples[1].after.slice(2),r=>r.samples[1].before=r.samples[0].before,r=>r.samples[0].extra=true]){const r=structuredClone(good);edit(r);assert.throws(()=>state(r,c,gate));}
});
