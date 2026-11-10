import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyIdentity} from './identity.mjs';
const root=process.cwd(),runtime=resolve('artifacts/passive-fifo-diagnostic-build-01/runtime/x86_64'),bindingPath=resolve('artifacts/passive-fifo-diagnostic-binding-01.json');
test('actual reviewed diagnostic runtime and both retained guest images bind without executing',async()=>{
 for(const [fixture,image]of [['main','artifacts/m3-region-fixture-02'],['pressure','artifacts/m3-region-pressure-fixture-01']]){
  const result=await verifyIdentity({root,runtime,bindingPath,fixturePath:resolve(image),fixture});
  assert.equal(result.binding.runtime.length,7);assert.equal(result.derived.derivation.anchors.length,17);assert.equal(result.derived.derivation.wasmChanged,false);
  assert.equal(result.derived.derivation.sourceSha256,'c6694c0e715ce8d5bc76f07afbb5ef2adbbb2c56d557972ff0ce94e7733b9148');
 }
});
test('duplicate artifact, wrong audit, wrong image and oldM3 runtime are rejected',async()=>{
 assert.ok(process.env.TMPDIR?.startsWith(root+'/tmp/'),'Run through scripts/with-tmp.py');
 const dir=await mkdtemp(resolve(process.env.TMPDIR,'fifo-identity-')),binding=JSON.parse(await readFile(bindingPath,'utf8'));
 const args={root,runtime,bindingPath,fixturePath:resolve('artifacts/m3-region-fixture-02'),fixture:'main'};
 for(const [name,change]of [['duplicate',b=>b.runtime[6]=b.runtime[5]],['audit',b=>b.sourceRecheckSha256='0'.repeat(64)],['fingerprint',b=>b.sourceFingerprint='0'.repeat(64)]]){
  const bad=structuredClone(binding);change(bad);const path=resolve(dir,name+'.json');await writeFile(path,JSON.stringify(bad));await assert.rejects(verifyIdentity({...args,bindingPath:path}),/binding|audit|fingerprint/);
 }
 await assert.rejects(verifyIdentity({...args,runtime:resolve('artifacts/m3a-build-01/runtime/x86_64')}),/runtime bytes differ/);
 await assert.rejects(verifyIdentity({...args,fixturePath:resolve('artifacts/m3-region-pressure-fixture-01')}),/source mismatch/);
});
