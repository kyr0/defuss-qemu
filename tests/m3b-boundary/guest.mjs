// Source-only isolated boundary transport. Actual runtime/ELF gates remain open.
import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';
import {configureM3Region,readM3Region,watchM3Region} from '../../experiments/m3a-region/reader.mjs';
import {configureM3b,decodeM3b,watchM3b,readGraph,readObjects,stopped} from '../m3b-fallthrough/reader.mjs';
import {readBoundaryRaw} from './reader.mjs';
import {checkProfileControls} from '../m3b-profile/controls.mjs';
export const args=Object.freeze(['-nodefaults','-machine','pc,acpi=off,hpet=off,usb=off','-cpu','max','-global','apic.vapic=off','-accel','tcg,tb-size=128','-smp','cpus=1,maxcpus=1','-m','512','-S',
 '-display','none','-monitor','none','-qmp','stdio','-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1','-serial','file:/guest/console.log',
 '-parallel','none','-no-reboot','-no-shutdown','-L','/rom','-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on']);
export async function runGuest({runtimeUrl,kernel,initramfs,roms,enabled,timeoutMs}){
 const report={schema:1,protocol:'defuss-m3b-boundary-fixture-v1',status:'failed',enabled,timingEligible:false,arguments:[...args],serial:'',gates:[],signals:[],probeInputs:[],probeResults:[],stderr:[]};
 const qmp=new Qmp();let mod,port,timer,finish,tail='',layout,pending=null,signal=null,pendingInput=null,pendingResult=null,chain=Promise.resolve(),sequence=0,complete;
 const done=new Promise(resolve=>finish=resolve),origin=performance.now(),clock=()=>performance.now()-origin,record=row=>globalThis.__recordM3bBoundary(row);
 const rawBank=(pointer,count)=>{const mem=mod.pcProfileWords?.()??mod.HEAPU32,p=Number(pointer);if(!(mem instanceof Uint32Array)||!Number.isSafeInteger(p)||p<0||p%4||p+count*4>mem.byteLength)throw Error('Native raw bank bounds');return Array.from(mem.slice(p/4,p/4+count));};
 const rawText=(kind,maximum)=>{const mem=mod.pcProfileWords?.()??mod.HEAPU32,size=mod['_defuss_m3b_'+kind+'_size'](),p=Number(mod['_defuss_m3b_'+kind+'_data']());
  if(!(mem instanceof Uint32Array)||!Number.isInteger(size)||size<=0||size>maximum||!Number.isSafeInteger(p)||p<0||p+size>mem.byteLength)throw Error('Native text bounds: '+kind);
  return Array.from(new Uint8Array(mem.buffer,mem.byteOffset+p,size));};
 const observation=async(status,withText=false,context='stopped-observation')=>{
  const initial=status.status==='prelaunch',raw={status:structuredClone(status)},errors=[];
  try{
   stopped(status,initial);
   // Copy all bounded banks before any typed interpretation. One corrupt bank
   // must not prevent retaining the other stopped observations.
   for(const [key,read]of [['m3aRaw',()=>rawBank(mod._defuss_m3_data(),96)],['m3bRaw',()=>rawBank(mod._defuss_m3b_data(),128)],['boundaryRaw',()=>rawBank(mod._defuss_m3b_boundary_data(),256)],['pool',()=>structuredClone(mod.pcJitPool?.()??null)],
    ...(withText?[['graphRaw',()=>rawText('graph',131072)],['objectsRaw',()=>rawText('objects',16384)]]:[])]){
    try{raw[key]=read();}catch(error){raw[key]=null;errors.push({field:key,error:String(error.stack??error)});}
   }
   if(errors.length)throw Error('Stopped raw snapshot capture failed');
   if(mod._defuss_m3_abi?.()!==1||mod._defuss_m3b_abi?.()!==1)throw Error('Native diagnostic ABI missing');
   const m3a=readM3Region({_defuss_m3_abi:()=>1,_defuss_m3_data:()=>0,pcProfileWords:()=>Uint32Array.from(raw.m3aRaw)}),m3b=decodeM3b(raw.m3bRaw,enabled),pool=raw.pool;
   if(mod._defuss_m3b_status()!==m3b.status)throw Error('Native M3b status changed while stopped');
   if(!m3a.enabled||m3a.saturated||m3a.counters.watchPcMismatches||m3a.counters.invalidMetadata)throw Error('M3a diagnostic invalid');
   if(!pool||pool.limit!==12000||!Number.isSafeInteger(pool.charged)||pool.charged<0||pool.charged>12000||!Number.isSafeInteger(pool.linearMemoryBytes)||pool.linearMemoryBytes<=0)throw Error('Invalid normal instance pool');
   if(JSON.stringify(readBoundaryRaw(mod,status,initial))!==JSON.stringify(raw.boundaryRaw))throw Error('Boundary bank changed while stopped');
   const result={status,m3a:{...m3a,raw:raw.m3aRaw},m3b,boundaryRaw:raw.boundaryRaw,pool};
   if(withText)for(const [key,read]of [['graph',readGraph],['objects',readObjects]]){result[key]=read(mod,status);if(JSON.stringify(result[key].raw)!==JSON.stringify(raw[key+'Raw']))throw Error('Native text changed while stopped');}
   return result;
  }catch(error){
   // The host fsyncs this bounded row before rejecting it. A corrupt native
   // layout, graph or pool remains inspectable even though acceptance stops.
   await record({event:'snapshot-failure',context,...raw,errors,failure:String(error.stack??error),hostMs:clock()});throw error;
  }
 };
 const pause=async()=>{await qmp.send('stop');const status=await qmp.send('query-status');stopped(status);return status;};
 const configureWatches=async(program,status)=>{
  for(let slot=0;slot<4;slot++){const address=program&&slot<2?BigInt(program[slot===0?'a':'b']):0n,end=address?address+1n:0n;watchM3Region(mod,slot,address,end);watchM3b(mod,slot,address,end,status);}
  const after=await qmp.send('query-status');stopped(after);return observation(after);
 };
 const match=()=>{
  if(pending===null||signal===null)return;const gate=pending,signalHostMs=signal;pending=null;signal=null;
  const input=gate.phase==='before'?pendingInput:null,result=gate.phase==='after'?pendingResult:null;
  if(gate.phase==='before')pendingInput=null;if(gate.phase==='after')pendingResult=null;
  chain=chain.then(async()=>{
   if(gate.seq!==sequence++||!layout||sequence>11)throw Error('Gate sequence/layout');
   if(gate.phase==='before'&&!input||gate.phase==='after'&&!result)throw Error('Missing exact input/result before gate');
   const status=await pause(),snapshot=await observation(status),row={event:'gate',gate,...(gate.seq===0?{layout}:{}),...(input?{input}:{}),...(result?{result}:{}),signalHostMs,...snapshot,readHostMs:clock()};
   await record(row);report.gates.push(row);
   const next=gate.phase==='layout'?0:gate.phase==='after'&&gate.mode===2?gate.program+1:gate.program;
   const configured=await configureWatches(layout.programs[next]??null,status);await record({event:'configured',seq:gate.seq,program:next<2?next:null,hostMs:clock(),...configured});
   if(gate.phase==='before'&&enabled){
    const operation={event:'arm-request',seq:gate.seq,request:input.request,mode:input.mode,pc:layout.programs[input.program].a,hostMs:clock()};await record(operation);
    const returnCode=mod._defuss_m3b_boundary_arm(input.request,input.mode,BigInt(operation.pc));
    const after=await qmp.send('query-status');stopped(after);const raw=readBoundaryRaw(mod,after);
    await record({event:'arm-result',seq:gate.seq,request:input.request,mode:input.mode,pc:operation.pc,returnCode,status:after,boundaryRaw:raw,hostMs:clock()});
    if(returnCode!==0)throw Error('Native one-shot arm rejected');
   }
   port.write('K');row.ackHostMs=clock();await record({event:'ack',seq:gate.seq,hostMs:row.ackHostMs,watchEpoch:{m3a:configured.m3a.watchEpoch,m3b:configured.m3b.watchEpoch}});await qmp.send('cont');row.contHostMs=clock();
  }).catch(error=>finish(String(error.stack??error)));
 };
 const line=text=>{
  if(/MBND_FAIL:|Kernel panic|BUN_APP_FAILURE/.test(text)){finish(text);return;}
  if(text.startsWith('MBND_LAYOUT:')){if(layout)throw Error('Duplicate layout');layout=JSON.parse(text.slice(12));report.layout=layout;}
  if(text.startsWith('MBND_INPUT:')){if(pendingInput)throw Error('Duplicate input');pendingInput=JSON.parse(text.slice(11));report.probeInputs.push(pendingInput);}
  if(text.startsWith('MBND_RESULT:')){if(pendingResult)throw Error('Duplicate result');pendingResult=JSON.parse(text.slice(12));report.probeResults.push(pendingResult);}
  if(text.startsWith('MBND_GATE:')){if(pending!==null)throw Error('Duplicate gate');pending=JSON.parse(text.slice(10));match();}
  if(text.startsWith('MBND_PASS:')){if(complete)throw Error('Duplicate pass');complete=JSON.parse(text.slice(10));finish('pass');}
  if(text.startsWith('MBND_')&&!['MBND_LAYOUT:','MBND_INPUT:','MBND_RESULT:','MBND_GATE:','MBND_PASS:','MBND_FAIL:'].some(p=>text.startsWith(p)))throw Error('Unknown boundary protocol line');
 };
 try{
  if(typeof enabled!=='boolean'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>1800000)throw Error('Invalid bounded arguments');
  timer=setTimeout(()=>finish('Guest deadline exceeded'),timeoutMs);const {default:factory}=await import(runtimeUrl);
  factory({arguments:[...args],mainScriptUrlOrBlob:runtimeUrl,printErr:t=>{if(report.stderr.length>=1024)finish('stderr bound');else report.stderr.push(String(t).slice(0,65536));},onAbort:e=>finish('Abort: '+e),preRun:[m=>{
   mod=m;configureM3Region(m,true);m._defuss_set_hot_limit(1500);m._defuss46_settings(2);report.configuration={...configureM3b(m,enabled),m3aEnabled:true,hotLimit:1500,flags:2,instanceLimit:12000,global:'apic.vapic=off'};
   m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',new Uint8Array(kernel));m.FS.writeFile('/guest/initramfs',new Uint8Array(initramfs));for(const[name,bytes]of Object.entries(roms))m.FS.writeFile('/rom/'+name,new Uint8Array(bytes));
   port=attachCom1(m,data=>{if(data.length!==1||data[0]!==71||signal!==null){finish('Unexpected COM1');return;}signal=clock();report.signals.push(signal);match();});
   m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops,decoder=new TextDecoder();
   node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});report.serial+=text;tail+=text;
    if(report.serial.length>4*1024*1024||tail.length>65536){finish('Serial bound');return count;}let end;while((end=tail.indexOf('\n'))>=0){const row=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);try{line(row);}catch(e){finish(String(e.stack??e));}}return count;}};
   m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
   m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){try{qmp.accept(new Uint8Array(b.subarray(o,o+n)));}catch(e){finish(String(e));}return n;}return original(s,b,o,n,p);};
  }]}).catch(e=>finish(String(e.stack??e)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');report.startupCpus=await qmp.send('query-cpus-fast');const initial=await qmp.send('query-status');stopped(initial,true);
  report.startup={event:'startup',hostMs:clock(),...await observation(initial,true,'startup')};await record(report.startup);
  report.controls=await checkProfileControls({mod,send:(name,args)=>qmp.send(name,args),enabled,record,readback:async status=>{const row=await observation(status,true,'profile-control-readback');return {m3bWords:row.m3b.raw,boundaryWords:row.boundaryRaw,graph:row.graph.text,objects:row.objects.text};}});
  await qmp.send('cont');const outcome=await done;if(outcome!=='pass')throw Error(outcome);await chain;if(sequence!==11||report.signals.length!==11||pending!==null||signal!==null||pendingInput!==null||pendingResult!==null)throw Error('Incomplete gate handshake');
  const finalStatus=await pause();report.final={event:'complete',validation:complete,...await observation(finalStatus),hostMs:clock()};await record(report.final);report.status='passed';
 }catch(error){report.failure=String(error.stack??error);}
 clearTimeout(timer);return report;
}
