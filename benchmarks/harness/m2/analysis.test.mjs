import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairedSteps,comparePackages} from './plan.mjs';
import {median,interval,endpointSummary} from './analyze.mjs';
import {validatePlan} from './campaign.mjs';
test('paired order alternates and every capture owns an independent step',()=>{
 const steps=pairedSteps('control','candidate',8);assert.equal(steps.length,16);
 assert.deepEqual(steps.slice(0,4).map(s=>s.enabled),[false,true,true,false]);
 assert.equal(new Set(steps.map(s=>s.id)).size,16);assert.ok(steps.every(s=>s.snapshot==='capture'&&s.mode==='baseline'));
});
test('configuration is the only package difference and changes snapshot identity',()=>{
 const a={artifacts:{a:{sha256:'same'}},experiment:{name:'sha256msg2-v1',enabled:false},compatibilitySha256:'off',generation:'off'};
 const b={...structuredClone(a),experiment:{name:'sha256msg2-v1',enabled:true},compatibilitySha256:'on',generation:'on'};
 assert.doesNotThrow(()=>comparePackages(a,b));
 const changed=structuredClone(b);changed.artifacts.a.sha256='changed';assert.throws(()=>comparePackages(a,changed));
 assert.throws(()=>comparePackages(a,{...b,compatibilitySha256:'off'}));
});
test('M2 rejects enabled instrumentation and code inspection',()=>{
 const p={schema:1,id:'test',experiment:'sha256msg2-v1',kind:'screen',steps:pairedSteps('a','b',1)};
 assert.doesNotThrow(()=>validatePlan(p));
 const q=structuredClone(p);q.steps[0].mode='profile-on';assert.throws(()=>validatePlan(q));
 q.steps[0].mode='baseline';q.steps[0].captureCode=true;assert.throws(()=>validatePlan(q));
});
test('whole-pair ratio is based on one median per VM',()=>{
 assert.equal(median([1000,10,11]),11);
 const plan={kind:'screen',primary:'sha256'};
 const r=endpointSummary([{control:{sha256:10},candidate:{sha256:5}},{control:{sha256:20},candidate:{sha256:10}}],'sha256',plan);
 assert.equal(r.ratios.length,2);assert.equal(r.geometricMean,.5);assert.equal(r.interval,undefined);
});
test('bootstrap retains all ratios and is deterministic at the paired unit',()=>{
 const result=interval([.5,.5,.5,.5],{draws:1000});assert.equal(result.lower,.5);assert.equal(result.upper,.5);
 const a=interval([.7,.8,.9,1.5],{draws:1000,seed:123});
 assert.deepEqual(a,interval([.7,.8,.9,1.5],{draws:1000,seed:123}));assert.ok(a.upper>1);
 assert.throws(()=>interval([.5]));assert.throws(()=>interval([.5,NaN]));
});
