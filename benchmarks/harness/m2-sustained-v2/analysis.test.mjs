import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessDrift,planConfirmation,planningRule} from './planning.mjs';
import {validateHostStatus} from './host-condition.mjs';
import {requireTimingObservation} from './report.mjs';
const parameters={primary:'sha256',secondary:['integer','json','http'],service:['emptyGateP95','resultStopMaxMs'],primaryUpperRatio:.95,secondaryUpperRatio:1.1,readyUpperRatio:1.1,serviceUpperRatio:1.5};
const endpoints=ratios=>Object.fromEntries(['sha256','integer','json','http','ready','emptyGateP95','resultStopMaxMs'].map(name=>[name,{ratios}]));
test('drift is a whole-VM diagnostic and retains early and late samples',()=>{
 const rows=Array.from({length:8},(_,sample)=>({sample,hostMs:100}));assert.equal(assessDrift(rows).withinBound,true);
 const drifting=rows.map((row,i)=>({...row,hostMs:i<4?200:100}));const result=assessDrift(drifting);assert.equal(result.lateEarlyRatio,.5);assert.equal(result.withinBound,false);assert.equal(drifting.length,8);
 assert.throws(()=>assessDrift(rows.slice(1)));assert.throws(()=>assessDrift([...rows].reverse()));
});
test('confirmation planning uses four paired logs, conservative SD bound and a hard cap',()=>{
 const stable=planConfirmation(endpoints([.9,.9,.9,.9]),parameters);assert.equal(stable.requiredPairs,8);assert.equal(stable.feasible,true);
 const moderate=planConfirmation(endpoints([-.03,0,.03,0].map(x=>.9*Math.exp(x))),parameters);assert.equal(moderate.requiredPairs,14);assert.equal(moderate.requiredPairs%2,0);
 const noisy=planConfirmation(endpoints([.5,.8,1.2,2]),parameters);assert.ok(noisy.requiredPairs>planningRule.maximumPairs);assert.equal(noisy.feasible,false);
 assert.throws(()=>planConfirmation(endpoints([.9,.9,.9]),parameters));
});
test('compiler host condition fails closed for Running, Broken and wrong VM identity',()=>{
 const config={expected:{name:'builder',status:'Stopped',memory:12884901888}},ok={...config.expected,errors:[]};assert.doesNotThrow(()=>validateHostStatus(ok,config));
 for(const mutate of [s=>s.status='Running',s=>s.status='Broken',s=>s.name='other',s=>s.memory=1,s=>s.errors=['unreadable']]){const s=structuredClone(ok);mutate(s);assert.throws(()=>validateHostStatus(s,config));}
});
test('sustained timing rejects resource observation and code capture',()=>{
 const clean={mode:'baseline',captureCode:false,manifest:{},browserResult:{captureCode:false,warmups:[],results:[]}};assert.doesNotThrow(()=>requireTimingObservation(clean));
 for(const mutate of [r=>r.observation='resource',r=>r.manifest.observation={},r=>r.browserResult.captureCode=true,r=>r.browserResult.warmups=[{codeCapture:{}}]]){const r=structuredClone(clean);mutate(r);assert.throws(()=>requireTimingObservation(r));}
});
