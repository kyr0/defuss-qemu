import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const sha=data=>createHash('sha256').update(data).digest('hex');
export const runtimeContract=Object.freeze({
 runtime:'artifacts/m2-msg1-diagnostic-build-01/runtime/x86_64',
 build:'artifacts/m2-msg1-diagnostic-build-01/build-report.json',
 buildSha256:'eadae6f19d99c9992b4777ec2b2b1c1173ad81fa3289cec64d3ec5baf99cdfb8',
 recheck:'artifacts/m2-msg1-diagnostic-build-01/source-recheck.json',
 recheckSha256:'b8025568de878e0c63c3e1ea939e40b35dfa07770a2de0ce30b53732cc5d983b',
 sourceFingerprint:'2b7a8b44cff517fd8a02c30151a47bbc6b1776a4f617ef5d1db952c2a218efa3',
 implementation:'artifacts/m2-msg1-implementation-01/manifest.json',
 implementationSha256:'b04500ea12e5719bfa3ff317b28fd0d31ddf292f8b4b318303f3517bd987a874',
 sourceReview:'artifacts/m2-msg1-source-review-01/review.json',
 sourceReviewSha256:'b01c960c7b5d430639d8ea9ddd871ea0a6b36a35cc01499ed341f61eae30318d',
 isaReview:'artifacts/m2-msg1-diagnostic-review-01/review.json',
 isaReviewSha256:'10c9ad6c8c601fbf2859a261269d2fbfd177f4a399f2ec2c2d31e344670201aa',
 jsSha256:'632df56970e2cd5969e54b661dcd251ab1fe4e645fbdb40ca6c6af323fc672cf',
 wasmSha256:'9246a4e3b659d7ca77260e8d293ec0a968cecff89255ec1e87ba65ecc3a1cd42',
});
export async function runtimeIdentity(runtime=resolve(root,runtimeContract.runtime)){
 const documents={},inputHashes={},artifacts=[];
 for(const [name,digest]of [[runtimeContract.build,runtimeContract.buildSha256],[runtimeContract.recheck,runtimeContract.recheckSha256],[runtimeContract.implementation,runtimeContract.implementationSha256],[runtimeContract.sourceReview,runtimeContract.sourceReviewSha256],[runtimeContract.isaReview,runtimeContract.isaReviewSha256]]){
  const data=await readFile(resolve(root,name));assert.equal(sha(data),digest,'MSG1 provenance differs: '+name);inputHashes[name]=digest;documents[name]=JSON.parse(data);
 }
 const build=documents[runtimeContract.build],audit=documents[runtimeContract.recheck],isa=documents[runtimeContract.isaReview];
 assert.equal(build.status,'passed');assert.equal(audit.status,'passed');assert.equal(build.sourceFingerprint,runtimeContract.sourceFingerprint);assert.equal(audit.sourceFingerprint,runtimeContract.sourceFingerprint);
 assert.equal(audit.buildReport.sha256,runtimeContract.buildSha256);assert.equal(audit.frozenImplementation.sha256,runtimeContract.implementationSha256);assert.deepEqual(audit.runtimeArtifacts,build.artifacts);
 assert.equal(isa.status,'passed');assert.equal(isa.kind,'independent-msg1-exact-isa-review');assert.equal(isa.fullMatrix,true);assert.equal(isa.sourceFingerprint,runtimeContract.sourceFingerprint);
 for(const [name,expected]of Object.entries(isa.identities)){const data=await readFile(resolve(root,name));assert.deepEqual({sha256:sha(data),bytes:data.length},expected,'MSG1 ISA evidence changed: '+name);inputHashes[name]=expected.sha256;}
 const names=['runtime/audio/backend.mjs','runtime/audio/pcm.mjs','runtime/audio/ringbuf.mjs','runtime/graphics.mjs','runtime/native-counters.mjs','runtime/x86_64/qemu-system-x86_64.js','runtime/x86_64/qemu-system-x86_64.wasm'];
 assert.deepEqual(Object.keys(build.artifacts).sort(),names.sort());
 for(const [name,expected]of Object.entries(build.artifacts)){
  const path=name.startsWith('runtime/x86_64/')?resolve(runtime,name.slice(15)):resolve(dirname(runtime),name.slice(8)),data=await readFile(path),actual={sha256:sha(data),bytes:data.length};assert.deepEqual(actual,expected,'MSG1 runtime bytes differ: '+name);
  inputHashes[relative(root,path)]=actual.sha256;artifacts.push({name,path:relative(root,path),...actual});
 }
 assert.equal(build.artifacts['runtime/x86_64/qemu-system-x86_64.js'].sha256,runtimeContract.jsSha256);assert.equal(build.artifacts['runtime/x86_64/qemu-system-x86_64.wasm'].sha256,runtimeContract.wasmSha256);
 return {status:'verified',contract:runtimeContract,artifacts,inputHashes,scope:'Frozen MSG1 source/build and independent arbitrary-input hot/cold ISA matrix are prerequisites; their counts are not Bun exposure measurements.'};
}
export function checkPackageRuntime(manifest){
 assert.equal(manifest.experiment?.name,'sha256msg1-v1');assert.equal(typeof manifest.experiment.enabled,'boolean');
 assert.equal(manifest.artifacts['runtime/qemu-system-x86_64.js'].sha256,runtimeContract.jsSha256);
 assert.equal(manifest.artifacts['runtime/qemu-system-x86_64.wasm'].sha256,runtimeContract.wasmSha256);
}
export const workloadPins=Object.freeze({
 'artifacts/m1-baseline-01/app.mjs.app/app.json':'39b212c4442de8fecaa620f70ac0c5e6d8a41f6d272c2dc28ba4c506177617c1',
 'benchmarks/harness/m1/driver.ts':'429c08005a3e36ed81d7098240c93b5b5c78aedd2f2dcc8df5e66dd5c6bdeb6c',
 'benchmarks/harness/m1/protocol.mjs':'fa9423577d8ac4b189f3b96d2f98de0a84a9b8ace909c9a93cc98d89f0b6aaad',
 'benchmarks/workload/operations.ts':'12df6a72cf79cd0e2b9cfd826cf45c9d9322917524cd91d9844b84914c46b498',
 'benchmarks/expected.json':'e0f1f4a96c2f5d3066695d9e26ab9980f97527a94b987ffc98947a61c2f84288',
});
export async function workloadIdentity(){
 for(const [name,digest]of Object.entries(workloadPins))assert.equal(sha(await readFile(resolve(root,name))),digest,'Original M1 workload bytes differ: '+name);
 return {...workloadPins};
}
export async function packageIdentity(directory,manifest){
 checkPackageRuntime(manifest);await workloadIdentity();
 const base=JSON.parse(await readFile(resolve(root,Object.keys(workloadPins)[0]))),expected=structuredClone(base),actual=structuredClone(manifest);
 for(const value of [expected,actual]){delete value.compatibilitySha256;delete value.generation;delete value.experiment;delete value.artifacts['runtime/qemu-system-x86_64.js'];delete value.artifacts['runtime/qemu-system-x86_64.wasm'];}
 assert.deepEqual(actual,expected,'Only MSG1 runtime and bound mode may differ from original package');
 const path=resolve(directory,'configuration-provenance.json'),bytes=await readFile(path),provenance=JSON.parse(bytes);
 assert.equal(provenance.kind,'msg1-exposure-package-v1');assert.equal(provenance.baseManifestSha256,Object.values(workloadPins)[0]);
 assert.deepEqual(provenance.experiment,manifest.experiment);assert.equal(provenance.compatibilitySha256,manifest.compatibilitySha256);
 const identity=await runtimeIdentity();assert.deepEqual(provenance.runtimeIdentity,identity);
 return {provenance,identity,inputHashes:{...workloadPins,...identity.inputHashes,[relative(root,path)]:sha(bytes)}};
}
