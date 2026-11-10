import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifySources as verifyParentSources} from '../m3b-context-runner-v3/identity.mjs';
export {validateImageClosure,imageSources} from '../m3b-context-runner-v3/identity.mjs';
export const files=Object.freeze(['README.md','config.mjs','transport.mjs','oracle.mjs','journal.mjs','guest.mjs','run.mjs','identity.mjs','freeze.py','test.mjs','test-transport.mjs','trace.mjs','test-trace.mjs','inspect.mjs','windows.mjs','test-windows.mjs','test-oracle.mjs'].map(n=>'tests/m3b-context-runner-v4/'+n));
export async function verifySources({read,manifestPath,reviewPath,binding}){
 // Recheck the immutable v3 host proof, which recursively binds ABI2 and v2.
 const sha=b=>createHash('sha256').update(b).digest('hex'),mb=await read(manifestPath),manifest=JSON.parse(mb),rb=await read(reviewPath),review=JSON.parse(rb);
 const manifestRef={path:manifestPath,sha256:sha(mb),bytes:mb.length},reviewRef={path:reviewPath,sha256:sha(rb),bytes:rb.length};
 assert.equal(manifest.schema,1);assert.equal(manifest.kind,'m3b-context-host-v4-source-freeze');assert.equal(manifest.status,'frozen');assert.equal(manifest.timingEligible,false);
 const previousManifest=manifest.previousHostSourceManifest,previousReview=manifest.previousHostSourceReview;
 assert.equal(previousManifest.path,'artifacts/m3b-context-v3-source-01/manifest.json');assert.equal(previousReview.path,'artifacts/m3b-context-v3-source-review-01/review.json');
 await read(previousManifest.path,previousManifest);await read(previousReview.path,previousReview);
 const parentSourceProof=await verifyParentSources({read,manifestPath:previousManifest.path,reviewPath:previousReview.path,binding});
 assert.deepEqual(parentSourceProof.sourceManifest,previousManifest);assert.deepEqual(parentSourceProof.sourceReview,previousReview);
 assert.deepEqual(manifest.parentSourceManifest,binding.sourceManifest);assert.deepEqual(manifest.parentSourceReview,binding.sourceReview);assert.equal(manifest.sourceFingerprint,binding.sourceFingerprint);
 assert.equal(review.status,'passed');assert.deepEqual(review.sourceBlockers,[]);assert.equal(review.sourceManifest.path,manifestPath);assert.equal(review.sourceManifest.sha256,sha(mb));
 assert.ok(Array.isArray(manifest.files));assert.deepEqual(manifest.files.map(r=>r.path).sort(),[...files].sort());
 for(const row of manifest.files){assert.equal(row.archive,manifestPath.slice(0,-'manifest.json'.length)+'source/'+row.path);await read(row.path,row);await read(row.archive,row);}
 assert.ok(manifest.dependencies&&typeof manifest.dependencies==='object'&&!Array.isArray(manifest.dependencies));
 for(const [path,id]of Object.entries(manifest.dependencies))await read(path,id);
 const nativePath='artifacts/m3b-context-v2-source-01/source/accel/tcg/cpu-exec.c',nativeId=manifest.dependencies[nativePath];
 assert.ok(nativeId&&/^[a-f0-9]{64}$/.test(nativeId.sha256)&&Number.isSafeInteger(nativeId.bytes)&&nativeId.bytes>0);
 const terminalNativeSource={path:nativePath,sha256:nativeId.sha256,bytes:nativeId.bytes};
 const parent=JSON.parse(await read(manifest.parentBinding.path,manifest.parentBinding));assert.deepEqual(parent,binding);
 const ref=manifest.previousFailureReview,previous=JSON.parse(await read(ref.path,ref));
 assert.equal(previous.status,'reviewed-failed-capture');assert.equal(previous.baselinePassed,false);assert.equal(previous.captureStatus,'failed');assert.deepEqual(previous.binding,manifest.parentBinding);
 assert.equal(previous.capture.path,'artifacts/m3b-context-v3-off-01/report.json');assert.match(previous.capture.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(previous.capture.bytes)&&previous.capture.bytes>0);
 const capture=JSON.parse(await read(previous.capture.path,previous.capture));assert.equal(capture.status,'failed');assert.equal(capture.protocol,'defuss-m3b-context-runner-v3');assert.equal(capture.enabled,false);assert.equal(capture.oracleFailure?.observationEvent,'complete');assert.equal(capture.gates.length,45);assert.deepEqual(capture.sourceProof.sourceManifest,previousManifest);assert.deepEqual(capture.sourceProof.sourceReview,previousReview);
 return {sourceManifest:manifestRef,sourceReview:reviewRef,parentBinding:manifest.parentBinding,previousHostSourceManifest:previousManifest,previousHostSourceReview:previousReview,parentSourceProof,terminalNativeSource,previousFailureReview:ref,contextAcceptanceIntegrated:true,scope:'Host-only bounded terminal linking-record parser over the unchanged reviewed ABI2 runtime, accounting,45 gate windows and guest workload. Preserved failed capture remains failed; all45 gates and complete evidence are still required.'};
}
