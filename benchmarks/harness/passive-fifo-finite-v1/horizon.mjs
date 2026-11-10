import assert from 'node:assert/strict';
import {names,parameters,warmupOrders,orders} from './protocol.mjs';
export const horizonRule=Object.freeze({clock:'browser performance.now relative to one origin; raw binary64 milliseconds retained',
 start:'Immediately before startBunApp invocation, before asset reads or runtime factory initialization',
 end:'Complete gate readCompleteHostMs after confirmed pause, protocol and effective-policy validation, before final ACK',
 phases:52,preludePhases:20,subsequentPhases:32,iterationsPerPhase:100,partitionAbsoluteToleranceMs:1e-6,
 partition:'prefix + all52 ACK-to-result intervals + all51 intervening gaps + suffix; no subtraction or discarded interval',
 failure:'Any post-start failure or unknown start invalidates the campaign; only durably proven pre-start failure may be replaced'});
export const bootstrapRule=Object.freeze({prng:'xorshift32: x^=x<<13; x^=x>>>17; x^=x<<5; unsigned/2^32',
 quantile:'Sorted draw index floor(p*(draws-1))',unit:'Whole paired log-ratio; identical resampled pair indices for every endpoint',
 primaryAlpha:.01,secondaryOneSidedAlpha:.002,readyOneSidedAlpha:.01,serviceOneSidedAlpha:.005});
const finite=x=>assert.ok(Number.isFinite(x)&&x>=0,'Invalid horizon clock');
export function summarizeHorizon(browser){
 const h=browser.horizon;assert.ok(h&&typeof h.startId==='string'&&/^[a-f0-9-]{36}$/.test(h.startId));
 finite(h.t0HostMs);finite(h.t1HostMs);assert.ok(h.t1HostMs>h.t0HostMs);
 const complete=browser.events.find(e=>e.event==='complete');assert.equal(h.t1HostMs,complete?.readCompleteHostMs);assert.ok(h.t1HostMs<=complete.ackHostMs);
 const phases=[...browser.warmups,...browser.results];assert.equal(phases.length,52);
 assert.deepEqual(phases.map(r=>({name:r.name,sample:r.sample})),[...warmupOrders,...orders].flatMap((order,index)=>order.map(name=>({name,sample:index<5?index:index-5}))));
 const totals=Object.fromEntries(names.map(name=>[name,0])),gaps=[];let previous=h.t0HostMs,phaseSum=0;
 for(const [i,row] of phases.entries()){
  assert.equal(row.iterations,parameters.batchRepetitions);finite(row.startAckHostMs);finite(row.resultHostMs);finite(row.hostMs);
  assert.ok(row.startAckHostMs>=previous&&row.resultHostMs>row.startAckHostMs,'Overlapping/reversed horizon phase');
  assert.equal(row.hostMs,row.resultHostMs-row.startAckHostMs);
  if(i)gaps.push(row.startAckHostMs-previous);
  phaseSum+=row.hostMs;totals[row.name]+=row.hostMs;previous=row.resultHostMs;
 }
 assert.ok(previous<=h.t1HostMs);const prefix=phases[0].startAckHostMs-h.t0HostMs,suffix=h.t1HostMs-previous;
 const fullHorizon=h.t1HostMs-h.t0HostMs,partitionTotal=prefix+phaseSum+gaps.reduce((a,b)=>a+b,0)+suffix;
 assert.ok(Math.abs(fullHorizon-partitionTotal)<=horizonRule.partitionAbsoluteToleranceMs,'Full horizon partition does not close');
 for(const event of browser.events){finite(event.hostMs);assert.ok(event.hostMs>=h.t0HostMs&&event.hostMs<=h.t1HostMs,'Guest event escaped full horizon');}
 const ready=browser.startup.readyHostMs-h.t0HostMs;assert.ok(ready>0&&ready<=fullHorizon);
 const gates=browser.calibration.map(r=>r.hostMs).sort((a,b)=>a-b);assert.equal(gates.length,20);assert.ok(gates.every(x=>Number.isFinite(x)&&x>0));
 const resultStopMaxMs=Math.max(...phases.map(r=>r.resultToStopMs));assert.ok(Number.isFinite(resultStopMaxMs)&&resultStopMaxMs>0);
 return {fullHorizon,phaseSum,...totals,ready,emptyGateP95:gates[Math.ceil(.95*gates.length)-1],resultStopMaxMs,
  partition:{prefixMs:prefix,phaseSumMs:phaseSum,gapMs:gaps,suffixMs:suffix,totalMs:partitionTotal,errorMs:partitionTotal-fullHorizon},
  phaseSplit:{preludeMs:browser.warmups.reduce((s,r)=>s+r.hostMs,0),subsequentMs:browser.results.reduce((s,r)=>s+r.hostMs,0),
   byWorkload:Object.fromEntries(names.map(name=>[name,{preludeMs:browser.warmups.filter(r=>r.name===name).reduce((s,r)=>s+r.hostMs,0),subsequentMs:browser.results.filter(r=>r.name===name).reduce((s,r)=>s+r.hostMs,0)}]))}};
}
