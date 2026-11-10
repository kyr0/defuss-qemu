import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Protocol,prefix} from '../m1/protocol.mjs';
import {decodeM3b} from '../../../tests/m3b-fallthrough/reader.mjs';
import {readM3Region} from '../../../experiments/m3a-region/reader.mjs';
import {decodeCensus} from '../../../tests/m3b-context-accounting-v3/census-reader.mjs';
import {limits,scope} from './config.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function delta(before,after){
 assert.deepEqual(Object.keys(before),Object.keys(after));
 return Object.fromEntries(Object.entries(before).map(([key,value])=>{assert.ok(Number.isSafeInteger(value)&&value>=0&&Number.isSafeInteger(after[key])&&after[key]>=value,'Counter decreased: '+key);return [key,after[key]-value];}));
}
export function decodeObservation(row,enabled,initial=false){
 assert.equal(row.status?.running,false);assert.equal(row.status.status,initial?'prelaunch':'paused');
 const b=decodeM3b(row.m3bRaw,enabled);assert.equal(row.nativeStatus,b.status);assert.equal(b.watchEpoch,0);
 assert.ok(b.watches.every(w=>w.begin==='0x0'&&w.end==='0x0'));
 assert.ok(Array.isArray(row.m3aRaw)&&row.m3aRaw.length===96&&row.m3aRaw.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff));
 const memory=new Uint32Array(row.m3aRaw),a=readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,HEAPU32:memory});
 assert.equal(a.enabled,true);assert.equal(a.started,!initial);assert.equal(a.saturated,false);assert.equal(row.m3aRaw[11],0);
 for(const key of ['invalidMetadata','generationExhaustions','extraWorkerRejects','watchPcMismatches','injectedStaleInstances','injectedInvalidDescriptors','injectionRejects'])assert.equal(a.counters[key],0,key);
 assert.ok(a.watches.every(w=>!w.enabled&&w.begin==='0x0'&&w.end==='0x0'));
 assert.deepEqual(row.m3aRaw.slice(50,55),Array(5).fill(0));
 const idle=Array(256).fill(0);Object.assign(idle,{0:0x4d334253,1:1,6:256,7:64});assert.deepEqual(row.boundaryRaw,idle);
 const c=decodeCensus(row.censusRaw,{initial});assert.equal(row.censusNativeStatus,c.state);assert.equal(c.watchEpoch,0);assert.equal(c.apiRejects,0);assert.equal(c.totalWatchedAttempts,0);assert.equal(c.activeMask,0);assert.ok(c.injection.raw.every(n=>n===0));
 assert.equal(row.pool?.limit,12000);assert.ok(Number.isSafeInteger(row.pool.charged)&&row.pool.charged>=0&&row.pool.charged<=12000);
 return {m3a:a.counters,m3b:b.counters,pool:row.pool};
}
export class Oracle {
 constructor({enabled,graph,objects}){assert.equal(typeof enabled,'boolean');Object.assign(this,{enabled,graph,objects,rows:0,serial:'',tail:'',events:[],gates:[],phases:[],ready:false,started:false,final:false,previous:null,phase:null,protocol:new Protocol('capture')});}
 accept(row){
  assert.ok(this.rows<limits.records&&!this.final);assert.equal(row.sequence,this.rows++);assert.equal(typeof row.serialChunk,'string');
  this.serial+=row.serialChunk;assert.ok(Buffer.byteLength(this.serial)<=limits.serial);this.tail+=row.serialChunk;
  const fresh=[];let end;
  while((end=this.tail.indexOf('\n'))>=0){const line=this.tail.slice(0,end).replace(/\r$/,'');this.tail=this.tail.slice(end+1);assert.ok(!/Kernel panic|BUN_APP_FAILURE:/.test(line));if(!line.startsWith(prefix))continue;const event=JSON.parse(line.slice(prefix.length));const kind=this.protocol.accept(event);this.events.push(event);fresh.push({kind,event});}
  const initial=row.kind==='startup',observed=decodeObservation(row,this.enabled,initial);
  if(this.previous){delta(this.previous.m3a,observed.m3a);delta(this.previous.m3b,observed.m3b);}this.previous=observed;
  if(initial){assert.equal(row.sequence,0);assert.equal(this.started,false);assert.deepEqual(fresh,[]);assert.equal(row.graph,this.graph);assert.equal(row.objects,this.objects);assert.equal(row.cpus?.length,1);assert.equal(row.cpus[0]['cpu-index'],0);assert.ok(Object.values(observed.m3a).every(n=>n===0));assert.ok(Object.values(observed.m3b).every(n=>n===0));this.started=true;}
  else if(row.kind==='ready'){assert.equal(this.started,true);assert.equal(this.ready,false);assert.equal(row.signal,49);assert.equal(fresh.length,1);assert.equal(fresh[0].kind,'prepared');this.ready=true;}
  else if(row.kind==='gate'){
   assert.equal(this.ready,true);assert.equal(row.signal,71);const gates=fresh.filter(x=>x.kind==='gate');assert.equal(gates.length,1);const event=gates[0].event;
   assert.ok(fresh.every(x=>x.kind==='gate'||x.kind==='resumed'));assert.deepEqual(event,row.gate);assert.equal(event.seq,this.gates.length+1);
   if(['initialized','maps'].includes(event.event))assert.equal(hash(event.maps),event.mapsSha256);
   if(['warmup-start','start'].includes(event.event)){assert.equal(this.phase,null);this.phase={event,observed};}
   if(['warmup-complete','result'].includes(event.event)){
    assert.ok(this.phase);const start=this.phase.event;assert.equal(start.name,event.name);assert.equal(start.sample,event.sample);
    this.phases.push({name:event.name??'warmup',sample:event.sample??null,startSeq:start.seq,endSeq:event.seq,m3a:delta(this.phase.observed.m3a,observed.m3a),m3b:delta(this.phase.observed.m3b,observed.m3b)});this.phase=null;
   }
   this.gates.push(event);
  }else if(row.kind==='final'){
   assert.equal(this.ready,true);assert.deepEqual(fresh,[]);this.protocol.finish();assert.equal(this.gates.length,69);assert.equal(this.phases.length,13);assert.equal(this.phase,null);assert.equal(row.gateAcks,69);assert.equal(this.tail,'');this.final=true;
  }else throw Error('Unknown observation kind');
  return observed;
 }
 finish(){assert.equal(this.final,true);assert.equal(this.rows,72);return {status:'passed',enabled:this.enabled,gates:this.gates.length,results:this.phases.length-1,nonce:this.protocol.resumed.nonce,phases:this.phases,lifetime:this.previous,scope,timingEligible:false,candidatePromotion:false};}
}
