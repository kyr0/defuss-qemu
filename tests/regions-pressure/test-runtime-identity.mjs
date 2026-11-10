import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRuntimeIdentity,runtimeContract} from './runtime-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),runtime=resolve(root,'artifacts/m3a-build-01/runtime/x86_64');
function modified(path){return async name=>{const bytes=await readFile(name);return name===path?Buffer.concat([bytes,Buffer.from('\n')]):bytes;};}
test('exact retained build provenance and seven runtime byte identities pass without execution',async()=>{
 const evidence=await verifyRuntimeIdentity({root,runtime});assert.equal(evidence.status,'verified');assert.equal(evidence.artifacts.length,7);
 assert.equal(evidence.contract.sourceFingerprint,runtimeContract.sourceFingerprint);
 assert.equal(evidence.artifacts.find(r=>r.buildArtifact.endsWith('.wasm')).sha256,runtimeContract.wasmSha256);
});
test('changed build report is rejected before runtime loading',async()=>{
 await assert.rejects(verifyRuntimeIdentity({root,runtime,readFile:modified(resolve(root,runtimeContract.buildReport))}),/provenance identity mismatch/);
});
test('changed post-build source audit is rejected',async()=>{
 await assert.rejects(verifyRuntimeIdentity({root,runtime,readFile:modified(resolve(root,runtimeContract.sourceRecheck))}),/provenance identity mismatch/);
});
test('API-compatible but different JS bytes are rejected',async()=>{
 await assert.rejects(verifyRuntimeIdentity({root,runtime,readFile:modified(resolve(runtime,'qemu-system-x86_64.js'))}),/artifact identity mismatch/);
});
test('changed imported counter helper is rejected with the original engine binary',async()=>{
 await assert.rejects(verifyRuntimeIdentity({root,runtime,readFile:modified(resolve(dirname(runtime),'native-counters.mjs'))}),/artifact identity mismatch/);
});
