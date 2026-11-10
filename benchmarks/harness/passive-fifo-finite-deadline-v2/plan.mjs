import {makeExecutionPolicy,validateExecutionPolicy,orchestration,executionPolicyRule} from './execution-policy.mjs';
import {horizonRule,bootstrapRule} from '../passive-fifo-finite-v1/horizon.mjs';
import assert from 'node:assert/strict';
import {readFile,open} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {hostConditionIdentity} from '../m2-sustained-v2/host-condition.mjs';
import {planningRule,planConfirmation} from '../passive-fifo-finite-v1/planning.mjs';
import {protocol,guestProtocol,parameters,orders,warmupOrders} from '../passive-fifo-finite-v1/protocol.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
export function pairedSteps(control,candidate,pairs,timeoutMs){
 const steps=[];
 for(let pair=1;pair<=pairs;pair++)for(const enabled of pair%2?[false,true]:[true,false])steps.push({id:`pair-${String(pair).padStart(2,'0')}-${enabled?'on':'off'}`,pair,enabled,
  package:enabled?candidate:control,mode:'baseline',snapshot:'capture',samplePeriod:257,timeoutMs});
 return steps;
}
export function comparePackages(control,candidate){
 for(const m of [control,candidate]){assert.equal(m.benchmark?.protocol,guestProtocol);assert.equal(m.observation,undefined);assert.equal(m.benchmark?.measurementProtocol,protocol);}
 assert.deepEqual(control.experiment,{name:'passive-fifo-v1',enabled:false});assert.deepEqual(candidate.experiment,{name:'passive-fifo-v1',enabled:true});
 const spec=({experiment,compatibilitySha256,generation,...rest})=>rest;
 assert.deepEqual(spec(control),spec(candidate),'Only the configured FIFO choice may differ');
 assert.notEqual(control.compatibilitySha256,candidate.compatibilitySha256,'Snapshot mode identity must differ');
}
export async function validateSelection(plan,root){
 if(plan.kind==='exploration'){assert.equal(plan.selection,null);return;}
 const selected=plan.selection;assert.ok(selected&&plan.inputs.includes(selected.path));
 const path=resolve(root,selected.path);assert.ok(path.startsWith(resolve(root)+'/'));
 const bytes=await readFile(path),record=JSON.parse(bytes);assert.equal(sha(bytes),selected.sha256);
 assert.equal(record.status,'passed');assert.equal(record.kind,'exploration');assert.equal(record.protocol,protocol);assert.equal(record.selected,true);
 for(const field of ['protocol','guestProtocol','horizonRule','bootstrapRule','parameters','orders','warmupOrders','planningRule','primary','secondary','service','primaryUpperRatio','secondaryUpperRatio','readyUpperRatio','serviceUpperRatio','memoryUpperRatio','bootstrapDraws','bootstrapSeed'])assert.deepEqual(record.plan[field],plan[field],'Selection design differs: '+field);
 assert.equal(record.plan.pairs,4);assert.equal(record.captureNonces.length,8);assert.equal(new Set(record.captureNonces).size,8);
 assert.deepEqual(selected.captureNonces,record.captureNonces);
 assert.deepEqual(record.confirmationPlanning,planConfirmation(record.endpoints,record.plan));
 assert.deepEqual(selected.confirmationPlanning,record.confirmationPlanning);assert.equal(record.confirmationPlanning.feasible,true);
 assert.equal(plan.pairs,record.confirmationPlanning.requiredPairs);
 for(const side of ['control','candidate'])assert.equal(record.packages[side].manifestSha256,plan.packages[side].manifestSha256);
}
async function main(){
 const {values}=parseArgs({options:{control:{type:'string'},candidate:{type:'string'},output:{type:'string'},kind:{type:'string'},selection:{type:'string'},amendment:{type:'string'},repetition:{type:'string'},timeout:{type:'string'},input:{type:'string',multiple:true,default:[]}}});
 assert.ok(values.control&&values.candidate&&values.output&&['exploration','confirmation'].includes(values.kind));
 assert.equal(values.kind,'exploration','Deadline amendment permits only future exploratory repetitions');assert.ok(values.amendment&&values.repetition&&values.timeout);
 const execution=await makeExecutionPolicy(resolve('.'),values.amendment,Number(values.repetition),Number(values.timeout),values.output);
 const packages={};for(const [name,path] of [['control',values.control],['candidate',values.candidate]]){
  const bytes=await readFile(resolve(path,'app.json')),manifest=JSON.parse(bytes);await validateManifest(manifest);packages[name]={path,manifest,manifestSha256:sha(bytes)};
 }
 comparePackages(packages.control.manifest,packages.candidate.manifest);
 let selection=null,pairs=4;
 if(values.kind==='confirmation'){
  assert.ok(values.selection,'Confirmation requires a successful separate screen selection');const bytes=await readFile(values.selection),record=JSON.parse(bytes);
  assert.equal(record.kind,'exploration');assert.equal(record.status,'passed');assert.equal(record.selected,true,'Exploration did not select this candidate');
  assert.equal(record.protocol,protocol);
  assert.deepEqual(record.confirmationPlanning,planConfirmation(record.endpoints,record.plan),'Pilot variance calculation differs');
  for(const side of ['control','candidate'])assert.equal(record.packages[side].manifestSha256,packages[side].manifestSha256,'Selection package differs');
  assert.equal(record.confirmationPlanning.feasible,true,'Required confirmation exceeds the declared feasible cap');
  pairs=record.confirmationPlanning.requiredPairs;assert.ok(Number.isInteger(pairs)&&pairs>=8&&pairs<=32&&pairs%2===0);
  assert.deepEqual(record.confirmationPlanning.rule,planningRule);
  selection={path:values.selection,sha256:sha(bytes),captureNonces:record.captureNonces,confirmationPlanning:record.confirmationPlanning};
 }else assert.equal(values.selection,undefined);
 const plan={schema:1,id:orchestration+'-repeat-'+execution.policy.repetition,experiment:'passive-fifo-v1',kind:values.kind,createdUtc:new Date().toISOString(),
  packages,pairs,steps:pairedSteps(values.control,values.candidate,pairs,execution.policy.timeoutMs),inputs:[...new Set([...values.input,...execution.references,...(selection?[selection.path]:[])])],selection,orchestration,executionPolicyRule,executionPolicy:execution.policy,
  hypothesis:'Passive FIFO retirement reduces the full fixed-workload horizon by at least5%, with all52-phase sum and four workload totals within10%, and unchanged resource/startup/service margins.',
  protocol,guestProtocol,horizonRule,bootstrapRule,parameters,orders,warmupOrders,hostCondition:await hostConditionIdentity(),planningRule,driftRatioLimit:1.10,
  unit:'Independent fresh capture pair; full horizon plus totals of all52 nested100-call batches, including nominal warmup',
  primary:'fullHorizon',secondary:['phaseSum','integer','json','sha256','http'],ratio:'candidate/control elapsed; below1 is faster',
  primaryUpperRatio:.95,secondaryUpperRatio:1.10,readyUpperRatio:1.10,memoryUpperRatio:1.10,
  service:['emptyGateP95','resultStopMaxMs'],serviceUpperRatio:1.50,
  runtimeArtifactByteRatio:1,generatedCodeByteRatio:1.10,
  resourceLimit:'Runtime artifact bytes must match exactly. Generated/resident code bytes and host peak memory are not exposed by this timing runtime; the generated-code budget remains unverified and product promotion is forbidden until separately measured.',
  confidence:.99,bootstrapDraws:50000,bootstrapSeed:20261107,
  secondaryFamily:'Bonferroni one-sided99.8% bounds for five secondary guards (family99%)',
  selectionRule:'Four fresh pairs select only if fullHorizon point ratio<0.95, all five secondary and readiness point ratios<1.10, both service point ratios<1.50 and each observed-memory ratio<=1.10. Drift is descriptive only. Separate correctness/exposure/resource evidence remains required.',
  confirmationRule:'Primary two-sided99% upper<0.95; five secondary one-sided99.8% uppers<1.10; ready one-sided99%<1.10; both service one-sided99.5% uppers<1.50; every observed-memory ratio<=1.10. Product promotion remains forbidden by unmeasured gates.',
  sampling:'Four independent fresh pilot pairs AB/BA/AB/BA. Pilot-derived next-even confirmation count, minimum8 and fixed cap32; wholly fresh confirmation only. No post-start or unknown-start observation can be replaced.',
  timing:'H includes startup and all20 prelude+32 subsequent phases, calibration/ACK/stopped-read gaps. No subtraction. Service stop-tail maximum covers all52 phases. Original guest source and bundle unchanged.',
  limits:['No diagnostics, code inspection or helper instrumentation. Same runtime artifact; one-time FIFO selection bound to package compatibility identity.',
   'No native-parity claim; no full product promotion or JIT convergence claim from this campaign alone. No MSG2 observations are reused or relabeled.']};
 await validateExecutionPolicy(plan,resolve('.'),{planPath:values.output});
 const handle=await open(values.output,'wx');try{await handle.writeFile(JSON.stringify(plan,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 const parent=await open(dirname(resolve(values.output)),'r');try{await parent.sync();}finally{await parent.close();}
 console.log(JSON.stringify({status:'passed',output:values.output,pairs,steps:plan.steps.length}));
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)await main();
