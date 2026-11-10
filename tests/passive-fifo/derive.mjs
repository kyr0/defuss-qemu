import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const sha=data=>createHash('sha256').update(data).digest('hex');
export async function deriveObserver(source){
 assert.ok(!source.includes('DEFUSS_FIFO_ASYNC_OBSERVER_BEGIN'),'Already observed runtime');
 const observer=await readFile(new URL('./observer.js',import.meta.url),'utf8');
 const patches=[
 ['worker-send','pcGraphicsBus:Module.pcGraphicsBus}','pcGraphicsBus:Module.pcGraphicsBus,pcFifoObserverBus:Module.pcFifoObserverBus}'],
 ['worker-load','startWorker=async()=>{Module.pcGraphicsBus=','startWorker=async()=>{Module.pcFifoObserverBus=msgData.pcFifoObserverBus;Module.pcGraphicsBus='],
 ['observer','function instantiate_wasm(',observer+'\nfunction instantiate_wasm('],
 ['raw-state','function pcInitNativeUnwind(exports){','function pcInitNativeUnwind(exports){fifoObsRawState=exports.asyncify_get_state;'],
 ['owner','function init_wasm_js(instance_done_gc){','function init_wasm_js(instance_done_gc){fifoObsInit(instance_done_gc);'],
 ['register','inst_gc_registry.register(inst.exports.start,"tbinstance")','inst_gc_registry.register(inst.exports.start,fifoObsRegister())'],
 ['install','const entry=addFunction(inst.exports.start,"ii");','const entry=addFunction(inst.exports.start,"ii");fifoObsInstall(entry);'],
 ['remove','var removeFunction=index=>{','var removeFunction=index=>{fifoObsRemove(index);'],
 ['delivered','new FinalizationRegistry(i=>{if(i=="tbinstance")','new FinalizationRegistry(i=>{i=fifoObsDelivered(i);if(i=="tbinstance")'],
 ['normal','function fifo_asyncify_normal(){','function fifo_asyncify_normal(){fifoObsNormal();'],
 ['sleep-unwind','runAndAbortIfError(()=>_asyncify_start_unwind(Asyncify.currData))','runAndAbortIfError(()=>{fifoObsTransition(1,Asyncify.currData,0);_asyncify_start_unwind(Asyncify.currData)})'],
 ['sleep-rewind','runAndAbortIfError(()=>_asyncify_start_rewind(Asyncify.currData))','runAndAbortIfError(()=>{fifoObsTransition(2,Asyncify.currData,0);_asyncify_start_rewind(Asyncify.currData)})'],
 ['stop-unwind','runAndAbortIfError(_asyncify_stop_unwind)','runAndAbortIfError(()=>{fifoObsTransition(3,Asyncify.currData,2);_asyncify_stop_unwind()})'],
 ['sleep-stop-rewind','runAndAbortIfError(_asyncify_stop_rewind)','runAndAbortIfError(()=>{fifoObsTransition(4,Asyncify.currData,0);_asyncify_stop_rewind()})'],
 ['fiber-unwind','_asyncify_start_unwind(asyncifyData);','fifoObsTransition(1,asyncifyData,1);_asyncify_start_unwind(asyncifyData);'],
 ['fiber-rewind','_asyncify_start_rewind(asyncifyData);','fifoObsTransition(2,asyncifyData,1);_asyncify_start_rewind(asyncifyData);'],
 ['fiber-stop-rewind','_asyncify_stop_rewind();Asyncify.currData=null','fifoObsTransition(4,Asyncify.currData,1);_asyncify_stop_rewind();Asyncify.currData=null'],
 ];
 const anchors=[];let output=source;
 for(const [name,before,after]of patches){assert.equal(output.split(before).length-1,1,'Exact FIFO observer anchor: '+name);output=output.replace(before,after);anchors.push({name,before,beforeSha256:sha(before),afterSha256:sha(after),occurrences:1});}
 return {output,derivation:{schema:1,kind:'passive-fifo-async-observer-v2',timingEligible:false,sourceSha256:sha(source),derivedSha256:sha(output),observerSha256:sha(observer),anchors,wasmChanged:false,forceGC:false,newYield:false}};
}
