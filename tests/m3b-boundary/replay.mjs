// Pure online replay after durable recording; no guest or filesystem actions.
import assert from 'node:assert/strict';
import {readM3Region} from '../../experiments/m3a-region/reader.mjs';
import {decodeM3b,stopped} from '../m3b-fallthrough/reader.mjs';
import {deniedCommands} from '../m3b-profile/controls.mjs';
import {validateIdle,validateArmed} from './reader.mjs';
import {reference,validateLayout,validateNativeProbe} from './contract.mjs';
const watchFields=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
const zeroWatch=w=>{for(const key of watchFields)assert.equal(w[key],0,key);};
const strip=(row,...keys)=>Object.fromEntries(Object.entries(row).filter(([k])=>!keys.includes(k)));
export class BoundaryReplay{
 constructor({enabled,proof,elfLayout}){
  assert.equal(typeof enabled,'boolean');this.enabled=enabled;this.proof=proof;
  this.layout={schema:1,stackPointer:elfLayout.stackPointer,programs:elfLayout.programs.map(p=>Object.fromEntries(['name','width','a','b','back','side','end','ownerBytes','codeHex'].map(k=>[k,p[k]])))};
  validateLayout(this.layout);this.reference=reference(this.layout);this.phase='startup';this.seq=0;this.epoch=0;this.program=null;this.previous=null;this.boundary=null;this.native=[];this.lastAck=0;this.controls=[];this.controlStage='initial';this.controlIndex=0;this.lastClock=0;
  this.operations=[...deniedCommands.map(([command,args])=>({kind:'qmp-denial',command,arguments:args})),...[[[Number(enabled),1],-2],[[1-Number(enabled),1],-2],[[0,0],-2],[[2,1],-1],[[1,0],-1]].map(([args,expected])=>({kind:'configure-rejection',arguments:args,expected})),{kind:'prelaunch-boundary-arm-rejection',request:1,mode:1,pc:'0x10000',expected:-1}];
 }
 snapshot(row,initial=false){
  stopped(row.status,initial);assert.deepEqual(row.m3b,decodeM3b(row.m3b.raw,this.enabled));
  const raw=row.m3a.raw;assert.ok(Array.isArray(raw)&&raw.length===96&&raw.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff));const w=Uint32Array.from(raw);
  assert.deepEqual(row.m3a,{...readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>w}),raw});
  assert.equal(row.m3a.enabled,true);assert.equal(row.m3a.started,!initial);assert.equal(row.m3a.saturated,false);assert.equal(row.m3a.counters.watchPcMismatches,0);assert.equal(row.m3a.counters.invalidMetadata,0);
  if(initial){
   const exact=Array(128).fill(0);Object.assign(exact,{0:0x4d334231,1:1,2:this.enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,12:4});assert.deepEqual(row.m3b.raw,exact,'Exact zero-execution prelaunch M3b template');
   for(const [key,n]of Object.entries({...row.m3a.counters,...row.m3a.fallbacks}))assert.equal(n,0,'Prelaunch M3a '+key);
   for(const at of [...Array.from({length:5},(_,i)=>50+i)])assert.equal(raw[at],0,'Prelaunch M3a injection state');
  }
  if(this.previous)for(const family of ['m3a','m3b'])for(const[key,n]of Object.entries(row[family].counters))assert.ok(n>=this.previous[family][key]);this.previous={m3a:{...row.m3a.counters},m3b:{...row.m3b.counters}};
  assert.equal(row.pool.limit,12000);assert.ok(Number.isSafeInteger(row.pool.charged)&&row.pool.charged>=0&&row.pool.charged<=12000);assert.ok(Number.isSafeInteger(row.pool.linearMemoryBytes)&&row.pool.linearMemoryBytes>0);
 }
 epochs(row){assert.equal(row.m3a.watchEpoch,this.epoch);assert.equal(row.m3b.watchEpoch,this.epoch);}
 ranges(row,program,cleared=false){
  for(let slot=0;slot<4;slot++){
   const p=program===null?null:this.layout.programs[program],a=p&&slot<2?BigInt(p[slot===0?'a':'b']):0n,b=a?a+1n:0n;
   for(const w of [row.m3a.watches[slot],row.m3b.watches[slot]]){assert.equal(BigInt(w.begin),a);assert.equal(BigInt(w.end),b);}
   const ordinary=row.m3a.watches[slot];assert.equal(ordinary.enabled,a!==0n);if(ordinary.selectedEntries)assert.ok(BigInt(ordinary.lastSelectedPC)>=a&&BigInt(ordinary.lastSelectedPC)<b);
   if(cleared){assert.equal(ordinary.selectedEntries,0);assert.equal(ordinary.lastSelectedPC,'0x0');const fused=row.m3b.watches[slot];zeroWatch(fused);assert.equal(fused.lastSelectedPC,'0x0');assert.equal(fused.lastGeneration,'0x0');}
  }
 }
 sameBoundary(raw){if(!this.enabled)validateIdle(raw);assert.deepEqual(raw,this.boundary,'Boundary changed outside its one armed probe');}
 control(row){
  assert.equal(this.phase,'controls');const operation=this.operations[this.controlIndex];
  if(row.event==='profile-control-readback'){
   assert.ok(['initial','readback'].includes(this.controlStage));stopped(row.status,true);assert.equal(row.sequence,this.controlIndex);assert.equal(row.phase,this.controlStage==='initial'?'initial':'after-operation');
   assert.deepEqual(Object.keys(row.readback).sort(),['boundaryWords','graph','m3bWords','objects']);assert.deepEqual(row.readback,{m3bWords:this.initialM3b,boundaryWords:this.boundary,graph:this.proof.graph.text,objects:this.proof.objects.text});
   decodeM3b(row.readback.m3bWords,this.enabled);validateIdle(row.readback.boundaryWords);this.controlStage=this.controlIndex===12?'complete':'request';return;
  }
  if(row.event==='profile-control-request'){
   assert.equal(this.controlStage,'request');assert.deepEqual(row,{event:'profile-control-request',sequence:this.controlIndex,...operation});this.controlStage='result';return;
  }
  if(row.event==='profile-control-result'){
   assert.equal(this.controlStage,'result');assert.deepEqual(strip(row,'returned','error'),{event:'profile-control-result',sequence:this.controlIndex,...operation});
   if(operation.kind==='qmp-denial'){assert.equal(row.returned,false);assert.equal(row.error,'GenericError: Command forbidden by frozen M3b diagnostic control surface');}else{assert.equal(row.returned,operation.expected);assert.equal(row.error,undefined);}
   this.controls.push(structuredClone(row));this.controlIndex++;this.controlStage='readback';return;
  }
  assert.equal(row.event,'profile-controls-complete');assert.equal(this.controlStage,'complete');assert.equal(row.schema,1);assert.equal(row.status,'passed');assert.equal(row.enabled,this.enabled);assert.equal(row.checks,12);assert.deepEqual(row.rows,this.controls);this.controlResult=strip(row,'event');this.phase='gate';
 }
 exposure(row){
  const a=row.m3b.watches[0],b=row.m3b.watches[1],oa=row.m3a.watches[0],ob=row.m3a.watches[1],g=row.gate;
  assert.ok(oa.selectedEntries>0);zeroWatch(b);
  if(!this.enabled){zeroWatch(a);assert.ok(ob.selectedEntries>0);return;}
  assert.ok(a.compiledEntries>0);assert.equal(a.lastSelectedPC,this.layout.programs[g.program].a);
  if(g.phase==='warm'){assert.ok(a.predecodeAccepted>0&&a.emittedOwners>0&&ob.selectedEntries>0);return;}
  assert.equal(a.BAttempts,g.bodies);assert.equal(a.servicePaid,g.bodies);assert.ok(a.BRequested>=(g.mode===2?1:0));if(a.BRequested)assert.ok(ob.selectedEntries>0);
  const input=this.reference.inputs[g.request-1],bank=validateNativeProbe(row.boundaryRaw,input,this.layout,{generation:a.lastGeneration});
  for(const [field,key]of [['service','servicePaid'],['attempts','BAttempts'],['requests','BRequested']]){assert.ok(bank[field].before>=this.beforeCounters[key]);assert.ok(bank[field].after<=row.m3b.counters[key]);}
  this.native.push({request:g.request,program:g.program,mode:g.mode,bank,bodyPartition:{attempts:a.BAttempts,completedFused:a.BAttempts-a.BRequested,resumedOrdinary:a.BRequested,allBodies:g.bodies,service:a.servicePaid}});
 }
 accept(row){
  for(const key of ['hostMs','signalHostMs','readHostMs'])if(row[key]!==undefined)assert.ok(typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0);
  const clock=row.readHostMs??row.hostMs;if(clock!==undefined){assert.ok(clock>=this.lastClock,'Host observation clock reversed');this.lastClock=clock;}
  if(row.event==='header')return;
  if(row.event.startsWith('profile-control'))return this.control(row);
  if(row.event==='startup'){
   assert.equal(this.phase,'startup');this.snapshot(row,true);this.epochs(row);this.ranges(row,null,true);validateIdle(row.boundaryRaw);this.boundary=[...row.boundaryRaw];this.initialM3b=[...row.m3b.raw];
   for(const key of ['graph','objects']){assert.equal(row[key].text,this.proof[key].text);assert.deepEqual(row[key].raw,Array.from(Buffer.from(this.proof[key].text)));}
   this.phase='controls';return;
  }
  if(row.event==='gate'){
   assert.equal(this.phase,'gate');assert.deepEqual(row.gate,this.reference.gates[this.seq]);this.snapshot(row);this.epochs(row);assert.ok(row.signalHostMs>=this.lastAck&&row.readHostMs>=row.signalHostMs);
   const gate=row.gate;if(gate.phase==='layout'){assert.deepEqual(row.layout,this.layout);this.ranges(row,null,true);this.sameBoundary(row.boundaryRaw);}
   else{
    assert.equal(this.program,gate.program);this.ranges(row,this.program,gate.phase==='before');
    if(gate.phase==='before'){assert.deepEqual(row.input,this.reference.inputs[gate.request-1]);assert.equal(row.result,undefined);this.sameBoundary(row.boundaryRaw);}
    else if(gate.phase==='after'){assert.deepEqual(row.result,this.reference.results[gate.request-1]);assert.equal(row.input,undefined);this.exposure(row);if(!this.enabled)validateIdle(row.boundaryRaw);this.boundary=[...row.boundaryRaw];}
    else{assert.equal(gate.phase,'warm');this.sameBoundary(row.boundaryRaw);this.exposure(row);}
   }
   this.gate=row;this.phase='configured';return;
  }
  if(row.event==='configured'){
   assert.equal(this.phase,'configured');assert.equal(row.seq,this.seq);const g=this.gate.gate,next=g.phase==='layout'?0:g.phase==='after'&&g.mode===2?g.program+1:g.program;
   assert.equal(row.program,next<2?next:null);this.snapshot(row);this.epoch+=4;this.epochs(row);this.ranges(row,row.program,true);this.sameBoundary(row.boundaryRaw);this.program=row.program;this.beforeCounters={...row.m3b.counters};this.phase=this.enabled&&g.phase==='before'?'arm-request':'ack';return;
  }
  if(row.event==='arm-request'){
   assert.equal(this.phase,'arm-request');const input=this.reference.inputs[this.gate.gate.request-1];assert.deepEqual(strip(row,'hostMs'),{event:'arm-request',seq:this.seq,request:input.request,mode:input.mode,pc:this.layout.programs[input.program].a});this.phase='arm-result';return;
  }
  if(row.event==='arm-result'){
   assert.equal(this.phase,'arm-result');const input=this.reference.inputs[this.gate.gate.request-1],a=this.layout.programs[input.program].a;stopped(row.status);assert.deepEqual(strip(row,'hostMs','status','boundaryRaw'),{event:'arm-result',seq:this.seq,request:input.request,mode:input.mode,pc:a,returnCode:0});validateArmed(row.boundaryRaw,{...input,a});this.boundary=[...row.boundaryRaw];this.phase='ack';return;
  }
  if(row.event==='ack'){
   assert.equal(this.phase,'ack');assert.equal(row.seq,this.seq);assert.deepEqual(row.watchEpoch,{m3a:this.epoch,m3b:this.epoch});assert.ok(row.hostMs>=this.gate.readHostMs);this.lastAck=row.hostMs;this.seq++;this.phase=this.seq===11?'complete':'gate';return;
  }
  if(row.event==='complete'){
   assert.equal(this.phase,'complete');this.snapshot(row);this.epochs(row);this.ranges(row,null,true);this.sameBoundary(row.boundaryRaw);assert.deepEqual(row.validation,this.reference.pass);assert.equal(this.native.length,this.enabled?4:0);this.phase='done';return;
  }
  throw Error('Unexpected boundary journal event');
 }
}
