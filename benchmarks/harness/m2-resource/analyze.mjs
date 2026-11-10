#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname,basename,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {deriveRuntime,sha} from './derive.mjs';
import {fields,resourceDelta} from './observer.mjs';
import {Protocol,orders,parameters,gatePlan,names} from '../m1/protocol.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {snapshotKey} from '../../../packaging/bun-app/snapshots.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const fixedVm=Object.freeze({machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3});
export function validateResourceConfiguration(manifest){
 assert.deepEqual(manifest.vm,fixedVm,'Resource observation requires the fixed timing VM settings');
 assert.equal(manifest.snapshot?.readyMode,'manual');
 assert.equal(manifest.experiment?.name,'sha256msg2-v1');assert.equal(typeof manifest.experiment.enabled,'boolean');
 assert.equal(manifest.observation?.name,'module-input-bytes-v1');assert.equal(manifest.observation.diagnostic,true);
}
export function compareResourcePackages(control,candidate){
 for(const manifest of [control,candidate])validateResourceConfiguration(manifest);
 assert.deepEqual(control.experiment,{name:'sha256msg2-v1',enabled:false});assert.deepEqual(candidate.experiment,{name:'sha256msg2-v1',enabled:true});
 const spec=({experiment,compatibilitySha256,generation,...rest})=>rest;
 assert.deepEqual(spec(control),spec(candidate),'Only the bound off/on configuration may differ between resource packages');
 assert.notEqual(control.compatibilitySha256,candidate.compatibilitySha256,'Resource mode snapshot identities must differ');
}
export function validateDerivedSpecification(production,derived){
 validateResourceConfiguration(derived);assert.equal(production.observation,undefined,'Production package must not be diagnostic');
 const spec=({compatibilitySha256,generation,observation,...rest})=>{
  const result=structuredClone(rest);delete result.artifacts['runtime/qemu-system-x86_64.js'];return result;
 };
 assert.deepEqual(spec(production),spec(derived),'Derivation may change only JavaScript and the diagnostic observation identity');
}
export function requireRecordedHashes(hashes,names){
 assert.ok(hashes&&typeof hashes==='object');
 for(const name of names)assert.match(hashes[name]??'',/^[a-f0-9]{64}$/,'Missing required hash: '+name);
}
async function requiredInputs(directory,manifest){
 const paths=[];
 async function walk(base){for(const entry of await readdir(base,{withFileTypes:true})){
  const path=resolve(base,entry.name);if(entry.isDirectory())await walk(path);
  else if(/\.(mjs|js|ts|json)$/.test(entry.name))paths.push(relative(root,path));
 }}
 for(const name of ['m1','m2','m2-resource','code'])await walk(resolve(root,'benchmarks/harness',name));
 paths.push('benchmarks/workload/operations.ts','benchmarks/expected.json','manifests/runtime-baseline.json',
  relative(root,resolve(directory,'app.json')),relative(root,resolve(directory,'derivation.json')),
  ...Object.keys(manifest.artifacts).map(name=>relative(root,resolve(directory,manifest.generation,name))));
 return paths;
}
export async function verifySnapshot(path,identity){
 const bytes=await readFile(path);assert.equal(bytes.length,identity.bytes,'Retained resource snapshot size changed');
 assert.equal(sha(bytes),identity.sha256,'Retained resource snapshot hash changed');
}
export function validateCounters(row){
 assert.equal(row?.schema,1);
 for(const field of fields)assert.ok(Number.isSafeInteger(row[field])&&row[field]>=0,'Invalid '+field);
 assert.equal(row.overflow,0);assert.equal(row.attemptedModules,row.compiledModules,'Compilation failed/in flight');
 assert.equal(row.compiledModules,row.instantiatedModules,'Instantiation failed/in flight');
 assert.equal(row.attemptedModuleBytes,row.instantiatedModuleBytes);assert.equal(row.attemptedImportVectorBytes,row.instantiatedImportVectorBytes);
 assert.equal(row.maxAttemptedModuleBytes,row.maxInstantiatedModuleBytes);
 assert.ok(row.maxInstantiatedModuleBytes<=row.instantiatedModuleBytes);
 assert.ok(BigInt(row.instantiatedModuleBytes)>=BigInt(row.instantiatedModules)*8n);
 assert.ok(BigInt(row.instantiatedModuleBytes)<=BigInt(row.instantiatedModules)*BigInt(row.maxInstantiatedModuleBytes));
 assert.equal(row.instantiatedModules===0,row.instantiatedModuleBytes===0);
 assert.equal(row.instantiatedModules===0,row.maxInstantiatedModuleBytes===0);
 assert.equal(row.instantiatedImportVectorBytes%8,0);return row;
}
export async function readResourceReport(argument,enabled){
 const path=resolve(argument),raw=await readFile(path),r=JSON.parse(raw),b=r.browserResult;
 assert.equal(r.protocol,'defuss-m2-resource-v1');assert.equal(r.status,'passed');assert.equal(b?.status,'passed');
 assert.equal(r.mode,'baseline');assert.equal(r.snapshotMode,'capture');assert.equal(r.captureCode,false);
 assert.equal(b.observation,'diagnostic-module-input-bytes');assert.equal(b.mode,'baseline');assert.equal(b.snapshotMode,'capture');
 assert.equal(r.manifest.experiment.enabled,enabled);assert.deepEqual(b.experiment,r.manifest.experiment);
 assert.equal(b.msg2Status,0x10000|(enabled?4:3));assert.deepEqual(r.pageErrors,[]);assert.deepEqual(r.serverErrors,[]);assert.ok(!r.deadlineExceeded);
 await validateManifest(r.manifest);validateResourceConfiguration(r.manifest);
 assert.equal(r.executionConfiguration?.aotEnabled,false);assert.equal(r.executionConfiguration?.planDisabled,true);
 const directory=resolve(root,r.package);
 requireRecordedHashes(r.inputHashes,await requiredInputs(directory,r.manifest));
 requireRecordedHashes(r.servedHashes,['benchmarks/harness/m2-resource/browser.mjs','benchmarks/harness/m2-resource/vm-adapter.mjs',
  'benchmarks/harness/m2-resource/observer.mjs','benchmarks/harness/m1/protocol.mjs',
  ...Object.keys(r.manifest.artifacts).map(name=>relative(root,resolve(directory,r.manifest.generation,name)))]);
 for(const hashes of [r.inputHashes,r.servedHashes])for(const [name,digest] of Object.entries(hashes))assert.equal(sha(await readFile(resolve(root,name))),digest,'Changed input: '+name);
 assert.deepEqual(JSON.parse(await readFile(resolve(directory,'app.json'))),r.manifest);
 assert.deepEqual(JSON.parse(await readFile(resolve(directory,'derivation.json'))),r.derivation);
 await verifySnapshot(resolve(root,r.cache,snapshotKey(r.manifest)+'.snapshot'),r.snapshot);
 const production=r.derivation.production,pRaw=await readFile(resolve(production,'app.json')),p=JSON.parse(pRaw);
 assert.equal(sha(pRaw),r.derivation.productionManifestSha256);await validateManifest(p);
 validateDerivedSpecification(p,r.manifest);
 const js='runtime/qemu-system-x86_64.js',wasm='runtime/qemu-system-x86_64.wasm';
 const source=await readFile(resolve(production,p.generation,js),'utf8'),d=await deriveRuntime(source);
 assert.equal(sha(source),p.artifacts[js].sha256);assert.equal(Buffer.byteLength(source),p.artifacts[js].bytes);
 for(const field of ['sourceSha256','derivedSha256','observerSha256','anchors'])assert.deepEqual(r.derivation[field],d.derivation[field]);
 assert.equal(r.manifest.observation.productionJsSha256,d.derivation.sourceSha256);
 assert.equal(r.manifest.artifacts[js].sha256,d.derivation.derivedSha256);assert.deepEqual(p.experiment,r.manifest.experiment);
 assert.deepEqual(p.artifacts[wasm],r.manifest.artifacts[wasm]);assert.equal(sha(await readFile(resolve(production,p.generation,wasm))),p.artifacts[wasm].sha256);
 assert.equal(r.derivation.wasmSha256,p.artifacts[wasm].sha256);
 for(const [name,identity] of Object.entries(p.artifacts))if(name!==js)assert.deepEqual(identity,r.manifest.artifacts[name]);
 const validator=new Protocol('capture'),events=[];
 for(const original of b.events){
  const e={...original};if(['initialized','maps'].includes(e.event)){
   assert.equal(basename(e.mapsArtifact.path),e.mapsArtifact.path);const maps=await readFile(resolve(dirname(path),e.mapsArtifact.path));
   assert.equal(sha(maps),e.mapsArtifact.sha256);assert.equal(maps.length,e.mapsArtifact.bytes);assert.equal(sha(maps),e.mapsSha256);e.maps=maps.toString('utf8');
  }
  const kind=validator.accept(e);if(kind==='gate'){
   const timestamps=[e.hostMs,e.pairedHostMs,e.stopRequestHostMs,e.stoppedHostMs,e.readCompleteHostMs,e.ackHostMs,e.contReplyHostMs];
   assert.ok(timestamps.every(n=>Number.isFinite(n)&&n>=0));assert.ok(timestamps.every((n,i)=>i===0||n>=timestamps[i-1]));
  }
  events.push(e);
 }
 validator.finish();assert.equal(b.gateAcks,gatePlan().length);
 assert.deepEqual(b.results.map(({name,sample,iterations})=>({name,sample,iterations})),orders.flatMap((order,sample)=>order.map(name=>({name,sample,iterations:parameters.batchRepetitions}))));
 let previous=validateCounters(b.resourcesInitialized);
 for(const row of [b.warmup,...b.results]){
  assert.equal(row.counters,null);assert.ok(!row.codeCapture);
  const begin=validateCounters(row.resources.begin),end=validateCounters(row.resources.end);
  resourceDelta(previous,begin);assert.deepEqual(row.resources.delta,resourceDelta(begin,end));previous=end;
  const a=events.find(e=>e.seq===row.startSeq),z=events.find(e=>e.seq===row.endSeq);assert.ok(a&&z);
  assert.equal(row.hostMs,z.hostMs-a.ackHostMs);assert.equal(row.name,z.name??'warmup');
 }
 const total=validateCounters(b.resourcesComplete);resourceDelta(previous,total);assert.ok(total.instantiatedModules>0);
 return {path,sha256:sha(raw),report:r,production:p,nonce:validator.resumed.nonce,total,
  phases:b.results.map(row=>({name:row.name,sample:row.sample,...row.resources.delta}))};
}
export async function compareResources(controlPath,candidatePath){
 const control=await readResourceReport(controlPath,false),candidate=await readResourceReport(candidatePath,true);
 assert.notEqual(control.nonce,candidate.nonce,'Resource pair must use fresh captures');
 assert.equal(control.report.browser,candidate.report.browser);for(const key of ['platform','arch','release','logicalCPUs','totalMemoryBytes'])assert.equal(control.report.host[key],candidate.report.host[key]);
 compareResourcePackages(control.report.manifest,candidate.report.manifest);
 const ratio=(a,b)=>b?a/b:null;
 const totalRatio=ratio(candidate.total.instantiatedModuleBytes,control.total.instantiatedModuleBytes);
 const phases=Object.fromEntries(names.map(name=>{const sum=r=>r.phases.filter(x=>x.name===name).reduce((n,x)=>n+x.instantiatedModuleBytes,0),a=sum(control),b=sum(candidate);return [name,{controlBytes:a,candidateBytes:b,ratio:ratio(b,a)}];}));
 return {schema:1,status:'passed',kind:'diagnostic-module-input-bytes',createdUtc:new Date().toISOString(),
  inputs:[control,candidate].map(({path,sha256,nonce,total,phases})=>({path,sha256,nonce,total,phases})),
  totalRatio,maximumModuleRatio:ratio(candidate.total.maxInstantiatedModuleBytes,control.total.maxInstantiatedModuleBytes),phases,
  budget:{metric:'Cumulative successfully instantiated module input bytes from VM start through complete stopped gate',upperRatio:1.10,observedWithinBudget:totalRatio<=1.10},
  timingEligible:false,productPromotionEligible:false,
  scope:['Single matched diagnostic pair; descriptive resource evidence, not an independent performance confirmation.',
   'Every call to instantiate_wasm counts its module bytes again. This measures cumulative generated module input, not deduplicated source bytes, currently live functions, browser native JIT code, or resident memory.',
   'Import-vector bytes describe the QEMU-side uint64 slot vector; they are distinct from encoded WebAssembly imports and are not added to module input bytes.',
   'All timing in these instrumented runs is ineligible for performance analysis. Only the frozen uninstrumented timing campaign can establish speedup.',
   'Per-phase deltas omit work between phase gates. Total includes boot, initialization, calibration, warmup, workload and intervening work. Phase maxima are deliberately not obtained by subtracting cumulative maxima.']};
}
async function main(){
 const {values}=parseArgs({options:{control:{type:'string'},candidate:{type:'string'},output:{type:'string'}}});assert.ok(values.control&&values.candidate&&values.output);
 const r=await compareResources(values.control,values.candidate);await mkdir(values.output);
 await writeFile(resolve(values.output,'analysis.json'),JSON.stringify(r,null,2)+'\n',{flag:'wx'});
 await writeFile(resolve(values.output,'REPORT.md'),`# MSG2 generated module input bytes\n\nCandidate/control total byte ratio: ${r.totalRatio.toFixed(6)}. Observed 1.10 budget passed: ${r.budget.observedWithinBudget}.\n\n${r.scope.join('\n\n')}\n`,{flag:'wx'});
 console.log(JSON.stringify({status:r.status,totalRatio:r.totalRatio,observedWithinBudget:r.budget.observedWithinBudget,output:values.output}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
