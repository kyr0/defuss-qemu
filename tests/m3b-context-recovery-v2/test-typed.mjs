import test from 'node:test';
import assert from 'node:assert/strict';
import {injectTyped} from './typed.mjs';
import {validateTypedMutation} from './mutation.mjs';
const status={running:false,status:'paused'},request={requestID:1,action:'stale-instance',slot:0,pc:0x405000n,generation:23n};
const pair=(w,i,n)=>{w[i]=Number(n&0xffffffffn);w[i+1]=Number(n>>32n);};
function before(){
 const raw=Array(2400).fill(0);Object.assign(raw,{0:0x4d334343,1:2,2:7,5:2400,6:4,7:32,8:592,9:112,10:4,12:1,13:1});
 const i=32;pair(raw,i,request.pc);Object.assign(raw,{[i+2]:1,[i+3]:1,[i+4]:1,[i+6]:1,[i+8]:1,[i+16]:1,[i+20]:1});
 const t=i+32;for(const [at,n]of [[0,request.pc],[2,0x100n],[4,23n],[6,0x200n],[8,request.pc],[10,0x3000n],[12,(1n<<64n)-1n]])pair(raw,t+at,n);
 raw[t+14]=0x18c0c2b3;raw[t+15]=0xff020000;raw[t+16]=1;raw[t+19]=0x200;
 for(let slot=1;slot<4;slot++)raw[32+slot*592+4]=slot+1;
 return {status:{...status},captureErrors:[],censusRaw:raw,censusNativeStatus:7,m3aRaw:Array(96).fill(0),m3bRaw:Array(128).fill(0),boundaryRaw:Array(256).fill(0),nativeStatus:63,pool:{limit:12000,charged:10,linearMemoryBytes:1<<20}};
}
function mutate(pre){
 const after=structuredClone(pre),c=after.censusRaw;c[16]=c[17]=c[20]=c[21]=c[22]=1;
 pair(c,24,request.pc);pair(c,26,23n);pair(c,28,23n);c[30]=0x18c0c2b3;c[31]=0xff020000;
 after.m3aRaw[34]++;pair(after.m3aRaw,50,request.pc);pair(after.m3aRaw,52,23n);after.m3aRaw[54]=1;
 const record={requestID:1,action:'stale-instance',slot:0,pc:'0x405000',generation:'0x17',returnCode:1,nativeCalls:1};
 return {after,record};
}
test('browser adapter calls the typed export once with exact generation and preserves a native refusal',()=>{
 const calls=[],mod={_defuss_m3cc_abi:()=>2,_defuss_m3cc_status:()=>7,_defuss_m3cc_inject:(...args)=>{calls.push(args);return -2;}};
 const actual=injectTyped(mod,request,status);assert.deepEqual(calls,[[1,1,0,0x405000n,23n]]);assert.equal(actual.returnCode,-2);assert.equal(actual.nativeCalls,1);
});
test('running, untyped and zero-generation requests never reach the native export',()=>{
 let calls=0;const mod={_defuss_m3cc_abi:()=>2,_defuss_m3cc_status:()=>7,_defuss_m3cc_inject:()=>{calls++;return 1;}};
 assert.throws(()=>injectTyped(mod,request,{running:true,status:'running'}));
 for(const delta of [{generation:0n},{generation:23},{pc:0x405000},{requestID:0},{slot:4},{action:'anything'}])assert.throws(()=>injectTyped(mod,{...request,...delta},status));
 assert.throws(()=>injectTyped({...mod,_defuss_m3cc_abi:()=>1},request,status),'ABI1 cannot issue an ABI2 recovery request');
 assert.equal(calls,0);
});
test('paused mutation preserves every raw word except the exact two evidence banks',()=>{
 const pre=before(),{after,record}=mutate(pre);assert.equal(validateTypedMutation(pre,after,record,{seq:1,pc:'0x405000',generation:'0x17'}).mutations,1);
 for(const change of [x=>x.censusRaw[12]++,x=>x.censusRaw[64+91]^=0x000f0000,x=>x.censusRaw[32+8]++,x=>x.censusRaw[28]++,x=>x.m3aRaw[35]++,x=>x.m3bRaw[20]++,x=>x.pool.charged++]){
  const corrupted=structuredClone(after);change(corrupted);assert.throws(()=>validateTypedMutation(pre,corrupted,record,{seq:1,pc:'0x405000',generation:'0x17'}));
 }
});
test('native refusal, repeated invocation and missing warm witness cannot become successful mutation evidence',()=>{
 const pre=before(),{after,record}=mutate(pre),options={seq:1,pc:'0x405000',generation:'0x17'};
 for(const delta of [{returnCode:-2},{nativeCalls:2},{generation:'0x18'},{requestID:2}])assert.throws(()=>validateTypedMutation(pre,after,{...record,...delta},options));
 const cleared=structuredClone(pre);cleared.censusRaw.fill(0,32+5);assert.throws(()=>validateTypedMutation(cleared,after,record,options));
});
test('second invalid-descriptor mutation preserves the prior stale request and increments only its own evidence',()=>{
 const initial=before(),first=mutate(initial),pre=first.after;
 // The same synthetic owner is sufficient here: this unit tests paused
 // cumulative evidence only; the real runner pins the distinct add64 owner.
 const after=structuredClone(pre),c=after.censusRaw;c[16]=2;c[18]=1;c[20]=2;c[21]=2;
 after.m3aRaw[35]++;after.m3aRaw[54]=2;
 const record={requestID:2,action:'invalid-descriptor',slot:0,pc:'0x405000',generation:'0x17',returnCode:1,nativeCalls:1},options={seq:5,pc:'0x405000',generation:'0x17'};
 assert.equal(validateTypedMutation(pre,after,record,options).mutations,1);
 for(const change of [x=>x.censusRaw[20]=0,x=>x.censusRaw[17]=0]){const bad=structuredClone(pre);change(bad);assert.throws(()=>validateTypedMutation(bad,after,record,options));}
 const extra=structuredClone(after);extra.m3aRaw[34]++;assert.throws(()=>validateTypedMutation(pre,extra,record,options));
});
