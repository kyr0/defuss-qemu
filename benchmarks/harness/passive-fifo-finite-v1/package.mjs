#!/usr/bin/env node
// Bind the one-time lowering choice into the existing snapshot compatibility hash.
import assert from 'node:assert/strict';
import {readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {canonical} from '../../../packaging/bun-app/snapshots.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
const {values}=parseArgs({options:{base:{type:'string'},output:{type:'string'},enabled:{type:'string'},runtime:{type:'string'}}});
assert.ok(values.base&&values.output&&['0','1'].includes(values.enabled));
const base=resolve(values.base),output=resolve(values.output),old=JSON.parse(await readFile(resolve(base,'app.json')));
await validateManifest(old);assert.equal(old.artifacts['app.mjs'].sha256,'f9ed5327b4549350c4ddd554c6ada074487a45924435ded873abe46e0aa7d668');assert.equal(old.experiment,undefined,'Use a fresh original package');
const {compatibilitySha256,generation,...spec}=old;
spec.artifacts=structuredClone(spec.artifacts);
const sources=Object.fromEntries(Object.keys(old.artifacts).map(name=>[name,resolve(base,generation,name)]));
if(values.runtime)for(const filename of ['qemu-system-x86_64.js','qemu-system-x86_64.wasm']){
 const name='runtime/'+filename,path=resolve(values.runtime,filename),bytes=await readFile(path);
 sources[name]=path;spec.artifacts[name]={sha256:sha(bytes),bytes:bytes.length};
}
spec.experiment={name:'passive-fifo-v1',enabled:values.enabled==='1'};
spec.benchmark={protocol:'defuss-m2-sustained-v2',measurementProtocol:'defuss-passive-fifo-finite-v1'};
const identity=sha(canonical(spec)),manifest={...spec,compatibilitySha256:identity,generation:identity};
await validateManifest(manifest);await mkdir(output);
for(const [name,info] of Object.entries(spec.artifacts)){
 const source=sources[name],target=resolve(output,identity,name),bytes=await readFile(source);
 assert.equal(bytes.length,info.bytes);assert.equal(sha(bytes),info.sha256);
 await mkdir(dirname(target),{recursive:true});await copyFile(source,target);
}
await writeFile(resolve(output,'app.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(output,'configuration-provenance.json'),JSON.stringify({schema:1,base,baseManifestSha256:sha(await readFile(resolve(base,'app.json'))),sources,experiment:spec.experiment,compatibilitySha256:identity},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'passed',output,experiment:spec.experiment,compatibilitySha256:identity}));
