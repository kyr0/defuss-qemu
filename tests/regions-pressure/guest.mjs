import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';
import {configureM3Region,readM3Region,watchM3Region} from '../../experiments/m3a-region/reader.mjs';
import {settings,pressureState,acceptGate,finishPressure} from './contract.mjs';
import {validateTranslationBuffer} from './jit.mjs';

export async function runPressureGuest({runtimeUrl,kernel,initramfs,roms}){
 const qmp=new Qmp(),started=performance.now(),report={status:'running',enabled:true,settings,startedUtc:new Date().toISOString(),gates:[],stderr:[],serial:'',fixtureScope:'Diagnostic256MiB TB-buffer correctness fixture; not production128MiB acceptance. Guest512MiB, instance cap12000, hot1500/flags3 unchanged.'};
 let mod,port,finish,timer,pending=null,signal=false,tail='',state,chain=Promise.resolve();const done=new Promise(ok=>finish=ok);
 const match=()=>{
  if(pending===null||!signal)return;const data=pending;pending=null;signal=false;
  chain=chain.then(async()=>{
   await qmp.send('stop');const status=await qmp.send('query-status');
   if(status.running||status.status!=='paused')throw Error('Pressure VM not stopped');
   const row={...data,status,counters:readM3Region(mod),pool:mod.pcJitPool(),elapsedMs:performance.now()-started,observedUtc:new Date().toISOString()};report.gates.push(row);
   try{row.jitRaw=await qmp.send('x-query-jit');row.jitStatus=await qmp.send('query-status');}
   catch(error){row.jitError=String(error.stack||error);}
   await globalThis.__recordPressureGate({sequence:report.gates.length-1,row,layout:state?.layout??null});
   const ack=acceptGate(state,row);
   if(data.stage==='layout')for(const [slot,name] of ['sentinel','generated'].entries())watchM3Region(mod,slot,BigInt(state.layout[name][0]),BigInt(state.layout[name][1]));
   if(data.stage==='churn'&&ack==='R')watchM3Region(mod,0,BigInt(state.layout.sentinel[0]),BigInt(state.layout.sentinel[1]));
   row.ack=ack;port.write(ack);await qmp.send('cont');
  }).catch(e=>finish(String(e.stack||e)));
 };
 const line=text=>{
  if(text.includes('PRESSURE_FAIL:')||text.includes('Kernel panic')){finish(text);return;}
  if(text.startsWith('PRESSURE_LAYOUT:')){if(state)throw Error('Duplicate pressure layout');state=pressureState(JSON.parse(text.slice(16)));report.layout=state.layout;}
  if(text.startsWith('PRESSURE_GATE:')){if(pending!==null)throw Error('Duplicate pressure gate');pending=JSON.parse(text.slice(14));match();}
  if(text.startsWith('PRESSURE_PASS:')){report.validation=JSON.parse(text.slice(14));finish('pass');}
 };
 const args=['-nodefaults','-machine','pc,acpi=off','-cpu','max','-accel',`tcg,tb-size=${settings.tbMiB}`,'-smp','1','-m',String(settings.guestRamMiB),
  '-display','none','-monitor','none','-qmp','stdio','-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1',
  '-serial','chardev:fixture-com1','-serial','file:/guest/console.log','-parallel','none','-no-reboot','-no-shutdown','-L','/rom',
  '-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on'];report.arguments=args;
 try{
  if(typeof globalThis.__recordPressureGate!=='function')throw Error('Durable host pressure recorder unavailable');
  timer=setTimeout(()=>finish('Pressure guest deadline exceeded'),settings.timeoutMs);
  const {default:factory}=await import(runtimeUrl);
  factory({arguments:args,mainScriptUrlOrBlob:runtimeUrl,printErr:t=>report.stderr.push(String(t)),onAbort:e=>finish(String(e)),preRun:[m=>{
   mod=m;configureM3Region(m,true);m._defuss_set_hot_limit(1500);m._defuss46_settings(3);
   report.configuration={phase:'preRun-before-vCPU',hotLimit:1500,flags:3,tbMiB:settings.tbMiB,guestRamMiB:settings.guestRamMiB,nativeSettingReadback:false,forcedGC:false};
   m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',new Uint8Array(kernel));m.FS.writeFile('/guest/initramfs',new Uint8Array(initramfs));
   for(const [name,bytes] of Object.entries(roms))m.FS.writeFile('/rom/'+name,new Uint8Array(bytes));
   port=attachCom1(m,data=>{if(data.length!==1||data[0]!==71||signal){finish('Invalid pressure COM1 gate');return;}signal=true;match();});
   m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops,decoder=new TextDecoder();
   node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});report.serial+=text;tail+=text;let end;
    while((end=tail.indexOf('\n'))>=0){const text=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);try{line(text);}catch(e){finish(String(e.stack||e));}}return count;}};
   m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
   m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(b.subarray(o,o+n));return n;}return original(s,b,o,n,p);};
  }]}).catch(e=>finish(String(e.stack||e)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  const outcome=await done;if(outcome!=='pass')throw Error(outcome);await chain;await qmp.send('stop');
  report.finalStatus=await qmp.send('query-status');if(report.finalStatus.running||report.finalStatus.status!=='paused')throw Error('Pressure final stop not confirmed');
  report.status=finishPressure(state,report.validation);report.finalCounters=readM3Region(mod);report.finalPool=mod.pcJitPool();
  if(report.finalPool.limit!==12000||!Number.isSafeInteger(report.finalPool.charged)||report.finalPool.charged<0||report.finalPool.charged>12000)throw Error('Final pressure pool bounds failed');
  report.finalJitRaw=await qmp.send('x-query-jit');report.finalJitStatus=await qmp.send('query-status');
  report.finalJit=validateTranslationBuffer({jitRaw:report.finalJitRaw,jitStatus:report.finalJitStatus,counters:report.finalCounters});
  if(report.finalCounters.counters.flushes!==state.warm.counters.counters.flushes||report.finalJit.capacityBytes!==state.previousJit.capacityBytes||report.finalJit.usedBytes<state.previousJit.usedBytes)throw Error('Final translation-buffer epoch/capacity differs');
 }catch(e){report.status='failed';report.failure=String(e.stack||e);}
 clearTimeout(timer);report.elapsedMs=performance.now()-started;report.finishedUtc=new Date().toISOString();
 report.retryTiming={requestedGuestSleepNs:Math.max(0,(state?.attempts??0)-1)*1000000000,hostGateTimes:'Each stopped row records elapsedMs and observedUtc. Guest sleep requests are not claimed as measured host sleep duration.'};
 report.lifetime={retirementObserved:Boolean(state?.retirement),selectedReinstantiationObserved:Boolean(state?.reinstantiated),capFallbackObserved:state?.capFallbackObserved??false,
  scope:'First6000 FIFO slots include the selected immutable sentinel installed before cumulative6000 with zero prior retirement. No intervening global TB flush. Natural GC only; global stale counts are not attributed solely to the sentinel. Exact suspended Asyncify eviction is not exercised.'};return report;
}
