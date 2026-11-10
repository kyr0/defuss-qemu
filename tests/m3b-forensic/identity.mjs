import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const files=Object.freeze(['README.md','config.mjs','transport.mjs','oracle.mjs','journal.mjs','guest.mjs','run.mjs','identity.mjs','freeze.py','test.mjs','test-transport.mjs','trace.mjs','test-trace.mjs','inspect.mjs'].map(n=>'tests/m3b-forensic/'+n));
export const imageSources=Object.freeze(['tests/m3b-fallthrough/build.py','tests/m3b-fallthrough/fixture.c','tests/m3b-fallthrough/fixture.S','tests/m3b-fallthrough/contract.mjs','experiments/m3b-fallthrough/predecode.h','packaging/bun_app_package.py',...['sdk.py','build.py','container_engine.py','runtime_dependencies.py'].map(n=>'scripts/'+n)]);
export function validateImageClosure(build){assert.deepEqual(Object.keys(build.sources).sort(),[...imageSources].sort());for(const h of Object.values(build.sources))assert.match(h,/^[a-f0-9]{64}$/);assert.equal(build.baseInitramfsSha256,'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9');}
export async function verifySources({read,manifestPath,reviewPath,binding}){
 const sha=b=>createHash('sha256').update(b).digest('hex'),mb=await read(manifestPath),manifest=JSON.parse(mb),rb=await read(reviewPath),review=JSON.parse(rb);
 assert.equal(manifest.schema,1);assert.equal(manifest.kind,'m3b-forensic-source-freeze');assert.equal(manifest.status,'frozen');assert.equal(manifest.timingEligible,false);
 assert.deepEqual(manifest.baseSourceManifest,binding.sourceManifest);assert.deepEqual(manifest.baseSourceReview,binding.sourceReview);
 assert.equal(review.status,'passed');assert.deepEqual(review.sourceBlockers,[]);assert.equal(review.sourceManifest.path,manifestPath);assert.equal(review.sourceManifest.sha256,sha(mb));
 assert.deepEqual(manifest.files.map(r=>r.path).sort(),[...files].sort());
 for(const row of manifest.files){assert.equal(row.archive,manifestPath.slice(0,-'manifest.json'.length)+'source/'+row.path);await read(row.path,row);await read(row.archive,row);}
 for(const [path,id]of Object.entries(manifest.dependencies))await read(path,id);
 for(const path of ['tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/contract.mjs','tests/m3b-fallthrough/reader.mjs','tests/m3b-fallthrough/runtime-identity.mjs','tests/m3b-fallthrough/build-provenance.mjs','experiments/m3a-region/reader.mjs'])assert.ok(manifest.dependencies[path]);
 return {sourceManifest:{path:manifestPath,sha256:sha(mb),bytes:mb.length},sourceReview:{path:reviewPath,sha256:sha(rb),bytes:rb.length},scope:'Host-only forensic logging of unchanged runtime/image; original acceptance unchanged.'};
}
