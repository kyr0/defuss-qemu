// Prospective orchestration only. Frozen finite-v1 measurement code is unchanged.
import assert from 'node:assert/strict';
import {readFile,lstat} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
export const orchestration='passive-fifo-finite-deadline-v2';
export const executionPolicyRule=Object.freeze({revision:orchestration,allowedTimeoutMs:[600000,1800000],hostGraceMs:20000,
 scope:'Only requested future exploratory repetitions02/03. Same finite-v1 measurement; failed set01 remains permanently invalid. No confirmation or causal load claim.'});
const sha=b=>createHash('sha256').update(b).digest('hex');
const inside=(root,name)=>{assert.equal(typeof name,'string');const path=resolve(root,name);assert.ok(path.startsWith(root+'/'),'Policy input outside project');return path;};
async function boundJSON(root,item){assert.match(item.sha256,/^[a-f0-9]{64}$/);const bytes=await readFile(inside(root,item.path));assert.equal(sha(bytes),item.sha256,'Policy reference changed: '+item.path);return JSON.parse(bytes);}
export function validatePolicyShape(policy){
 assert.equal(policy.schema,1);assert.equal(policy.revision,orchestration);assert.ok(executionPolicyRule.allowedTimeoutMs.includes(policy.timeoutMs));assert.equal(policy.hostGraceMs,20000);
 assert.ok([2,3].includes(policy.repetition));assert.equal(typeof policy.planPath,'string');assert.match(policy.amendment.sha256,/^[a-f0-9]{64}$/);assert.equal(typeof policy.amendment.path,'string');
 assert.deepEqual(Object.keys(policy).sort(),['schema','revision','timeoutMs','hostGraceMs','repetition','planPath','amendment'].sort());
 return policy;
}
export async function readAmendment(root,amendment){
 const a=await boundJSON(root,amendment);assert.equal(a.schema,1);assert.equal(a.kind,'passive-fifo-finite-deadline-amendment');assert.equal(a.status,'prospective-declared');assert.ok(['explicit-user-answer','assistant-default-after-unanswered-optional-clarification'].includes(a.decision.source));assert.equal(a.decision.explicitUserAnswer,a.decision.source==='explicit-user-answer');assert.equal(a.decision.timeoutMs,a.timeoutMs);
 assert.equal(a.protocol,'defuss-passive-fifo-finite-v1');assert.ok(executionPolicyRule.allowedTimeoutMs.includes(a.timeoutMs));assert.equal(a.hostGraceMs,20000);assert.equal(a.reporting,'all-retained-descriptive-only');assert.ok(Number.isFinite(Date.parse(a.createdUtc)));
 const original=await boundJSON(root,a.originalPlan),declaration=await boundJSON(root,a.repetitionsDeclaration);
 assert.equal(original.kind,'exploration');assert.equal(original.protocol,a.protocol);assert.equal(original.pairs,4);assert.ok(original.steps.every(s=>s.timeoutMs===600000));
 assert.deepEqual(declaration.originalPlan,a.originalPlan);assert.equal(declaration.protocol,a.protocol);assert.deepEqual(declaration.repetitions.map(r=>r.number),[1,2,3]);
 const preserved=a.preservedCampaign;assert.equal(preserved.path,declaration.repetitions[0].campaign);
 const frozen=await boundJSON(root,{path:preserved.path+'/frozen.json',sha256:preserved.frozenSha256}),halt=await boundJSON(root,{path:preserved.path+'/invalid-completed-observation.json',sha256:preserved.haltSha256});
 assert.equal(frozen.planSha256,a.originalPlan.sha256);assert.deepEqual(frozen.plan,original);assert.ok(halt.attempt.startsWith(preserved.path+'/attempts/'));assert.equal(halt.schema,1);assert.ok(halt.reason.includes('permanently invalid'));
 assert.ok(Date.parse(a.createdUtc)>=Math.max(Date.parse(original.createdUtc),Date.parse(declaration.createdUtc),Date.parse(halt.utc)),'Amendment cannot predate preserved evidence');
 assert.deepEqual(a.repetitions.map(r=>r.number),[2,3]);assert.deepEqual(a.retainedPlans.map(r=>r.number),[2,3]);
 const newPaths=a.repetitions.flatMap(r=>['plan','campaign','analysis','review'].map(k=>r[k]));assert.equal(new Set(newPaths).size,8);
 const oldPaths=new Set(declaration.repetitions.flatMap(r=>['plan','campaign','analysis','review'].map(k=>r[k])));for(const path of newPaths){assert.equal(relative(root,inside(root,path)),path,'Canonical project-relative output required');assert.ok(!oldPaths.has(path),'New namespace must preserve every old output path');}
 for(const old of declaration.repetitions.filter(r=>r.number!==1))await assert.rejects(lstat(inside(root,old.campaign)),error=>error.code==='ENOENT','An old future campaign already exists; extra replacement is forbidden');
 for(const ref of a.retainedPlans){assert.equal(ref.path,declaration.repetitions.find(r=>r.number===ref.number).plan);const retained=await boundJSON(root,ref);assert.equal(retained.kind,'exploration');assert.equal(retained.pairs,4);assert.deepEqual(retained.packages,original.packages);assert.ok(retained.steps.every(s=>s.timeoutMs===600000));}
 const references=[amendment.path,a.originalPlan.path,a.repetitionsDeclaration.path,preserved.path+'/frozen.json',preserved.path+'/invalid-completed-observation.json',...a.retainedPlans.map(r=>r.path)];
 return {amendment:a,original,declaration,references};
}
export async function makeExecutionPolicy(root,amendmentPath,repetition,timeoutMs,planPath){
 const bytes=await readFile(inside(root,amendmentPath)),amendment={path:relative(root,inside(root,amendmentPath)),sha256:sha(bytes)};
 const loaded=await readAmendment(root,amendment),a=loaded.amendment;
 assert.equal(timeoutMs,a.timeoutMs);assert.ok([2,3].includes(repetition));const planned=loaded.amendment.repetitions.find(r=>r.number===repetition);
 assert.equal(relative(root,inside(root,planPath)),planned.plan,'Only the declared fresh repetition plan path is permitted');
 return {policy:validatePolicyShape({schema:1,revision:orchestration,timeoutMs,hostGraceMs:20000,repetition,planPath:planned.plan,amendment}),references:loaded.references};
}
export async function validateExecutionPolicy(plan,root,{planPath,campaignPath}={}){
 assert.equal(plan.orchestration,orchestration);assert.deepEqual(plan.executionPolicyRule,executionPolicyRule);assert.equal(plan.kind,'exploration','This amendment cannot authorize confirmation');assert.equal(plan.pairs,4);
 const policy=validatePolicyShape(plan.executionPolicy),loaded=await readAmendment(root,policy.amendment);assert.equal(policy.timeoutMs,loaded.amendment.timeoutMs);assert.equal(policy.planPath,loaded.amendment.repetitions.find(r=>r.number===policy.repetition).plan);
 if(planPath)assert.equal(relative(root,inside(root,planPath)),policy.planPath,'Wrong repetition plan invocation');
 if(campaignPath)assert.equal(relative(root,inside(root,campaignPath)),loaded.amendment.repetitions.find(r=>r.number===policy.repetition).campaign,'Only the declared fresh repetition campaign is permitted');
 for(const path of loaded.references)assert.ok(plan.inputs.includes(path),'Missing exact amendment reference in plan.inputs: '+path);
 assert.ok(Date.parse(loaded.amendment.createdUtc)<=Date.parse(plan.createdUtc),'Amendment must predate plan');
 // Root may add source/reviewer freezes, but may not omit or reorder original inputs.
 assert.deepEqual(plan.inputs.slice(0,loaded.original.inputs.length),loaded.original.inputs,'Original50 inputs changed');
 for(const name of ['packages','protocol','guestProtocol','horizonRule','bootstrapRule','parameters','orders','warmupOrders','planningRule','primary','secondary','service','primaryUpperRatio','secondaryUpperRatio','readyUpperRatio','memoryUpperRatio','serviceUpperRatio','driftRatioLimit','runtimeArtifactByteRatio','generatedCodeByteRatio','confidence','bootstrapDraws','bootstrapSeed','hostCondition'])assert.deepEqual(plan[name],loaded.original[name],'Changed measurement design: '+name);
 assert.deepEqual(plan.steps,loaded.original.steps.map(step=>({...step,timeoutMs:policy.timeoutMs})),'Only the operational deadline may change fixed steps');
 return loaded;
}
