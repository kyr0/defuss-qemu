import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const sha=data=>createHash('sha256').update(data).digest('hex');
export async function deriveRuntime(source){
 const observer=await readFile(new URL('./observer.js',import.meta.url),'utf8');
 assert.ok(!source.includes('DEFUSS_M2_RESOURCE_OBSERVER_BEGIN'),'Already observed runtime');
 const patches=[
  ['worker-send','pcGraphicsBus:Module.pcGraphicsBus}','pcGraphicsBus:Module.pcGraphicsBus,pcResourceBus:Module.pcResourceBus}'],
  ['worker-load','startWorker=async()=>{Module.pcGraphicsBus=','startWorker=async()=>{Module.pcResourceBus=msgData.pcResourceBus;Module.pcGraphicsBus='],
  ['observer','function instantiate_wasm(',observer+'\nfunction instantiate_wasm('],
  ['attempt','const mod=new WebAssembly.Module(wasm);','pcResourceAttempt(wasm.byteLength,import_vec_size);const mod=new WebAssembly.Module(wasm);pcResourceCompiled();'],
  ['instance','const inst=new WebAssembly.Instance(mod,{env:{memory:wasmMemory},helper});','const inst=new WebAssembly.Instance(mod,{env:{memory:wasmMemory},helper});pcResourceInstantiated(wasm.byteLength,import_vec_size);'],
 ];
 const anchors=[];let output=source;
 for(const [name,before,after] of patches){
  assert.equal(output.split(before).length-1,1,'Exact resource anchor: '+name);
  anchors.push({name,before,beforeSha256:sha(before),afterSha256:sha(after),occurrences:1});output=output.replace(before,after);
 }
 return {output,derivation:{schema:1,kind:'diagnostic-js-module-input-bytes',sourceSha256:sha(source),derivedSha256:sha(output),observerSha256:sha(observer),anchors}};
}
