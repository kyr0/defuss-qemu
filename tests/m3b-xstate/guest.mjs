import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';
import {configureM3Region,readM3Region,watchM3Region} from '../../experiments/m3a-region/reader.mjs';
import {configureM3b,readM3b,watchM3b,readGraph,readObjects,stopped} from '../m3b-fallthrough/reader.mjs';
export const args=Object.freeze(['-nodefaults','-machine','pc,acpi=off,hpet=off,usb=off','-cpu','max','-global','apic.vapic=off','-accel','tcg,tb-size=128','-smp','cpus=1,maxcpus=1','-m','512','-S',
 '-display','none','-monitor','none','-qmp','stdio','-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1','-serial','file:/guest/console.log',
 '-parallel','none','-no-reboot','-no-shutdown','-L','/rom','-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on']);
export async function runGuest({runtimeUrl,kernel,initramfs,roms,enabled,timeoutMs}){
 const report={schema:1,protocol:'defuss-m3b-xstate-fixture-v1',status:'failed',enabled,timingEligible:false,arguments:[...args],serial:'',gates:[],signals:[],stderr:[]};
 const qmp=new Qmp();let serialAt=0;let mod,port,timer,finish,tail='',layout,pending=null,signal=null,chain=Promise.resolve(),sequence=0,complete,xstateCaps,xstatePending;
 const done=new Promise(resolve=>finish=resolve),origin=performance.now(),clock=()=>performance.now()-origin;
 const record=async row=>{row.serialChunk=report.serial.slice(serialAt);serialAt=report.serial.length;return globalThis.__recordM3bFixture(row);};
 const pool=()=>{const p=mod.pcJitPool?.();if(!p||p.limit!==12000||!Number.isSafeInteger(p.charged)||p.charged<0||p.charged>12000)throw Error('Invalid normal instance pool');return p;};
 const observation=status=>{
  const m3a=readM3Region(mod);if(!m3a.enabled||m3a.saturated||m3a.counters.watchPcMismatches||m3a.counters.invalidMetadata)throw Error('M3a diagnostic invalid');
  const mem=mod.pcProfileWords?.()??mod.HEAPU32,p=Number(mod._defuss_m3_data());
  if(!Number.isSafeInteger(p)||p<0||p%4||p+384>mem.byteLength)throw Error('M3a bank pointer');
  return {status,m3a:{...m3a,raw:Array.from(mem.slice(p/4,p/4+96))},m3b:readM3b(mod,enabled,status,status.status==='prelaunch'),pool:pool()};
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
   if(!xstateCaps||!xstatePending||xstatePending.seq!==gate.seq)throw Error('Missing paired XSTATE record');
   const status=await pause(),snapshot=observation(status),row={event:'gate',gate,xstateCaps,xstate:xstatePending,...(gate.seq===0?{layout}:{}),signalHostMs,...snapshot,readHostMs:clock()};
   await record(row);report.gates.push(row);xstatePending=null;
   const next=gate.phase==='layout'?0:gate.phase==='direct-b'?gate.program+1:gate.program;
   const configured=await configureWatches(layout.programs[next]??null,row.status);
   await record({event:'configured',seq:gate.seq,program:next<11?next:null,hostMs:clock(),...configured});
   port.write('K');row.ackHostMs=clock();await record({event:'ack',seq:gate.seq,hostMs:row.ackHostMs,watchEpoch:{m3a:configured.m3a.watchEpoch,m3b:configured.m3b.watchEpoch}});await qmp.send('cont');row.contHostMs=clock();
  }).catch(error=>finish(String(error.stack??error)));
 };
 const line=text=>{
  if(text.startsWith('M3X_CAPS:')){if(xstateCaps)throw Error('Duplicate XSTATE caps');xstateCaps=JSON.parse(text.slice(9));}
  if(text.startsWith('M3X_STATE:')){if(xstatePending)throw Error('Overlapping XSTATE record');xstatePending=JSON.parse(text.slice(10));}
  if(text.startsWith('M3X_')&&!text.startsWith('M3X_CAPS:')&&!text.startsWith('M3X_STATE:'))throw Error('Unknown XSTATE record');
  if(/M3B_FAIL:|Kernel panic|BUN_APP_FAILURE/.test(text)){finish(text);return;}
  if(text.startsWith('M3B_LAYOUT:')){if(layout)throw Error('Duplicate layout');layout=JSON.parse(text.slice(11));report.layout=layout;}
  if(text.startsWith('M3B_GATE:')){if(pending!==null)throw Error('Duplicate pending gate');pending=JSON.parse(text.slice(9));match();}
  if(text.startsWith('M3B_PASS:')){if(complete)throw Error('Duplicate pass');complete=JSON.parse(text.slice(9));finish('pass');}
  if(text.startsWith('M3B_')&&!['M3B_LAYOUT:','M3B_GATE:','M3B_PASS:','M3B_FAIL:'].some(p=>text.startsWith(p)))throw Error('Unknown fixture protocol line');
 };
 try{
  if(typeof enabled!=='boolean'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>1800000)throw Error('Invalid bounded arguments');
  timer=setTimeout(()=>finish('Guest deadline exceeded'),timeoutMs);const {default:factory}=await import(runtimeUrl);
  factory({arguments:[...args],mainScriptUrlOrBlob:runtimeUrl,printErr:t=>{if(report.stderr.length>1024)finish('stderr bound');else report.stderr.push(String(t).slice(0,65536));},onAbort:e=>finish('Abort: '+e),preRun:[m=>{
   mod=m;configureM3Region(m,true);m._defuss_set_hot_limit(1500);m._defuss46_settings(2);report.configuration={...configureM3b(m,enabled),m3aEnabled:true,hotLimit:1500,flags:2,instanceLimit:12000};
   m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',new Uint8Array(kernel));m.FS.writeFile('/guest/initramfs',new Uint8Array(initramfs));
   for(const [name,bytes]of Object.entries(roms))m.FS.writeFile('/rom/'+name,new Uint8Array(bytes));
   port=attachCom1(m,data=>{if(data.length!==1||data[0]!==71||signal!==null){finish('Unexpected COM1 byte');return;}signal=clock();report.signals.push(signal);match();});
   m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops,decoder=new TextDecoder();
   node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});report.serial+=text;tail+=text;
    if(report.serial.length>4*1024*1024||tail.length>65536){finish('Serial bound');return count;}
    let end;while((end=tail.indexOf('\n'))>=0){const row=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);try{line(row);}catch(e){finish(String(e.stack??e));}}return count;}};
   m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
   m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){try{qmp.accept(b.subarray(o,o+n));}catch(e){finish(String(e));}return n;}return original(s,b,o,n,p);};
  }]}).catch(e=>finish(String(e.stack??e)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  const initial=await qmp.send('query-status');stopped(initial,true);report.startup={event:'startup',hostMs:clock(),...observation(initial),graph:readGraph(mod,initial),objects:readObjects(mod,initial)};await record(report.startup);await qmp.send('cont');
  const outcome=await done;if(outcome!=='pass')throw Error(outcome);await chain;if(sequence!==45||report.signals.length!==45||pending!==null||signal!==null)throw Error('Incomplete gate handshake');
  const finalStatus=await pause();report.final={event:'complete',validation:complete,...observation(finalStatus),hostMs:clock()};await record(report.final);report.status='passed';
 }catch(error){report.failure=String(error.stack??error);}
 clearTimeout(timer);return report;
}
