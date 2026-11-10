import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const sha=data=>createHash('sha256').update(data).digest('hex');
export const runtimeContract=Object.freeze({sourceFingerprint:'fbc926db3afb566515204f470da6d2dfce3b77ef9706fef2d532a71a218ad3ea',
 frozen:'artifacts/passive-fifo-overlay-source-01/manifest.json',frozenSha256:'0b0007d3c3ccc9732a0a66c308b3f6db31ff27f15d4efc189579051f503fed27',
 review:'artifacts/passive-fifo-overlay-source-review-01/review.json',reviewSha256:'2083b74b69137a0bbc235449a26a8c640110c8337fa71e3d75227649cd26c6e8',
 reviewer:'artifacts/passive-fifo-build-review-tools-01/recheck.py',reviewerSha256:'a0131cadba9a82c47e1b5a7b1fdb72d151e740eee709b70326cffa89904b3b98'});
export async function verifyRuntime({buildReport,sourceManifest,sourceRecheck}){
 const inputs={};async function identity(argument,expected){const path=resolve(root,argument);assert.ok(path.startsWith(root+'/'));const bytes=await readFile(path),id={sha256:sha(bytes),bytes:bytes.length};if(expected)for(const [k,v] of Object.entries(expected))assert.equal(id[k],v,'Runtime provenance differs: '+argument);inputs[relative(root,path)]=id.sha256;return {path,bytes,id};}
 const build=await identity(buildReport),overlay=await identity(sourceManifest),audit=await identity(sourceRecheck),b=JSON.parse(build.bytes),o=JSON.parse(overlay.bytes),a=JSON.parse(audit.bytes);
 assert.equal(b.status,'passed');assert.equal(b.sourceFingerprint,runtimeContract.sourceFingerprint);assert.deepEqual(b.targets,['x86_64-softmmu']);assert.ok(b.runs.every(r=>r.returncode===0));
 assert.equal(o.kind,'passive-fifo-v1');assert.equal(o.variant,'performance');assert.equal(o.diagnostic,false);assert.equal(o.defaultEnabled,false);assert.equal(o.newYield,false);assert.equal(o.forceGC,false);
 assert.deepEqual(o.constants,{soft:9000,batch:256,newInstalls:256,minimumLive:512,cap:12000});
 assert.equal(a.status,'passed');assert.equal(a.kind,'passive-fifo-postbuild-audit');assert.equal(a.variant,'performance');assert.equal(a.sourceFingerprint,runtimeContract.sourceFingerprint);
 assert.deepEqual(a.buildReport,build.id);assert.deepEqual(a.overlay,overlay.id);assert.deepEqual(a.runtimeArtifacts,b.artifacts);
 assert.equal(b.source,'/project/'+a.source);assert.equal(resolve(root,a.source),resolve(o.output));
 for(const [path,digest,key] of [[runtimeContract.frozen,runtimeContract.frozenSha256,'frozenImplementation'],[runtimeContract.review,runtimeContract.reviewSha256,'sourceReview'],[runtimeContract.reviewer,runtimeContract.reviewerSha256,'reviewer']]){const file=await identity(path,{sha256:digest});assert.deepEqual(a[key],file.id);}
 const frozen=JSON.parse((await identity(runtimeContract.frozen)).bytes);
 for(const row of frozen.files){await identity(row.path,{sha256:row.sha256,bytes:row.bytes});await identity(row.archive,{sha256:row.sha256,bytes:row.bytes});}
 await identity(a.inventory.path,{sha256:a.inventory.sha256,bytes:a.inventory.bytes});
 const expected=['runtime/audio/backend.mjs','runtime/audio/pcm.mjs','runtime/audio/ringbuf.mjs','runtime/graphics.mjs','runtime/native-counters.mjs','runtime/x86_64/qemu-system-x86_64.js','runtime/x86_64/qemu-system-x86_64.wasm'];assert.deepEqual(Object.keys(b.artifacts).sort(),expected.sort());
 const artifacts={};for(const name of expected){const file=await identity(resolve(dirname(build.path),name),b.artifacts[name]);artifacts[name]={path:relative(root,file.path),...file.id};}
 return {schema:1,status:'verified',contract:runtimeContract,buildReport:relative(root,build.path),sourceManifest:relative(root,overlay.path),sourceRecheck:relative(root,audit.path),artifacts,inputs,
 scope:'Exact performance build, post-build complete source audit and seven runtime artifacts. The full source tree is bound through the pinned independent audit, not rehashed while a guest runs.'};
}
export async function recheckInputs(inputs){for(const [path,digest] of Object.entries(inputs))assert.equal(sha(await readFile(resolve(root,path))),digest,'Input changed: '+path);}
