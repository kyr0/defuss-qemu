import {verifyRuntime} from '../../../tests/passive-fifo-heldout/runtime-proof.mjs';
import {verifySnapshot as verifyEnvelope} from '../passive-fifo-finite-v1/snapshot.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {deriveRuntime,sha} from './derive.mjs';
import {fields,resourceDelta} from './observer.mjs';
import {loadReport} from './report.mjs';
import {validatePlan} from './plan.mjs';
import {hostConditionIdentity,validateHostStatus} from '../m2-sustained-v2/host-condition.mjs';
import {names} from '../m2-sustained-v2/protocol.mjs';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {snapshotKey} from '../../../packaging/bun-app/snapshots.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const fixedVm=Object.freeze({machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3});
export function validateResourceConfiguration(manifest){
 assert.deepEqual(manifest.vm,fixedVm,'Resource observation requires the fixed timing VM settings');
 assert.equal(manifest.snapshot?.readyMode,'manual');assert.equal(manifest.benchmark?.measurementProtocol,'defuss-passive-fifo-finite-v1');assert.equal(manifest.benchmark?.protocol,'defuss-m2-sustained-v2');
 assert.equal(manifest.experiment?.name,'passive-fifo-v1');assert.equal(typeof manifest.experiment.enabled,'boolean');
 assert.equal(manifest.observation?.name,'module-input-bytes-passive-fifo-v1');assert.equal(manifest.observation.diagnostic,true);
}
export function compareResourcePackages(control,candidate){
 for(const manifest of [control,candidate])validateResourceConfiguration(manifest);
 assert.deepEqual(control.experiment,{name:'passive-fifo-v1',enabled:false});assert.deepEqual(candidate.experiment,{name:'passive-fifo-v1',enabled:true});
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
 for(const name of ['m1','m2','m2-sustained-v2','passive-fifo-resource-v1','code'])await walk(resolve(root,'benchmarks/harness',name));
 await walk(resolve(root,'tests/passive-fifo-heldout'));
 paths.push(relative(root,resolve(directory,'runtime-provenance.json')),'benchmarks/workload/operations.ts','benchmarks/expected.json','manifests/runtime-baseline.json',
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
 const loaded=await loadReport(argument,'baseline'),path=loaded.path,raw=await readFile(path),r=loaded.report,b=r.browserResult;
 const planRaw=await readFile(resolve(root,r.resourcePlan.path)),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),r.resourcePlan.sha256);validatePlan(plan);for(const [name,digest] of Object.entries(plan.inputIdentities)){assert.equal(sha(await readFile(resolve(root,name))),digest);assert.equal(r.inputHashes[name],digest);}
 assert.equal(r.inputHashes[r.resourcePlan.path],r.resourcePlan.sha256);
 assert.deepEqual(r.hostCondition.configuration,plan.hostCondition);assert.deepEqual(plan.hostCondition,await hostConditionIdentity());
 for(const phase of ['before','after']){const observed=r.hostCondition[phase];assert.deepEqual(JSON.parse(observed.stdout),observed.status);validateHostStatus(observed.status,plan.hostCondition);
  assert.ok(Number.isFinite(Date.parse(observed.startedUtc))&&Date.parse(observed.completedUtc)>=Date.parse(observed.startedUtc));}
 assert.ok(Date.parse(r.hostCondition.after.startedUtc)>=Date.parse(r.hostCondition.before.completedUtc));
 assert.equal(r.protocol,'defuss-passive-fifo-resource-v1');assert.equal(r.status,'passed');assert.equal(b?.status,'passed');
 assert.equal(r.mode,'baseline');assert.equal(r.snapshotMode,'capture');assert.equal(r.captureCode,false);
 assert.equal(b.observation,'diagnostic-module-input-bytes-passive-fifo-v1');assert.equal(b.mode,'baseline');assert.equal(b.snapshotMode,'capture');
 assert.equal(r.manifest.experiment.enabled,enabled);assert.deepEqual(b.experiment,r.manifest.experiment);
 assert.deepEqual(b.fifo,{abi:1,enabled,diagnostic:false,status:enabled?7:6,state:enabled?3:0,rejections:0,effective:enabled});assert.deepEqual(r.pageErrors,[]);assert.deepEqual(r.serverErrors,[]);assert.ok(!r.deadlineExceeded);
 await validateManifest(r.manifest);validateResourceConfiguration(r.manifest);
 assert.equal(r.executionConfiguration?.aotEnabled,false);assert.equal(r.executionConfiguration?.planDisabled,true);
 const directory=resolve(root,r.package);
 requireRecordedHashes(r.inputHashes,await requiredInputs(directory,r.manifest));
 requireRecordedHashes(r.servedHashes,['benchmarks/harness/passive-fifo-resource-v1/browser.mjs','benchmarks/harness/passive-fifo-resource-v1/vm-adapter.mjs',
  'benchmarks/harness/passive-fifo-resource-v1/observer.mjs','benchmarks/harness/m2-sustained-v2/protocol.mjs','experiments/passive-fifo/reader.mjs',
  ...Object.keys(r.manifest.artifacts).map(name=>relative(root,resolve(directory,r.manifest.generation,name)))]);
 for(const hashes of [r.inputHashes,r.servedHashes])for(const [name,digest] of Object.entries(hashes))assert.equal(sha(await readFile(resolve(root,name))),digest,'Changed input: '+name);
 assert.deepEqual(JSON.parse(await readFile(resolve(directory,'app.json'))),r.manifest);
 assert.deepEqual(JSON.parse(await readFile(resolve(directory,'derivation.json'))),r.derivation);
 await verifyEnvelope(resolve(root,r.cache,snapshotKey(r.manifest)+'.snapshot'),r.manifest,{sha256:r.snapshot.sha256,bytes:r.snapshot.bytes});
 const proof=JSON.parse(await readFile(resolve(directory,'runtime-provenance.json')));assert.deepEqual(await verifyRuntime(proof),proof);assert.deepEqual(r.runtimeProvenance,proof);
 const production=r.derivation.production,pRaw=await readFile(resolve(production,'app.json')),p=JSON.parse(pRaw);
 assert.equal(sha(pRaw),r.derivation.productionManifestSha256);await validateManifest(p);
 for(const name of ['qemu-system-x86_64.js','qemu-system-x86_64.wasm']){
  const {sha256,bytes}=proof.artifacts['runtime/x86_64/'+name];
  assert.deepEqual(p.artifacts['runtime/'+name],{sha256,bytes},'Production runtime differs from reviewed performance build');
 }
 const selected=plan.packages[enabled?'candidate':'control'];assert.equal(sha(pRaw),selected.manifestSha256);assert.deepEqual(p,selected.manifest);assert.equal(resolve(production),resolve(root,selected.path));
 validateDerivedSpecification(p,r.manifest);
 const js='runtime/qemu-system-x86_64.js',wasm='runtime/qemu-system-x86_64.wasm';
 const source=await readFile(resolve(production,p.generation,js),'utf8'),d=await deriveRuntime(source);
 assert.equal(sha(source),p.artifacts[js].sha256);assert.equal(Buffer.byteLength(source),p.artifacts[js].bytes);
 for(const field of ['sourceSha256','derivedSha256','observerSha256','anchors'])assert.deepEqual(r.derivation[field],d.derivation[field]);
 assert.equal(r.manifest.observation.productionJsSha256,d.derivation.sourceSha256);
 assert.equal(r.manifest.artifacts[js].sha256,d.derivation.derivedSha256);assert.deepEqual(p.experiment,r.manifest.experiment);
 assert.deepEqual(p.artifacts[wasm],r.manifest.artifacts[wasm]);assert.equal(sha(await readFile(resolve(production,p.generation,wasm))),p.artifacts[wasm].sha256);
 assert.equal(r.derivation.wasmSha256,p.artifacts[wasm].sha256);
 for(const [name,identity] of Object.entries(p.artifacts))if(name!==js){
  assert.deepEqual(identity,r.manifest.artifacts[name]);const bytes=await readFile(resolve(production,p.generation,name));
  assert.equal(bytes.length,identity.bytes,'Production artifact size changed: '+name);assert.equal(sha(bytes),identity.sha256,'Production artifact changed: '+name);
 }
 const events=loaded.events;
 const initial=validateCounters(b.resourcesInitialized),gaps=[],phaseDeltas=[];let previous=initial;
 for(const row of [...b.warmups,...b.results]){
  assert.equal(row.counters,null);assert.ok(!row.codeCapture);
  const begin=validateCounters(row.resources.begin),end=validateCounters(row.resources.end);
  gaps.push({beforeSeq:row.startSeq,...resourceDelta(previous,begin)});const delta=resourceDelta(begin,end);assert.deepEqual(row.resources.delta,delta);phaseDeltas.push(delta);previous=end;
  const a=events.find(e=>e.seq===row.startSeq),z=events.find(e=>e.seq===row.endSeq);assert.ok(a&&z);
  assert.equal(row.hostMs,z.hostMs-a.ackHostMs);assert.equal(row.name,z.name??'warmup');
 }
 const total=validateCounters(b.resourcesComplete),tail=resourceDelta(previous,total);assert.ok(total.instantiatedModules>0);
 const additive=fields.filter(name=>!name.startsWith('max'));const reconstructed={};
 for(const name of additive){const sum=[initial,...gaps,...phaseDeltas,tail].reduce((sum,row)=>sum+BigInt(row[name]),0n);assert.equal(sum,BigInt(total[name]),'Resource partition does not reconstruct total: '+name);reconstructed[name]=Number(sum);}
 const partition={initial,gaps,phaseDeltas,tail,reconstructed,maxima:{maxAttemptedModuleBytes:total.maxAttemptedModuleBytes,maxInstantiatedModuleBytes:total.maxInstantiatedModuleBytes},scope:'Additive counters reconstruct the VM-start-through-complete total. Maxima remain cumulative and are never added or subtracted.'};
 return {path,sha256:sha(raw),report:r,production:p,nonce:events.find(e=>e.event==='resumed').nonce,total,partition,
  warmups:b.warmups.map(row=>({name:row.name,sample:row.sample,...row.resources.delta})),
  phases:b.results.map(row=>({name:row.name,sample:row.sample,...row.resources.delta}))};
}
export async function compareResources(controlPath,candidatePath){
 const control=await readResourceReport(controlPath,false),candidate=await readResourceReport(candidatePath,true);
 assert.notEqual(control.nonce,candidate.nonce,'Resource pair must use fresh captures');
 assert.equal(control.report.browser,candidate.report.browser);for(const key of ['platform','arch','release','logicalCPUs','totalMemoryBytes'])assert.equal(control.report.host[key],candidate.report.host[key]);
 compareResourcePackages(control.report.manifest,candidate.report.manifest);assert.deepEqual(control.report.resourcePlan,candidate.report.resourcePlan,'Resource observations must bind the same prospective resource plan');
 const ratio=(a,b)=>b?a/b:null;
 const totalRatio=ratio(candidate.total.instantiatedModuleBytes,control.total.instantiatedModuleBytes);
 const allPhases=Object.fromEntries(names.map(name=>{const sum=r=>[...r.warmups,...r.phases].filter(x=>x.name===name).reduce((n,x)=>n+x.instantiatedModuleBytes,0),a=sum(control),b=sum(candidate);return [name,{controlBytes:a,candidateBytes:b,ratio:ratio(b,a)}];}));
 const phases=Object.fromEntries(names.map(name=>{const sum=r=>r.phases.filter(x=>x.name===name).reduce((n,x)=>n+x.instantiatedModuleBytes,0),a=sum(control),b=sum(candidate);return [name,{controlBytes:a,candidateBytes:b,ratio:ratio(b,a)}];}));
 return {schema:1,status:'passed',kind:'diagnostic-module-input-bytes-passive-fifo-v1',createdUtc:new Date().toISOString(),
  resourcePlan:control.report.resourcePlan,workloadProtocol:'defuss-m2-sustained-v2',
  inputs:[control,candidate].map(({path,sha256,nonce,total,partition,warmups,phases})=>({path,sha256,nonce,total,partition,warmups,phases})),
  totalRatio,maximumModuleRatio:ratio(candidate.total.maxInstantiatedModuleBytes,control.total.maxInstantiatedModuleBytes),allPhases,phases,
  budget:{metric:'Cumulative successfully instantiated module input bytes from VM start through complete stopped gate',upperRatio:1.10,observedWithinBudget:totalRatio<=1.10},
  timingEligible:false,productPromotionEligible:false,
  scope:['Single matched sustained-v2 diagnostic pair; 500 warmup and800 measured calls per endpoint, every phase retained. Descriptive resource evidence, not an independent performance confirmation.',
   'Every call to instantiate_wasm counts its module bytes again. This measures cumulative generated module input, not deduplicated source bytes, currently live functions, browser native JIT code, or resident memory.',
   'Import-vector bytes describe the QEMU-side uint64 slot vector; they are distinct from encoded WebAssembly imports and are not added to module input bytes.',
   'All timing in these instrumented runs is ineligible for performance analysis. Only the frozen uninstrumented timing campaign can establish speedup.',
   'Per-phase deltas omit work between phase gates. Total includes boot, initialization, calibration, warmup, workload and intervening work. Phase maxima are deliberately not obtained by subtracting cumulative maxima.']};
}
async function main(){
 const {values}=parseArgs({options:{control:{type:'string'},candidate:{type:'string'},output:{type:'string'}}});assert.ok(values.control&&values.candidate&&values.output);
 const r=await compareResources(values.control,values.candidate);await mkdir(values.output);
 await writeFile(resolve(values.output,'analysis.json'),JSON.stringify(r,null,2)+'\n',{flag:'wx'});
 await writeFile(resolve(values.output,'REPORT.md'),`# Passive FIFO generated module input bytes\n\nCandidate/control total byte ratio: ${r.totalRatio.toFixed(6)}. Observed 1.10 budget passed: ${r.budget.observedWithinBudget}.\n\n${r.scope.join('\n\n')}\n`,{flag:'wx'});
 console.log(JSON.stringify({status:r.status,totalRatio:r.totalRatio,observedWithinBudget:r.budget.observedWithinBudget,output:values.output}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
