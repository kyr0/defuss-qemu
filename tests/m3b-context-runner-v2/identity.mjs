import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const files=Object.freeze(['README.md','config.mjs','transport.mjs','oracle.mjs','journal.mjs','guest.mjs','run.mjs','identity.mjs','freeze.py','test.mjs','test-transport.mjs','trace.mjs','test-trace.mjs','inspect.mjs','windows.mjs','test-windows.mjs','test-oracle.mjs'].map(n=>'tests/m3b-context-runner-v2/'+n));
export const imageSources=Object.freeze(['tests/m3b-fallthrough/build.py','tests/m3b-fallthrough/fixture.c','tests/m3b-fallthrough/fixture.S','tests/m3b-fallthrough/contract.mjs','experiments/m3b-fallthrough/predecode.h','packaging/bun_app_package.py',...['sdk.py','build.py','container_engine.py','runtime_dependencies.py'].map(n=>'scripts/'+n)]);
export function validateImageClosure(build){assert.deepEqual(Object.keys(build.sources).sort(),[...imageSources].sort());for(const h of Object.values(build.sources))assert.match(h,/^[a-f0-9]{64}$/);assert.equal(build.baseInitramfsSha256,'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9');}
export async function verifySources({read,manifestPath,reviewPath,binding}){
 const sha=b=>createHash('sha256').update(b).digest('hex'),mb=await read(manifestPath),manifest=JSON.parse(mb),rb=await read(reviewPath),review=JSON.parse(rb);
 const manifestRef={path:manifestPath,sha256:sha(mb),bytes:mb.length},reviewRef={path:reviewPath,sha256:sha(rb),bytes:rb.length};
 assert.deepEqual(binding.sourceManifest,manifestRef);assert.deepEqual(binding.sourceReview,reviewRef);
 assert.equal(manifest.schema,1);assert.equal(manifest.kind,'m3b-context-census-source-freeze');assert.equal(manifest.variant,'m3b-context-census-v2');assert.equal(manifest.status,'frozen');assert.equal(manifest.timingEligible,false);
 assert.equal(review.status,'passed');assert.deepEqual(review.sourceBlockers,[]);assert.equal(review.sourceManifest.path,manifestPath);assert.equal(review.sourceManifest.sha256,sha(mb));
 assert.ok(Array.isArray(manifest.files)&&Array.isArray(manifest.newFiles));assert.equal(new Set(manifest.files.map(r=>r.path)).size,manifest.files.length);assert.equal(new Set(manifest.newFiles).size,manifest.newFiles.length);
 const required=[...files,'tests/m3b-context-accounting-v2/contract.mjs','tests/m3b-context-accounting-v2/census-reader.mjs','tests/m3b-context-accounting-v2/census-browser.mjs','experiments/m3b-context-census-v2/ABI.md','experiments/m3b-context-proof-v2/proof.py'];
 for(const path of required){assert.ok(manifest.newFiles.includes(path),'Required new source absent: '+path);assert.ok(manifest.files.some(r=>r.path===path));}
 const oldPath='artifacts/m3b-implementation-source-01/manifest.json',oldHash='c68689c58c732fd99a858b4e515c3b57934a76c933ca3375600e939fa4e6c1bc';
 assert.equal(manifest.parentManifest.path,oldPath);assert.equal(manifest.parentManifest.sha256,oldHash);const old=JSON.parse(await read(oldPath,manifest.parentManifest));assert.deepEqual(manifest.files.slice(0,old.files.length),old.files);
 assert.deepEqual(manifest.files.slice(old.files.length).map(r=>r.path),manifest.newFiles);
 for(const row of manifest.files){if(manifest.newFiles.includes(row.path))assert.equal(row.archive,manifestPath.slice(0,-'manifest.json'.length)+'source/'+row.path);await read(row.path,row);await read(row.archive,row);}
 for(const [path,id]of Object.entries(manifest.dependencies))await read(path,id);
 for(const path of ['tests/m3b-fallthrough/guest.mjs','tests/m3b-fallthrough/contract.mjs','tests/m3b-fallthrough/reader.mjs','tests/m3b-fallthrough/runtime-identity.mjs','tests/m3b-fallthrough/build-provenance.mjs','experiments/m3a-region/reader.mjs'])assert.ok(manifest.files.some(r=>r.path===path)||manifest.dependencies[path]);
 return {sourceManifest:manifestRef,sourceReview:reviewRef,parentManifest:manifest.parentManifest,variant:manifest.variant,contextAcceptanceIntegrated:true,scope:'Combined reviewed source freeze with census-complete positive-window accounting; full capture and all45 unchanged guest oracles remain mandatory.'};
}
