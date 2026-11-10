// Future actual evidence only. A binding is supplied after reviewed build/pins exist.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export const runtimeFiles=Object.freeze(['runtime/audio/backend.mjs','runtime/audio/pcm.mjs','runtime/audio/ringbuf.mjs','runtime/graphics.mjs','runtime/native-counters.mjs','runtime/x86_64/qemu-system-x86_64.js','runtime/x86_64/qemu-system-x86_64.wasm']);
export function normalizeSource(root,value){
 root=resolve(root);assert.equal(typeof value,'string');let name;
 if(value.startsWith('/project/'))name=value.slice(9);
 else if(value.startsWith(root+'/'))name=value.slice(root.length+1);
 else {assert.ok(!value.startsWith('/'),'Unknown source root');name=value;}
 assert.ok(name.startsWith('artifacts/')&&name.split('/').every(x=>x&&!['.','..'].includes(x)),'Canonical isolated artifact source required');
 const path=resolve(root,name);assert.equal(relative(root,path),name);return path;
}
export function assertRuntimeFiles(build,recheck){assert.deepEqual(Object.keys(build).sort(),[...runtimeFiles].sort());assert.deepEqual(Object.keys(recheck).sort(),[...runtimeFiles].sort());}

export async function verifyRuntimeBinding(root,name){
 root=resolve(root);const inputs={},buffers=new Map();
 const read=async(path,expected)=>{
  const full=resolve(root,path);assert.ok(full.startsWith(root+'/'));assert.equal(await realpath(full),full,'Symlink input refused');const bytes=await readFile(full),id={sha256:sha(bytes),bytes:bytes.length};
  if(expected){assert.equal(id.sha256,expected.sha256);if(expected.bytes!==undefined)assert.equal(id.bytes,expected.bytes);}
  const key=relative(root,full);if(inputs[key])assert.deepEqual(inputs[key],id);inputs[key]=id;buffers.set(key,bytes);return bytes;
 };
 const bound=async ref=>{assert.ok(ref&&typeof ref.path==='string'&&/^[a-f0-9]{64}$/.test(ref.sha256));return JSON.parse(await read(ref.path,ref));};
 const binding=JSON.parse(await read(name));assert.equal(binding.schema,1);assert.equal(binding.kind,'m3b-differential-runtime-binding-v1');assert.equal(binding.status,'passed');assert.equal(binding.timingEligible,false);
 assert.match(binding.sourceFingerprint,/^[a-f0-9]{64}$/);assert.equal(binding.profile,1);
 const build=await bound(binding.buildReport),overlay=await bound(binding.overlayManifest),recheck=await bound(binding.sourceRecheck),freeze=await bound(binding.sourceManifest),review=await bound(binding.sourceReview);
 assert.equal(build.status,'passed');assert.equal(build.sourceFingerprint,binding.sourceFingerprint);assert.equal(normalizeSource(root,build.source),normalizeSource(root,overlay.source));assert.equal(build.sdk,'registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812');assert.deepEqual(build.targets,['x86_64-softmmu']);
 assert.equal(overlay.kind,'m3b-budget1-diagnostic-overlay');assert.equal(overlay.graphPinned,true);assert.equal(overlay.defaultEnabled,false);assert.equal(overlay.productionEligible,false);assert.equal(overlay.timingEligible,false);
 assert.equal(overlay.budget,1);assert.equal(overlay.maximumInstructions,32);assert.equal(overlay.maximumBytes,128);
 assert.equal(overlay.baseFingerprint,'b517b8d6c23d67db7e74fe4d2d5c4ff421693cb01b86c8666ffba006ca772d49');
 assert.equal(recheck.status,'passed');for(const field of ['path','sha256']){assert.equal(recheck.buildReport[field],binding.buildReport[field]);assert.equal(recheck.overlayManifest[field],binding.overlayManifest[field]);}
 assert.equal(normalizeSource(root,recheck.source.path),normalizeSource(root,overlay.source));assert.equal(recheck.source.matches,true);assert.equal(recheck.source.fingerprintBeforeBuild,binding.sourceFingerprint);assert.equal(recheck.source.fingerprintAfterBuild,binding.sourceFingerprint);
 for(const change of overlay.changes){const checked=recheck.overlayChecks.find(x=>x.path===change.path);assert.ok(checked);assert.equal(checked.passed,true);assert.equal(checked.after,change.after);assert.equal(checked.observedAfter,change.after);}
 assert.equal(review.status,'passed');assert.equal(review.sourceManifest.path,binding.sourceManifest.path);assert.equal(review.sourceManifest.sha256,binding.sourceManifest.sha256);assert.deepEqual(review.sourceBlockers,[]);
 for(const f of freeze.files){await read(f.path,f);if(f.archive)await read(f.archive,f);}
 for(const [path,id]of Object.entries(freeze.dependencies??{}))await read(path,typeof id==='string'?{sha256:id}:id);
 const graph=await read(binding.graphContract.path,binding.graphContract),text=graph.toString('utf8');assert.match(text,/^#define M3B_GRAPH_PINNED 1$/m);
 assert.equal(overlay.changes.find(x=>x.path==='system/m3b-graph-contract.h')?.after,binding.graphContract.sha256);
 assert.ok(freeze.files.some(f=>f.sha256===binding.graphContract.sha256&&f.path.endsWith('/graph-contract.h')),'Pinned graph contract absent from reviewed source freeze');
 const match=text.match(/static const char m3b_expected_graph\[\]\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*)+);/);assert.ok(match,'Expected graph literal missing');
 const graphText=[...match[1].matchAll(/"(?:[^"\\]|\\.)*"/g)].map(m=>JSON.parse(m[0])).join('');assert.ok(graphText.endsWith('\n')&&Buffer.byteLength(graphText)<=131072&&graphText.split('\n').length<=129);
 const objectMatch=text.match(/static const char m3b_expected_objects\[\]\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*)+);/);assert.ok(objectMatch,'Expected object literal missing');
 const objectText=[...objectMatch[1].matchAll(/"(?:[^"\\]|\\.)*"/g)].map(m=>JSON.parse(m[0])).join('');assert.ok(objectText.endsWith('\n')&&Buffer.byteLength(objectText)<=16384&&objectText.split('\n').length<=33);
 const graphReview=await bound(binding.graphReview);assert.equal(graphReview.status,'passed');assert.equal(graphReview.graphContract.sha256,binding.graphContract.sha256);assert.equal(graphReview.graphSha256,sha(graphText));assert.equal(graphReview.objectsSha256,sha(objectText));
 const buildDir=dirname(resolve(root,binding.buildReport.path)),runtime=resolve(root,binding.runtime);assert.equal(runtime,resolve(buildDir,'runtime/x86_64'));
 assertRuntimeFiles(build.artifacts,recheck.runtimeArtifacts);
 for(const [path,id]of Object.entries(build.artifacts)){
  assert.ok(path.startsWith('runtime/')&&!path.includes('..'));const r=recheck.runtimeArtifacts[path];assert.equal(r.matchesBuildReport,true);assert.equal(r.sha256,id.sha256);assert.equal(r.bytes,id.bytes);
  await read(relative(root,resolve(buildDir,path)),id);
 }
 for(const suffix of ['qemu-system-x86_64.js','qemu-system-x86_64.wasm'])assert.ok(buffers.has(relative(root,resolve(runtime,suffix))));
 return {binding,inputs,buffers,runtime:relative(root,runtime),graph:{text:graphText,sha256:sha(graphText),bytes:Buffer.byteLength(graphText)},objects:{text:objectText,sha256:sha(objectText),bytes:Buffer.byteLength(objectText)},sourceFingerprint:binding.sourceFingerprint,read};
}
