import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Protocol,prefix} from '../m1/protocol.mjs';
export class Oracle {
 constructor({arm}){this.arm=arm;this.rows=0;this.serial='';this.tail='';this.protocol=new Protocol('capture');this.results=[];this.calibration=[];this.gates=[];this.final=false;this.previousHost=0;}
 accept(row){
  assert.equal(row.sequence,this.rows++);assert.ok(this.rows<=72&&!this.final);assert.equal(row.status.running,false);assert.equal(row.status.status,row.kind==='startup'?'prelaunch':'paused');
  assert.equal(row.nativeStatus,null);if(this.arm==='diagnostic'){assert.equal(row.setupCounts.length,5);assert.ok(row.setupCounts.every((x,i)=>Number.isSafeInteger(x)&&x>=0&&(!this.counts||x>=this.counts[i])));this.counts=row.setupCounts;}else assert.equal(row.setupCounts,null);assert.equal(row.pool.limit,12000);assert.ok(row.pool.charged>=0&&row.pool.charged<=12000);
  assert.ok(Number.isFinite(row.hostMs)&&row.hostMs>=this.previousHost);this.previousHost=row.hostMs;
  this.serial+=row.serialChunk;this.tail+=row.serialChunk;const fresh=[];let end;
  while((end=this.tail.indexOf('\n'))>=0){const line=this.tail.slice(0,end).replace(/\r$/,'');this.tail=this.tail.slice(end+1);assert.ok(!/Kernel panic|BUN_APP_FAILURE:/.test(line));if(!line.startsWith(prefix))continue;const event=JSON.parse(line.slice(prefix.length));fresh.push({kind:this.protocol.accept(event),event});}
  if(row.kind==='startup'){assert.deepEqual(row.mainWorkerUnwind,{mode:'native',reason:null});assert.equal(row.sequence,0);assert.equal(row.cpus.length,1);assert.equal(row.cpus[0]['cpu-index'],0);assert.deepEqual(fresh,[]);assert.equal(row.previousAck,null);this.startHostMs=row.startHostMs;}
  else if(row.kind==='ready'){assert.equal(row.sequence,1);assert.equal(row.signal,49);assert.equal(fresh.length,1);assert.equal(fresh[0].kind,'prepared');this.readyMs=row.hostMs-this.startHostMs;}
  else if(row.kind==='gate'){
   const gates=fresh.filter(r=>r.kind==='gate');assert.equal(gates.length,1);assert.ok(fresh.every(r=>['gate','resumed'].includes(r.kind)));const event=gates[0].event;assert.deepEqual(row.gate,event);assert.equal(event.seq,this.gates.length+1);assert.equal(row.signal,71);assert.equal(row.previousAck.seq,event.seq-1);assert.ok(row.markerHostMs>=row.previousAck.hostMs&&row.hostMs>=row.markerHostMs);
   if(['initialized','maps'].includes(event.event))assert.equal(createHash('sha256').update(event.maps).digest('hex'),event.mapsSha256);
   this.gates.push(event);
   if(['result','gate-result','warmup-complete'].includes(event.event)){
    const last=this.gates.at(-2);assert.equal(last.event,event.event==='result'?'start':event.event==='gate-result'?'gate-start':'warmup-start');
    assert.equal(last.name,event.name);assert.equal(last.sample,event.sample);
    const timing={name:event.name??'warmup',sample:event.sample??null,startSeq:last.seq,endSeq:event.seq,startAckHostMs:row.previousAck.hostMs,resultHostMs:row.markerHostMs,hostMs:row.markerHostMs-row.previousAck.hostMs,resultToStopMs:row.hostMs-row.markerHostMs,guestMs:event.guestMs??null};
    assert.ok(timing.hostMs>0);if(event.event==='result')this.results.push(timing);else if(event.event==='gate-result')this.calibration.push(timing);else this.warmup=timing;
   }
  }else if(row.kind==='final'){assert.deepEqual(fresh,[]);this.protocol.finish();assert.equal(this.gates.length,69);assert.equal(this.results.length,12);assert.equal(this.calibration.length,20);assert.equal(row.gateAcks,69);assert.equal(this.tail,'');this.horizonMs=row.hostMs-this.startHostMs;this.final=true;}
  else throw Error('Unknown row');
 }
 finish(){assert.equal(this.final,true);assert.equal(this.rows,72);return {status:'passed',arm:this.arm,nonce:this.protocol.resumed.nonce,gates:this.gates.length,results:this.results,calibration:this.calibration,warmup:this.warmup,readyMs:this.readyMs,horizonMs:this.horizonMs};}
}
