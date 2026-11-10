import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {observerBus,publishObserverNative,observerSnapshot,readTrace,pressureState,acceptPressure,validateMainOracle} from './contract.mjs';
import {deriveObserver} from './derive.mjs';
const code=await readFile(new URL('./observer.js',import.meta.url),'utf8');
function fixture(){
 const bus=observerBus();publishObserverNative(bus,1024);const heap=new SharedArrayBuffer(65536),words=new Uint32Array(bus.buffer),memory=new DataView(heap);
 const context=vm.createContext({Module:{pcFifoObserverBus:bus},HEAP8:new Int8Array(heap),SharedArrayBuffer,Uint32Array,DataView,Atomics,Map,Number,Error,BigInt,bigintToI53Checked:Number,Asyncify:{state:0,State:{Normal:0,Unwinding:1,Rewinding:2}},nativeState:0});
 vm.runInContext(code+'\nfifoObsRawState=()=>nativeState;fifoObsInit(512n);',context);
 const tokens=[];function install(n){for(let i=0;i<n;i++){const token=context.fifoObsRegister();tokens.push(token);context.fifoObsInstall(tokens.length);}}
 function retire(start,n){for(let i=start;i<start+n;i++)context.fifoObsRemove(i+1);context.fifoObsCloseGroup();}
 function transition(kind,key=4096,route=0){context.Asyncify.state=({1:1,2:2,3:0,4:0})[kind];context.nativeState=({1:0,2:0,3:1,4:2})[kind];context.fifoObsTransition(kind,key,route);context.nativeState=({1:1,2:2,3:0,4:0})[kind];}
 function deliver(i){assert.equal(context.fifoObsDelivered(tokens[i]),'tbinstance');memory.setInt32(512,memory.getInt32(512,true)+1,true);}
 function snapshot(seq){const native=new Uint32Array(heap,1024,64);Atomics.store(native,2,seq);context.fifoObsNormal();Atomics.store(native,3,seq);}
 return {bus,heap,words,memory,context,tokens,install,retire,transition,deliver,snapshot};
}
test('real observer code tracks exact lifecycle, natural delivery and coherent post-rewind epoch',()=>{
 const f=fixture();f.install(512);Atomics.store(f.words,32,1);f.retire(0,256);
 f.transition(1);f.transition(3);f.deliver(0);f.transition(2);f.transition(4);
 assert.equal(f.words[15],2);f.snapshot(1);assert.equal(f.words[15],3);assert.equal(f.words[45],1);
 const native={sequence:1,charged:512,live:256,pending:256,done:1,counters:{installs:512,softBatches:1,softRetired:256,emergencyBatches:0,emergencyRetired:0,gcConsumed:0}};
 const observed=observerSnapshot(f.bus,native);assert.equal(observed.delivered,1);assert.equal(observed.mutationViolations,0);
 // A later delivered callback cannot corrupt the already captured exact epoch.
 f.deliver(1);assert.equal(observerSnapshot(f.bus,native).delivered,1);
 const trace=readTrace(f.bus);assert.equal(trace.phase,3);assert.equal(trace.rows.filter(r=>r[0]===5).length,256);assert.equal(trace.rows.at(-1)[0],8);
 assert.deepEqual(trace.rows.filter(r=>r[0]>=1&&r[0]<=4).map(r=>r[0]),[1,3,2,4]);
 assert.throws(()=>observerSnapshot(f.bus,{...native,done:2}),/accounting differs/);
});
test('both JS and raw native state must be Normal at actual removal/install',()=>{
 for(const key of ['js','native']){const f=fixture();f.install(512);if(key==='js')f.context.Asyncify.state=2;else f.context.nativeState=2;assert.throws(()=>f.context.fifoObsRemove(1),/failure 11/);}
 const f=fixture();f.context.fifoObsRegister();f.context.nativeState=1;assert.throws(()=>f.context.fifoObsInstall(1),/failure 9/);
});
test('unique installation tokens reject double removal/delivery while reused slots remain safe',()=>{
 const f=fixture();f.install(512);f.retire(0,256);assert.throws(()=>f.context.fifoObsRemove(1),/failure 10/);
 const g=fixture();g.install(512);g.retire(0,256);const token=g.context.fifoObsRegister();g.context.fifoObsInstall(1);
 assert.notEqual(token.id,g.tokens[0].id);g.deliver(0);assert.throws(()=>g.context.fifoObsDelivered(g.tokens[0]),/failure 12/);
});
test('extra batch without256 installations is rejected after rewind and off6000 batch fits',()=>{
 const f=fixture();f.install(512);f.retire(0,256);f.transition(1);f.transition(3);f.transition(2);f.transition(4);
 assert.throws(()=>f.retire(256,256),/failure 20/);
 const off=fixture();off.install(6000);Atomics.store(off.words,32,1);off.retire(0,6000);off.transition(1);off.transition(3);off.transition(2);off.transition(4);off.snapshot(1);
 assert.equal(off.words[40],1);assert.equal(off.words[15],3);assert.equal(readTrace(off.bus).rows.filter(r=>r[0]===5).length,6000);
});
test('fiber routes, active episode bound, trace overflow and consumed-during-episode reject',()=>{
 const f=fixture();f.install(512);Atomics.store(f.words,32,1);f.retire(0,256);f.transition(1,4096,1);f.transition(3,4096,2);f.deliver(0);f.transition(2,4096,1);f.memory.setInt32(512,0,true);f.transition(4,4096,1);f.snapshot(1);assert.equal(f.words[20],1);
 const g=fixture();for(let i=0;i<64;i++)g.transition(1,4096+i*64,1);assert.throws(()=>g.transition(1,99999,1),/failure 14/);
 const h=fixture();h.install(512);Atomics.store(h.words,15,1);Atomics.store(h.words,16,16384);assert.throws(()=>h.context.fifoObsRemove(1),/failure 4/);
});
test('pressure retirement gates require events after warm snapshot, not boot-only totals',()=>{
 const layout={maxNodes:12000,batch:64,iterations:100000,retries:16,sleepNs:1000000000,generated:['0x1000','0xbc800']};
 // Correct generated range is768000 bytes.
 layout.generated[1]='0x'+(0x1000+768000).toString(16);
 const s=pressureState(layout),c={softBatches:2,gcConsumed:256,emergencyRetired:0};
 const row=(stage,nodes,checks,extra={})=>({stage,nodes,attempt:0,checks,snapshot:{counters:{...c,...extra}},observer:{tracePhase:3}});
 assert.equal(acceptPressure(s,row('layout',0,2),true),'K');assert.equal(acceptPressure(s,row('warm',0,10),true),'K');
 assert.equal(acceptPressure(s,row('churn',64,74),true),'K');assert.equal(acceptPressure(s,row('churn',128,138,{softBatches:4,gcConsumed:512}),true),'R');
});
test('exact derivation rejects absent/duplicate/already-derived hooks; retained glue supplies sleep+fiber anchors',async()=>{
 // This retained glue is only an anchor fixture; never accepted as policy runtime.
 const original=await readFile(new URL('../../artifacts/m3a-build-01/runtime/x86_64/qemu-system-x86_64.js',import.meta.url),'utf8');
 const source=original+'\nfunction fifo_asyncify_normal(){return Asyncify.state===0;}';
 const derived=await deriveObserver(source);assert.equal(derived.derivation.anchors.length,17);assert.equal(derived.derivation.wasmChanged,false);
 assert.ok(derived.output.includes('fifoObsRawState=exports.asyncify_get_state'));
 await assert.rejects(deriveObserver(original),/normal/);await assert.rejects(deriveObserver(source+'var removeFunction=index=>{'),/remove/);await assert.rejects(deriveObserver(derived.output),/Already/);
});
test('exact retained main oracle accepts actual off/on metadata and rejects fabricated result counts',async()=>{
 for(const arm of ['off','on']){
  const report=JSON.parse(await readFile(new URL('../../artifacts/m3-region-'+arm+'-03/report.json',import.meta.url),'utf8'));validateMainOracle(report);
  for(const mutation of [r=>r.results[5].checks++,r=>r.results[0].name='wrong',r=>r.results.reverse(),r=>r.validation.checks++,r=>r.interrupts.runs=129,r=>r.interrupts.signals=0]){
   const bad=structuredClone(report);mutation(bad);assert.throws(()=>validateMainOracle(bad),/oracle|differs/);
  }
 }
});
