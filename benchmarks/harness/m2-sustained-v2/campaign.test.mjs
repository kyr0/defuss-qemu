import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {runCampaign,validatePlan} from './campaign.mjs';
import {pairedSteps} from './plan.mjs';
import {protocol,parameters,orders,warmupOrders} from './protocol.mjs';
import {planningRule} from './planning.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
const plan=()=>({schema:1,id:'sustained-test',experiment:'sha256msg2-v1',kind:'exploration',protocol,parameters,orders,warmupOrders,planningRule,
 primaryUpperRatio:.95,secondaryUpperRatio:1.1,readyUpperRatio:1.1,memoryUpperRatio:1.1,serviceUpperRatio:1.5,driftRatioLimit:1.1,
 primary:'sha256',secondary:['integer','json','http'],service:['emptyGateP95','resultStopMaxMs'],bootstrapDraws:50000,bootstrapSeed:20261107,confidence:.99,
 pairs:4,hostCondition:{expected:{name:'builder',status:'Stopped',memory:12884901888}},steps:pairedSteps('package','package',4),inputs:['source.mjs']});
test('sustained plan requires fixed four-pair alternating exploration and fresh captures',()=>{
 assert.doesNotThrow(()=>validatePlan(plan()));
 for(const mutate of [p=>p.protocol='defuss-m1-v1',p=>p.steps[0].enabled=true,p=>p.steps[0].pair=2,p=>p.steps[0].snapshot='restore',p=>p.pairs=3,p=>p.steps[0].captureCode=true,p=>p.steps[0].mode='profile-on']){
  const p=plan();mutate(p);assert.throws(()=>validatePlan(p));
 }
});
async function fixture(t){
 const scratch=resolve(new URL('../../../tmp',import.meta.url).pathname);await mkdir(scratch,{recursive:true});
 const root=await mkdtemp(resolve(scratch,'sv2-campaign-'));
 await mkdir(resolve(root,'package'));await writeFile(resolve(root,'package/app.json'),'{}');await writeFile(resolve(root,'source.mjs'),'original');
 await writeFile(resolve(root,'plan.json'),JSON.stringify(plan()));const launches=[];
 const options={root,planPath:'plan.json',output:'artifacts/campaign',sourcePaths:[],getEnvironment:async()=>({test:true}),onProgress:()=>{},
  validate:async({reportPath,step})=>{const bytes=await readFile(reportPath),r=JSON.parse(bytes);assert.equal(r.status,'passed');assert.equal(r.step,step.id);return {reportSha256:sha(bytes)};},
  runChild:async(command,{attempt})=>{const request=JSON.parse(await readFile(resolve(attempt,'request.json')));assert.deepEqual(request.command,command);assert.ok(command.includes('--plan'));launches.push(attempt);
   await mkdir(resolve(attempt,'run'));await writeFile(resolve(attempt,'run/report.json'),JSON.stringify({status:'passed',step:request.stepId}));return {code:0,signal:null,error:null};}};
 return {root,options,launches};
}
test('eight serial fresh captures resume without adding observations',async t=>{
 const f=await fixture(t);await runCampaign(f.options);assert.equal(f.launches.length,8);
 await runCampaign(f.options);assert.equal(f.launches.length,8);
 await writeFile(resolve(f.root,'source.mjs'),'changed');await assert.rejects(()=>runCampaign(f.options),/Frozen inputs/);assert.equal(f.launches.length,8);
});
test('pre-execution/child failure remains retained when a fresh attempt resumes',async t=>{
 const f=await fixture(t);let failed;
 await assert.rejects(()=>runCampaign({...f.options,runChild:async(_,{attempt})=>{failed=attempt;await writeFile(resolve(attempt,'host-failure.txt'),'compiler running');return {code:1};}}),/Child failed/);
 await runCampaign(f.options);assert.equal(f.launches.length,8);assert.ok(!f.launches.includes(failed));assert.equal(await readFile(resolve(failed,'host-failure.txt'),'utf8'),'compiler running');
});
test('completed observation with invalid host condition permanently halts without replacement',async t=>{
 const f=await fixture(t);let calls=0;
 await assert.rejects(()=>runCampaign({...f.options,runChild:async(_,{attempt})=>{calls++;await mkdir(resolve(attempt,'run'));await writeFile(resolve(attempt,'run/report.json'),JSON.stringify({status:'failed',browserResult:{status:'passed'},nonRetryableCompletedObservation:true}));return {code:1};}}),/halted without replacement/);
 assert.equal(calls,1);await assert.rejects(()=>runCampaign(f.options),/replacement is forbidden/);assert.equal(f.launches.length,0);
 assert.ok(JSON.parse(await readFile(resolve(f.root,'artifacts/campaign/invalid-completed-observation.json'))).reportSha256);
});
test('completed guest with a zero exit but invalid evidence cannot be replaced',async t=>{
 const f=await fixture(t);
 await assert.rejects(()=>runCampaign({...f.options,runChild:async(_,{attempt})=>{await mkdir(resolve(attempt,'run'));await writeFile(resolve(attempt,'run/report.json'),JSON.stringify({status:'passed',step:'wrong',browserResult:{status:'passed'}}));return {code:0};}}),/halted without replacement/);
 await assert.rejects(()=>runCampaign(f.options),/replacement is forbidden/);assert.equal(f.launches.length,0);
});
