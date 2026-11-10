#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {hostConditionIdentity} from './host-condition.mjs';
import {planningRule,planConfirmation} from './planning.mjs';
import {protocol,parameters,orders,warmupOrders} from './protocol.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
export function pairedSteps(control,candidate,pairs){
 const steps=[];
 for(let pair=1;pair<=pairs;pair++)for(const enabled of pair%2?[false,true]:[true,false])steps.push({id:`pair-${String(pair).padStart(2,'0')}-${enabled?'on':'off'}`,pair,enabled,
  package:enabled?candidate:control,mode:'baseline',snapshot:'capture',samplePeriod:257,timeoutMs:600000});
 return steps;
}
export function comparePackages(control,candidate){
 for(const m of [control,candidate]){assert.equal(m.benchmark?.protocol,protocol);assert.equal(m.observation,undefined);}
 assert.deepEqual(control.experiment,{name:'sha256msg2-v1',enabled:false});assert.deepEqual(candidate.experiment,{name:'sha256msg2-v1',enabled:true});
 const spec=({experiment,compatibilitySha256,generation,...rest})=>rest;
 assert.deepEqual(spec(control),spec(candidate),'Only the configured lowering choice may differ');
 assert.notEqual(control.compatibilitySha256,candidate.compatibilitySha256,'Snapshot mode identity must differ');
}
async function main(){
 const {values}=parseArgs({options:{control:{type:'string'},candidate:{type:'string'},output:{type:'string'},kind:{type:'string'},selection:{type:'string'},input:{type:'string',multiple:true,default:[]}}});
 assert.ok(values.control&&values.candidate&&values.output&&['exploration','confirmation'].includes(values.kind));
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
  assert.equal(record.protocolAdequate,true);assert.equal(record.confirmationPlanning.feasible,true,'Required confirmation exceeds the declared feasible cap');
  pairs=record.confirmationPlanning.requiredPairs;assert.ok(Number.isInteger(pairs)&&pairs>=8&&pairs<=32&&pairs%2===0);
  assert.deepEqual(record.confirmationPlanning.rule,planningRule);
  selection={path:values.selection,sha256:sha(bytes),captureNonces:record.captureNonces,confirmationPlanning:record.confirmationPlanning};
 }else assert.equal(values.selection,undefined);
 const plan={schema:1,id:'m2-msg2-sustained-v2-'+values.kind,experiment:'sha256msg2-v1',kind:values.kind,createdUtc:new Date().toISOString(),
  packages,pairs,steps:pairedSteps(values.control,values.candidate,pairs),inputs:[...values.input,...(selection?[selection.path]:[])],selection,
  hypothesis:'Exact inline SHA256MSG2 arithmetic reduces unchanged Bun SHA256 elapsed time by at least 5%, while keeping the three other workload endpoints within 10% regression and meeting the declared startup, resource and service budgets.',
  protocol,parameters,orders,warmupOrders,hostCondition:await hostConditionIdentity(),planningRule,driftRatioLimit:1.10,
  unit:'Independent fresh capture pair; each VM endpoint is the median of all eight nested100-call measured batches;500 warmup calls per endpoint retained separately',
  primary:'sha256',secondary:['integer','json','http'],ratio:'candidate/control elapsed; below1 is faster',
  primaryUpperRatio:.95,secondaryUpperRatio:1.10,readyUpperRatio:1.10,memoryUpperRatio:1.10,
  service:['emptyGateP95','resultStopMaxMs'],serviceUpperRatio:1.50,
  runtimeArtifactByteRatio:1,generatedCodeByteRatio:1.10,
  resourceLimit:'Runtime artifact bytes must match exactly. Generated/resident code bytes and host peak memory are not exposed by this timing runtime; the generated-code budget remains unverified and product promotion is forbidden until separately measured.',
  confidence:.99,bootstrapDraws:50000,bootstrapSeed:20261107,
  secondaryFamily:'Bonferroni one-sided upper99.6667% bound for the three secondary endpoints',
  selectionRule:'Four-pair exploration selects only if the primary point ratio<0.95, all secondary point ratios<1.10 and every VM/endpoint late-four/early-four median ratio lies within[1/1.10,1.10]. The drift check is a whole-campaign veto, never an exclusion or retry rule. Exploration never establishes improvement.',
  confirmationRule:'Primary99% paired-bootstrap upper bound<0.95; all secondary upper bounds<1.10, ready upper99%<1.10, observed linear-memory ratio<=1.10, both service upper99.5% bounds<1.50. This is the measured-gate result only; generated-code, correctness/exposure/held-out gates still required before promotion.',
  sampling:'Four exploratory pairs, balanced AB/BA. Confirmation count follows the frozen planningRule from pilot paired-log variance, never a universal eight. All confirmation captures are fresh and exclude exploration; every completed observation stays in analysis.',
  timing:'Original operation source, inputs and results; separate sustained-v2 ACK gates with20 warmup batches and32 measured batches; host monotonic endpoints, raw empty gates retained without subtraction; capture readiness includes durable snapshot cost. Service proxies are each VM empty-gate nearest-rank95th percentile (20 gates) and maximum result-to-confirmed-stop tail (32 batches), not general worst-case interrupt or network latency.',
  limits:['No diagnostics, code inspection or helper instrumentation. Same runtime artifact; one-time lowering selection bound to package compatibility identity.',
   'No native-parity claim; no full product promotion or JIT convergence claim from this campaign alone. Prior v1 failed selection remains unchanged.']};
 await writeFile(values.output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'passed',output:values.output,pairs,steps:plan.steps.length}));
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)await main();
