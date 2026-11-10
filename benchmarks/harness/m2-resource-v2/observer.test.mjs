import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {deriveRuntime} from './derive.mjs';
import {createResourceBus,readResourceBus,resourceDelta} from './observer.mjs';
import {validateCounters,compareResourcePackages,validateDerivedSpecification,requireRecordedHashes,verifySnapshot} from './analyze.mjs';
import {loadReport} from '../analysis/analyze.mjs';
const tmp=resolve(new URL('../../../tmp',import.meta.url).pathname);await mkdir(tmp,{recursive:true});
const tiny=new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,9,1,5,115,116,97,114,116,0,0,10,6,1,4,0,65,0,11]);
const source=`// pcGraphicsBus:Module.pcGraphicsBus}
// startWorker=async()=>{Module.pcGraphicsBus=
function instantiate_wasm(wasm_begin,wasm_size,import_vec_begin,import_vec_size,timing){
const wasm=HEAP8.subarray(wasm_begin,wasm_begin+wasm_size);const helper={};
const mod=new WebAssembly.Module(wasm);
const inst=new WebAssembly.Instance(mod,{env:{memory:wasmMemory},helper});
return inst.exports.start();}`;
test('derived hook counts actual WebAssembly compilation and instantiation',async()=>{
 const {output}=await deriveRuntime(source),bus=createResourceBus();
 const context={Module:{pcResourceBus:bus},SharedArrayBuffer,BigUint64Array,Atomics,WebAssembly,HEAP8:tiny,wasmMemory:new WebAssembly.Memory({initial:1})};
 const invoke=runInNewContext(output+';instantiate_wasm',context);
 assert.equal(invoke(0,tiny.length,0,16,0),0);assert.equal(invoke(0,tiny.length,0,8,0),0);
 const row=readResourceBus(bus);validateCounters(row);
 assert.equal(row.attemptedModules,2);assert.equal(row.instantiatedModuleBytes,2*tiny.length);assert.equal(row.instantiatedImportVectorBytes,24);assert.equal(row.maxInstantiatedModuleBytes,tiny.length);
 assert.throws(()=>invoke(1,tiny.length-1,0,0,0),WebAssembly.CompileError);
 const failed=readResourceBus(bus);assert.equal(failed.attemptedModules,3);assert.equal(failed.compiledModules,2);assert.throws(()=>validateCounters(failed));
});
test('separate worker contexts aggregate over one shared atomic bus',async()=>{
 const observer=await readFile(new URL('./observer.js',import.meta.url),'utf8'),bus=createResourceBus();
 for(let worker=0;worker<3;worker++)runInNewContext(observer+';pcResourceAttempt(42,8);pcResourceCompiled();pcResourceInstantiated(42,8);',{Module:{pcResourceBus:bus},SharedArrayBuffer,BigUint64Array,Atomics});
 const row=readResourceBus(bus);validateCounters(row);assert.equal(row.instantiatedModules,3);assert.equal(row.instantiatedModuleBytes,126);
});
test('derivation fails closed on absent, duplicated or already modified anchors',async()=>{
 const d=await deriveRuntime(source);assert.equal(d.derivation.anchors.length,5);
 await assert.rejects(()=>deriveRuntime(source.replace('new WebAssembly.Module(wasm)','new WebAssembly.Module(other)')));
 await assert.rejects(()=>deriveRuntime(source+'\n// pcGraphicsBus:Module.pcGraphicsBus}'));
 await assert.rejects(()=>deriveRuntime(d.output));
});
test('counter corruption and overflow fail closed',()=>{
 const bus=createResourceBus(),words=new BigUint64Array(bus.buffer);assert.doesNotThrow(()=>validateCounters(readResourceBus(bus)));
 words[9]=1n;assert.throws(()=>readResourceBus(bus));words[9]=0n;words[1]=BigInt(Number.MAX_SAFE_INTEGER)+1n;assert.throws(()=>readResourceBus(bus));
 const row={schema:1,attemptedModules:1,attemptedModuleBytes:42,attemptedImportVectorBytes:8,maxAttemptedModuleBytes:42,compiledModules:1,instantiatedModules:1,instantiatedModuleBytes:42,instantiatedImportVectorBytes:8,maxInstantiatedModuleBytes:42,overflow:0};
 for(const mutation of [r=>r.compiledModules=0,r=>r.instantiatedModuleBytes=43,r=>r.maxInstantiatedModuleBytes=43,r=>r.instantiatedImportVectorBytes=7,r=>r.instantiatedModules=-1]){const q=structuredClone(row);mutation(q);assert.throws(()=>validateCounters(q));}
 const later={...row,attemptedModules:2,compiledModules:2,instantiatedModules:2,attemptedModuleBytes:84,instantiatedModuleBytes:84,attemptedImportVectorBytes:16,instantiatedImportVectorBytes:16};
 const delta=resourceDelta(row,later);assert.equal(delta.instantiatedModuleBytes,42);assert.equal(delta.maxInstantiatedModuleBytes,undefined);assert.throws(()=>resourceDelta(later,row));
 assert.throws(()=>resourceDelta(row,{...later,maxAttemptedModuleBytes:40,maxInstantiatedModuleBytes:40}));
});
test('resource protocol is rejected by existing timing report loader',async()=>{
 const dir=await mkdtemp(resolve(tmp,'m2-resource-test-'));try{
  const path=resolve(dir,'report.json');await writeFile(path,JSON.stringify({schema:1,status:'passed',protocol:'defuss-m2-resource-v2'}));
  await assert.rejects(()=>loadReport(path,'baseline'),/defuss-m[12]/);
 }finally{await writeFile(resolve(dir,'retained.json'),JSON.stringify({purpose:'Resource-v2 unit evidence retained'})+'\n');}
});
function packages(){
 const control={schema:1,benchmark:{protocol:'defuss-m2-sustained-v2'},vm:{machine:'pc,acpi=off',cpu:'max',ramMiB:512,smp:1,tbMiB:128,hotLimit:1500,runtimeFlags:3},snapshot:{readyMode:'manual'},
  artifacts:{'runtime/qemu-system-x86_64.js':{sha256:'observed-js',bytes:20},'runtime/qemu-system-x86_64.wasm':{sha256:'same-wasm',bytes:10}},
  experiment:{name:'sha256msg2-v1',enabled:false},observation:{name:'module-input-bytes-sustained-v2',diagnostic:true,productionJsSha256:'production-js'},compatibilitySha256:'off',generation:'off'};
 const candidate={...structuredClone(control),experiment:{name:'sha256msg2-v1',enabled:true},compatibilitySha256:'on',generation:'on'};
 return {control,candidate};
}
test('resource pairs reject changed full specs and nonstandard settings in either or both modes',()=>{
 const {control,candidate}=packages();assert.doesNotThrow(()=>compareResourcePackages(control,candidate));
 for(const mutate of [m=>m.vm.hotLimit=16,m=>m.vm.runtimeFlags=2,m=>m.snapshot.readyMode='auto',m=>m.extraOption=true,
  m=>m.observation.productionJsSha256='different',m=>m.artifacts['runtime/qemu-system-x86_64.wasm'].bytes=11]){
  const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>compareResourcePackages(control,bad));
 }
 const wrong=packages();wrong.control.vm.hotLimit=wrong.candidate.vm.hotLimit=16;assert.throws(()=>compareResourcePackages(wrong.control,wrong.candidate));
 assert.throws(()=>compareResourcePackages(control,{...candidate,compatibilitySha256:'off'}));
});
test('resource derivation preserves all production specs except observed JS and identity',()=>{
 const {control}=packages(),production=structuredClone(control);delete production.observation;
 production.compatibilitySha256=production.generation='production-off';production.artifacts['runtime/qemu-system-x86_64.js']={sha256:'production-js',bytes:8};
 assert.doesNotThrow(()=>validateDerivedSpecification(production,control));
 for(const mutate of [m=>m.vm.runtimeFlags=2,m=>m.experiment.enabled=true,m=>m.snapshot.extra='changed',m=>m.unexpected=true]){
  const changed=structuredClone(production);mutate(changed);assert.throws(()=>validateDerivedSpecification(changed,control));
 }
});
test('resource evidence requires declared source hashes and unchanged retained snapshot bytes',async()=>{
 assert.throws(()=>requireRecordedHashes({},['required.mjs']));assert.throws(()=>requireRecordedHashes({'required.mjs':'invalid'},['required.mjs']));
 assert.doesNotThrow(()=>requireRecordedHashes({'required.mjs':'a'.repeat(64)},['required.mjs']));
 const dir=await mkdtemp(resolve(tmp,'m2-resource-snapshot-'));try{
  const path=resolve(dir,'snapshot'),bytes=Buffer.from('retained snapshot');await writeFile(path,bytes);
  const {sha}=await import('./derive.mjs');const identity={sha256:sha(bytes),bytes:bytes.length};await verifySnapshot(path,identity);
  await writeFile(path,Buffer.from('Retained snapshot'));await assert.rejects(()=>verifySnapshot(path,identity),/hash changed/);
  await writeFile(path,Buffer.from('short'));await assert.rejects(()=>verifySnapshot(path,identity),/size changed/);
 }finally{await writeFile(resolve(dir,'retained.json'),JSON.stringify({purpose:'Resource-v2 unit evidence retained'})+'\n');}
});
