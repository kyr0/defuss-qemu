import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./observer.js',import.meta.url),'utf8');
function model(){
 const memory=new Uint32Array(new SharedArrayBuffer(65536)),a=32,slot=a+64,profile=4000,debt=4500,pool=4501;
 memory.set([0x4d335357,1,2624,4,640],a);memory[a+14]=64;memory[a+6]=1;memory[a+12]=profile*4;memory[a+16]=pool*4;
 memory[slot]=1;memory[slot+1]=1;memory[slot+4]=0x1234;memory[slot+16]=debt*4;memory[profile]=0x4d334231;memory[profile+1]=1;memory[profile+22]=10;memory[profile+24]=10;memory[profile+23]=2;memory[pool]=12000;
 let native=0;const context=vm.createContext({HEAPU32:memory,Module:{pcM3sWorker:0x1234n},ENVIRONMENT_IS_PTHREAD:true,Asyncify:{state:1},Atomics,Error,BigInt,Number});
 vm.runInContext(source,context);context.pcM3sInit({defuss_m3s_abi:()=>1,defuss_m3s_data:()=>BigInt(a*4),asyncify_get_state:()=>native});
 return {context,memory,a,slot,debt,profile,set:x=>{native=x;},transition(kind){return context.pcM3sTransition(kind,()=>{native=[1,0,2,0][kind-1];return 77;});}};
}
test('four original transition calls retain return and exact owner/state/debt/accounting',()=>{const m=model();for(let i=1;i<=4;i++)assert.equal(m.transition(i),77);assert.equal(m.memory[m.slot+18],4);assert.equal(m.memory[m.a+10],4);assert.equal(m.memory[m.a+7],0);for(let i=0;i<4;i++){const e=m.slot+288+i*64;assert.deepEqual(Array.from(m.memory.slice(e,e+10)),[i+1,[0,1,0,2][i],[1,0,2,0][i],1,0x1234,0,0,10,10,2]);}});
test('other workers and inactive candidates preserve calls without observations',()=>{for(const edit of [m=>m.context.Module.pcM3sWorker=999n,m=>m.context.ENVIRONMENT_IS_PTHREAD=false,m=>m.memory[m.a+6]=0]){const m=model();edit(m);let calls=0;assert.equal(m.context.pcM3sTransition(1,()=>++calls),1);assert.equal(calls,1);assert.equal(m.memory[m.slot+18],0);assert.equal(m.memory[m.a+7],0);}});
test('original exception is preserved exactly once',()=>{const m=model(),error=Error('original');let calls=0;assert.throws(()=>m.context.pcM3sTransition(1,()=>{calls++;throw error;}),e=>e===error);assert.equal(calls,1);assert.equal(m.memory[m.a+7],12);});
test('bad transition, debt, pointer and active token fail without suppressing original call',()=>{for(const edit of [m=>m.set(2),m=>m.memory[m.debt]=1,m=>m.memory[m.a+12]=0xffffffff,m=>m.memory[m.a+6]=5,m=>m.memory[m.slot+18]=4]){const m=model();edit(m);assert.equal(m.transition(1),77);assert.notEqual(m.memory[m.a+7],0);}});
test('record bound rejects a fifth event',()=>{const m=model();for(let i=1;i<=4;i++)m.transition(i);assert.equal(m.transition(1),77);assert.equal(m.memory[m.slot+18],4);assert.equal(m.memory[m.a+10],4);assert.equal(m.memory[m.a+7],10);});
