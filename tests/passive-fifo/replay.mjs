import assert from 'node:assert/strict';
import {decodeFifoSnapshot} from '../../experiments/passive-fifo/reader.mjs';
import {parseTranslationBuffer} from '../regions-pressure/jit.mjs';
import {observerBus,observerSnapshot,validateSnapshot,validateMainOracle,pressureState,acceptPressure,finishPressure,settings} from './contract.mjs';
export function replayPolicyReport(report){
 assert.ok(['passed','incomplete'].includes(report.status));assert.deepEqual(report.settings,settings);assert.equal(report.timingEligible,false);
 const enabled=report.enabled;assert.equal(typeof enabled,'boolean');assert.ok(report.gates.length<=223);
 assert.equal(report.signals.length,report.gates.length);assert.equal(report.markers.length,report.gates.length);assert.equal(report.acks.length,report.gates.length);
 let prior,priorJit,warmFlush,pressure,phase=report.fixture==='main'?'main':'pressure',mainStart,epoch=0;
 if(phase==='pressure')pressure=pressureState(report.pressureLayout??report.layout);
 const decode=row=>{
  const native=decodeFifoSnapshot(row.snapshot.rawWords,row.snapshot.sequence,enabled);
  assert.equal(native.sequence,++epoch,'Missing/duplicate native snapshot epoch');
  for(const [key,value]of Object.entries(native))assert.deepEqual(row.snapshot[key],value,'Native decoded '+key);
  validateSnapshot(native,enabled,prior);prior=native;
  const bus=observerBus(),w=new Uint32Array(bus.buffer);w.set(row.observer.raw,64);w[63]=w[127]=native.sequence;
  assert.deepEqual(observerSnapshot(bus,native),row.observer,'Observer epoch decode');
  assert.deepEqual(row.control,{status:enabled?7:6,state:enabled?3:0,rejections:0});
 };
 for(let i=0;i<report.gates.length;i++){
  const row=report.gates[i];assert.equal(row.status.running,false);assert.equal(row.status.status,'paused');decode(row);
  assert.deepEqual(report.signals[i].bytes,[71]);const marker=report.markers[i];assert.equal(marker.fixturePhase,row.fixturePhase);
  for(const key of Object.keys(marker))assert.deepEqual(row[key],marker[key],'Marker differs');
  assert.equal(report.acks[i].sequence,i);assert.equal(report.acks[i].fixturePhase,row.fixturePhase);assert.equal(report.acks[i].stage,row.stage);assert.equal(report.acks[i].ack,row.ack);
  assert.equal(row.jitStatus.running,false);assert.equal(row.jitStatus.status,'paused');const jit=parseTranslationBuffer(row.jitRaw);assert.deepEqual(jit,row.jit);
  if(priorJit){assert.equal(jit.capacityBytes,priorJit.capacityBytes);if(jit.flushCount===priorJit.flushCount)assert.ok(jit.usedBytes>=priorJit.usedBytes);}
  if(row.fixturePhase==='main'&&phase==='pressure'){assert.equal(report.fixture,'combined');assert.equal(finishPressure(pressure,report.pressureValidation),'passed');phase='main';}
  assert.equal(row.fixturePhase,phase);
  if(phase==='pressure'){assert.equal(acceptPressure(pressure,row,enabled),row.ack);if(row.stage==='warm')warmFlush=jit.flushCount;}
  else{assert.equal(row.ack,'K');mainStart??=row.snapshot.counters;}
  if(warmFlush!==undefined)assert.equal(jit.flushCount,warmFlush,'Post-warm flush');priorJit=jit;
 }
 decode(report.final);assert.equal(report.finalStatus.running,false);assert.equal(report.finalStatus.status,'paused');
 assert.equal(report.finalJitStatus.running,false);assert.equal(report.finalJitStatus.status,'paused');assert.deepEqual(report.finalJit,parseTranslationBuffer(report.finalJitRaw));
 assert.equal(report.finalJit.capacityBytes,priorJit.capacityBytes);if(report.finalJit.flushCount===priorJit.flushCount)assert.ok(report.finalJit.usedBytes>=priorJit.usedBytes);
 if(warmFlush!==undefined)assert.equal(report.finalJit.flushCount,warmFlush);
 if(report.fixture==='pressure')assert.equal(finishPressure(pressure,report.validation),report.status);
 else if(report.status==='passed'){
  validateMainOracle({...report,gates:report.gates.filter(g=>g.fixturePhase==='main')});assert.deepEqual(report.mainPolicyExposure.before,mainStart);assert.deepEqual(report.mainPolicyExposure.after,report.final.snapshot.counters);
  for(const [key,value]of Object.entries(report.mainPolicyExposure.delta))assert.equal(value,report.final.snapshot.counters[key]-mainStart[key]);
 }
 if(report.fixture!=='main'&&report.status==='passed'){
  assert.equal(report.trace.phase,3);assert.ok(report.trace.rows.length<=16384&&report.trace.rows.some(r=>r[0]===8));
  for(const row of report.trace.rows){assert.equal(row.length,12);if(row[0]===5||row[0]===6){assert.equal(row[1],0);assert.equal(row[11],0);}}
  const episode=report.trace.rows.filter(r=>r[0]>=1&&r[0]<=4&&r[3]===report.trace.episode);
  assert.deepEqual(episode.map(r=>r[0]),[1,3,2,4]);assert.deepEqual(episode.map(r=>r[1]),[1,0,2,0]);assert.deepEqual(episode.map(r=>r[11]),[0,1,0,2]);
  assert.ok(episode.every(r=>r[2]===episode[0][2]));assert.equal(episode[0][6],episode[3][6]);assert.equal(episode[0][8],episode[3][8]);assert.equal(episode[0][5]+episode[3][7]-episode[0][7],episode[3][5]);
  assert.equal(report.trace.rows.at(-1)[0],8);assert.equal(report.trace.rows.length,report.final.observer.traceRows);
 }
 return {status:'passed',gates:report.gates.length,scope:'Raw native/observer epochs and received marker/signal/ACK protocol replayed independently; fixed guest oracle and no-flush pressure epoch verified.'};
}
