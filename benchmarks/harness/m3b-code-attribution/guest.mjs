import {Qmp} from '../../../host/browser/qmp.mjs';
import {attachCom1} from '../../../packaging/bun-app/serial.mjs';
import {configureM3Region} from '../../../experiments/m3a-region/reader.mjs';
import {configureM3b,readGraph,readObjects,stopped} from '../../../tests/m3b-fallthrough/reader.mjs';
import {configureCensus,readCensusRaw} from '../../../tests/m3b-context-accounting-v3/census-browser.mjs';
import {prefix} from '../m1/protocol.mjs';
import {args,protocol,limits,scope} from './config.mjs';
export async function run({runtimeUrl,assets,binding,enabled,timeoutMs}){
 const report={schema:1,protocol,status:'failed',enabled,arguments:[...args],scope,timingEligible:false,signals:[],stderr:[],gateAcks:0};
 const qmp=new Qmp(),origin=performance.now(),clock=()=>performance.now()-origin;
 let mod,port,timer,doneResolve,finished=false,failure=null,serial='',tail='',serialAt=0,pending=null,signal=null,prepared=false,ready=false,sequence=0,chain=Promise.resolve();
 const done=new Promise(resolve=>doneResolve=resolve),finish=error=>{if(!finished){finished=true;failure=error;doneResolve();}};
 const raw=(name,words)=>{const memory=mod.pcProfileWords?.()??mod.HEAPU32,p=Number(mod[name]());if(!(memory instanceof Uint32Array)||!Number.isSafeInteger(p)||p<0||p%4||p+words*4>memory.byteLength)throw Error('Native raw bank pointer');return Array.from(memory.slice(p/4,p/4+words));};
 const pause=async()=>{await qmp.send('stop');const status=await qmp.send('query-status');stopped(status);return status;};
 const record=async(kind,status,extra={})=>{
  stopped(status,kind==='startup');const census=readCensusRaw(mod,status,{initial:kind==='startup'});
  if(mod._defuss_m3co_abi?.()!==1)throw Error('Code observer ABI1 required');
  const row={sequence:sequence++,kind,status,hostMs:clock(),serialChunk:serial.slice(serialAt),m3aRaw:raw('_defuss_m3_data',96),m3bRaw:raw('_defuss_m3b_data',128),codeRaw:raw('_defuss_m3co_data',2112),boundaryRaw:raw('_defuss_m3b_boundary_data',256),nativeStatus:mod._defuss_m3b_status(),censusRaw:census.raw,censusNativeStatus:census.nativeStatus,pool:structuredClone(mod.pcJitPool()),...extra};
  serialAt=serial.length;const result=await globalThis.__m3bExposureRecord(row);if(result?.accepted!==true)throw Error('Durable host oracle refused observation');if(finished)throw Error(failure??'Already finished');
 };
 const pump=()=>{
  const start=!ready&&prepared&&signal===49;if(!start&&(!ready||!pending||signal!==71))return;
  const gate=pending,s=signal;pending=null;signal=null;
  chain=chain.then(async()=>{
   if(finished)throw Error('No ACK after failure');const status=await pause();
   await record(start?'ready':'gate',status,start?{signal:s}:{signal:s,gate});
   if(start){ready=true;port.write('C');}else{port.write('K');report.gateAcks++;}
   await qmp.send('cont');
   if(gate?.event==='complete')finish(null);
  }).catch(error=>finish(String(error.stack??error)));
 };
 try{
  if(typeof enabled!=='boolean'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>limits.timeout||!crossOriginIsolated)throw Error('Bounded isolated arguments required');
  timer=setTimeout(()=>finish('30-minute cold exposure deadline exceeded'),timeoutMs);
  const loaded={};for(const [name,url]of Object.entries(assets)){const response=await fetch(url);if(!response.ok)throw Error('Asset '+name);loaded[name]=new Uint8Array(await response.arrayBuffer());}
  const {default:factory}=await import(runtimeUrl);
  factory({arguments:[...args],mainScriptUrlOrBlob:runtimeUrl,printErr:text=>{text=String(text);if(report.stderr.join('\n').length+text.length>limits.stderr){finish('Stderr bound');return;}report.stderr.push(text);},onAbort:e=>finish('VM abort: '+e),preRun:[m=>{
   mod=m;configureM3Region(m,true);m._defuss_set_hot_limit(1500);m._defuss46_settings(3);report.configuration={m3b:configureM3b(m,enabled),census:configureCensus(m,binding),m3aEnabled:true,hotLimit:1500,runtimeFlags:3,instanceLimit:12000};
   m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',loaded.kernel);m.FS.writeFile('/guest/initramfs',loaded['initramfs.cpio.gz']);for(const [name,data]of Object.entries(loaded))if(name.startsWith('rom/'))m.FS.writeFile('/'+name,data);
   m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops,decoder=new TextDecoder('utf-8',{fatal:true});
   node.stream_ops={...ops,write(s,b,o,n,p){try{const text=decoder.decode(new Uint8Array(b.subarray(o,o+n)),{stream:true});serial+=text;tail+=text;if(serial.length>limits.serial||tail.length>2097152)throw Error('Serial bound');let end;while((end=tail.indexOf('\n'))>=0){const line=tail.slice(0,end).replace(/\r$/,'');tail=tail.slice(end+1);if(/Kernel panic|BUN_APP_FAILURE:/.test(line))throw Error(line);if(line.startsWith(prefix)){const event=JSON.parse(line.slice(prefix.length));if(event.event==='snapshot-prepared'){if(prepared)throw Error('Duplicate ready');prepared=true;}else if(event.seq!==undefined){if(pending)throw Error('Overlapping gates');pending=event;}pump();}}node.usedBytes=Number(p)+n;return n;}catch(e){finish(String(e.stack??e));throw e;}}};
   port=attachCom1(m,data=>{try{for(const byte of data){if(signal!==null||![49,71].includes(byte)||report.signals.length>=70)throw Error('Unexpected COM1');signal=byte;report.signals.push({byte,hostMs:clock()});pump();}}catch(e){finish(String(e.stack??e));}});
   m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const old=m.TTY.stream_ops.write;m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(new Uint8Array(b.subarray(o,o+n)));return n;}return old(s,b,o,n,p);};
  }]}).catch(e=>finish(String(e.stack??e)));
  await Promise.race([qmp.greeting,done.then(()=>{throw Error(failure);})]);await qmp.send('qmp_capabilities');const status=await qmp.send('query-status');
  await record('startup',status,{cpus:await qmp.send('query-cpus-fast'),graph:readGraph(mod,status).text,objects:readObjects(mod,status).text});await qmp.send('cont');
  await done;await chain;if(failure)throw Error(failure);
  // Final persistence is allowed after the normal complete gate; no further ACK.
  finished=false;await record('final',await pause(),{gateAcks:report.gateAcks});finished=true;
  if(report.signals.length!==70||pending!==null||signal!==null||sequence!==72)throw Error('Incomplete handshake');report.status='passed';
 }catch(e){report.failure=String(e.stack??e);}
 finally{clearTimeout(timer);if(mod)try{report.endStatus=await pause();}catch(e){report.status='failed';report.pauseFailure=String(e);}report.serial=serial;report.records=sequence;}
 return report;
}
