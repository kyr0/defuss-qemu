import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';
import {configureM3Region,readM3Region,watchM3Region,injectM3Region} from '../../experiments/m3a-region/reader.mjs';

export const fixtureSettings=Object.freeze({hotLimit:1500,flags:2,admission:false,rep16:true,instanceLimit:12000});
const configuredModules=new WeakSet();
// Both native settings fields are non-atomic and have a pre-vCPU contract.
// Call only from preRun; never change these settings at a stopped guest gate.
export function configureRegionFixture(mod,enabled){
 if(configuredModules.has(mod))throw Error('Fixture configuration already applied');
 if(typeof mod._defuss_set_hot_limit!=='function'||typeof mod._defuss46_settings!=='function')throw Error('Fixture settings APIs unavailable');
 configuredModules.add(mod);configureM3Region(mod,enabled);
 mod._defuss_set_hot_limit(fixtureSettings.hotLimit);mod._defuss46_settings(fixtureSettings.flags);
 return {phase:'preRun-before-vCPU',enabled,...fixtureSettings,
  evidence:'Fixed settings API calls completed in preRun. Native hotness/admission getters are unavailable; this is not a native readback.'};
}
export function validateFixturePool(pool){
 if(!pool||pool.limit!==fixtureSettings.instanceLimit||!Number.isSafeInteger(pool.charged)||pool.charged<0||pool.charged>pool.limit)throw Error('Invalid fixture instance-pool accounting or cap');
 return pool;
}
export function validateRecovery(counters,injection,requireSelected){
 if(!injection)throw Error('Missing diagnostic injection record');
 const stale=injection.action==='stale-instance',changed=stale?'staleInstanceMisses':'invalidRedispatches',unchanged=stale?'invalidRedispatches':'staleInstanceMisses';
 if(counters.counters[changed]-injection.after.counters[changed]!==1)throw Error('Diagnostic recovery counter must increase exactly once: '+changed);
 if(counters.counters[unchanged]!==injection.after.counters[unchanged])throw Error('Unexpected other recovery counter: '+unchanged);
 if(requireSelected&&counters.watches[0].selectedEntries<=injection.after.watches[0].selectedEntries)throw Error('Recovered fixture entry did not execute selected code after rewarm: '+injection.action);
}
export function validateExposure(counters,slots,enabled,stage){
 for(const slot of slots)if(enabled&&!(counters.watches[slot].selectedEntries>0))throw Error('Fixture code did not execute the selected region path: stage '+stage+' slot '+slot);
 if(!enabled&&counters.counters.selectedEntries!==0)throw Error('Disabled region path selected');
}
export function validateMutatingSMC(counters,before,activePC){
 const watch=counters.watches[1];
 if(watch.selectedEntries!==1||BigInt(watch.lastSelectedPC)!==BigInt(activePC))throw Error('Single mutating active-SMC call did not select its original entry exactly once');
 if(counters.counters.invalidations<=before.counters.invalidations)throw Error('Mutating active-SMC call did not expose invalidation');
}
export async function runRegionGuest({runtimeUrl,kernel,initramfs,roms,enabled,timeoutMs=300000}){
 const qmp=new Qmp(),report={status:'running',enabled,...fixtureSettings,gates:[],gateObservations:[],results:[],injections:[],stderr:[],serial:''};
 let mod,port,finish,timer,pending=null,signal=false,tail='',layout=null,smc=null,chain=Promise.resolve();
 const done=new Promise(ok=>finish=ok),order=[-1,0,5,6,7,11,14,15,1,10,16,17,2,12,3,13,4];
 const match=()=>{
  if(pending===null||!signal)return;
  const stage=pending;pending=null;signal=false;
  chain=chain.then(async()=>{
   if(stage!==order[report.gates.length])throw Error('Wrong region gate order');
   // Leave the guest running without an ACK before stopping at the final read.
   // This is guest syscall continuation evidence, not an exact Asyncify site.
   if(stage===4)await new Promise(ok=>setTimeout(ok,100));
   await qmp.send('stop');const status=await qmp.send('query-status');
   if(status.running||status.status!=='paused')throw Error('VM not stopped');
   const counters=readM3Region(mod),pool=mod.pcJitPool?.()??null;
   // Retain the failed gate too: exposure rejection must not discard its
   // exact stopped counters or conceal a pool already exhausted during boot.
   report.gateObservations.push({stage,status,counters,pool});validateFixturePool(pool);
   if(counters.saturated||counters.enabled!==enabled||counters.counters.watchPcMismatches||counters.counters.injectionRejects)throw Error('Invalid region counters/configuration');
   if(stage===-1){
    if(!layout)throw Error('Missing fixture layout');
    for(const [slot,name] of ['state','faultLoad','faultStore','suspend'].entries())watchM3Region(mod,slot,BigInt(layout[name][0]),BigInt(layout[name][1]));
   }
   validateExposure(counters,({0:[0],5:[0],7:[0],14:[1],15:[1],1:[2],16:[0,1],2:[0,1],3:[2]})[stage]??[],enabled,stage);
   if(stage===10){
    if(!smc||BigInt(smc.end)-BigInt(smc.start)!==4096n)throw Error('Missing executable alias page');
    watchM3Region(mod,0,BigInt(smc.start),BigInt(smc.start)+6n);
    watchM3Region(mod,1,BigInt(smc.start)+128n,BigInt(smc.start)+166n);
   }
   if(stage===11){
    watchM3Region(mod,1,BigInt(layout.faultLoad[0]),BigInt(layout.faultLoad[1]));
    watchM3Region(mod,2,BigInt(layout.faultStore[0]),BigInt(layout.faultStore[1]));
   }
   if(stage===14)watchM3Region(mod,1,BigInt(layout.faultLoad[0]),BigInt(layout.faultLoad[1]));
   if(stage===15)watchM3Region(mod,2,BigInt(layout.faultStore[0]),BigInt(layout.faultStore[1]));
   if(stage===16)watchM3Region(mod,1,BigInt(smc.start)+128n,BigInt(smc.start)+166n);
   if(stage===17&&enabled)validateMutatingSMC(counters,report.gates.find(g=>g.stage===16).counters,BigInt(smc.start)+128n);
   if(stage===12)watchM3Region(mod,2,BigInt(layout.loop[0]),BigInt(layout.loop[1]));
   if(stage===13)watchM3Region(mod,3,BigInt(layout.suspend[0]),BigInt(layout.suspend[1]));
   if(enabled&&(stage===5||stage===6||stage===7)){
    const injection=report.injections.find(row=>row.action===(stage===5?'stale-instance':'invalid-descriptor'));
    validateRecovery(counters,injection,stage!==6);
   }
   if(enabled&&(stage===0||stage===5)){
    const action=stage===0?'stale-instance':'invalid-descriptor',field=stage===0?'injectedStaleInstances':'injectedInvalidDescriptors';
    const mutation=injectM3Region(mod,action,0,BigInt(layout.state[0])),after=readM3Region(mod);
    if(mutation.mutations!==1||after.counters[field]-counters.counters[field]!==1)throw Error('Diagnostic injection count mismatch');
    report.injections.push({...mutation,stage,before:counters,after});
   }
   if(stage===2&&enabled&&!(counters.counters.invalidations>report.gates.find(g=>g.stage===10).counters.counters.invalidations))throw Error('SMC did not expose invalidation');
   report.gates.push({stage,counters,pool});
   port.write('K');await qmp.send('cont');
  }).catch(error=>finish(String(error.stack||error)));
 };
 const line=text=>{
  if(text.includes('REGION_FAIL:')||text.includes('Kernel panic')){finish(text);return;}
  if(text.startsWith('REGION_LAYOUT:'))layout=JSON.parse(text.slice(14));
  if(text.startsWith('REGION_SMC_RANGE:'))smc=JSON.parse(text.slice(17));
  if(text.startsWith('REGION_RESULT:'))report.results.push(JSON.parse(text.slice(14)));
  if(text.startsWith('REGION_INTERRUPTS:'))report.interrupts=JSON.parse(text.slice(18));
  const gate=text.match(/^REGION_GATE:(-?\d+)$/);
  if(gate){if(pending!==null)throw Error('Duplicate gate');pending=Number(gate[1]);match();}
  if(text.startsWith('REGION_PASS:')){report.validation=JSON.parse(text.slice(12));finish('pass');}
 };
 const args=['-nodefaults','-machine','pc,acpi=off','-cpu','max','-accel','tcg,tb-size=128','-smp','1','-m','512',
  '-display','none','-monitor','none','-qmp','stdio','-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1',
  '-serial','chardev:fixture-com1','-serial','file:/guest/console.log','-parallel','none','-no-reboot','-no-shutdown','-L','/rom',
  '-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on'];
 report.arguments=args;
 try{
  timer=setTimeout(()=>finish('Guest deadline exceeded'),timeoutMs);
  const {default:factory}=await import(runtimeUrl);
  factory({arguments:args,mainScriptUrlOrBlob:runtimeUrl,printErr:text=>report.stderr.push(String(text)),onAbort:e=>finish(String(e)),
   preRun:[m=>{
    mod=m;report.configuration=configureRegionFixture(m,enabled);
    m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',new Uint8Array(kernel));m.FS.writeFile('/guest/initramfs',new Uint8Array(initramfs));
    for(const [name,bytes] of Object.entries(roms))m.FS.writeFile('/rom/'+name,new Uint8Array(bytes));
    port=attachCom1(m,data=>{if(data.length!==1||data[0]!==71||signal){finish('Invalid COM1 gate');return;}signal=true;match();});
    m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops,decoder=new TextDecoder();
    node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});report.serial+=text;tail+=text;let end;
     while((end=tail.indexOf('\n'))>=0){const text=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);try{line(text);}catch(error){finish(String(error.stack||error));}}return count;}};
    m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
    m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(b.subarray(o,o+n));return n;}return original(s,b,o,n,p);};
   }]}).catch(error=>finish(String(error.stack||error)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  const outcome=await done;if(outcome!=='pass')throw Error(outcome);await chain;await qmp.send('stop');
  const finalStatus=await qmp.send('query-status');if(finalStatus.running||finalStatus.status!=='paused')throw Error('Final VM stop not confirmed');
  if(report.gates.length!==17||report.results.length!==7||report.validation.faults!==384||report.validation.stages!==8||report.interrupts.inLoop<3||report.injections.length!==(enabled?2:0))throw Error('Incomplete fixture evidence');
  report.finalCounters=readM3Region(mod);report.finalPool=validateFixturePool(mod.pcJitPool?.());
  if(report.finalCounters.saturated||report.finalCounters.counters.watchPcMismatches||
    (enabled?report.finalCounters.watches[3].selectedEntries===0:report.finalCounters.counters.selectedEntries!==0))throw Error('Missing final-call selected entry or invalid counters');
  report.suspensionScope='Final guest read call selected after a dedicated post-warmup watch reset; delayed host ACK and register/stack continuation checked. Does not identify the exact compiled function containing an Asyncify unwind or establish eviction while suspended.';
  report.layout=layout;report.smc=smc;report.status='passed';
 }catch(error){report.status='failed';report.failure=String(error.stack||error);}
 clearTimeout(timer);return report;
}
