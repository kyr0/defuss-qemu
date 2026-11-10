import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export {validateImageClosure} from '../m3b-context-runner/identity.mjs';
export const files=Object.freeze(['README.md','typed.mjs','mutation.mjs','test-typed.mjs','config.mjs','windows.mjs','guest.mjs','run.mjs','oracle.mjs','identity.mjs','freeze.py','recovery-contract.mjs','test-recovery-contract.mjs','test-oracle.mjs','inspect.mjs'].map(n=>'tests/m3b-context-recovery/'+n));
export async function verifySources({read,manifestPath,reviewPath,binding}){
 const sha=b=>createHash('sha256').update(b).digest('hex'),mb=await read(manifestPath),manifest=JSON.parse(mb),rb=await read(reviewPath),review=JSON.parse(rb);
 assert.equal(manifest.schema,1);assert.equal(manifest.kind,'m3b-context-recovery-source-freeze');assert.equal(manifest.status,'frozen');assert.equal(manifest.timingEligible,false);
 assert.deepEqual(manifest.parentSourceManifest,binding.sourceManifest);assert.deepEqual(manifest.parentSourceReview,binding.sourceReview);assert.equal(manifest.sourceFingerprint,binding.sourceFingerprint);
 assert.equal(review.status,'passed');assert.deepEqual(review.sourceBlockers,[]);assert.equal(review.sourceManifest.path,manifestPath);assert.equal(review.sourceManifest.sha256,sha(mb));
 assert.deepEqual(manifest.files.map(r=>r.path).sort(),[...files].sort());
 for(const row of manifest.files){assert.equal(row.archive,manifestPath.slice(0,-'manifest.json'.length)+'source/'+row.path);await read(row.path,row);await read(row.archive,row);}
 for(const [path,id]of Object.entries(manifest.dependencies))await read(path,id);
 const ref=manifest.baselineReview,baseline=JSON.parse(await read(ref.path,ref));assert.equal(baseline.status,'passed');assert.equal(baseline.baselinePassed,true);assert.equal(baseline.binding.path,manifest.parentBinding.path);assert.equal(baseline.binding.sha256,manifest.parentBinding.sha256);
 const parent=JSON.parse(await read(manifest.parentBinding.path,manifest.parentBinding));assert.deepEqual(parent,binding);
 return {sourceManifest:{path:manifestPath,sha256:sha(mb),bytes:mb.length},sourceReview:{path:reviewPath,sha256:sha(rb),bytes:rb.length},parentBinding:manifest.parentBinding,baselineReview:ref,contextAcceptanceIntegrated:true,scope:'Typed recovery source after accepted baseline; every subsequent recovery outcome remains an executed evidence requirement.'};
}
