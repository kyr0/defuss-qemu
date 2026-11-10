import test from 'node:test';
import assert from 'node:assert/strict';
import {checkExposure} from './fixture-check.mjs';

test('fixture exposure distinguishes interpreter, compiled inline and compiled fallback',()=>{
  assert.equal(checkExposure(['1500','2596','0'],{enabled:true,cold:false}),true);
  assert.equal(checkExposure(['4096','0','2596'],{enabled:false,cold:false}),true);
  assert.equal(checkExposure(['4096','0','0'],{enabled:true,cold:true}),true);
  assert.equal(checkExposure(['4096','0','0'],{enabled:false,cold:true}),true);
});
test('missing compiled path, unexpected mode, reset/wrap and double counting cannot pass',()=>{
  assert.throws(()=>checkExposure(['4096','0','0'],{enabled:true,cold:false}),/No compiled/);
  assert.throws(()=>checkExposure(['4096','0','0'],{enabled:false,cold:false}),/No compiled/);
  assert.throws(()=>checkExposure(['4096','1','0'],{enabled:true,cold:true}),/Cold/);
  assert.throws(()=>checkExposure(['4096','1','0'],{enabled:false,cold:false}),/Disabled/);
  assert.throws(()=>checkExposure(['4096','2','1'],{enabled:true,cold:false}),/fell back/);
  assert.throws(()=>checkExposure(['2','4094','3'],{enabled:true,cold:false}),/subset/);
  assert.throws(()=>checkExposure(['2048','0','2048'],{enabled:false,cold:false}),/Missing/);
  assert.throws(()=>checkExposure(['-1','4096','0'],{enabled:true,cold:false}),/reset\/wrap/);
  assert.throws(()=>checkExposure(['18446744073709551616','1','0'],{enabled:true,cold:false}));
});
