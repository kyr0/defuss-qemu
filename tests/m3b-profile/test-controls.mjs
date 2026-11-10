import test from 'node:test';
import assert from 'node:assert/strict';
import {checkProfileControls} from './controls.mjs';
function fixture(overrides={}){
 const records=[],calls=[];let graph='graph\n';
 const m3bWords=Array(128).fill(0);Object.assign(m3bWords,{0:0x4d334231,1:1,2:63,5:1,6:32,7:128,8:12,9:32,10:20,12:4});
 const boundaryWords=Array(256).fill(0);boundaryWords[0]=0x4d334253;boundaryWords[1]=1;boundaryWords[6]=256;boundaryWords[7]=64;
 const context={enabled:true,mod:{_defuss_m3b_abi:()=>1,_defuss_m3b_status:()=>63,
  _defuss_m3b_configure:(e,p)=>e>1||(e&&p!==1)?-1:-2,_defuss_m3b_boundary_arm:()=>-1},
  send:async(command,args)=>{calls.push({command,args});if(command==='query-status')return {status:'prelaunch',running:false};
   throw Error('GenericError: Command forbidden by frozen M3b diagnostic control surface');},
  readback:async()=>({graph,objects:'objects\n',m3bWords,boundaryWords}),record:async row=>records.push(structuredClone(row)),...overrides};
 return {context,records,calls,changeGraph:()=>{graph='changed\n';}};
}
test('retains each exact denial and native configuration rejection before completion',async()=>{
 const f=fixture(),r=await checkProfileControls(f.context);
 assert.equal(r.checks,12);assert.equal(f.records.length,38);
 assert.deepEqual(f.records.slice(0,4).map(r=>r.event),['profile-control-readback','profile-control-request','profile-control-result','profile-control-readback']);
 assert.deepEqual(r.rows.filter(r=>r.kind==='configure-rejection').map(r=>r.arguments),[[1,1],[0,1],[0,0],[2,1],[1,0]]);
 assert.equal(f.calls.some(c=>['cont','stop','quit','system_reset'].includes(c.command)),false);
});
test('an ordinary QMP error or accepted command cannot stand in for native guard denial',async()=>{
 for(const response of ['other-error','accepted']){
  const f=fixture(),send=f.context.send;f.context.send=async(c,a)=>c==='query-status'?send(c,a):response==='accepted'?{}:Promise.reject(Error('CommandNotFound: command not found'));
  await assert.rejects(checkProfileControls(f.context),/exact native M3b QMP denial/);
  assert.equal(f.records.at(-1).event,'profile-control-readback');
 }
});
test('readback changes fail even when QMP reports the expected denial',async()=>{
 const f=fixture(),send=f.context.send;f.context.send=async(c,a)=>{if(c!=='query-status')f.changeGraph();return send(c,a);};
 await assert.rejects(checkProfileControls(f.context),/profile\/graph\/counters changed/);
 assert.equal(f.records.at(-1).readback.graph,'changed\n');
});
test('prelaunch is exact and native boundary arming cannot consume its first request',async()=>{
 for(const status of [{status:'paused',running:false},{status:'running',running:true}]){
  let reads=0;const f=fixture({send:async()=>status,readback:async()=>{reads++;throw Error('Unsafe read');}});
  await assert.rejects(checkProfileControls(f.context),/exact prelaunch/);
  assert.equal(reads,0);assert.equal(f.records.at(-1).readback,null);
 }
 const armed=fixture();armed.context.mod._defuss_m3b_boundary_arm=()=>0;
 await assert.rejects(checkProfileControls(armed.context),/Boundary arm accepted/);
});
test('a durable request-log failure prevents the attempted native mutation',async()=>{
 const f=fixture({record:async row=>{if(row.event==='profile-control-request')throw Error('fsync failed');}});
 await assert.rejects(checkProfileControls(f.context),/fsync failed/);
 assert.deepEqual(f.calls.map(c=>c.command),['query-status']);
});
test('an empty readback cannot pass as unchanged native state',async()=>{
 const f=fixture({readback:async()=>({})});
 await assert.rejects(checkProfileControls(f.context),/readback shape/);
 assert.deepEqual(f.records[0].readback,{});
});
test('prelaunch cannot conceal nonzero execution counters or boundary failure',async()=>{
 for(const [bank,index]of [['m3bWords',16],['boundaryWords',5],['boundaryWords',230]]){
  const f=fixture(),read=f.context.readback;
  f.context.readback=async status=>{const r=await read(status);r[bank][index]=1;return r;};
  await assert.rejects(checkProfileControls(f.context),/prelaunch profile|Boundary bank/);
  assert.equal(f.records[0].readback[bank][index],1);
 }
});
