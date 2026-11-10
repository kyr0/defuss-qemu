import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runtimeIdentity,workloadIdentity,runtimeContract,checkPackageRuntime,root} from './identity.mjs';
import {openProgress} from './progress.mjs';
test('exact MSG1 build, arbitrary-input ISA review and unchanged M1 inputs verify without launching',async()=>{
 const proof=await runtimeIdentity();assert.equal(proof.status,'verified');assert.equal(proof.artifacts.length,7);assert.ok(Object.keys(proof.inputHashes).length>=95);await workloadIdentity();
 await assert.rejects(runtimeIdentity(resolve(root,'artifacts/m3a-build-01/runtime/x86_64')),/bytes differ/);
 const manifest={experiment:{name:'sha256msg1-v1',enabled:true},artifacts:{'runtime/qemu-system-x86_64.js':{sha256:runtimeContract.jsSha256},'runtime/qemu-system-x86_64.wasm':{sha256:runtimeContract.wasmSha256}}};checkPackageRuntime(manifest);
 for(const change of [m=>m.experiment.name='sha256msg2-v1',m=>m.artifacts['runtime/qemu-system-x86_64.js'].sha256='0'.repeat(64)]){const bad=structuredClone(manifest);change(bad);assert.throws(()=>checkPackageRuntime(bad));}
});
test('stopped pre-ACK evidence is durably retained and rejects wrong sequence/running or oversized records',async()=>{
 assert.ok(process.env.TMPDIR?.startsWith(root+'/tmp/'));const dir=await mkdtemp(resolve(process.env.TMPDIR,'msg1-progress-'));
 for(const kind of ['sequence','running','large']){
  const path=resolve(dir,kind+'.jsonl'),p=await openProgress(path,{protocol:'test'}),record={sequence:0,event:{stoppedStatus:{running:false,status:'paused'}}};
  await p.appendGate(record);assert.equal((await readFile(path,'utf8')).trim().split('\n').length,2);
  const bad={sequence:kind==='sequence'?0:1,event:{stoppedStatus:{running:kind==='running',status:'paused'},...(kind==='large'?{text:'x'.repeat(1048576)}:{})}};
  await assert.rejects(p.appendGate(bad));await p.close();
 }
});
