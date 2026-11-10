import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const files=Object.freeze(['README.md','fixture.c','fixture.S','build.py','build-provenance.mjs','guest-contract.mjs','config.mjs','transport.mjs','journal.mjs','run.mjs','inspect.mjs','guest.mjs','oracle.mjs','suspension.mjs','runtime-identity.mjs','identity.mjs','controller.py','test.mjs','validate-host.py','preflight.mjs','freeze.py'].map(n=>'tests/m3b-worker-suspension/'+n));
export const imageSources=Object.freeze(['build.py','fixture.c','fixture.S','guest-contract.mjs'].map(n=>'tests/m3b-worker-suspension/'+n).concat(['experiments/m3b-fallthrough/predecode.h','packaging/bun_app_package.py',...['sdk.py','build.py','container_engine.py','runtime_dependencies.py'].map(n=>'scripts/'+n)]));
export function validateImageClosure(build){assert.deepEqual(Object.keys(build.sources).sort(),[...imageSources].sort());for(const h of Object.values(build.sources))assert.match(h,/^[a-f0-9]{64}$/);assert.equal(build.baseInitramfsSha256,'6dde230b0e49d80c54337e2854d7cff6e8c9aa8cfa37588eaf9df4dd325a87a9');}
export async function verifySources({read,verifyInput=read,manifestPath,binding}){
 const bytes=await read(manifestPath),m=JSON.parse(bytes);assert.equal(m.schema,1);assert.equal(m.kind,'m3b-worker-suspension-fixture-freeze-v1');assert.equal(m.status,'frozen');assert.equal(m.timingEligible,false);
 assert.deepEqual(m.binding,binding.observedSuspensionBinding);assert.deepEqual(m.files.map(x=>x.path).sort(),[...files].sort());
 for(const f of m.files){assert.equal(f.archive,manifestPath.slice(0,-13)+'source/'+f.path);await read(f.path,f);await read(f.archive,f);}
 for(const [p,id]of Object.entries(m.dependencies))await verifyInput(p,id);
 const tests=JSON.parse(await read(m.hostTests.path,m.hostTests));assert.equal(tests.status,'passed');assert.equal(tests.sourceStable,true);
 assert.deepEqual(tests.sources,Object.fromEntries(m.files.map(f=>[f.path,{sha256:f.sha256,bytes:f.bytes}])));
 return {sourceManifest:{path:manifestPath,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length},hostTests:m.hostTests,authorship:'Root authored host checks and source freeze, not an external source review.'};
}
