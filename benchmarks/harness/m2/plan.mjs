#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
export function pairedSteps(control,candidate,pairs){
 const steps=[];
 for(let pair=1;pair<=pairs;pair++)for(const enabled of pair%2?[false,true]:[true,false])steps.push({id:`pair-${String(pair).padStart(2,'0')}-${enabled?'on':'off'}`,pair,enabled,
  package:enabled?candidate:control,mode:'baseline',snapshot:'capture',samplePeriod:257,timeoutMs:600000});
 return steps;
}
export function comparePackages(control,candidate){
 assert.deepEqual(control.experiment,{name:'sha256msg2-v1',enabled:false});assert.deepEqual(candidate.experiment,{name:'sha256msg2-v1',enabled:true});
 const spec=({experiment,compatibilitySha256,generation,...rest})=>rest;
 assert.deepEqual(spec(control),spec(candidate),'Only the configured lowering choice may differ');
 assert.notEqual(control.compatibilitySha256,candidate.compatibilitySha256,'Snapshot mode identity must differ');
}
async function main(){
 const {values}=parseArgs({options:{control:{type:'string'},candidate:{type:'string'},output:{type:'string'},kind:{type:'string'},selection:{type:'string'},input:{type:'string',multiple:true,default:[]}}});
 assert.ok(values.control&&values.candidate&&values.output&&['screen','confirmation'].includes(values.kind));
 const packages={};for(const [name,path] of [['control',values.control],['candidate',values.candidate]]){
  const bytes=await readFile(resolve(path,'app.json')),manifest=JSON.parse(bytes);await validateManifest(manifest);packages[name]={path,manifest,manifestSha256:sha(bytes)};
 }
 comparePackages(packages.control.manifest,packages.candidate.manifest);
 let selection=null;
 if(values.kind==='confirmation'){
  assert.ok(values.selection,'Confirmation requires a successful separate screen selection');const bytes=await readFile(values.selection),record=JSON.parse(bytes);
  assert.equal(record.kind,'screen');assert.equal(record.status,'passed');assert.equal(record.selected,true,'Screen did not select this candidate');
  for(const side of ['control','candidate'])assert.equal(record.packages[side].manifestSha256,packages[side].manifestSha256,'Selection package differs');
  selection={path:values.selection,sha256:sha(bytes),captureNonces:record.captureNonces};
 }else assert.equal(values.selection,undefined);
 const pairs=values.kind==='screen'?1:8;
 const plan={schema:1,id:'m2-msg2-'+values.kind,experiment:'sha256msg2-v1',kind:values.kind,createdUtc:new Date().toISOString(),
  packages,pairs,steps:pairedSteps(values.control,values.candidate,pairs),inputs:[...values.input,...(selection?[selection.path]:[])],selection,
  hypothesis:'Exact inline SHA256MSG2 arithmetic reduces unchanged Bun SHA256 elapsed time by at least 5%, while keeping the three other workload endpoints within 10% regression and meeting the declared startup, resource and service budgets.',
  protocol:'defuss-m1-v1',unit:'Independent fresh capture pair; each VM endpoint is the median of three nested100-call batches',
  primary:'sha256',secondary:['integer','json','http'],ratio:'candidate/control elapsed; below1 is faster',
  primaryUpperRatio:.95,secondaryUpperRatio:1.10,readyUpperRatio:1.10,memoryUpperRatio:1.10,
  service:['emptyGateP95','resultStopMaxMs'],serviceUpperRatio:1.50,
  runtimeArtifactByteRatio:1,generatedCodeByteRatio:1.10,
  resourceLimit:'Runtime artifact bytes must match exactly. Generated/resident code bytes and host peak memory are not exposed by this timing runtime; the generated-code budget remains unverified and product promotion is forbidden until separately measured.',
  confidence:.99,bootstrapDraws:50000,bootstrapSeed:20261107,
  secondaryFamily:'Bonferroni one-sided upper99.6667% bound for the three secondary endpoints',
  selectionRule:'Screen selects only if primary point ratio<0.95 and each secondary point ratio<1.10. Screen never establishes improvement.',
  confirmationRule:'Primary99% paired-bootstrap upper bound<0.95; all secondary upper bounds<1.10, ready upper99%<1.10, observed linear-memory ratio<=1.10, both service upper99.5% bounds<1.50. This is the measured-gate result only; generated-code, correctness/exposure/held-out gates still required before promotion.',
  sampling:'Eight fresh pairs are a predeclared practical count, not a power guarantee. Never pool screen or failure evidence; retain every completed slow observation.',
  timing:'Unchanged M1 ACK protocol and workload; host monotonic endpoints, raw empty gates retained without subtraction; capture readiness includes durable snapshot cost. Service proxies are each VM empty-gate nearest-rank95th percentile (20 gates) and maximum result-to-confirmed-stop tail (12 batches), not general worst-case interrupt or network latency.',
  limits:['No diagnostics, code inspection or helper instrumentation. Same runtime artifact; one-time lowering selection bound to package compatibility identity.',
   'No native-parity claim; no full product promotion from this campaign alone.']};
 await writeFile(values.output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'passed',output:values.output,pairs,steps:plan.steps.length}));
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)await main();
