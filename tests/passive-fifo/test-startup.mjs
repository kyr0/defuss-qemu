import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {observerBus,publishObserverNative} from './contract.mjs';
import {deriveObserver} from './derive.mjs';
import {openEvents,validateEvents} from './events.mjs';

test('actual generated FIFO preRun order clones initial factory bus and sees later shared native publication',async()=>{
 const original=await readFile(new URL('../../artifacts/passive-fifo-diagnostic-build-01/runtime/x86_64/qemu-system-x86_64.js',import.meta.url),'utf8');
 const {output}=await deriveObserver(original);
 function extract(start,end){const a=output.indexOf(start),b=output.indexOf(end,a);assert.ok(a>=0&&b>a);return output.slice(a,b);}
 const callbacks=extract('var callRuntimeCallbacks=','var runDependencies=');
 const preRun=extract('function preRun(){','function initRuntime(){');
 // vm.Script cannot parse import.meta; only the unused worker-constructor URL
 // is normalized. The tested queue, pool loader and message payload are exact.
 const pthread=extract('var PThread={',';var onPostRuns=').replace('import.meta.url','"file:///unused-runtime.js"')+';';
 const observer=await readFile(new URL('./observer.js',import.meta.url),'utf8');
 for(const early of [false,true]){
  const bus=observerBus(),loads=[],order=[],Module=early?{pcFifoObserverBus:bus}:{};
  Module.preRun=[m=>{order.push('user');if(!early)m.pcFifoObserverBus=bus;publishObserverNative(bus,1024);}];
  const context=vm.createContext({Module,ENVIRONMENT_IS_NODE:false,ENVIRONMENT_IS_PTHREAD:false,wasmMemory:{},wasmModule:{},
   addRunDependency(){},removeRunDependency(){},err:()=>{},structuredClone,queueMicrotask,
   Worker:class{postMessage(message){loads.push(structuredClone(message));order.push('worker');queueMicrotask(()=>this.onmessage({data:{cmd:'loaded'}}));}}});
  vm.runInContext(callbacks+preRun+pthread+'PThread.allocateUnusedWorker=function(){PThread.unusedWorkers.push(new Worker())};PThread.initMainThread();preRun();',context);
  assert.deepEqual(order,['worker','worker','worker','worker','user']);assert.equal(loads.length,4);
  if(!early){assert.ok(loads.every(m=>m.pcFifoObserverBus===undefined),'The old late assignment reproduces lost worker settings');continue;}
  for(const load of loads){assert.notEqual(load.pcFifoObserverBus,bus);assert.equal(Atomics.load(new Uint32Array(load.pcFifoObserverBus.buffer),49),1024);assert.equal(load.pcFifoObserverBus.nativeAddress,undefined);}
  const owner=vm.createContext({Module:{pcFifoObserverBus:loads[0].pcFifoObserverBus},HEAP8:new Int8Array(new SharedArrayBuffer(65536)),SharedArrayBuffer,Uint32Array,DataView,Atomics,Map,Number,Error,BigInt,bigintToI53Checked:Number});
  vm.runInContext(observer+'fifoObsRawState=()=>0;fifoObsInit(512n);',owner);assert.equal(owner.fifoObsNativeAddress(),1024);
 }
});
test('shared native publication is single-use, bounded and required by owner',async()=>{
 const bus=observerBus();for(const bad of [0,-4,3,2**32,NaN])assert.throws(()=>publishObserverNative(bus,bad),/Invalid/);
 publishObserverNative(bus,1024n);assert.throws(()=>publishObserverNative(bus,1024n),/already/);
 const code=await readFile(new URL('./observer.js',import.meta.url),'utf8'),empty=observerBus();
 const context=vm.createContext({Module:{pcFifoObserverBus:empty},HEAP8:new Int8Array(new SharedArrayBuffer(65536)),SharedArrayBuffer,Uint32Array,DataView,Atomics,Map,Number,Error,BigInt,bigintToI53Checked:Number});
 assert.throws(()=>vm.runInContext(code+'fifoObsRawState=()=>0;fifoObsInit(512n);',context),/failure 21/);
});
test('bounded event journal is durable before callback completion and rejects fatal replay/overflow',async()=>{
 assert.ok(process.env.TMPDIR?.startsWith(process.cwd()+'/tmp/'));
 const dir=await mkdtemp(resolve(process.env.TMPDIR,'fifo-events-')),path=resolve(dir,'events.jsonl'),log=await openEvents(path);
 await log.append({event:'runner-start'});assert.equal((await readFile(path,'utf8')).trim().split('\n').length,1);
 await log.append({event:'first-stopped-gate'});let bytes=await readFile(path);validateEvents(bytes,{bytes:bytes.length,records:2});
 await log.append({event:'pageerror',text:'Missing FIFO observer bus'});bytes=await readFile(path);assert.throws(()=>validateEvents(bytes,{bytes:bytes.length,records:3}),/Fatal/);
 await assert.rejects(log.append({event:'console',text:'x'.repeat(65536)}),/bound/);await assert.rejects(log.close(),/bound/);
 assert.equal((await readFile(path,'utf8')).trim().split('\n').length,3);
});
