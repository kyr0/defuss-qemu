import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {validateExecutionPolicy,makeExecutionPolicy,validatePolicyShape} from './execution-policy.mjs';
import {validatePlan} from './campaign.mjs';
import {endpointSummary} from './analyze.mjs';
import {endpointSummary as originalSummary} from '../passive-fifo-finite-v1/analyze.mjs';
const root=resolve(new URL('../../..',import.meta.url).pathname),sha=b=>createHash('sha256').update(b).digest('hex');
assert.ok(process.env.DEADLINE_V2_TEST_FIXTURE?.startsWith(root+'/tmp/'),'Synthetic fixture path must be retained under project tmp');
const fixture=JSON.parse(await readFile(process.env.DEADLINE_V2_TEST_FIXTURE));
const records=await Promise.all(fixture.results.map(async x=>({...x,record:JSON.parse(await readFile(resolve(root,x.plan)))})));
test('both bounded operational deadlines retain exact fixed work and original inputs',async()=>{
 for(const x of records){validatePlan(x.record);await validateExecutionPolicy(x.record,root,{planPath:x.plan,campaignPath:x.campaign});const made=await makeExecutionPolicy(root,x.amendment,x.record.executionPolicy.repetition,x.timeoutMs,x.plan);assert.deepEqual(made.policy,x.record.executionPolicy);assert.equal(x.record.steps.length,8);assert.ok(x.record.steps.every(s=>s.timeoutMs===x.timeoutMs));}
});
test('policy does not authorize original failed set, undeclared paths or confirmation',async()=>{
 const plan=records[1].record;
 await assert.rejects(()=>validateExecutionPolicy(plan,root,{campaignPath:'artifacts/passive-fifo-finite-exploration-01'}));
 await assert.rejects(()=>validateExecutionPolicy(plan,root,{planPath:'benchmarks/plans/passive-fifo-finite-exploration-02.json'}));
 for(const mutate of [p=>p.kind='confirmation',p=>p.pairs=8,p=>p.primaryUpperRatio=.96,p=>p.horizonRule.phases=32,p=>p.steps[0].timeoutMs=600000,p=>p.inputs.reverse()]){const p=structuredClone(plan);mutate(p);await assert.rejects(()=>validateExecutionPolicy(p,root));}
});
test('deadline bound, repetition and amendment decision remain typed and explicit',async()=>{
 for(const mutate of [p=>p.timeoutMs=1800001,p=>p.timeoutMs='1800000',p=>p.repetition=1,p=>p.hostGraceMs=0,p=>p.extra=true]){const p=structuredClone(records[1].record.executionPolicy);mutate(p);assert.throws(()=>validatePolicyShape(p));}
 const x=records[1],original=JSON.parse(await readFile(resolve(root,x.amendment)));
 for(const [i,mutate] of [a=>a.decision.explicitUserAnswer=true,a=>a.timeoutMs=600000,a=>a.createdUtc='2026-11-06T00:00:00Z',a=>a.retainedPlans[0].sha256='0'.repeat(64),a=>a.repetitions[0].number=1,a=>a.repetitions[0].campaign=a.preservedCampaign.path].entries()){
  const a=structuredClone(original);mutate(a);const path=resolve(fixture.scratch,'bad-amendment-'+i+'.json'),bytes=Buffer.from(JSON.stringify(a));await writeFile(path,bytes);const p=structuredClone(x.record),prior=p.executionPolicy.amendment.path;p.executionPolicy.amendment={path:relative(root,path),sha256:sha(bytes)};p.inputs=p.inputs.map(n=>n===prior?relative(root,path):n);await assert.rejects(()=>validateExecutionPolicy(p,root));
 }
});
test('frozen numerical endpoint primitive is unchanged for all nine families',()=>{
 const p={...records[0].record,kind:'confirmation'};const names=[p.primary,...p.secondary,'ready',...p.service],pairs=Array.from({length:8},(_,i)=>({control:Object.fromEntries(names.map(n=>[n,100])),candidate:Object.fromEntries(names.map(n=>[n,88+i]))}));
 for(const name of names)assert.deepEqual(endpointSummary(pairs,name,p),originalSummary(pairs,name,p));
});
