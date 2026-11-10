import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyRuntimeBinding,runtimeFiles} from '../m3b-fallthrough/runtime-identity.mjs';
const parentPath='artifacts/m3b-context-v2-binding-01/binding.json',parentSha='fde6abcfa0cae40e8be1fed679f4e54783325ad16d8d88b9a9a0a517e35c4c22';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function verifySuspensionBinding(root,path){
 const proof=await verifyRuntimeBinding(root,parentPath);assert.equal(proof.inputs[parentPath].sha256,parentSha);proof.buffers.clear();
 const read=async(name,expected)=>{const p=resolve(root,name);assert.ok(p.startsWith(root+'/'));assert.equal(await realpath(p),p);const b=await readFile(p),id={sha256:sha(b),bytes:b.length};if(expected)assert.deepEqual(id,{sha256:expected.sha256,bytes:expected.bytes});if(proof.inputs[name])assert.deepEqual(id,proof.inputs[name]);proof.inputs[name]=id;return b;};
 const bound=async ref=>JSON.parse(await read(ref.path,ref)),observed=JSON.parse(await read(path));
 assert.equal(observed.kind,'m3b-worker-suspension-observed-binding-v1');assert.equal(observed.status,'passed');assert.equal(observed.timingEligible,false);const binding=await bound(observed.native);
 const derivation=await bound(observed.derivation);assert.equal(derivation.status,'derived');await read(derivation.original.path,derivation.original);await read(derivation.observer.path,derivation.observer);await read(derivation.tool.path,derivation.tool);
 for(const [p,id]of Object.entries(observed.inputs))await read(p,id);
 assert.equal(binding.kind,'m3b-worker-suspension-runtime-binding-v1');assert.equal(binding.status,'passed');assert.equal(binding.timingEligible,false);assert.equal(binding.parent.path,parentPath);assert.equal(binding.parent.sha256,parentSha);assert.deepEqual(binding.suspensionAbi,{version:1,words:2624,slots:4,stride:640});
 const pre=await bound(binding.prebuild),post=await bound(binding.postbuild),build=await bound(binding.buildReport),overlay=await bound(binding.overlay);
 assert.equal(pre.status,'passed');assert.equal(post.status,'passed');assert.equal(build.status,'passed');assert.equal(pre.baseFingerprint,proof.sourceFingerprint);assert.equal(overlay.baseFingerprint,proof.sourceFingerprint);
 assert.equal(pre.originalServiceFunctionUnchanged,true);assert.equal(pre.allOtherFilesByteIdentical,true);assert.equal(post.sourceStable,true);assert.equal(post.parentSourceStable,true);
 assert.deepEqual(pre.changes,['tcg/m3s-observer.inc','tcg/wasm64.c']);assert.deepEqual(overlay.changes.map(r=>r.path).sort(),pre.changes);
 for(const value of [pre.sourceFingerprint,post.sourceFingerprint,overlay.sourceFingerprint,build.sourceFingerprint])assert.equal(value,binding.sourceFingerprint);
 assert.equal(build.sdk,'registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812');assert.deepEqual(build.targets,['x86_64-softmmu']);
 const source=binding.source;assert.equal(pre.source,source);assert.equal(post.source,source);assert.equal(build.source,'/project/'+source);assert.equal(overlay.source,resolve(root,source));
 for(const f of pre.files){await read(f.path,f);await read(f.archive,f);}
 for(const [name,id]of Object.entries(post.inputs))await read(name,id);
 const before=await bound(pre.sourceInventory),after=await bound(post.sourceInventory);assert.deepEqual(after,before);
 assert.equal(before.fingerprint,binding.sourceFingerprint);assert.equal(Object.keys(before.files).length,10115);assert.equal(Object.keys(before.links).length,14);
 const hash=createHash('sha256');for(const [name,id]of Object.entries(before.files)){hash.update(name+'\0');hash.update(Buffer.from(id.sha256,'hex'));}assert.equal(hash.digest('hex'),binding.sourceFingerprint);
 for(const change of overlay.changes){assert.deepEqual(before.files[change.path],change.after);await read(source+'/'+change.path,change.after);}
 assert.deepEqual(Object.keys(build.artifacts).sort(),[...runtimeFiles].sort());assert.deepEqual(post.runtimeArtifacts,build.artifacts);
 const directory=dirname(binding.buildReport.path);assert.equal(binding.runtime,directory+'/runtime/x86_64');
 assert.deepEqual(Object.keys(observed.artifacts).sort(),[...runtimeFiles].sort());
 assert.equal(observed.runtime,dirname(path)+'/runtime/x86_64');
 for(const name of runtimeFiles){
  await read(directory+'/'+name,build.artifacts[name]);const p=dirname(path)+'/'+name;
  if(name.endsWith('.js'))assert.deepEqual(observed.artifacts[name],{sha256:derivation.derived.sha256,bytes:derivation.derived.bytes});
  else assert.deepEqual(observed.artifacts[name],build.artifacts[name]);
  proof.buffers.set(p,await read(p,observed.artifacts[name]));
 }
 const original=await read(derivation.original.path,derivation.original),observer=await read(derivation.observer.path,derivation.observer);
 let expected=original.toString();for(const [a,b]of Object.entries(derivation.replacements)){assert.equal(expected.split(a).length,2);expected=expected.replace(a,b);}
 assert.equal(expected.split('function instantiate_wasm(').length,2);expected=expected.replace('function instantiate_wasm(',observer.toString()+'\nfunction instantiate_wasm(');
 assert.equal(proof.buffers.get(observed.runtime+'/qemu-system-x86_64.js').toString(),expected,'Exact fresh JS derivation');
 assert.equal(derivation.original.path,directory+'/runtime/x86_64/qemu-system-x86_64.js');
 // Preserve the unchanged census declaration for its frozen reader, and bind
 // the additional observer separately. No old runtime identity is reused.
 return {...proof,binding:{...proof.binding,suspensionBinding:binding,observedSuspensionBinding:observed},runtime:observed.runtime,sourceFingerprint:binding.sourceFingerprint,suspensionBinding:binding,read};
}
