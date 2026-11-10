import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeHorizon} from './horizon.mjs';
import {warmupOrders,orders} from './protocol.mjs';
function fixture(){
 let clock=100;const phases=[...warmupOrders,...orders].flatMap((order,index)=>order.map(name=>{const row={name,sample:index<5?index:index-5,iterations:100,startAckHostMs:clock,resultHostMs:clock+10,hostMs:10,resultToStopMs:1};clock+=12;return row;}));
 return {horizon:{startId:'00000000-0000-0000-0000-000000000000',t0HostMs:0,t1HostMs:clock+5},events:[{event:'complete',hostMs:clock+1,readCompleteHostMs:clock+5,ackHostMs:clock+6}],warmups:phases.slice(0,20),results:phases.slice(20),startup:{readyHostMs:40},calibration:Array.from({length:20},()=>({hostMs:2}))};
}
function shift(b,first,delta){const rows=[...b.warmups,...b.results];for(let i=first;i<rows.length;i++){rows[i].startAckHostMs+=delta;rows[i].resultHostMs+=delta;}for(const key of ['hostMs','readCompleteHostMs','ackHostMs'])b.events[0][key]+=delta;b.horizon.t1HostMs+=delta;}
test('full horizon closes exactly and includes all13 phases per workload',()=>{const h=summarizeHorizon(fixture());assert.equal(h.phaseSum,520);for(const name of ['integer','json','sha256','http']){assert.equal(h[name],130);assert.deepEqual(h.phaseSplit.byWorkload[name],{preludeMs:50,subsequentMs:80});}assert.equal(h.partition.gapMs.length,51);assert.equal(h.partition.totalMs,h.fullHorizon);assert.equal(h.phaseSplit.preludeMs,200);assert.equal(h.phaseSplit.subsequentMs,320);});
test('warmup, startup and ACK-gap costs cannot escape the main endpoint',()=>{
 const base=summarizeHorizon(fixture());
 const warm=fixture();warm.warmups[0].hostMs+=50;warm.warmups[0].resultHostMs+=50;shift(warm,1,50);const wh=summarizeHorizon(warm);assert.equal(wh.fullHorizon,base.fullHorizon+50);assert.equal(wh.phaseSum,base.phaseSum+50);
 const gap=fixture();shift(gap,1,50);const gh=summarizeHorizon(gap);assert.equal(gh.fullHorizon,base.fullHorizon+50);assert.equal(gh.phaseSum,base.phaseSum);
 const startup=fixture();shift(startup,0,50);startup.startup.readyHostMs+=50;const sh=summarizeHorizon(startup);assert.equal(sh.fullHorizon,base.fullHorizon+50);assert.equal(sh.ready,base.ready+50);assert.equal(sh.phaseSum,base.phaseSum);
 const stop=fixture();stop.warmups[0].resultToStopMs=100;assert.equal(summarizeHorizon(stop).resultStopMaxMs,100);
});
test('omitted prelude, overlap, changed work and shortened horizon reject',()=>{for(const mutate of [b=>b.warmups.pop(),b=>b.results[0].iterations=1,b=>b.results[0].startAckHostMs=0,b=>b.horizon.t1HostMs--,b=>b.events[0].hostMs=b.horizon.t1HostMs+1]){const b=fixture();mutate(b);assert.throws(()=>summarizeHorizon(b));}});
