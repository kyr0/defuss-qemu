import test from 'node:test';
import assert from 'node:assert/strict';
import {pressureState,acceptGate,finishPressure,settings} from './contract.mjs';
const layout={sentinel:['0x402004','0x40200b'],generated:['0x700000','0x7bb800'],...Object.fromEntries(['maxNodes','batch','iterations','retries','sleepNs'].map(k=>[k,settings[k]]))};
function row(stage,{nodes=0,attempt=0,installs=5000,retires=0,selected=8,charged=installs,flushes=0}={}){
 const checks=stage==='layout'?2:stage==='warm'?10:stage==='churn'?10+nodes:11+nodes+attempt;
 return {stage,nodes,attempt,checks,status:{status:'paused',running:false},jitStatus:{status:'paused',running:false},jitRaw:{'human-readable-text':`Translation buffer state:\ngen code size       120000000/268430336\nTB count            81000\nTB flush count      ${flushes}\n`},pool:{charged,limit:12000},counters:{enabled:true,started:true,saturated:false,
  counters:{instanceInstalls:installs,instanceRetires:retires,flushes,watchPcMismatches:0,injectionRejects:0,invalidMetadata:0,generationExhaustions:0,extraWorkerRejects:0,injectedStaleInstances:0,injectedInvalidDescriptors:0},
  watches:[{selectedEntries:selected,lastSelectedPC:'0x402004'},{selectedEntries:30,lastSelectedPC:'0x700004'}]}};
}
function warmed(){const s=pressureState(layout);acceptGate(s,row('layout'));acceptGate(s,row('warm'));return s;}
function retired(){const s=warmed();assert.equal(acceptGate(s,row('churn',{nodes:64,installs:12000,retires:6000})),'R');return s;}
test('sentinel must precede first6000 FIFO slots without prior retirement',()=>{
 for(const options of [{installs:6000},{retires:1},{selected:0}]){
  const s=pressureState(layout);acceptGate(s,row('layout'));assert.throws(()=>acceptGate(s,row('warm',options)),/first6000/);
 }
});
test('flushes, changed cap and wrong retirement size reject the ring proof',()=>{
 assert.throws(()=>acceptGate(warmed(),row('churn',{nodes:64,installs:12000,retires:6001})),/exactly the first6000/);
 assert.throws(()=>acceptGate(warmed(),row('churn',{nodes:64,installs:12000,retires:6000,flushes:1})),/flush/);
 assert.throws(()=>acceptGate(warmed(),row('churn',{nodes:64,installs:12001})),/cap/);
});
test('natural selected reinstantiation requires fresh install after retirement',()=>{
 const s=retired();assert.equal(acceptGate(s,row('revisit',{nodes:64,installs:12001,retires:6000,charged:6001,selected:1})),'R');
 assert.equal(finishPressure(s,{nodes:64,attempts:1,checks:75}),'passed');
 const bad=retired();assert.throws(()=>acceptGate(bad,row('revisit',{nodes:64,installs:12000,retires:6000,selected:1})),/fresh selected/);
});
test('sixteen correct capped fallbacks remain incomplete, never a lifetime pass',()=>{
 const s=retired();for(let attempt=0;attempt<16;attempt++)assert.equal(acceptGate(s,row('revisit',{nodes:64,attempt,installs:12000,retires:6000,selected:0})),'K');
 assert.equal(s.capFallbackObserved,true);assert.equal(finishPressure(s,{nodes:64,attempts:16,checks:90}),'incomplete');
 assert.throws(()=>acceptGate(s,row('revisit',{nodes:64,attempt:16,installs:12000,retires:6000,selected:0})),/order/);
});
test('duplicate or skipped batches cannot replace bounded observed work',()=>{
 assert.throws(()=>acceptGate(warmed(),row('churn',{nodes:128})),/bounded churn/);
 const s=warmed();acceptGate(s,row('churn',{nodes:64}));assert.throws(()=>acceptGate(s,row('churn',{nodes:64})),/bounded churn/);
});
