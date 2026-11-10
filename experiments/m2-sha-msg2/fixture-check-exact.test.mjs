import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {checkExposure,fixtureSourceSha256,expectedInstructionCounts} from './fixture-check-exact.mjs';

test('count contract pins the precise guest source and all 32768 nonfaulting instructions',async()=>{
  const source=await readFile(new URL('./guest-fixture.c',import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'),fixtureSourceSha256);
  assert.deepEqual(expectedInstructionCounts,['4096','4096','4096','4096','4096','4096','8192']);
  assert.equal(expectedInstructionCounts.reduce((sum,n)=>sum+BigInt(n),0n),32768n);
});
test('exact accounting accepts each hot mode and cold paths without double-counting fallback',()=>{
  for(let mode=0;mode<7;mode++){
    const count=BigInt(expectedInstructionCounts[mode]);
    const on=checkExposure(['1500',String(count-1500n),'0'],{enabled:true,cold:false,mode});
    assert.equal(on.expectedInstructions,String(count));assert.equal(on.interpreted,'1500');
    const off=checkExposure([String(count),'0',String(count-1500n)],{enabled:false,cold:false,mode});
    assert.equal(off.observedInstructions,String(count));assert.equal(off.interpreted,'1500');
    for(const enabled of [false,true])assert.equal(checkExposure([String(count),'0','0'],{enabled,cold:true,mode}).observedInstructions,String(count));
  }
});
test('extra kernel/helper work, a counted fault or omitted warmup cannot masquerade as fixture exposure',()=>{
  assert.throws(()=>checkExposure(['1500','2597','0'],{enabled:true,cold:false,mode:0}),/Unexpected MSG2 execution count/);
  assert.throws(()=>checkExposure(['4097','0','2596'],{enabled:false,cold:false,mode:5}),/Unexpected MSG2 execution count/);
  assert.throws(()=>checkExposure(['3000','5193','0'],{enabled:true,cold:false,mode:6}),/Unexpected MSG2 execution count/);
  assert.throws(()=>checkExposure(['1500','2596','0'],{enabled:true,cold:false,mode:6}),/Unexpected MSG2 execution count/);
  assert.throws(()=>checkExposure(['8192','0','0'],{enabled:true,cold:true,mode:0}),/Unexpected MSG2 execution count/);
  for(const mode of [-1,7,1.5,undefined])assert.throws(()=>checkExposure(['1500','2596','0'],{enabled:true,cold:false,mode}),/Unknown/);
});
