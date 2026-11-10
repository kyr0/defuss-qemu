// Complete synthetic OFF/ON journals, not real execution evidence. Unrun draft.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoundaryReplay} from './replay.mjs';
import {readM3Region} from '../../experiments/m3a-region/reader.mjs';
import {decodeM3b} from '../m3b-fallthrough/reader.mjs';
import {layout,fixture} from './test-data.mjs';
const proof={graph:{text:'/machine\tpc\n'},objects:{text:'/objects/pc.ram\tmemory-backend-ram\n'}};
const put=(w,at,n)=>{n=BigInt(n);w[at]=Number(n&0xffffffffn);w[at+1]=Number(n>>32n);};
function idle(){const w=Array(256).fill(0);Object.assign(w,{0:0x4d334253,1:1,6:256,7:64});return w;}
function transcript(enabled){
 const engine=new BoundaryReplay({enabled,proof,elfLayout:layout}),rows=[];let time=0,epoch=0,program=null,boundary=idle(),selected=0,compiled=0,attempts=0,requested=0,published=0;
 const snapshot=(initial=false,activity=null)=>{
  const a=Array(96).fill(0);Object.assign(a,{0:0x4d335231,1:1,2:1,3:initial?0:1,5:128,6:112,7:64,8:4,9:64,10:8,11:epoch});
  const b=Array(128).fill(0);Object.assign(b,{0:0x4d334231,1:1,2:enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,11:epoch,12:4});
  if(activity){selected+=activity.oa+activity.ob;if(enabled){compiled+=activity.compiled;attempts+=activity.attempts;requested+=activity.requested;published+=activity.published;}}
  a[18]=a[19]=selected;b[16]=b[29]=published;b[20]=compiled;b[22]=b[24]=attempts;b[23]=requested;
  for(let slot=0;slot<2;slot++)if(program!==null){const pc=BigInt(layout.programs[program][slot===0?'a':'b']),aa=64+slot*8,bb=32+slot*20;put(a,aa,pc);put(a,aa+2,pc+1n);a[aa+7]=1;put(b,bb,pc);put(b,bb+2,pc+1n);
   if(activity){a[aa+4]=slot?activity.ob:activity.oa;if(a[aa+4])put(a,aa+5,pc);if(enabled&&slot===0){b[bb+4]=activity.compiled;b[bb+6]=b[bb+8]=activity.attempts;b[bb+7]=activity.requested;b[bb+9]=b[bb+11]=activity.published;if(activity.compiled){put(b,bb+16,pc);put(b,bb+18,17n);}}}
  }
  const typed=Uint32Array.from(a);return {status:{running:false,status:initial?'prelaunch':'paused'},m3a:{...readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>typed}),raw:a},m3b:decodeM3b(b,enabled),boundaryRaw:[...boundary],pool:{limit:12000,charged:100,linearMemoryBytes:536870912}};
 };
 const startup={event:'startup',hostMs:++time,...snapshot(true),graph:{text:proof.graph.text,raw:[...Buffer.from(proof.graph.text)]},objects:{text:proof.objects.text,raw:[...Buffer.from(proof.objects.text)]}};rows.push(startup);
 const readback={m3bWords:startup.m3b.raw,boundaryWords:startup.boundaryRaw,graph:proof.graph.text,objects:proof.objects.text};rows.push({event:'profile-control-readback',phase:'initial',sequence:0,status:startup.status,readback});const resultRows=[];
 for(let i=0;i<engine.operations.length;i++){
  const request={event:'profile-control-request',sequence:i,...engine.operations[i]};rows.push(request);
  const result={...request,event:'profile-control-result',...(request.kind==='qmp-denial'?{returned:false,error:'GenericError: Command forbidden by frozen M3b diagnostic control surface'}:{returned:request.expected})};rows.push(result);resultRows.push(result);
  rows.push({event:'profile-control-readback',phase:'after-operation',sequence:i+1,status:startup.status,readback});
 }
 rows.push({event:'profile-controls-complete',schema:1,status:'passed',enabled,checks:12,rows:resultRows,scope:'Synthetic non-evidence verifier input'});
 for(const gate of engine.reference.gates){
  let activity=null,extra={};
  if(gate.phase==='layout')extra.layout=layout;
  if(gate.phase==='warm')activity={oa:10,ob:10,compiled:8,attempts:10,requested:0,published:1};
  if(gate.phase==='before')extra.input=engine.reference.inputs[gate.request-1];
  if(gate.phase==='after'){
   const input=engine.reference.inputs[gate.request-1];extra.result=engine.reference.results[gate.request-1];
   if(enabled){boundary=fixture(input);boundary[22]=boundary[24]=attempts;boundary[23]=boundary[25]=attempts+1;boundary[26]=requested;boundary[27]=requested+(gate.mode===2?1:0);}
   activity={oa:gate.bodies+1,ob:enabled?(gate.mode===2?1:0):gate.bodies,compiled:gate.bodies+1,attempts:gate.bodies,requested:gate.mode===2?1:0,published:0};
  }
  rows.push({event:'gate',gate,...extra,signalHostMs:++time,...snapshot(false,activity),readHostMs:++time});
  const next=gate.phase==='layout'?0:gate.phase==='after'&&gate.mode===2?gate.program+1:gate.program;program=next<2?next:null;epoch+=4;
  rows.push({event:'configured',seq:gate.seq,program,hostMs:++time,...snapshot()});
  if(enabled&&gate.phase==='before'){
   const pc=layout.programs[gate.program].a;rows.push({event:'arm-request',seq:gate.seq,request:gate.request,mode:gate.mode,pc,hostMs:++time});
   boundary=idle();boundary[2]=1;boundary[3]=gate.request;boundary[4]=gate.mode;put(boundary,8,BigInt(pc));
   rows.push({event:'arm-result',seq:gate.seq,request:gate.request,mode:gate.mode,pc,returnCode:0,status:{running:false,status:'paused'},boundaryRaw:[...boundary],hostMs:++time});
  }
  rows.push({event:'ack',seq:gate.seq,watchEpoch:{m3a:epoch,m3b:epoch},hostMs:++time});
 }
 rows.push({event:'complete',validation:engine.reference.pass,...snapshot(),hostMs:++time});return rows;
}
function replay(rows,enabled){const engine=new BoundaryReplay({enabled,proof,elfLayout:layout});for(const row of rows)engine.accept(row);return engine;}
test('complete synthetic OFF/ON journals require allcontrols/all11gates and four native observations only ON',()=>{
 for(const enabled of [false,true]){const result=replay(transcript(enabled),enabled);assert.equal(result.phase,'done');assert.equal(result.native.length,enabled?4:0);assert.equal(result.controlIndex,12);}
});
test('replay rejects omitted/reordered control, gate and one-shot lifecycle evidence',()=>{
 for(const change of [rows=>rows.splice(rows.findIndex(r=>r.event==='arm-result'),1),rows=>rows.splice(rows.findIndex(r=>r.event==='profile-control-readback'&&r.phase==='after-operation'),1),
  rows=>rows.find(r=>r.event==='profile-control-result').error='ordinary unknown command',rows=>rows.find(r=>r.event==='gate'&&r.gate.phase==='before').input.count=99,
  rows=>rows.find(r=>r.event==='gate'&&r.gate.phase==='after').boundaryRaw[21]=2,rows=>rows.find(r=>r.event==='configured').hostMs=0,
  rows=>{const r=rows.find(r=>r.event==='configured'&&r.seq===1);r.m3b.raw[20]--;r.m3b.counters.compiledEntries--;},
  rows=>rows.find(r=>r.event==='ack').watchEpoch.m3b+=4]){
  const rows=structuredClone(transcript(true));change(rows);assert.throws(()=>replay(rows,true));
 }
});
test('running/altered native control readbacks and OFF activity cannot be accepted',()=>{
 for(const enabled of [false,true]){const rows=structuredClone(transcript(enabled));rows.find(r=>r.event==='profile-control-readback').status={running:true,status:'running'};assert.throws(()=>replay(rows,enabled));}
 // Change every comparison copy consistently: equality to an arbitrary
 // baseline must not substitute for an exact zero-execution native template.
 const active=structuredClone(transcript(true));active[0].m3b.raw[20]=1;active[0].m3b.counters.compiledEntries=1;
 for(const row of active)if(row.event==='profile-control-readback')row.readback.m3bWords[20]=1;
 assert.throws(()=>replay(active,true),/prelaunch M3b template/);
 for(const at of [16,40,50,52,54]){const changed=structuredClone(transcript(true)),raw=changed[0].m3a.raw;raw[at]=1;
  // A fallback count must remain internally consistent to reach the initial
  // zero-state guard, rather than fail only the decoder's arithmetic check.
  if(at===40){raw[18]=raw[20]=1;}
  const w=Uint32Array.from(raw);changed[0].m3a={...readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>w}),raw};assert.throws(()=>replay(changed,true),/Prelaunch M3a/);
 }
 const rows=structuredClone(transcript(false));rows.find(r=>r.event==='gate'&&r.gate.phase==='after').boundaryRaw[2]=1;assert.throws(()=>replay(rows,false));
});
