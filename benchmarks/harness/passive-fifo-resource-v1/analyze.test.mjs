import {syntheticRuntime} from '../../../tests/passive-fifo-heldout/runtime-fixture.mjs';
import {gzipSync} from 'node:zlib';
import {packRecord} from '../../../packaging/bun-app/snapshots.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {syntheticReport,root,sha} from './fixture.mjs';
import {deriveRuntime} from './derive.mjs';
import {resourceDelta} from './observer.mjs';
import {readResourceReport,compareResources} from './analyze.mjs';
import {canonical,snapshotKey} from '../../../packaging/bun-app/snapshots.mjs';
import {protocol,parameters,orders,warmupOrders} from '../m2-sustained-v2/protocol.mjs';
import {planningRule} from '../m2-sustained-v2/planning.mjs';
import {pairedSteps} from '../m2-sustained-v2/plan.mjs';
import {hostConditionIdentity} from '../m2-sustained-v2/host-condition.mjs';
const source=`// pcGraphicsBus:Module.pcGraphicsBus}
// startWorker=async()=>{Module.pcGraphicsBus=
function instantiate_wasm(wasm_begin,wasm_size,import_vec_begin,import_vec_size,timing){
const wasm=HEAP8.subarray(wasm_begin,wasm_begin+wasm_size);const helper={};
const mod=new WebAssembly.Module(wasm);
const inst=new WebAssembly.Instance(mod,{env:{memory:wasmMemory},helper});
return inst.exports.start();}`;
const makeManifest=spec=>{const identity=sha(canonical(spec));return {...spec,compatibilitySha256:identity,generation:identity};};
const counter=n=>({schema:1,attemptedModules:n,compiledModules:n,instantiatedModules:n,attemptedModuleBytes:64*n,instantiatedModuleBytes:64*n,attemptedImportVectorBytes:8*n,instantiatedImportVectorBytes:8*n,maxAttemptedModuleBytes:64,maxInstantiatedModuleBytes:64,overflow:0});
async function writePackage(directory,manifest,data){
 for(const [name,bytes] of Object.entries(data)){const path=resolve(directory,manifest.generation,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(resolve(directory,'app.json'),bytes);return sha(bytes);
}
async function fixtures(alternate=null){
 const packageSource=source+(alternate==='js'?'\n// changed candidate JS':'');
 const scratch=await mkdtemp(resolve(root,'tmp/resource-v2-integration-')),template=JSON.parse(await readFile(resolve(root,'artifacts/m2-package-off-01/app.json')));
 const data=Object.fromEntries(Object.keys(template.artifacts).map(name=>[name,Buffer.from('synthetic '+name)]));data['runtime/qemu-system-x86_64.js']=Buffer.from(packageSource);data['app.mjs']=await readFile(resolve(root,'artifacts/m2-sustained-v2-bundle-01/app.mjs'));
 const runtime=await syntheticRuntime(source,data['runtime/qemu-system-x86_64.wasm']);
 if(alternate==='wasm')data['runtime/qemu-system-x86_64.wasm']=Buffer.from('self-consistent alternate wasm');
 const artifacts=Object.fromEntries(Object.entries(data).map(([name,bytes])=>[name,{sha256:sha(bytes),bytes:bytes.length}]));
 const {generation,compatibilitySha256,...spec}=template;Object.assign(spec,{artifacts,appSha256:artifacts['app.mjs'].sha256,benchmark:{protocol,measurementProtocol:'defuss-passive-fifo-finite-v1'}});
 const packages={},instances=[];
 for(const enabled of [false,true]){
  const side=enabled?'candidate':'control',production=resolve(scratch,side+'-production'),observed=resolve(scratch,side+'-observed');
  const p=makeManifest({...spec,experiment:{name:'passive-fifo-v1',enabled}}),manifestSha256=await writePackage(production,p,data);packages[side]={path:relative(root,production),manifest:p,manifestSha256};
  const derived=await deriveRuntime(packageSource),dData={...data,'runtime/qemu-system-x86_64.js':Buffer.from(derived.output)};
  const d=makeManifest({...spec,artifacts:{...artifacts,'runtime/qemu-system-x86_64.js':{sha256:sha(dData['runtime/qemu-system-x86_64.js']),bytes:dData['runtime/qemu-system-x86_64.js'].length}},experiment:p.experiment,
   observation:{name:'module-input-bytes-passive-fifo-v1',diagnostic:true,productionJsSha256:artifacts['runtime/qemu-system-x86_64.js'].sha256,wasmSha256:artifacts['runtime/qemu-system-x86_64.wasm'].sha256}});
  await writePackage(observed,d,dData);for(const directory of [production,observed])await writeFile(resolve(directory,'runtime-provenance.json'),JSON.stringify(runtime.proof));
  const derivation={...derived.derivation,production,productionManifestSha256:manifestSha256,wasmSha256:artifacts['runtime/qemu-system-x86_64.wasm'].sha256,experiment:p.experiment,compatibilitySha256:d.compatibilitySha256};
  await writeFile(resolve(observed,'derivation.json'),JSON.stringify(derivation));instances.push({enabled,observed,d,derivation});
 }
 const plan={schema:1,kind:'diagnostic-resource-pair',experiment:'passive-fifo-v1',protocol:'defuss-passive-fifo-resource-v1',timingEligible:false,parameters,orders,warmupOrders,upperRatio:1.1,timeoutMs:600000,hostCondition:await hostConditionIdentity(),packages,inputs:Object.keys(runtime.proof.inputs),inputIdentities:runtime.proof.inputs};
 const planPath=resolve(scratch,'plan.json'),planRaw=Buffer.from(JSON.stringify(plan));await writeFile(planPath,planRaw);
 const records=[];
 for(const {enabled,observed,d,derivation} of instances){
  const f=await syntheticReport(d),r=f.report,b=r.browserResult;
  Object.assign(r,{runtimeProvenance:runtime.proof,experiment:d.experiment,package:relative(root,observed),derivation,browser:'synthetic-validator-fixture',host:{platform:'synthetic',arch:'synthetic',release:'synthetic',logicalCPUs:1,totalMemoryBytes:1},resourcePlan:{path:relative(root,planPath),sha256:sha(planRaw)}});
  const status={...plan.hostCondition.expected,errors:[]},observation={startedUtc:'2026-11-07T00:00:00Z',completedUtc:'2026-11-07T00:00:01Z',stdout:JSON.stringify(status),stderr:'',status};
  r.hostCondition={configuration:plan.hostCondition,before:observation,after:{...observation,startedUtc:'2026-11-07T00:10:00Z',completedUtc:'2026-11-07T00:10:01Z'}};
  Object.assign(b,{experiment:d.experiment,fifo:{abi:1,enabled,diagnostic:false,status:enabled?7:6,state:enabled?3:0,rejections:0,effective:enabled},resourcesInitialized:counter(10)});let n=10;
  for(const row of [...b.warmups,...b.results]){row.resources={begin:counter(++n),end:counter(n+=2)};row.resources.delta=resourceDelta(row.resources.begin,row.resources.end);}b.resourcesComplete=counter(++n);
  const snapshotRaw=Buffer.from('synthetic retained snapshot'),compressed=gzipSync(snapshotRaw),snapshot=Buffer.from(packRecord({metadata:{schema:1,encoding:'gzip',appSha256:d.appSha256,compatibilitySha256:d.compatibilitySha256,bytes:snapshotRaw.length,sha256:sha(snapshotRaw),compressedBytes:compressed.length,compressedSha256:sha(compressed)},data:compressed})),cache=resolve(f.dir,'snapshots');await mkdir(cache);const snapshotPath=resolve(cache,snapshotKey(d)+'.snapshot');await mkdir(dirname(snapshotPath),{recursive:true});await writeFile(snapshotPath,snapshot);r.cache=relative(root,cache);r.snapshot={sha256:sha(snapshot),bytes:snapshot.length};
  async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const p=resolve(directory,entry.name);if(entry.isDirectory())await walk(p);else if(/\.(mjs|js|ts|json)$/.test(entry.name))r.inputHashes[relative(root,p)]=sha(await readFile(p));}}
  for(const name of ['m1','m2','m2-sustained-v2','passive-fifo-resource-v1','code'])await walk(resolve(root,'benchmarks/harness',name));
  await walk(resolve(root,'tests/passive-fifo-heldout'));Object.assign(r.inputHashes,runtime.proof.inputs);
  for(const p of [resolve(observed,'runtime-provenance.json'),planPath,resolve(observed,'app.json'),resolve(observed,'derivation.json'),...['benchmarks/workload/operations.ts','benchmarks/expected.json','manifests/runtime-baseline.json'].map(x=>resolve(root,x))])r.inputHashes[relative(root,p)]=sha(await readFile(p));
  for(const name of Object.keys(d.artifacts)){const p=resolve(observed,d.generation,name);r.inputHashes[relative(root,p)]=r.servedHashes[relative(root,p)]=sha(await readFile(p));}
  for(const name of ['benchmarks/harness/passive-fifo-resource-v1/browser.mjs','benchmarks/harness/passive-fifo-resource-v1/vm-adapter.mjs','benchmarks/harness/passive-fifo-resource-v1/observer.mjs','benchmarks/harness/m2-sustained-v2/protocol.mjs','experiments/passive-fifo/reader.mjs'])r.servedHashes[name]=sha(await readFile(resolve(root,name)));
  await f.save();records.push({...f,snapshotPath,snapshot});
 }
 return records;
}
test('full resource analyzer binds a synthetic pair and rejects corruption across protocol, counters and retained evidence',async()=>{
 const [off,on]=await fixtures(),analysis=await compareResources(off.path,on.path);assert.equal(analysis.totalRatio,1);assert.equal(analysis.budget.observedWithinBudget,true);assert.equal(analysis.timingEligible,false);assert.equal(analysis.inputs[0].warmups.length,20);assert.equal(analysis.inputs[0].phases.length,32);assert.equal(analysis.inputs[0].partition.gaps.length,52);assert.equal(analysis.inputs[0].partition.reconstructed.instantiatedModuleBytes,analysis.inputs[0].total.instantiatedModuleBytes);
 off.report.browserResult.warmups[0].resources.delta.instantiatedModuleBytes++;await off.save();await assert.rejects(()=>readResourceReport(off.path,false));off.report.browserResult.warmups[0].resources.delta.instantiatedModuleBytes--;await off.save();
 const key='benchmarks/harness/passive-fifo-resource-v1/observer.js',value=off.report.inputHashes[key];delete off.report.inputHashes[key];await off.save();await assert.rejects(()=>readResourceReport(off.path,false),/Missing required hash/);off.report.inputHashes[key]=value;await off.save();
 await writeFile(off.snapshotPath,Buffer.from('tampered retained snapshot'));await assert.rejects(()=>readResourceReport(off.path,false),/Snapshot envelope changed/);await writeFile(off.snapshotPath,off.snapshot);
 off.report.hostCondition.after.status={...off.report.hostCondition.after.status,status:'Running'};off.report.hostCondition.after.stdout=JSON.stringify(off.report.hostCondition.after.status);await off.save();await assert.rejects(()=>readResourceReport(off.path,false),/Compiler VM host condition/);
});

test('self-consistent alternate production/derived runtime cannot detach from reviewed build',async()=>{for(const kind of ['js','wasm']){const [off]=await fixtures(kind);await assert.rejects(()=>readResourceReport(off.path,false),/Production runtime differs from reviewed performance build/);}});
