import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessDrift,planConfirmation,planningRule} from './planning.mjs';
import {validateHostStatus} from '../m2-sustained-v2/host-condition.mjs';
import {requireTimingObservation} from './report.mjs';
const parameters={primary:'fullHorizon',secondary:['phaseSum','integer','json','sha256','http'],service:['emptyGateP95','resultStopMaxMs'],primaryUpperRatio:.95,secondaryUpperRatio:1.1,readyUpperRatio:1.1,serviceUpperRatio:1.5};
const endpoints=ratios=>Object.fromEntries(['fullHorizon','phaseSum','sha256','integer','json','http','ready','emptyGateP95','resultStopMaxMs'].map(name=>[name,{ratios}]));
test('drift is descriptive and retains every early/late sample',()=>{
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

test('five-guard planning uses one-sided .998 quantile',()=>{const r=planConfirmation(endpoints([.9,.91,.89,.9]),parameters);for(const name of parameters.secondary)assert.equal(r.endpoints[name].zBound,2.878161739095483);});

test('paired confidence families use the declared alpha and identical resample indices',async()=>{
 const {endpointSummary,interval}=await import('./analyze.mjs');
 const plan={...parameters,kind:'confirmation',bootstrapDraws:50000,bootstrapSeed:20261107};
 const units=Array.from({length:8},(_,i)=>({control:Object.fromEntries(Object.keys(endpoints([1,1,1,1])).map(n=>[n,100])),candidate:Object.fromEntries(Object.keys(endpoints([1,1,1,1])).map(n=>[n,85+i]))}));
 for(const [name,alpha] of [['fullHorizon',.01],['phaseSum',.002],['ready',.01],['emptyGateP95',.005]])assert.equal(endpointSummary(units,name,plan).interval.alpha,alpha);
 const ratios=units.map(u=>u.candidate.fullHorizon/100),a=interval(ratios),b=interval(ratios.map(x=>x*2));assert.ok(Math.abs(b.upper/a.upper-2)<1e-12);assert.deepEqual(a,interval(ratios));
});
test('runtime artifact reporting retains absolute production deltas without claiming resident bytes',async()=>{const {runtimeArtifactComparison}=await import('./analyze.mjs');const manifest={artifacts:{'runtime/qemu-system-x86_64.js':{bytes:110,sha256:'new-js'},'runtime/qemu-system-x86_64.wasm':{bytes:220,sha256:'new-wasm'}}},baseline={runtimes:{x86_64:{files:{'runtime/x86_64/qemu-system-x86_64.js':{bytes:100,sha256:'old-js'},'runtime/x86_64/qemu-system-x86_64.wasm':{bytes:200,sha256:'old-wasm'}}}}};const r=runtimeArtifactComparison(manifest,baseline);assert.equal(r['qemu-system-x86_64.js'].deltaBytes,10);assert.equal(r['qemu-system-x86_64.wasm'].ratio,1.1);});
