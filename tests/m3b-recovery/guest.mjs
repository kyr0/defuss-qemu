// Existing guest image and native diagnostic API; only this host adapter is new.
import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';
import {configureM3Region,watchM3Region,injectM3Region} from '../../experiments/m3a-region/reader.mjs';
import {configureM3b,watchM3b,stopped} from '../m3b-fallthrough/reader.mjs';
export {args} from '../m3b-fallthrough/guest.mjs';
import {args} from '../m3b-fallthrough/guest.mjs';
export async function runGuest({runtimeUrl,kernel,initramfs,roms,enabled,timeoutMs}){
 const report={schema:1,protocol:'defuss-m3b-recovery-fixture-v1',status:'failed',enabled,timingEligible:false,arguments:[...args],serial:'',gates:[],signals:[],injections:[],stderr:[]};
 const qmp=new Qmp();let mod,port,timer,finish,tail='',layout,pending=null,signal=null,chain=Promise.resolve(),sequence=0,complete;
 const done=new Promise(resolve=>finish=resolve),origin=performance.now(),clock=()=>performance.now()-origin;
 const record=row=>globalThis.__recordM3bRecovery(row);
 const rawBank=(pointer,count)=>{const mem=mod.pcProfileWords?.()??mod.HEAPU32,p=Number(pointer);
  if(!(mem instanceof Uint32Array)||!Number.isSafeInteger(p)||p<0||p%4||p+count*4>mem.byteLength)throw Error('Raw native bank pointer');return Array.from(mem.slice(p/4,p/4+count));};
 const rawText=(kind,limit)=>{const mem=mod.pcProfileWords?.()??mod.HEAPU32,size=mod['_defuss_m3b_'+kind+'_size'](),pointer=Number(mod['_defuss_m3b_'+kind+'_data']());
  if(!(mem instanceof Uint32Array)||!Number.isInteger(size)||size<=0||size>limit||!Number.isSafeInteger(pointer)||pointer<0||pointer+size>mem.byteLength)throw Error('Bounded native text pointer/size');
  return Array.from(new Uint8Array(mem.buffer,mem.byteOffset+pointer,size));};
 const observation=(status,withText=false)=>{
  // Copy all available raw banks before the host interprets any counter.
  // Even a malformed bank reaches the fsynced host journal before rejection.
  const row={status:structuredClone(status),captureErrors:[]};
  if(status?.running!==false||status.status!==(withText?'prelaunch':'paused')){
   for(const key of ['m3aRaw','m3bRaw','boundaryRaw','nativeStatus','pool',...(withText?['graphRaw','objectsRaw']:[])])row[key]=null;
   row.captureErrors.push({key:'status',error:'No native reads without the required externally confirmed stopped state'});return row;
  }
  for(const [key,read]of [['m3aRaw',()=>rawBank(mod._defuss_m3_data(),96)],['m3bRaw',()=>rawBank(mod._defuss_m3b_data(),128)],
   ['boundaryRaw',()=>rawBank(mod._defuss_m3b_boundary_data(),256)],['nativeStatus',()=>mod._defuss_m3b_status()],['pool',()=>structuredClone(mod.pcJitPool?.()??null)],
   ...(withText?[['graphRaw',()=>rawText('graph',131072)],['objectsRaw',()=>rawText('objects',16384)]]:[])]){
   try{row[key]=read();}catch(error){row[key]=null;row.captureErrors.push({key,error:String(error.stack??error)});}
  }
  return row;
 };
 const pause=async()=>{await qmp.send('stop');const status=await qmp.send('query-status');stopped(status);return status;};
 const configureWatches=async(program,status)=>{
  for(let slot=0;slot<4;slot++){
   const key=slot===0?'a':'b',address=program&&slot<2?BigInt(program[key]):0n,end=address?address+1n:0n;
   watchM3Region(mod,slot,address,end);watchM3b(mod,slot,address,end,status);
  }
  const after=await qmp.send('query-status');stopped(after);return observation(after);
 };
 const match=()=>{
  if(pending===null||signal===null)return;const gate=pending,signalHostMs=signal;pending=null;signal=null;
  chain=chain.then(async()=>{
   if(gate.seq!==sequence++||!layout||sequence>45)throw Error('Gate sequence/layout');
   const status=await pause(),snapshot=observation(status),row={event:'gate',gate,...(gate.seq===0?{layout}:{}),signalHostMs,...snapshot,readHostMs:clock()};
   await record(row);report.gates.push(row);
   const next=gate.phase==='layout'?0:gate.phase==='direct-b'?gate.program+1:gate.program;
   const configured=await configureWatches(layout.programs[next]??null,row.status);
   await record({event:'configured',seq:gate.seq,program:next<11?next:null,hostMs:clock(),...configured});
   if(enabled&&(gate.seq===1||gate.seq===5)){
    const action=gate.seq===1?'stale-instance':'invalid-descriptor',pc=layout.programs[gate.seq===1?0:1].a;
    // The host has already accepted/fsynced both the selected warm owner and
    // cleared exact A watch. Native API independently rechecks paused, one
    // worker, unique live compiled owner and matching watched static user PC.
    await record({event:'injection-request',seq:gate.seq,action,slot:0,pc,before:configured,hostMs:clock()});
    let mutation=null,returnCode=null,nativeCalls=0,failure=null,afterStatus=null,statusFailure=null;
    // The existing helper keeps all its argument/ABI/native checks. This
    // proxy only retains the actual result that its exception would hide.
    const api={_defuss_m3_abi:()=>mod._defuss_m3_abi(),_defuss_m3_test_abi:()=>mod._defuss_m3_test_abi(),
     _defuss_m3_test_inject:(...args)=>{nativeCalls++;returnCode=mod._defuss_m3_test_inject(...args);return returnCode;}};
    try{mutation=injectM3Region(api,action,0,BigInt(pc));}catch(error){failure=String(error.stack??error);}
    try{afterStatus=await qmp.send('query-status');}catch(error){statusFailure=String(error.stack??error);}
    const evidence={event:'injection',seq:gate.seq,mutation,returnCode,nativeCalls,failure,statusFailure,before:configured,after:observation(afterStatus),hostMs:clock()};
    await record(evidence);report.injections.push(evidence);
   }
   port.write('K');row.ackHostMs=clock();await record({event:'ack',seq:gate.seq,hostMs:row.ackHostMs,watchEpoch:{m3a:configured.m3aRaw[11],m3b:configured.m3bRaw[11]}});await qmp.send('cont');row.contHostMs=clock();
  }).catch(error=>finish(String(error.stack??error)));
 };
 const line=text=>{
  if(/M3B_FAIL:|Kernel panic|BUN_APP_FAILURE/.test(text)){finish(text);return;}
  if(text.startsWith('M3B_LAYOUT:')){if(layout)throw Error('Duplicate layout');layout=JSON.parse(text.slice(11));report.layout=layout;}
  if(text.startsWith('M3B_GATE:')){if(pending!==null)throw Error('Duplicate pending gate');pending=JSON.parse(text.slice(9));match();}
  if(text.startsWith('M3B_PASS:')){if(complete)throw Error('Duplicate pass');complete=JSON.parse(text.slice(9));finish('pass');}
  if(text.startsWith('M3B_')&&!['M3B_LAYOUT:','M3B_GATE:','M3B_PASS:','M3B_FAIL:'].some(p=>text.startsWith(p)))throw Error('Unknown fixture protocol line');
 };
 try{
  if(typeof enabled!=='boolean'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>1800000)throw Error('Invalid bounded arguments');
  timer=setTimeout(()=>finish('Guest deadline exceeded'),timeoutMs);const {default:factory}=await import(runtimeUrl);
  factory({arguments:[...args],mainScriptUrlOrBlob:runtimeUrl,printErr:t=>{if(report.stderr.length>=1024)finish('stderr bound');else report.stderr.push(String(t).slice(0,65536));},onAbort:e=>finish('Abort: '+e),preRun:[m=>{
   mod=m;configureM3Region(m,true);m._defuss_set_hot_limit(1500);m._defuss46_settings(2);report.configuration={...configureM3b(m,enabled),m3aEnabled:true,hotLimit:1500,flags:2,instanceLimit:12000};
   m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',new Uint8Array(kernel));m.FS.writeFile('/guest/initramfs',new Uint8Array(initramfs));
   for(const [name,bytes]of Object.entries(roms))m.FS.writeFile('/rom/'+name,new Uint8Array(bytes));
   port=attachCom1(m,data=>{if(data.length!==1||data[0]!==71||signal!==null){finish('Unexpected COM1 byte');return;}signal=clock();report.signals.push(signal);match();});
   m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops,decoder=new TextDecoder();
   node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});report.serial+=text;tail+=text;
    if(report.serial.length>4*1024*1024||tail.length>65536){finish('Serial bound');return count;}let end;while((end=tail.indexOf('\n'))>=0){const row=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);try{line(row);}catch(e){finish(String(e.stack??e));}}return count;}};
   m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
   m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){try{qmp.accept(new Uint8Array(b.subarray(o,o+n)));}catch(e){finish(String(e));}return n;}return original(s,b,o,n,p);};
  }]}).catch(e=>finish(String(e.stack??e)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  // This read-only command completes after machine initialization; greeting
  // alone may precede the immutable profile publication.
  let startupCpus=null,startupFailure=null,initial=null;
  try{startupCpus=await qmp.send('query-cpus-fast');initial=await qmp.send('query-status');}catch(error){startupFailure=String(error.stack??error);}
  report.startup={event:'startup',hostMs:clock(),startupCpus,startupFailure,...observation(initial,true)};await record(report.startup);await qmp.send('cont');
  const outcome=await done;if(outcome!=='pass')throw Error(outcome);await chain;
  if(sequence!==45||report.signals.length!==45||report.injections.length!==(enabled?2:0)||pending!==null||signal!==null)throw Error('Incomplete gate/injection handshake');
  const finalStatus=await pause();report.final={event:'complete',validation:complete,...observation(finalStatus),hostMs:clock()};await record(report.final);report.status='passed';
 }catch(error){report.failure=String(error.stack??error);}
 clearTimeout(timer);return report;
}
