// Diagnostic prelaunch control-surface checks. No guest continuation is sent.
// This tests real native enforcement only when called by a real VM adapter.
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const denial='GenericError: Command forbidden by frozen M3b diagnostic control surface';
export const deniedCommands=Object.freeze([
 ['query-block',{}],
 ['qom-list',{path:'/machine'}],
 ['human-monitor-command',{'command-line':'info qtree'}],
 // If the guard is missing this can create only a small, unattached RAM
 // object in this owned, stopped test VM. The caller must then fail/close it.
 ['object-add',{'qom-type':'memory-backend-ram',id:'m3b-control-probe',size:4096}],
 ['object-del',{id:'m3b-control-probe-absent'}],
 ['defuss-m3b-unknown-command',{}],
].map(([command,args])=>Object.freeze([command,Object.freeze(args)])));

function prelaunch(status){
 requireValue(status?.running===false&&status.status==='prelaunch','Profile controls require exact prelaunch');
}

function validateReadback(value,enabled){
 requireValue(value&&typeof value==='object'&&
  Object.keys(value).sort().join(',')==='boundaryWords,graph,m3bWords,objects','Invalid native readback shape');
 for(const [key,size]of [['m3bWords',128],['boundaryWords',256]])
  requireValue(Array.isArray(value[key])&&value[key].length===size&&
   value[key].every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff),'Invalid native raw bank '+key);
 const profile=Array(128).fill(0),boundary=Array(256).fill(0);
 Object.assign(profile,{0:0x4d334231,1:1,2:enabled?63:62,5:1,6:32,7:128,8:12,9:32,10:20,12:4});
 Object.assign(boundary,{0:0x4d334253,1:1,6:256,7:64});
 requireValue(value.m3bWords.every((n,i)=>n===profile[i]),'Invalid native prelaunch profile layout or nonzero counters');
 requireValue(value.boundaryWords.every((n,i)=>n===boundary[i]),'Boundary bank was armed/changed before guest execution');
 requireValue(typeof value.graph==='string'&&value.graph.length>0&&value.graph.length<128*1024&&
  typeof value.objects==='string'&&value.objects.length>0&&value.objects.length<32*512,'Invalid native graph/object strings');
}

export async function checkProfileControls({mod,send,readback,record,enabled}){
 requireValue(typeof enabled==='boolean','Explicit profile mode required');
 for(const fn of [send,readback,record])requireValue(typeof fn==='function','Missing profile-check callback');
 for(const name of ['_defuss_m3b_abi','_defuss_m3b_status','_defuss_m3b_configure','_defuss_m3b_boundary_arm'])
  requireValue(typeof mod?.[name]==='function','Missing native export '+name);
 const rows=[];
 const capture=async phase=>{
  const status=structuredClone(await send('query-status'));
  if(status?.running!==false||status.status!=='prelaunch'){
   await record({event:'profile-control-readback',phase,sequence:rows.length,status,readback:null});
   prelaunch(status); // Never read native banks in an unexpected run state.
  }
  const value=structuredClone(await readback(status));
  // Persist the actual stopped raw snapshot, including a corrupt bank,
  // before interpretation. The adapter must return raw, bounded copied banks.
  await record({event:'profile-control-readback',phase,sequence:rows.length,status,readback:value});
  validateReadback(value,enabled);
  requireValue(mod._defuss_m3b_abi()===1,'Unexpected native profile ABI');
  requireValue(mod._defuss_m3b_status()===(enabled?63:62),'Native profile is not eligible and locked');
  return JSON.stringify(value);
 };
 const baseline=await capture('initial');
 const unchanged=async()=>{
  requireValue(await capture('after-operation')===baseline,'Native profile/graph/counters changed during control checks');
 };
 const request=async operation=>{
  const row={event:'profile-control-request',sequence:rows.length,...operation};
  await record(row);return row;
 };
 const outcome=async(row,result)=>{
  const done={...row,event:'profile-control-result',...result};
  await record(done);rows.push(done);return done;
 };
 for(const [command,args] of deniedCommands){
  const row=await request({kind:'qmp-denial',command,arguments:args});
  let returned=false,error;
  try{await send(command,args);returned=true;}catch(e){error=String(e?.message??e);}
  await outcome(row,{returned,error:error??null});
  await unchanged();
  requireValue(!returned&&error===denial,'Expected exact native M3b QMP denial: '+command);
 }
 for(const [args,expected] of [[[Number(enabled),1],-2],[[1-Number(enabled),1],-2],[[0,0],-2],[[2,1],-1],[[1,0],-1]]){
  const row=await request({kind:'configure-rejection',arguments:args,expected});
  const returned=mod._defuss_m3b_configure(...args);
  await outcome(row,{returned});await unchanged();requireValue(returned===expected,'Native configure rejection differs');
 }
 // The first valid one-shot request must remain unconsumed at prelaunch.
 const row=await request({kind:'prelaunch-boundary-arm-rejection',request:1,mode:1,pc:'0x10000',expected:-1});
 const returned=mod._defuss_m3b_boundary_arm(1,1,0x10000n);
 await outcome(row,{returned});await unchanged();requireValue(returned===-1,'Boundary arm accepted outside exact paused state');
 const result={schema:1,status:'passed',enabled,checks:rows.length,rows,
  scope:'Exact native QMP denials, locked configuration and prelaunch boundary-arm rejection; immutable readback unchanged. No guest execution, direct lifecycle callback, arbitrary launch-option, DMA or performance proof.'};
 await record({event:'profile-controls-complete',...result});return result;
}
