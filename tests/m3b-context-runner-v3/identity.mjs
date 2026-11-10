import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifySources as verifyParentSources} from '../m3b-context-runner-v2/identity.mjs';
export {validateImageClosure,imageSources} from '../m3b-context-runner-v2/identity.mjs';
export const files=Object.freeze(['README.md','config.mjs','transport.mjs','oracle.mjs','journal.mjs','guest.mjs','run.mjs','identity.mjs','freeze.py','test.mjs','test-transport.mjs','trace.mjs','test-trace.mjs','inspect.mjs','windows.mjs','test-windows.mjs','test-oracle.mjs'].map(n=>'tests/m3b-context-runner-v3/'+n));
export async function verifySources({read,manifestPath,reviewPath,binding}){
 // The unchanged runtime still binds the complete ABI2 implementation freeze.
 // The host-only128MiB capacity revision has a separate reviewed source freeze.
 const parentSourceProof=await verifyParentSources({read,manifestPath:binding.sourceManifest.path,reviewPath:binding.sourceReview.path,binding});
 const sha=b=>createHash('sha256').update(b).digest('hex'),mb=await read(manifestPath),manifest=JSON.parse(mb),rb=await read(reviewPath),review=JSON.parse(rb);
 const manifestRef={path:manifestPath,sha256:sha(mb),bytes:mb.length},reviewRef={path:reviewPath,sha256:sha(rb),bytes:rb.length};
 assert.equal(manifest.schema,1);assert.equal(manifest.kind,'m3b-context-host-v3-source-freeze');assert.equal(manifest.status,'frozen');assert.equal(manifest.timingEligible,false);
 assert.deepEqual(manifest.parentSourceManifest,binding.sourceManifest);assert.deepEqual(manifest.parentSourceReview,binding.sourceReview);assert.equal(manifest.sourceFingerprint,binding.sourceFingerprint);
 assert.equal(review.status,'passed');assert.deepEqual(review.sourceBlockers,[]);assert.equal(review.sourceManifest.path,manifestPath);assert.equal(review.sourceManifest.sha256,sha(mb));
 assert.ok(Array.isArray(manifest.files));assert.deepEqual(manifest.files.map(r=>r.path).sort(),[...files].sort());
 for(const row of manifest.files){assert.equal(row.archive,manifestPath.slice(0,-'manifest.json'.length)+'source/'+row.path);await read(row.path,row);await read(row.archive,row);}
 assert.ok(manifest.dependencies&&typeof manifest.dependencies==='object'&&!Array.isArray(manifest.dependencies));
 for(const [path,id]of Object.entries(manifest.dependencies))await read(path,id);
 const parent=JSON.parse(await read(manifest.parentBinding.path,manifest.parentBinding));assert.deepEqual(parent,binding);
 const ref=manifest.previousFailureReview,previous=JSON.parse(await read(ref.path,ref));
 assert.equal(previous.status,'reviewed-failed-capture');assert.equal(previous.baselinePassed,false);assert.equal(previous.captureStatus,'failed');assert.deepEqual(previous.binding,manifest.parentBinding);
 assert.equal(previous.capture.path,'artifacts/m3b-context-v2-off-01/report.json');assert.match(previous.capture.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(previous.capture.bytes)&&previous.capture.bytes>0);
 const capture=JSON.parse(await read(previous.capture.path,previous.capture));assert.equal(capture.status,'failed');assert.equal(capture.protocol,'defuss-m3b-context-runner-v2');assert.equal(capture.enabled,false);assert.equal(capture.oracleFailure?.gate?.seq,41);
 return {sourceManifest:manifestRef,sourceReview:reviewRef,parentBinding:manifest.parentBinding,parentSourceProof,previousFailureReview:ref,contextAcceptanceIntegrated:true,scope:'Host-only128MiB stopped-window capacity revision over the unchanged reviewed ABI2 runtime, accounting and guest workload. Preserved failed capture remains failed; all45 gates and complete evidence are still required.'};
}
