import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';
import {configureFifo,readFifoSnapshot} from '../../experiments/passive-fifo/reader.mjs';
import {settings,mainOrder,observerBus,publishObserverNative,observerSnapshot,readTrace,validateSnapshot,validateMainOracle,pressureState,acceptPressure,finishPressure} from './contract.mjs';
import {parseTranslationBuffer} from '../regions-pressure/jit.mjs';
export async function runPolicyGuest({runtimeUrl,kernel,initramfs,roms,enabled,fixture}){
 if(!['main','pressure','combined'].includes(fixture))throw Error('Unknown fixture');
 const qmp=new Qmp(),report={status:'running',fixture,enabled,settings,gates:[],results:[],signals:[],acks:[],markers:[],stderr:[],serial:'',timingEligible:false};
 let mod,port,state,finish,timer,pending=null,signal=false,tail='',chain=Promise.resolve(),prior,priorJit,warmFlush,serialBytes=0,stderrBytes=0,phase=fixture==='combined'?'pressure':fixture;
 const done=new Promise(ok=>finish=ok),started=performance.now(),bus=observerBus();
 const recordEvent=(event,data)=>{void globalThis.__recordPolicyEvent({event,...data}).catch(e=>finish(String(e)));};
 const queryStatus=()=>qmp.send('query-status');
 const snapshot=async()=>{
  let native;
  try{
  native=await readFifoSnapshot(mod,{enabled,queryStatus});const observed=observerSnapshot(bus,native);
  native.rawWords=Array.from(new Uint32Array(mod.pcProfileWords().buffer,Number(mod._defuss_fifo_data()),64));
  if(native.rawWords[2]!==native.sequence||native.rawWords[3]!==native.sequence)throw Error('Native copied epoch changed');
  validateSnapshot(native,enabled,prior);prior=native;
  const control={status:mod._defuss_fifo_status(),state:mod._defuss_fifo_state(),rejections:mod._defuss_fifo_rejections()};
  if(control.status!==(enabled?7:6)||control.state!==(enabled?3:0)||control.rejections)throw Error('Native effective policy readback failed');
  return {snapshot:native,observer:observed,control};
  }catch(error){error.observation??={native:native??null,observerEpoch:bus?Array.from(new Uint32Array(bus.buffer,64*4,64)):null};throw error;}
 };
 const match=()=>{
  if(pending===null||!signal)return;const data=pending;pending=null;signal=false;
  chain=chain.then(async()=>{
   if(phase==='main'&&data.stage!==mainOrder[report.gates.filter(g=>g.fixturePhase==='main').length])throw Error('Wrong main gate order');
   if(phase==='main'&&data.stage===4)await new Promise(ok=>setTimeout(ok,100));
   Atomics.store(new Uint32Array(bus.buffer),46,1);await qmp.send('stop');const status=await queryStatus();if(status.running||status.status!=='paused')throw Error('Not paused');Atomics.store(new Uint32Array(bus.buffer),46,2);
   report.activeGate={...data,fixturePhase:phase,status};
   const row={...report.activeGate,...await snapshot(),elapsedMs:performance.now()-started,utc:new Date().toISOString()};
   row.jitRaw=await qmp.send('x-query-jit');row.jitStatus=await queryStatus();report.gates.push(row);report.activeGate=null;
   await globalThis.__recordPolicyGate({sequence:report.gates.length-1,row});
   if(row.jitStatus.running||row.jitStatus.status!=='paused')throw Error('Translation query ended outside paused VM');
   row.jit=parseTranslationBuffer(row.jitRaw);
   if(priorJit&&(row.jit.capacityBytes!==priorJit.capacityBytes||row.jit.flushCount===priorJit.flushCount&&row.jit.usedBytes<priorJit.usedBytes))throw Error('Translation buffer changed inconsistently');
   if(fixture!=='main'){
    if(data.stage==='warm')warmFlush=row.jit.flushCount;
    if(warmFlush!==undefined&&row.jit.flushCount!==warmFlush)throw Error('Post-warm TB flush invalidates pressure epoch');
   }
   priorJit=row.jit;
   let ack='K';if(phase==='pressure')ack=acceptPressure(state,row,enabled);
   if(phase==='main'&&data.stage===-1||phase==='pressure'&&data.stage==='warm')Atomics.store(new Uint32Array(bus.buffer),32,1);
   row.ack=ack;report.acks.push({sequence:report.acks.length,fixturePhase:phase,stage:data.stage,ack});port.write(ack);Atomics.store(new Uint32Array(bus.buffer),46,3);await qmp.send('cont');Atomics.store(new Uint32Array(bus.buffer),46,0);
  }).catch(async error=>{
   if(error.observation)report.failedObservation=error.observation;
   if(report.activeGate){report.failedGate={...report.activeGate,observation:error.observation??null,error:String(error)};
    try{await globalThis.__recordPolicyGate({sequence:report.gates.length,row:report.failedGate});}catch(e){report.failedProgress=String(e);}}
   finish(String(error.stack||error));
  });
 };
 const line=text=>{
  if(/REGION_FAIL:|PRESSURE_FAIL:|Kernel panic/.test(text)){finish(text);return;}
  if(text.startsWith('REGION_LAYOUT:'))report.layout=JSON.parse(text.slice(14));
  if(text.startsWith('REGION_SMC_RANGE:'))report.smc=JSON.parse(text.slice(17));
  if(text.startsWith('REGION_RESULT:'))report.results.push(JSON.parse(text.slice(14)));
  if(text.startsWith('REGION_INTERRUPTS:'))report.interrupts=JSON.parse(text.slice(18));
  if(text.startsWith('PRESSURE_LAYOUT:')){if(state)throw Error('Duplicate layout');state=pressureState(JSON.parse(text.slice(16)));report.layout=state.layout;report.pressureLayout=state.layout;}
  const gate=text.match(/^REGION_GATE:(-?\d+)$/);
  if(gate||text.startsWith('PRESSURE_GATE:')){if(pending!==null||report.markers.length>=223)throw Error('Duplicate/excess gate');if(Boolean(gate)!==(phase==='main'))throw Error('Wrong fixture marker phase');pending=gate?{stage:Number(gate[1])}:JSON.parse(text.slice(14));report.markers.push({fixturePhase:phase,...pending});match();}
  if(text.startsWith('PRESSURE_PASS:')){
   if(phase!=='pressure')throw Error('Unexpected pressure completion');report.pressureValidation=JSON.parse(text.slice(14));
   if(fixture==='combined'){
    report.pressureStatus=finishPressure(state,report.pressureValidation);if(report.pressureStatus!=='passed'){finish('incomplete');return;}phase='main';
   }else{report.validation=report.pressureValidation;finish('pass');}
  }
  if(text.startsWith('REGION_PASS:')){if(phase!=='main')throw Error('Unexpected main completion');report.validation=JSON.parse(text.slice(12));finish('pass');}
 };
 const args=['-nodefaults','-machine','pc,acpi=off','-cpu','max','-accel','tcg,tb-size=256','-smp','1','-m','512',
 '-display','none','-monitor','none','-qmp','stdio','-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1',
 '-serial','chardev:fixture-com1','-serial','file:/guest/console.log','-parallel','none','-no-reboot','-no-shutdown','-L','/rom',
 '-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on'];report.arguments=args;
 try{
  if(typeof globalThis.__recordPolicyGate!=='function'||typeof globalThis.__recordPolicyEvent!=='function')throw Error('Durable progress recorder unavailable');
  timer=setTimeout(()=>finish('Policy guest deadline exceeded'),settings.timeoutMs);
  const {default:factory}=await import(runtimeUrl);
  factory({pcFifoObserverBus:bus,arguments:args,mainScriptUrlOrBlob:runtimeUrl,printErr:t=>{const text=String(t);stderrBytes+=text.length;if(report.stderr.length>=4096||stderrBytes>1048576||text.length>65536){finish('Bounded stderr exceeded');return;}report.stderr.push(text);recordEvent('runtime-stderr',{text});},onAbort:e=>{recordEvent('runtime-abort',{text:String(e)});finish(String(e));},preRun:[m=>{
   mod=m;report.configuration=configureFifo(m,enabled,{diagnostic:true});m._defuss_set_hot_limit(1500);m._defuss46_settings(3);
   report.observerNativeAddress=publishObserverNative(bus,m._defuss_fifo_data());
   m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',new Uint8Array(kernel));m.FS.writeFile('/guest/initramfs',new Uint8Array(initramfs));
   for(const [name,bytes]of Object.entries(roms))m.FS.writeFile('/rom/'+name,new Uint8Array(bytes));
   port=attachCom1(m,data=>{if(report.signals.length>=223){finish('Excess COM1 gates');return;}report.signals.push({bytes:Array.from(data),elapsedMs:performance.now()-started});if(data.length!==1||data[0]!==71||signal){finish('Invalid COM1 gate');return;}signal=true;match();});
   m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops,decoder=new TextDecoder();
   node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});
    serialBytes+=count;if(serialBytes>16*1048576||tail.length+text.length>1048576){finish('Bounded guest console exceeded');return count;}
    report.serial+=text;tail+=text;let end;
    while((end=tail.indexOf('\n'))>=0){const t=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);try{line(t);}catch(e){finish(String(e.stack||e));}}return count;}};
   m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
   m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(b.subarray(o,o+n));return n;}return original(s,b,o,n,p);};
  }]}).catch(e=>finish(String(e.stack||e)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  const outcome=await done;if(!['pass','incomplete'].includes(outcome))throw Error(outcome);await chain;Atomics.store(new Uint32Array(bus.buffer),46,1);await qmp.send('stop');report.finalStatus=await queryStatus();Atomics.store(new Uint32Array(bus.buffer),46,2);
  if(report.finalStatus.running||report.finalStatus.status!=='paused')throw Error('Final stop not confirmed');
  report.final=await snapshot();report.trace=readTrace(bus);report.finalJitRaw=await qmp.send('x-query-jit');report.finalJitStatus=await queryStatus();
  if(report.finalJitStatus.running||report.finalJitStatus.status!=='paused')throw Error('Final translation query ended outside paused VM');
  report.finalJit=parseTranslationBuffer(report.finalJitRaw);
  if(report.finalJit.capacityBytes!==priorJit.capacityBytes||report.finalJit.flushCount===priorJit.flushCount&&report.finalJit.usedBytes<priorJit.usedBytes||fixture!=='main'&&report.finalJit.flushCount!==warmFlush)throw Error('Final translation epoch differs');
  if(pending!==null||signal||report.signals.length!==report.gates.length||report.markers.length!==report.gates.length||report.acks.length!==report.gates.length)throw Error('Unpaired final marker/signal/ACK');
  if(outcome==='incomplete')report.status='incomplete';
  else if(fixture!=='pressure'){
   const mainGates=report.gates.filter(g=>g.fixturePhase==='main');validateMainOracle({...report,gates:mainGates});
   const first=mainGates[0].snapshot.counters,last=report.final.snapshot.counters;
   report.mainPolicyExposure={before:first,after:last,delta:Object.fromEntries(['softBatches','softRetired','emergencyRetired','gcConsumed','compiledCalls','interpretedCalls'].map(k=>[k,last[k]-first[k]])),scope:'Main segment begins at its layout gate. Prior retirement is distinct from retirement during main; global compiledCalls cannot prove per-function compiled exposure.'};
   report.status='passed';
  }else report.status=finishPressure(state,report.validation);
  report.scope='Retained guest diagnostic correctness/lifecycle fixture with256MiB translation buffer and production hot1500/flags3. Combined mode runs exact pressure then main ELF bytes in one VM; main exposure deltas distinguish prior from during-main retirement. No M3 injection/watch API, per-function compiled-path, suspended-instance eviction or timing claim.';
 }catch(e){report.status='failed';report.failure=String(e.stack||e);if(e.observation)report.failedObservation=e.observation;}
 clearTimeout(timer);report.elapsedMs=performance.now()-started;report.incompleteReason=state?.incompleteReason??null;return report;
}
