import assert from 'node:assert/strict';
export const recoverySources=Object.freeze(['README.md','derive.py','freeze.py','guest.mjs','identity.mjs','replay.mjs','run.mjs','test-replay.mjs'].map(n=>'tests/m3b-recovery/'+n));
export const fixtureSources=Object.freeze(['tests/m3b-fallthrough/build.py','tests/m3b-fallthrough/fixture.c','tests/m3b-fallthrough/fixture.S','tests/m3b-fallthrough/contract.mjs','experiments/m3b-fallthrough/predecode.h','packaging/bun_app_package.py',...['sdk.py','build.py','container_engine.py','runtime_dependencies.py'].map(n=>'scripts/'+n)]);
export function validateFixtureClosure(build){
 assert.deepEqual(Object.keys(build.sources).sort(),[...fixtureSources].sort());
 for(const value of Object.values(build.sources))assert.match(value,/^[a-f0-9]{64}$/);
 assert.equal(build.baseInitramfsSha256,'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9');
}
export async function verifyRecoverySources({read,manifestPath,reviewPath,binding}){
 const manifestBytes=await read(manifestPath),manifest=JSON.parse(manifestBytes);
 const reviewBytes=await read(reviewPath),review=JSON.parse(reviewBytes);
 const {createHash}=await import('node:crypto');const hash=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(manifest.schema,1);assert.equal(manifest.kind,'m3b-recovery-source-freeze');assert.equal(manifest.status,'frozen');assert.equal(manifest.timingEligible,false);
 assert.deepEqual(manifest.baseSourceManifest,binding.sourceManifest);assert.deepEqual(manifest.baseSourceReview,binding.sourceReview);
 assert.equal(review.status,'passed');assert.deepEqual(review.sourceBlockers,[]);assert.equal(review.sourceManifest.path,manifestPath);assert.equal(review.sourceManifest.sha256,hash(manifestBytes));
 assert.deepEqual(manifest.files.map(r=>r.path).sort(),[...recoverySources].sort());
 for(const row of manifest.files){assert.equal(row.archive,manifestPath.slice(0,-'manifest.json'.length)+'source/'+row.path);await read(row.path,row);await read(row.archive,row);}
 for(const [path,id]of Object.entries(manifest.dependencies))await read(path,id);
 for(const key of ['tests/m3b-fallthrough/run.mjs','tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/reader.mjs','tests/m3b-fallthrough/contract.mjs','tests/m3b-fallthrough/runtime-identity.mjs','experiments/m3a-region/reader.mjs'])assert.ok(manifest.dependencies[key]);
 return {sourceManifest:{path:manifestPath,sha256:hash(manifestBytes),bytes:manifestBytes.length},sourceReview:{path:reviewPath,sha256:hash(reviewBytes),bytes:reviewBytes.length},baseSourceManifest:manifest.baseSourceManifest,scope:'New host-only recovery adapter; unchanged engine and guest image.'};
}
