#!/usr/bin/env node
// Bind the one-time lowering choice into the existing snapshot compatibility hash.
import assert from 'node:assert/strict';
import {readFile,mkdir,open} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {canonical} from '../../../packaging/bun-app/snapshots.mjs';
import {runtimeIdentity,workloadIdentity,workloadPins,checkPackageRuntime,root,runtimeContract} from './identity.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
const {values}=parseArgs({options:{base:{type:'string'},output:{type:'string'},enabled:{type:'string'},runtime:{type:'string'}}});
assert.ok(values.base&&values.output&&values.runtime&&['0','1'].includes(values.enabled));
assert.ok(process.env.TMPDIR?.startsWith(root+'/tmp/'),'Run through scripts/with-tmp.py');
assert.equal(resolve(values.runtime),resolve(root,runtimeContract.runtime),'Use pinned MSG1 runtime location');
const runtimeProof=await runtimeIdentity(resolve(values.runtime));await workloadIdentity();
const base=resolve(values.base),output=resolve(values.output),old=JSON.parse(await readFile(resolve(base,'app.json')));
assert.equal(sha(await readFile(resolve(base,'app.json'))),Object.values(workloadPins)[0],'Use exact original M1 package');
assert.ok(output.startsWith(root+'/artifacts/'),'Package output belongs under project artifacts');
await validateManifest(old);assert.equal(old.experiment,undefined,'Use a fresh original package');
const {compatibilitySha256,generation,...spec}=old;
spec.artifacts=structuredClone(spec.artifacts);
const sources=Object.fromEntries(Object.keys(old.artifacts).map(name=>[name,resolve(base,generation,name)]));
if(values.runtime)for(const filename of ['qemu-system-x86_64.js','qemu-system-x86_64.wasm']){
 const name='runtime/'+filename,path=resolve(values.runtime,filename),bytes=await readFile(path);
 sources[name]=path;spec.artifacts[name]={sha256:sha(bytes),bytes:bytes.length};
}
spec.experiment={name:'sha256msg1-v1',enabled:values.enabled==='1'};
const identity=sha(canonical(spec)),manifest={...spec,compatibilitySha256:identity,generation:identity};
await validateManifest(manifest);checkPackageRuntime(manifest);await mkdir(output);
const durable=async(path,bytes)=>{const file=await open(path,'wx');try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}};
for(const [name,info] of Object.entries(spec.artifacts)){
 const source=sources[name],target=resolve(output,identity,name),bytes=await readFile(source);
 assert.equal(bytes.length,info.bytes);assert.equal(sha(bytes),info.sha256);
 await mkdir(dirname(target),{recursive:true});await durable(target,bytes);
}
await durable(resolve(output,'app.json'),JSON.stringify(manifest,null,2)+'\n');
await durable(resolve(output,'configuration-provenance.json'),JSON.stringify({schema:1,kind:'msg1-exposure-package-v1',base,baseManifestSha256:sha(await readFile(resolve(base,'app.json'))),sources,experiment:spec.experiment,compatibilitySha256:identity,runtimeIdentity:runtimeProof},null,2)+'\n');
const directories=new Set([output,dirname(output)]);for(const name of Object.keys(spec.artifacts)){let directory=dirname(resolve(output,identity,name));while(directory.startsWith(output+'/')){directories.add(directory);directory=dirname(directory);}}
for(const directory of [...directories].sort((a,b)=>b.length-a.length)){const h=await open(directory,'r');try{await h.sync();}finally{await h.close();}}
console.log(JSON.stringify({status:'passed',output,experiment:spec.experiment,compatibilitySha256:identity}));
