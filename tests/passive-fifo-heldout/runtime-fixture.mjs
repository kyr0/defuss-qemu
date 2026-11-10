// Synthetic source/build records for validator tests only. Never execute this runtime.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {verifyRuntime,runtimeContract,sha} from './runtime-proof.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),identity=async path=>{const bytes=await readFile(path);return {sha256:sha(bytes),bytes:bytes.length};};
export async function syntheticRuntime(js='synthetic JS',wasm=Buffer.from('synthetic WASM')){
 await mkdir(resolve(root,'tmp'),{recursive:true});const dir=await mkdtemp(resolve(root,'tmp/fifo-synthetic-'));
 const names=['runtime/audio/backend.mjs','runtime/audio/pcm.mjs','runtime/audio/ringbuf.mjs','runtime/graphics.mjs','runtime/native-counters.mjs','runtime/x86_64/qemu-system-x86_64.js','runtime/x86_64/qemu-system-x86_64.wasm'],artifacts={};
 for(const name of names){const path=resolve(dir,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,name.endsWith('.js')?js:name.endsWith('.wasm')?wasm:name);artifacts[name]=await identity(path);}
 const source=relative(root,resolve(dir,'source')),overlay={kind:'passive-fifo-v1',variant:'performance',diagnostic:false,defaultEnabled:false,newYield:false,forceGC:false,output:resolve(root,source),constants:{soft:9000,batch:256,newInstalls:256,minimumLive:512,cap:12000}},build={status:'passed',source:'/project/'+source,sourceFingerprint:runtimeContract.sourceFingerprint,targets:['x86_64-softmmu'],runs:[{returncode:0}],artifacts};
 const b=resolve(dir,'build-report.json'),o=resolve(dir,'source-fifo-overlay.json'),a=resolve(dir,'source-recheck.json'),i=resolve(dir,'inventory.json');await writeFile(b,JSON.stringify(build));await writeFile(o,JSON.stringify(overlay));await writeFile(i,'{}');
 const audit={status:'passed',kind:'passive-fifo-postbuild-audit',variant:'performance',source,sourceFingerprint:runtimeContract.sourceFingerprint,buildReport:await identity(b),overlay:await identity(o),runtimeArtifacts:artifacts,inventory:{path:relative(root,i),...await identity(i)},frozenImplementation:await identity(resolve(root,runtimeContract.frozen)),sourceReview:await identity(resolve(root,runtimeContract.review)),reviewer:await identity(resolve(root,runtimeContract.reviewer))};
 await writeFile(a,JSON.stringify(audit));const args={buildReport:b,sourceManifest:o,sourceRecheck:a};return {dir,args,proof:await verifyRuntime(args)};
}
