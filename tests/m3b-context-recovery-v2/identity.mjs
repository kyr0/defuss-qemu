import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {runtimeFiles} from '../m3b-fallthrough/runtime-identity.mjs';
import {verifySources as verifyHostSources} from '../m3b-context-runner-v5/identity.mjs';
export {validateImageClosure} from '../m3b-context-runner-v5/identity.mjs';
export const files=Object.freeze(['README.md','typed.mjs','mutation.mjs','test-typed.mjs','config.mjs','windows.mjs','guest.mjs','run.mjs','oracle.mjs','identity.mjs','freeze.py','recovery-contract.mjs','test-recovery-contract.mjs','test-oracle.mjs','inspect.mjs'].map(n=>'tests/m3b-context-recovery-v2/'+n));
export function retainRuntimeBuffers(proof,destination){
 assert.ok(proof.buffers instanceof Map&&destination instanceof Map);assert.ok(proof.runtime.endsWith('/runtime/x86_64'));
 const build=dirname(dirname(proof.runtime)),prefix=build+'/runtime/',expected=runtimeFiles.map(path=>build+'/'+path).sort();
 assert.equal(expected.length,7);assert.deepEqual([...proof.buffers.keys()].filter(path=>path.startsWith(prefix)).sort(),expected,'Exact seven runtime buffers required');
 // Validate everything before changing either map. The bytes were already
 // verified by the immutable binding reader and remain actual owned buffers.
 for(const path of expected){const bytes=proof.buffers.get(path);assert.ok(bytes instanceof Uint8Array);assert.deepEqual(proof.inputs[path],{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.byteLength});}
 for(const path of expected)destination.set(path,proof.buffers.get(path));
 proof.buffers.clear();return expected;
}
export async function verifySources({read,manifestPath,reviewPath,binding}){
 const sha=b=>createHash('sha256').update(b).digest('hex'),mb=await read(manifestPath),manifest=JSON.parse(mb),rb=await read(reviewPath),review=JSON.parse(rb);
 assert.equal(manifest.schema,1);assert.equal(manifest.kind,'m3b-context-recovery-v2-source-freeze');assert.equal(manifest.status,'frozen');assert.equal(manifest.timingEligible,false);
 assert.deepEqual(manifest.parentSourceManifest,binding.sourceManifest);assert.deepEqual(manifest.parentSourceReview,binding.sourceReview);assert.equal(manifest.sourceFingerprint,binding.sourceFingerprint);
 assert.equal(review.status,'passed');assert.deepEqual(review.sourceBlockers,[]);assert.equal(review.sourceManifest.path,manifestPath);assert.equal(review.sourceManifest.sha256,sha(mb));
 assert.deepEqual(manifest.files.map(r=>r.path).sort(),[...files].sort());
 for(const row of manifest.files){assert.equal(row.archive,manifestPath.slice(0,-'manifest.json'.length)+'source/'+row.path);await read(row.path,row);await read(row.archive,row);}
 for(const [path,id]of Object.entries(manifest.dependencies))await read(path,id);
 const hostManifest='artifacts/m3b-context-v5-source-01/manifest.json',hostReview='artifacts/m3b-context-v5-source-review-01/review.json';
 for(const path of [hostManifest,hostReview]){const id=manifest.dependencies[path];assert.ok(id&&/^[a-f0-9]{64}$/.test(id.sha256)&&Number.isSafeInteger(id.bytes)&&id.bytes>0);await read(path,id);}
 const hostSourceProof=await verifyHostSources({read,manifestPath:hostManifest,reviewPath:hostReview,binding});
 assert.deepEqual(hostSourceProof.sourceManifest,manifest.hostSourceManifest);assert.deepEqual(hostSourceProof.sourceReview,manifest.hostSourceReview);
 const ref=manifest.baselineReview,baseline=JSON.parse(await read(ref.path,ref));assert.equal(baseline.status,'passed');assert.equal(baseline.baselinePassed,true);assert.deepEqual(baseline.binding,manifest.parentBinding);
 assert.ok(baseline.inventory&&typeof baseline.inventory==='object'&&!Array.isArray(baseline.inventory)&&Object.keys(baseline.inventory).length>0,'Complete baseline review inventory map required');
 for(const [path,id]of Object.entries(baseline.inventory)){assert.match(id.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(id.bytes)&&id.bytes>=0);assert.deepEqual(manifest.dependencies[path],{sha256:id.sha256,bytes:id.bytes},'Baseline inventory must be in recovery freeze');await read(path,id);}
 const archived=manifest.previousRecoverySource;assert.equal(archived.path,'artifacts/m3b-context-recovery-v2-before-v5-port-01/manifest.json');const old=JSON.parse(await read(archived.path,archived));assert.equal(old.kind,'m3b-context-recovery-v2-before-v5-port');assert.equal(old.status,'preserved');assert.equal(old.files.length,15);
 for(const row of old.files){assert.deepEqual(manifest.dependencies[row.archive],{sha256:row.sha256,bytes:row.bytes});await read(row.archive,row);}
 const cacheArchive=manifest.cacheCleanupSource;assert.equal(cacheArchive.path,'artifacts/m3b-context-recovery-v2-before-cache-fix-01/manifest.json');const cached=JSON.parse(await read(cacheArchive.path,cacheArchive));assert.equal(cached.kind,'m3b-context-recovery-v2-before-cache-fix');assert.equal(cached.status,'preserved');assert.equal(cached.files.length,15);assert.deepEqual(cached.priorArchive,archived);
 const cacheTests=JSON.parse(await read(cached.testReport.path,cached.testReport));assert.equal(cacheTests.status,'passed');assert.equal(cacheTests.returncode,0);assert.equal(cacheTests.sourceStable,true);
 for(const row of cached.files){const id={sha256:row.sha256,bytes:row.bytes};assert.deepEqual(cacheTests.sources[row.path],id);assert.deepEqual(manifest.dependencies[row.archive],id);await read(row.archive,row);}
 const parent=JSON.parse(await read(manifest.parentBinding.path,manifest.parentBinding));assert.deepEqual(parent,binding);
 return {sourceManifest:{path:manifestPath,sha256:sha(mb),bytes:mb.length},sourceReview:{path:reviewPath,sha256:sha(rb),bytes:rb.length},parentBinding:manifest.parentBinding,hostSourceProof,terminalNativeSource:hostSourceProof.terminalNativeSource,baselineReview:ref,previousRecoverySource:archived,cacheCleanupSource:cacheArchive,contextAcceptanceIntegrated:true,scope:'Typed recovery source after accepted baseline, using reviewed v5 accounting and unchanged terminal parsing; every subsequent recovery outcome remains an executed evidence requirement.'};
}
