import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';
import {configureM3Region} from '../../experiments/m3a-region/reader.mjs';
import {configureM3b,stopped} from '../m3b-fallthrough/reader.mjs';
import {runtimeArguments,protocol,pressureSettings} from './config.mjs';
import {BytePipe} from './transport.mjs';
import {configureCensus,readCensusRaw} from '../m3b-context-accounting-v2/census-browser.mjs';
export async function runGuest({runtimeUrl,kernel,initramfs,roms,enabled,timeoutMs,binding}){
 const args=runtimeArguments(),report={schema:1,protocol,status:'failed',enabled,timingEligible:false,arguments:args.report,gates:[],signals:[]};
 const qmp=new Qmp();let mod,port,timer,flushTimer,finish,tail='',layout,pending=null,signal=null,sequence=0,complete,chain=Promise.resolve(),finished=false,epoch=0;
 const origin=performance.now(),clock=()=>performance.now()-origin,done=new Promise(resolve=>finish=reason=>{if(!finished){finished=true;resolve(reason);}});
 const pipe=new BytePipe({send:row=>globalThis.__m3bForensicChunk(row),onFailure:e=>finish(String(e.stack??e))});
 const record=async row=>{row.streams=await pipe.drain();const result=await globalThis.__m3bForensicRecord(row);if(result?.accepted!==true)throw Error(result?.failure??'Pressure host refused');return result;};
 const rawBank=(pointer,count)=>{const mem=mod.pcProfileWords?.()??mod.HEAPU32,p=Number(pointer);
  if(!(mem instanceof Uint32Array)||!Number.isSafeInteger(p)||p<0||p%4||p+count*4>mem.byteLength)throw Error('Native bank pointer');return Array.from(mem.slice(p/4,p/4+count));};
 const rawText=(kind,limit)=>{const mem=mod.pcProfileWords?.()??mod.HEAPU32,size=mod['_defuss_m3b_'+kind+'_size'](),p=Number(mod['_defuss_m3b_'+kind+'_data']());
  if(!(mem instanceof Uint32Array)||!Number.isInteger(size)||size<=0||size>limit||!Number.isSafeInteger(p)||p<0||p+size>mem.byteLength)throw Error('Native text pointer/size');return Array.from(new Uint8Array(mem.buffer,mem.byteOffset+p,size));};
 const observe=(status,text=false)=>{
  const row={status:structuredClone(status),captureErrors:[]},reads=[['codeRaw',()=>{if(mod._defuss_m3co_abi()!==1)throw Error('Code observer ABI');return rawBank(mod._defuss_m3co_data(),2112);}],['m3aRaw',()=>rawBank(mod._defuss_m3_data(),96)],['m3bRaw',()=>rawBank(mod._defuss_m3b_data(),128)],['boundaryRaw',()=>rawBank(mod._defuss_m3b_boundary_data(),256)],['nativeStatus',()=>mod._defuss_m3b_status()],['pool',()=>structuredClone(mod.pcJitPool?.()??null)],...(text?[['graphRaw',()=>rawText('graph',131072)],['objectsRaw',()=>rawText('objects',16384)]]:[])];
  const safe=status?.running===false&&status.status===(text?'prelaunch':'paused');
  for(const [key,read]of reads)try{if(!safe)throw Error('Native read requires externally confirmed stopped state');row[key]=read();}catch(e){row[key]=null;row.captureErrors.push({key,error:String(e.stack??e)});}
  try{if(!safe)throw Error('Native census read requires externally confirmed stopped state');const c=readCensusRaw(mod,status,{initial:text});row.censusRaw=c.raw;row.censusNativeStatus=c.nativeStatus;}catch(e){row.censusRaw=null;row.censusNativeStatus=null;row.captureErrors.push({key:'censusRaw',error:String(e.stack??e)});}
  return row;
 };
 const pause=async()=>{await qmp.send('stop');return qmp.send('query-status');};
 const stoppedObservation=async(status)=>{
  const row=observe(status);row.jitRaw=null;row.jitError=null;row.jitStatus=null;
  try{stopped(status);row.jitRaw=await qmp.send('x-query-jit');row.jitStatus=await qmp.send('query-status');}catch(e){row.jitError=String(e.stack??e);}
  return row;
 };
 const match=()=>{
  if(pending===null||signal===null)return;const gate=pending,signalHostMs=signal;pending=null;signal=null;
  chain=chain.then(async()=>{
   if(finished)throw Error('No gate execution after failure');const seq=sequence++;if(gate.seq!==seq||!layout||sequence>10)throw Error('Gate bound/layout');
   const row={event:'gate',seq,gate,...(seq===0?{layout}:{}),signalHostMs,...await stoppedObservation(await pause()),readHostMs:clock()};
   report.gates.push(row);const decision=await record(row);stopped(row.status);if(decision.ack!=='K')throw Error('Exact pressure decision required');
   if(finished)throw Error('No ACK after failure');port.write(decision.ack);row.ackHostMs=clock();
   await record({event:'ack',seq,ack:decision.ack,hostMs:row.ackHostMs,watchEpoch:{m3a:epoch,m3b:epoch,census:epoch}});await qmp.send('cont');row.contHostMs=clock();
  }).catch(e=>finish(String(e.stack??e)));
 };
 const line=text=>{
  if(/M3B_SIGNAL_ALIAS_FAIL:|Kernel panic|BUN_APP_FAILURE/.test(text))throw Error(text);
  if(text.startsWith('M3B_SIGNAL_ALIAS_LAYOUT:')){if(layout)throw Error('Duplicate layout');layout=JSON.parse(text.slice('M3B_SIGNAL_ALIAS_LAYOUT:'.length));report.layout=layout;}
  if(text.startsWith('M3B_SIGNAL_ALIAS_GATE:')){if(pending!==null)throw Error('Duplicate gate');pending=JSON.parse(text.slice('M3B_SIGNAL_ALIAS_GATE:'.length));match();}
  if(text.startsWith('M3B_SIGNAL_ALIAS_PASS:')){if(complete)throw Error('Duplicate pass');complete=JSON.parse(text.slice('M3B_SIGNAL_ALIAS_PASS:'.length));finish('pass');}
  if(text.startsWith('M3B_SIGNAL_ALIAS_')&&!['M3B_SIGNAL_ALIAS_LAYOUT:','M3B_SIGNAL_ALIAS_GATE:','M3B_SIGNAL_ALIAS_PASS:'].some(p=>text.startsWith(p)))throw Error('Unknown guest record');
 };
 const sink=(path,name,consume)=>{
  mod.FS.writeFile(path,new Uint8Array());const node=mod.FS.lookupPath(path).node,ops=node.stream_ops;
  node.stream_ops={...ops,write(stream,buffer,offset,length,position){
   const bytes=new Uint8Array(buffer.subarray(offset,offset+length)),p=Number(position);
   try{pipe.push(name,bytes,p);node.usedBytes=p+length;if(consume)consume(bytes);}catch(e){finish(String(e.stack??e));throw e;}
   // Deliberately do not call MEMFS's write: durable host streams own bytes.
   // FS.write still advances stream.position; the node records logical size.
   return length;
  }};
 };
 try{
  if(typeof enabled!=='boolean'||timeoutMs!==pressureSettings.timeoutMs)throw Error('Bounded explicit arguments required');
  timer=setTimeout(()=>finish('Bounded pressure deadline exceeded'),timeoutMs);
  // Trace partials flush only at gates/final drain; full chunks still enqueue
  // immediately. This host timer never yields or pauses the guest.
  flushTimer=setInterval(()=>{try{pipe.flushOne('serial');pipe.flushOne('stderr');}catch(e){finish(String(e.stack??e));}},512);
  const {default:factory}=await import(runtimeUrl);
  factory({arguments:args.factory,mainScriptUrlOrBlob:runtimeUrl,printErr:t=>{try{const b=new TextEncoder().encode(String(t)+'\n');pipe.push('stderr',b,pipe.streams.stderr.seen);}catch(e){finish(String(e.stack??e));}},onAbort:e=>finish('Abort: '+e),preRun:[m=>{
   mod=m;configureM3Region(m,true);m._defuss_set_hot_limit(1500);m._defuss46_settings(2);report.configuration={...configureM3b(m,enabled),census:configureCensus(m,binding),m3aEnabled:true,hotLimit:1500,flags:2,instanceLimit:12000};
   m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',new Uint8Array(kernel));m.FS.writeFile('/guest/initramfs',new Uint8Array(initramfs));for(const [n,b]of Object.entries(roms))m.FS.writeFile('/rom/'+n,new Uint8Array(b));
   const decoder=new TextDecoder();sink('/guest/console.log','serial',bytes=>{tail+=decoder.decode(bytes,{stream:true});if(tail.length>65536)throw Error('Partial serial line bound');let end;while((end=tail.indexOf('\n'))>=0){const text=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);line(text);}});
   port=attachCom1(m,data=>{if(data.length!==1||data[0]!==71||signal!==null){finish('Unexpected COM1');return;}signal=clock();report.signals.push(signal);match();});
   m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
   m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){try{qmp.accept(new Uint8Array(b.subarray(o,o+n)));}catch(e){finish(String(e));}return n;}return original(s,b,o,n,p);};
  }]}).catch(e=>finish(String(e.stack??e)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  let startupCpus=null,startupFailure=null,initial=null;try{startupCpus=await qmp.send('query-cpus-fast');initial=await qmp.send('query-status');}catch(e){startupFailure=String(e.stack??e);}
  report.startup={event:'startup',hostMs:clock(),startupCpus,startupFailure,...observe(initial,true)};await record(report.startup);if(finished)throw Error('Startup failure');await qmp.send('cont');
  const reason=await done;await chain;if(reason!=='pass')throw Error(reason);
  if(sequence!==10||report.signals.length!==sequence||pending!==null||signal!==null)throw Error('Incomplete handshake');
  report.final={event:'complete',validation:complete,...await stoppedObservation(await pause()),hostMs:clock()};const final=await record(report.final);if(!['passed','incomplete'].includes(final.result))throw Error('Exact lifetime result required');report.status=final.result;
 }catch(e){report.failure=String(e.stack??e);}
 finally{
  clearTimeout(timer);clearInterval(flushTimer);
  // No resume/ACK in this path. Stop and drain while the browser still lives.
  if(mod)try{report.endStatus=await Promise.race([pause(),new Promise((_,bad)=>setTimeout(()=>bad(Error('Final pause deadline')),3000))]);stopped(report.endStatus);}catch(e){report.status='failed';report.pauseFailure=String(e);}
  try{report.streams=await pipe.drain();}catch(e){report.status='failed';report.drainFailure=String(e.stack??e);report.streams=pipe.snapshot();}
 }
 return report;
}
