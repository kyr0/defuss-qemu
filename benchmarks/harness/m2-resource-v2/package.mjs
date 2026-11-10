#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {validateManifest} from '../../../packaging/bun-app/vm.mjs';
import {canonical} from '../../../packaging/bun-app/snapshots.mjs';
import {deriveRuntime,sha} from './derive.mjs';
const {values}=parseArgs({options:{production:{type:'string'},output:{type:'string'}}});
assert.ok(values.production&&values.output);
const production=resolve(values.production),output=resolve(values.output),raw=await readFile(resolve(production,'app.json'));
const old=JSON.parse(raw);await validateManifest(old);
assert.equal(old.experiment?.name,'sha256msg2-v1');assert.equal(typeof old.experiment.enabled,'boolean');assert.equal(old.observation,undefined);assert.equal(old.benchmark?.protocol,'defuss-m2-sustained-v2','Use the frozen sustained-v2 production package');
const {compatibilitySha256,generation,...spec}=old;
spec.artifacts=structuredClone(spec.artifacts);
const data={};for(const [name,info] of Object.entries(spec.artifacts)){
 data[name]=await readFile(resolve(production,generation,name));assert.equal(data[name].length,info.bytes);assert.equal(sha(data[name]),info.sha256);
}
const js='runtime/qemu-system-x86_64.js',wasm='runtime/qemu-system-x86_64.wasm';
const derived=await deriveRuntime(data[js].toString('utf8'));data[js]=Buffer.from(derived.output);
spec.artifacts[js]={sha256:sha(data[js]),bytes:data[js].length};
spec.observation={name:'module-input-bytes-sustained-v2',diagnostic:true,productionJsSha256:old.artifacts[js].sha256,wasmSha256:old.artifacts[wasm].sha256};
const identity=sha(canonical(spec)),manifest={...spec,compatibilitySha256:identity,generation:identity};await validateManifest(manifest);
assert.equal(sha(data[wasm]),spec.observation.wasmSha256,'WASM must remain byte-identical');
await mkdir(output);
for(const [name,bytes] of Object.entries(data)){const path=resolve(output,identity,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});}
await writeFile(resolve(output,'app.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(output,'derivation.json'),JSON.stringify({...derived.derivation,production,productionManifestSha256:sha(raw),wasmSha256:sha(data[wasm]),experiment:old.experiment,compatibilitySha256:identity},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'passed',output,experiment:spec.experiment,wasmSha256:sha(data[wasm]),compatibilitySha256:identity}));
