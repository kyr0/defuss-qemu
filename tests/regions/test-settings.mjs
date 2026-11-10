import test from 'node:test';
import assert from 'node:assert/strict';
import {configureRegionFixture,fixtureSettings,validateFixturePool} from './guest.mjs';

function moduleWithCalls(){
 const calls=[];
 return {calls,_defuss_m3_abi:()=>1,
  _defuss_m3_configure:value=>{calls.push(['region',value]);return 0;},
  _defuss_set_hot_limit:value=>calls.push(['hotness',value]),
  _defuss46_settings:value=>calls.push(['flags',value])};
}
test('both modes use fixed pre-start settings and cannot be configured again',()=>{
 for(const enabled of [false,true]){
  const mod=moduleWithCalls(),record=configureRegionFixture(mod,enabled);
  assert.deepEqual(mod.calls,[['region',Number(enabled)],['hotness',1500],['flags',2]]);
  assert.equal(record.phase,'preRun-before-vCPU');assert.equal(record.enabled,enabled);
  assert.equal(record.instanceLimit,12000);assert.match(record.evidence,/not a native readback/);
  assert.throws(()=>configureRegionFixture(mod,enabled),/already applied/);
  assert.equal(mod.calls.length,3);assert.equal(Object.isFrozen(fixtureSettings),true);
 }
});
test('missing settings API or rejected region configuration prevents hotness writes',()=>{
 const missing=moduleWithCalls();delete missing._defuss46_settings;
 assert.throws(()=>configureRegionFixture(missing,true),/APIs unavailable/);assert.deepEqual(missing.calls,[]);
 const rejected=moduleWithCalls();rejected._defuss_m3_configure=()=>-1;
 assert.throws(()=>configureRegionFixture(rejected,true),/configuration rejected/);assert.deepEqual(rejected.calls,[]);
});
test('pool validation retains the unchanged cap and permits bounded charged retirement',()=>{
 for(const charged of [0,6000,12000])assert.equal(validateFixturePool({charged,limit:12000}).charged,charged);
 for(const pool of [null,{charged:0,limit:24000},{charged:12001,limit:12000},{charged:-1,limit:12000},{charged:1.5,limit:12000}])
  assert.throws(()=>validateFixturePool(pool),/accounting or cap/);
});
