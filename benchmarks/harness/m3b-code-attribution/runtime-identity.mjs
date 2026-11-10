import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyRuntimeBinding,runtimeFiles} from '../../../tests/m3b-fallthrough/runtime-identity.mjs';
const parentPath='artifacts/m3b-context-v2-binding-01/binding.json',parentSha='fde6abcfa0cae40e8be1fed679f4e54783325ad16d8d88b9a9a0a517e35c4c22';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function verifyCodeBinding(root,path){
 const proof=await verifyRuntimeBinding(root,parentPath);assert.equal(proof.inputs[parentPath].sha256,parentSha);proof.buffers.clear();
 const read=async(name,expected)=>{const p=resolve(root,name);assert.ok(p.startsWith(root+'/'));assert.equal(await realpath(p),p);const b=await readFile(p),id={sha256:sha(b),bytes:b.length};if(expected)assert.deepEqual(id,{sha256:expected.sha256,bytes:expected.bytes});if(proof.inputs[name])assert.deepEqual(id,proof.inputs[name]);proof.inputs[name]=id;return b;};
 const bound=async ref=>JSON.parse(await read(ref.path,ref)),binding=JSON.parse(await read(path));
 assert.equal(binding.kind,'m3b-code-attribution-runtime-binding-v1');assert.equal(binding.status,'passed');assert.equal(binding.timingEligible,false);assert.equal(binding.parent.path,parentPath);assert.equal(binding.parent.sha256,parentSha);assert.deepEqual(binding.codeAbi,{version:1,words:2112,slots:16,stride:128});
 const pre=await bound(binding.prebuild),post=await bound(binding.postbuild),build=await bound(binding.buildReport),overlay=await bound(binding.overlay);
 assert.equal(pre.status,'passed');assert.equal(post.status,'passed');assert.equal(build.status,'passed');assert.equal(pre.baseFingerprint,proof.sourceFingerprint);assert.equal(overlay.baseFingerprint,proof.sourceFingerprint);
 for(const key of ['originalServiceFunctionUnchanged','originalCountdownAndPoolPredicateUnchanged','originalDescriptorLayoutUnchanged'])assert.equal(pre[key],true);assert.equal(pre.allOtherFilesByteIdentical,true);assert.equal(post.sourceStable,true);assert.equal(post.parentSourceStable,true);
 assert.deepEqual(pre.changes,['include/qemu/m3b-profile.h','target/i386/tcg/m3b-frontend.inc','tcg/m3b-runtime-head.inc','tcg/m3co-observer.inc']);assert.deepEqual(overlay.changes.map(r=>r.path).sort(),pre.changes);
 for(const value of [pre.sourceFingerprint,post.sourceFingerprint,overlay.sourceFingerprint,build.sourceFingerprint])assert.equal(value,binding.sourceFingerprint);
 assert.equal(build.sdk,'registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812');assert.deepEqual(build.targets,['x86_64-softmmu']);
 const source=binding.source;assert.equal(pre.source,source);assert.equal(post.source,source);assert.equal(build.source,'/project/'+source);assert.equal(overlay.source,resolve(root,source));
 for(const f of pre.files){await read(f.path,f);await read(f.archive,f);}
 for(const [name,id]of Object.entries(post.inputs))await read(name,id);
 const before=await bound(pre.sourceInventory),after=await bound(post.sourceInventory);assert.deepEqual(after,before);
 assert.equal(Object.keys(before.files).length,10115);assert.equal(Object.keys(before.links).length,14);
 const hash=createHash('sha256');for(const [name,id]of Object.entries(before.files)){hash.update(name+'\0');hash.update(Buffer.from(id.sha256,'hex'));}assert.equal(hash.digest('hex'),binding.sourceFingerprint);
 for(const change of overlay.changes){assert.deepEqual(before.files[change.path],change.after);await read(source+'/'+change.path,change.after);}
 assert.deepEqual(Object.keys(build.artifacts).sort(),[...runtimeFiles].sort());assert.deepEqual(post.runtimeArtifacts,build.artifacts);
 const directory=dirname(binding.buildReport.path);assert.equal(binding.runtime,directory+'/runtime/x86_64');
 for(const name of runtimeFiles){const path=directory+'/'+name;proof.buffers.set(path,await read(path,build.artifacts[name]));}
 // Preserve the unchanged census declaration for its frozen reader, and bind
 // the additional observer separately. No old runtime identity is reused.
 return {...proof,binding:{...proof.binding,codeBinding:binding},runtime:binding.runtime,sourceFingerprint:binding.sourceFingerprint,codeBinding:binding,read};
}
