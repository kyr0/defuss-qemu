import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {hostConditionIdentity} from '../m2-sustained-v2/host-condition.mjs';
import {parameters,orders,warmupOrders} from '../m2-sustained-v2/protocol.mjs';
import {comparePackages} from '../passive-fifo-finite-v1/plan.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {verifyRuntime} from '../../../tests/passive-fifo-heldout/runtime-proof.mjs';
export const protocol='defuss-passive-fifo-resource-v1';
const root=resolve(new URL('../../..',import.meta.url).pathname);
const sha=b=>createHash('sha256').update(b).digest('hex');
export function validatePlan(plan){
 assert.equal(plan.schema,1);assert.equal(plan.protocol,protocol);assert.equal(plan.kind,'diagnostic-resource-pair');assert.equal(plan.experiment,'passive-fifo-v1');assert.equal(plan.timingEligible,false);
 assert.deepEqual(plan.parameters,parameters);assert.deepEqual(plan.orders,orders);assert.deepEqual(plan.warmupOrders,warmupOrders);
 assert.equal(plan.upperRatio,1.10);assert.equal(plan.timeoutMs,600000);assert.deepEqual(plan.hostCondition.expected,{name:'builder',status:'Stopped',memory:12884901888});
 comparePackages(plan.packages.control.manifest,plan.packages.candidate.manifest);for(const side of ['control','candidate'])assert.equal(plan.packages[side].manifest.appSha256,'f9ed5327b4549350c4ddd554c6ada074487a45924435ded873abe46e0aa7d668');assert.ok(Array.isArray(plan.inputs)&&plan.inputs.length>0);assert.deepEqual(Object.keys(plan.inputIdentities).sort(),[...plan.inputs].sort());for(const digest of Object.values(plan.inputIdentities))assert.match(digest,/^[a-f0-9]{64}$/);return plan;
}
async function main(){
 const {values}=parseArgs({options:{control:{type:'string'},candidate:{type:'string'},output:{type:'string'},input:{type:'string',multiple:true,default:[]}}});assert.ok(values.control&&values.candidate&&values.output);
 const packages={},inputs=[...values.input];
 for(const [side,path] of [['control',values.control],['candidate',values.candidate]]){
  const raw=await readFile(resolve(path,'app.json')),manifest=JSON.parse(raw);await validateManifest(manifest);
  const proof=JSON.parse(await readFile(resolve(path,'runtime-provenance.json')));assert.deepEqual(await verifyRuntime(proof),proof);
  for(const name of ['qemu-system-x86_64.js','qemu-system-x86_64.wasm']){const {sha256,bytes}=proof.artifacts['runtime/x86_64/'+name];assert.deepEqual(manifest.artifacts['runtime/'+name],{sha256,bytes},'Production runtime differs from reviewed performance build');}
  packages[side]={path,manifest,manifestSha256:sha(raw)};inputs.push(resolve(path,'app.json'),resolve(path,'runtime-provenance.json'),...Object.keys(proof.inputs));
 }
 const normalized=[...new Set(inputs.map(path=>{const absolute=resolve(root,path);assert.ok(absolute.startsWith(root+'/'));return relative(root,absolute);}))];
 const inputIdentities={};for(const path of normalized)inputIdentities[path]=sha(await readFile(resolve(root,path)));
 const plan=validatePlan({schema:1,kind:'diagnostic-resource-pair',experiment:'passive-fifo-v1',protocol,timingEligible:false,createdUtc:new Date().toISOString(),parameters,orders,warmupOrders,packages,inputs:normalized,inputIdentities,upperRatio:1.10,timeoutMs:600000,hostCondition:await hostConditionIdentity(),scope:'Prospective single matched cumulative-module-input-byte pair, before timing. Same full52-phase workload and performance WASM; no timing selection or native/live-memory claim.'});
 await writeFile(values.output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'passed',output:values.output}));
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)await main();
