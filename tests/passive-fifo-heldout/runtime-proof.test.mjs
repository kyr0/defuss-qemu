import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {verifyRuntime,runtimeContract,sha} from './runtime-proof.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),id=async path=>{const b=await readFile(path);return {sha256:sha(b),bytes:b.length};};
test('performance build provenance binds exact source audit and all seven artifact bytes',async()=>{
 const base=resolve(root,'tmp');await mkdir(base,{recursive:true});const dir=await mkdtemp(resolve(base,'fifo-proof-'));
 const names=['runtime/audio/backend.mjs','runtime/audio/pcm.mjs','runtime/audio/ringbuf.mjs','runtime/graphics.mjs','runtime/native-counters.mjs','runtime/x86_64/qemu-system-x86_64.js','runtime/x86_64/qemu-system-x86_64.wasm'],artifacts={};
 for(const name of names){const path=resolve(dir,name);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,name);artifacts[name]=await id(path);}
 const source=relative(root,resolve(dir,'source')),overlay={kind:'passive-fifo-v1',variant:'performance',diagnostic:false,defaultEnabled:false,newYield:false,forceGC:false,output:resolve(root,source),constants:{soft:9000,batch:256,newInstalls:256,minimumLive:512,cap:12000}},build={status:'passed',source:'/project/'+source,sourceFingerprint:runtimeContract.sourceFingerprint,targets:['x86_64-softmmu'],runs:[{returncode:0}],artifacts};
 const b=resolve(dir,'build-report.json'),o=resolve(dir,'source-fifo-overlay.json'),a=resolve(dir,'source-recheck.json'),inventory=resolve(dir,'inventory.json');await writeFile(b,JSON.stringify(build));await writeFile(o,JSON.stringify(overlay));await writeFile(inventory,'{}');
 const audit={status:'passed',kind:'passive-fifo-postbuild-audit',variant:'performance',source,sourceFingerprint:runtimeContract.sourceFingerprint,buildReport:await id(b),overlay:await id(o),runtimeArtifacts:artifacts,inventory:{path:relative(root,inventory),...await id(inventory)},frozenImplementation:await id(resolve(root,runtimeContract.frozen)),sourceReview:await id(resolve(root,runtimeContract.review)),reviewer:await id(resolve(root,runtimeContract.reviewer))};
 await writeFile(a,JSON.stringify(audit));const args={buildReport:b,sourceManifest:o,sourceRecheck:a};assert.equal((await verifyRuntime(args)).status,'verified');
 audit.variant='diagnostic';await writeFile(a,JSON.stringify(audit));await assert.rejects(()=>verifyRuntime(args));audit.variant='performance';await writeFile(a,JSON.stringify(audit));
 await writeFile(resolve(dir,names[0]),'corrupt');await assert.rejects(()=>verifyRuntime(args),/provenance differs/);
});
