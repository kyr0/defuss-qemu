import test from 'node:test';
import assert from 'node:assert/strict';
import {difference,phaseCounters} from './counters.mjs';
test('32-bit cumulative rollover is handled; nested times remain separate',()=>{
  assert.deepEqual(difference({interpretUs:0xfffffff0,helperUs:7},{interpretUs:3,helperUs:11}),{interpretUs:19,helperUs:4});
});
test('MMU precision loss or unexpected reset cannot silently produce a delta',()=>{
  assert.throws(()=>difference({memory:{counters:{lookups:100}}},{memory:{counters:{lookups:99}}}),/precision\/reset/);
  assert.throws(()=>difference({memory:{counters:{lookups:100}}},{memory:{counters:{lookups:null}}}),/precision\/reset/);
  assert.deepEqual(difference({memory:{counters:{lookups:100}}},{memory:{counters:{lookups:104}}}),{memory:{lookups:4}});
});
test('retained baseline and diagnostic builds cannot be silently interchanged',()=>{
  const baseline=phaseCounters({module:{}},'baseline',{});baseline.begin();assert.equal(baseline.end(),null);baseline.close();
  assert.throws(()=>phaseCounters({module:{}},'profile-off',{}),/requires/);
  assert.throws(()=>phaseCounters({module:{_defuss_m1_abi:()=>1}},'baseline',{}),/Baseline/);
});
test('diagnostic-disabled control calls only disabled reset and never reads counters',()=>{
  const calls=[],mod={_defuss_m1_abi:()=>1,_defuss_m1_reset:(enabled,period)=>{calls.push([enabled,period]);return 0;}};
  const control=phaseCounters({module:mod},'profile-off',{},257);control.begin();assert.equal(control.end(),null);control.close();
  assert.deepEqual(calls,[[0,257],[0,257]]);
});
