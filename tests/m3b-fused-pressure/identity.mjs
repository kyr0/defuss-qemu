import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const imageSources=Object.freeze(['tests/m3b-fused-pressure/build.py','tests/m3b-fused-pressure/fixture.c','tests/m3b-fused-pressure/fixture.S','tests/m3b-fused-pressure/guest-contract.mjs','experiments/m3b-fallthrough/predecode.h','packaging/bun_app_package.py',...['sdk.py','build.py','container_engine.py','runtime_dependencies.py'].map(n=>'scripts/'+n)]);
export function validateImageClosure(build){assert.deepEqual(Object.keys(build.sources).sort(),[...imageSources].sort());for(const h of Object.values(build.sources))assert.match(h,/^[a-f0-9]{64}$/);assert.equal(build.baseInitramfsSha256,'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9');}

export const files=Object.freeze(["README.md", "fixture.c", "fixture.S", "build.py", "guest-contract.mjs", "test-guest-contract.mjs", "config.mjs", "transport.mjs", "journal.mjs", "oracle.mjs", "guest.mjs", "run.mjs", "identity.mjs", "freeze.py", "build-provenance.mjs", "test-oracle.mjs", "inspect.mjs"].map(n=>'tests/m3b-fused-pressure/'+n));
export async function verifySources({read,verifyInput=read,manifestPath,reviewPath,binding}){
 const sha=b=>createHash('sha256').update(b).digest('hex'),mb=await read(manifestPath),manifest=JSON.parse(mb),rb=await read(reviewPath),review=JSON.parse(rb);
 assert.equal(manifest.schema,1);assert.equal(manifest.kind,'m3b-fused-pressure-source-freeze');assert.equal(manifest.status,'frozen');assert.equal(manifest.timingEligible,false);
 assert.deepEqual(manifest.parentSourceManifest,binding.sourceManifest);assert.deepEqual(manifest.parentSourceReview,binding.sourceReview);assert.equal(manifest.sourceFingerprint,binding.sourceFingerprint);
 assert.equal(review.status,'passed');assert.deepEqual(review.sourceBlockers,[]);assert.equal(review.sourceManifest.path,manifestPath);assert.equal(review.sourceManifest.sha256,sha(mb));
 assert.deepEqual(manifest.files.map(r=>r.path).sort(),[...files].sort());
 for(const row of manifest.files){assert.equal(row.archive,manifestPath.slice(0,-'manifest.json'.length)+'source/'+row.path);await read(row.path,row);await read(row.archive,row);}
 assert.ok(manifest.dependencies['tests/regions-pressure/fixture.c'],'Dynamic preserved-workload test dependency required');
 for(const [path,id]of Object.entries(manifest.dependencies))await verifyInput(path,id);
 const ref=manifest.baselineReview,baseline=JSON.parse(await read(ref.path,ref));assert.equal(baseline.status,'passed');assert.equal(baseline.baselinePassed,true);assert.deepEqual(baseline.binding,manifest.parentBinding);
 assert.ok(baseline.inventory&&typeof baseline.inventory==='object'&&!Array.isArray(baseline.inventory)&&Object.keys(baseline.inventory).length>0,'Complete baseline inventory required');
 for(const [path,id]of Object.entries(baseline.inventory)){
  assert.ok(id&&/^[a-f0-9]{64}$/.test(id.sha256)&&Number.isSafeInteger(id.bytes)&&id.bytes>=0,'Exact baseline inventory identity required');
  assert.deepEqual(manifest.dependencies[path],id,'Frozen baseline inventory identity');await verifyInput(path,id);
 }
 const parent=JSON.parse(await read(manifest.parentBinding.path,manifest.parentBinding));assert.deepEqual(parent,binding);
 return {sourceManifest:{path:manifestPath,sha256:sha(mb),bytes:mb.length},sourceReview:{path:reviewPath,sha256:sha(rb),bytes:rb.length},parentBinding:manifest.parentBinding,baselineReview:ref,naturalLifetimeOnly:true,scope:'Bounded pressure source after accepted baseline; actual natural lifetime remains an executed evidence requirement.'};
}
