// Diagnostic reads only after an externally confirmed stopped/prelaunch state.
const globalNames=['predecodeAccepted','formed','cleanRetries','entryRejects','compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','debtErrors','tciTargetReturns','backedgeTciReturns','IRRejected','emittedOwners'];
const watchNames=['compiledEntries','tciEntries','BAttempts','BRequested','servicePaid','predecodeAccepted','IRRejected','emittedOwners','entryRejects','cleanRetries','backedgeTciReturns'];
const check=(ok,message)=>{if(!ok)throw Error(message);};
export const headerBytes=12;
export function stopped(status,initial=false){check(status?.running===false&&status.status===(initial?'prelaunch':'paused'),'Externally confirmed stopped state required');}
function memory(mod){const array=mod.pcProfileWords?.()??mod.HEAPU32;check(array instanceof Uint32Array,'Shared uint32 memory missing');return array;}
function pointer(value,bytes,mem,alignment=4){const p=Number(value);check(Number.isSafeInteger(p)&&p>=0&&p%alignment===0&&p+bytes<=mem.byteLength,'Native data pointer invalid');return p;}
export function configureM3b(mod,enabled){
 check(typeof enabled==='boolean'&&mod._defuss_m3b_abi?.()===1,'M3b ABI1 required');
 for(const name of ['_defuss_m2_msg1_config','_defuss_m2_msg2_config','_defuss_fifo_configure'])check(typeof mod[name]!=='function','Combined accelerator runtime refused');
 const rc=mod._defuss_m3b_configure(enabled?1:0,1);check(rc===0,'M3b diagnostic profile configuration rejected: '+rc);
 check(mod._defuss_m3b_status()===(enabled?11:10),'Pre-start M3b choice differs');
 return {enabled,profile:1,phase:'preRun-before-vCPU',returnCode:rc,status:mod._defuss_m3b_status()};
}
export function decodeM3b(raw,enabled){
 check(typeof enabled==='boolean','Explicit boolean mode required');
 check(Array.isArray(raw)&&raw.length===128&&raw.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff),'M3b128-word bank required');
 const w=raw;check(w[0]===0x4d334231&&w[1]===1&&w[2]===(enabled?63:62)&&w[3]===0&&w[4]===0,'Pinned eligible diagnostic mode required');
 check(w[5]===1&&w[6]===32&&w[7]===128&&w[8]===headerBytes&&w[9]===32&&w[10]===20&&w[12]===4,'M3b layout differs');
 for(const i of [13,14,15,30,31,...Array.from({length:16},(_,i)=>112+i)])check(w[i]===0,'Reserved M3b word nonzero');
 const pair=at=>BigInt(w[at])|(BigInt(w[at+1])<<32n),hex=n=>'0x'+n.toString(16);
 const counters=Object.fromEntries(globalNames.map((name,i)=>[name,w[16+i]]));
 check(counters.debtErrors===0&&counters.entryRejects===0&&counters.BRequested<=counters.BAttempts&&counters.servicePaid===counters.BAttempts,'Invalid entry/debt/service accounting');
 if(!enabled)check(Object.values(counters).every(n=>n===0),'Disabled M3b produced counters');
 const watches=Array.from({length:4},(_,slot)=>{
  const at=32+slot*20,begin=pair(at),end=pair(at+2),lastPC=pair(at+16),generation=pair(at+18);
  check(begin===0n&&end===0n||begin>=0x10000n&&begin<end&&end<=(1n<<47n),'M3b watch range invalid');check(w[at+15]===0,'Reserved watch word nonzero');
  const row={slot,begin:hex(begin),end:hex(end),...Object.fromEntries(watchNames.map((name,i)=>[name,w[at+4+i]])),lastSelectedPC:hex(lastPC),lastGeneration:hex(generation)};
  check(row.BRequested<=row.BAttempts&&row.servicePaid===row.BAttempts&&row.entryRejects===0,'Watch accounting invalid');
  for(const name of watchNames)check(row[name]<=counters[name],'Watch exceeds lifetime counter: '+name);
  if(row.compiledEntries+row.tciEntries){check(lastPC>=begin&&lastPC<end&&generation>0n,'Selected watch PC/generation invalid');}
  else check(lastPC===0n&&generation===0n,'Unselected watch retains state');
  if(begin===end||!enabled)check(watchNames.every(n=>row[n]===0),'Disabled watch/mode has activity');
  return row;
 });
 return {abi:1,enabled,status:w[2],reasons:0,saturated:false,watchEpoch:w[11],counters,watches,raw:[...raw]};
}
export function readM3b(mod,enabled,status,initial=false){
 stopped(status,initial);check(mod._defuss_m3b_abi?.()===1,'M3b ABI missing');const mem=memory(mod),p=pointer(mod._defuss_m3b_data(),512,mem);
 const row=decodeM3b(Array.from(mem.slice(p/4,p/4+128)),enabled);check(mod._defuss_m3b_status()===row.status,'M3b status changed while stopped');return row;
}
export function watchM3b(mod,slot,begin,end,status){
 stopped(status);check(Number.isInteger(slot)&&slot>=0&&slot<4&&typeof begin==='bigint'&&typeof end==='bigint','Exact watch arguments required');
 check(begin===0n&&end===0n||begin>=0x10000n&&begin<end&&end<=(1n<<47n),'Watch bounds');
 check(mod._defuss_m3b_watch(slot,begin,end)===0,'Stopped watch configuration rejected');
}
function readText(mod,status,kind,maximum,rows){
 stopped(status,true);const mem=memory(mod),size=mod['_defuss_m3b_'+kind+'_size']();check(Number.isInteger(size)&&size>0&&size<=maximum,'Bounded immutable native text required');
 const p=pointer(mod['_defuss_m3b_'+kind+'_data'](),size,mem,1),raw=Array.from(new Uint8Array(mem.buffer,mem.byteOffset+p,size));
 const text=new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(raw));check(text.endsWith('\n')&&text.split('\n').length<=rows+1,'Native text rows');return {raw,text};
}
export function readGraph(mod,status){return readText(mod,status,'graph',131072,128);}
export function readObjects(mod,status){return readText(mod,status,'objects',16384,32);}
