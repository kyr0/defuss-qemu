import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {checkExposure,validateCumulative,checkSerial,fixtureSourceSha256,expectedInstructionCounts,faultPass} from './fixture-check.mjs';

test('source pin binds seven MSG1 forms and the separate warmed fault PC',async()=>{
  const source=await readFile(new URL('./guest-fixture.c',import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'),fixtureSourceSha256);
  const text=source.toString();assert.equal((text.match(/MSG1_CASE\([0-6],/g)||[]).length,7);
  assert.ok(text.includes('0x0f, 0x38, 0xcc'));assert.ok(!text.includes('0xcd'));
  assert.deepEqual(expectedInstructionCounts,['4096','4096','4096','4096','4096','4096','8192']);
  assert.equal(expectedInstructionCounts.reduce((sum,n)=>sum+BigInt(n),0n),32768n);
});
test('hot off/on and cold off/on partitions preserve exact source-derived counts',()=>{
  for(let mode=0;mode<7;mode++){
    const n=BigInt(expectedInstructionCounts[mode]);
    const on=checkExposure(['1500',String(n-1500n),'0'],{enabled:true,cold:false,mode});
    assert.equal(on.observedInstructions,String(n));assert.equal(on.interpreted,'1500');
    const off=checkExposure([String(n),'0',String(n-1500n)],{enabled:false,cold:false,mode});
    assert.equal(off.observedInstructions,String(n));assert.equal(off.interpreted,'1500');
    for(const enabled of [false,true])assert.equal(checkExposure([String(n),'0','0'],{enabled,cold:true,mode}).interpreted,String(n));
  }
  assert.deepEqual(validateCumulative(['9007199254740993','0','0'],{enabled:false,cold:true}),[9007199254740993n,0n,0n]);
});
test('counted fault, unrelated extra work, missing warmup, wrong mode and wrap are rejected',()=>{
  const reject=(delta,options={enabled:true,cold:false,mode:0})=>assert.throws(()=>checkExposure(delta,options));
  reject(['1500','2597','0']);reject(['3000','5193','0'],{enabled:true,cold:false,mode:6});
  reject(['1500','2596','0'],{enabled:true,cold:false,mode:6});
  reject(['4096','0','0']);reject(['4096','0','2596']);
  reject(['2','4094','3']);reject(['-1','4097','0']);reject(['01500','2596','0']);
  reject(['18446744073709551616','0','0']);reject(['4096','1','0'],{enabled:true,cold:true,mode:0});
  for(const mode of [-1,7,1.5,undefined])reject(['1500','2596','0'],{enabled:true,cold:false,mode});
  assert.throws(()=>validateCumulative(['10','1','0'],{enabled:false,cold:false}));
});
test('raw success requires all eight gates, seven mode passes and exactly one precise fault marker',()=>{
  const lines=['MSG1_FIXTURE_START','MSG1_GATE:-1'];
  for(let i=0;i<7;i++){if(i===6)lines.push(faultPass);lines.push(`MSG1_MODE_PASS:${i} checks=4096`,`MSG1_GATE:${i}`);}
  lines.push('MSG1_FIXTURE_PASS checks=28672','FIXTURE_PASS');const serial=lines.join('\n')+'\n';
  assert.equal(checkSerial(serial).successfulInstructions,32768);
  for(const bad of [serial.replace('MSG1_GATE:2\n',''),serial.replace('checks=28672','checks=28671'),
    serial.replace('faults=1','faults=2'),serial+'FIXTURE_PASS\n',serial+'MSG2_GATE:0\n',serial+'Kernel panic\n'])
    assert.throws(()=>checkSerial(bad));
});
