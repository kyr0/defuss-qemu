// New diagnostic bank only. Source draft; no actual runtime has been read.
const check=(ok,message)=>{if(!ok)throw Error(message);};
const u64=(w,at)=>BigInt(w[at])|(BigInt(w[at+1])<<32n);
const hex=x=>x.toString(16).padStart(16,'0');
export function requirePaused(status){check(status?.running===false&&status.status==='paused','Exact confirmed paused state required');}
export function words(raw){check(Array.isArray(raw)&&raw.length===256&&raw.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff),'256 exact uint32 words required');check(raw[0]===0x4d334253&&raw[1]===1&&raw[6]===256&&raw[7]===64,'Boundary ABI1/layout');return raw;}
function snapshot(w,at){
 const raw=w.slice(at,at+64);for(const i of [35,60,61,62,63])check(raw[i]===0,'Reserved snapshot field');
 return {gpr:Array.from({length:16},(_,i)=>hex(u64(raw,i*2))),eip:'0x'+u64(raw,32).toString(16),rflags:raw[34],rawEflags:hex(u64(raw,36)),
  ccDst:hex(u64(raw,38)),ccSrc:hex(u64(raw,40)),ccSrc2:hex(u64(raw,42)),ccOp:raw[44],df:raw[45]|0,hflags:raw[46],hflags2:raw[47],
  csBase:hex(u64(raw,48)),fsBase:hex(u64(raw,50)),gsBase:hex(u64(raw,52)),cr0:hex(u64(raw,54)),cr4:hex(u64(raw,56)),efer:hex(u64(raw,58)),raw};
}
export function validateIdle(raw){const w=words(raw);for(let i=2;i<256;i++)if(i!==6&&i!==7)check(w[i]===0,'OFF/unarmed bank must remain idle');return {status:'idle',raw:[...w]};}
export function validateArmed(raw,{request,mode,a}){
 const w=words(raw);check(w[2]===1&&w[3]===request&&w[4]===mode&&u64(w,8)===BigInt(a),'Exact armed selector');
 for(let i=5;i<256;i++)if(![6,7,8,9].includes(i))check(w[i]===0,'Armed bank must contain no old observation');return {status:'armed',request,mode,raw:[...w]};
}
export function decodeComplete(raw,{request,mode,a,b,ownerBytes}){
 const w=words(raw);check(Number.isInteger(request)&&request>=1&&request<=4&&[1,2].includes(mode),'Fixed four-request fixture');
 check(w[2]===3&&w[3]===request&&w[4]===mode&&w[5]===0,'Completed matching boundary capture required');
 check(u64(w,8)===BigInt(a)&&u64(w,10)>0n&&w[12]===Number(BigInt(b)-BigInt(a))&&w[13]===ownerBytes,'Exact owner identity');
 check(w[14]===(mode===1?1:3)&&w[15]===mode&&w[16]===(mode===1?0:2),'Return/debt/private-request kind');
 check(w[17]===1&&w[18]===3&&w[19]===1&&w[20]===1&&w[21]===1,'One selected compiled call and three snapshots');
 check(w[23]===w[22]+1&&w[25]===w[24]+1&&w[27]===w[26]+(mode===2?1:0),'Exact service/attempt/request deltas');
 check(w[28]===0&&w[29]===1&&w[30]===6&&w[31]===0,'Cleared debt/normal state/six guest instructions');for(let i=224;i<256;i++)check(w[i]===0,'Reserved boundary tail');
 const before=snapshot(w,32),postCall=snapshot(w,96),postService=snapshot(w,160);
 check(before.eip===a&&postCall.eip===(mode===1?a:b),'Exact materialized A/B EIP');
 check(postCall.raw.every((n,i)=>n===postService.raw[i]),'Post-service state must equal post-call state exactly');
 return {status:'complete',request,mode,generation:'0x'+u64(w,10).toString(16),before,postCall,postService,
  service:{before:w[22],after:w[23]},attempts:{before:w[24],after:w[25]},requests:{before:w[26],after:w[27]},raw:[...w],suspensionObserved:false};
}
export function readBoundaryRaw(mod,status,initial=false){
 if(initial)check(status?.running===false&&status.status==='prelaunch','Exact confirmed prelaunch state required');else requirePaused(status);const mem=mod.pcProfileWords?.()??mod.HEAPU32;check(mem instanceof Uint32Array,'Native shared uint32 memory');
 const p=Number(mod._defuss_m3b_boundary_data?.());check(Number.isSafeInteger(p)&&p>=0&&p%4===0&&p+1024<=mem.byteLength,'Boundary pointer bounds');
 const view=new Uint32Array(mem.buffer,mem.byteOffset+p,256),shared=typeof SharedArrayBuffer!=='undefined'&&view.buffer instanceof SharedArrayBuffer;
 const acquire=()=>shared?Atomics.load(view,2):view[2],before=acquire(),raw=Array.from(view);check(acquire()===before&&raw[2]===before,'Boundary status changed during stopped read');return raw;
}
export function armBoundary(mod,status,{request,mode,a}){
 requirePaused(status);check(Number.isInteger(request)&&request>=1&&request<=4&&[1,2].includes(mode),'Fixed bounded arm arguments');
 const pc=BigInt(a);check(pc>=0x10000n&&pc<=(1n<<47n)-128n,'Bounded user PC');const rc=mod._defuss_m3b_boundary_arm(request,mode,pc);check(rc===0,'Boundary arm rejected: '+rc);
 return {returnCode:rc,...validateArmed(readBoundaryRaw(mod,status),{request,mode,a})};
}
