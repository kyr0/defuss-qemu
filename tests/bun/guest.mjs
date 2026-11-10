import {fixtureDefinitions,counterDefinitions,checkFixtureCounters} from './fixture-config.mjs';
import {Qmp} from '../../host/browser/qmp.mjs';
import {attachCom1} from '../../packaging/bun-app/serial.mjs';

export async function runGuest({runtimeUrl,kernel,initramfs,roms,fixture=null,fixtureKind=null,cold=false,hotLimit=1500,counterKind=null,timeoutMs=240000}){
 const started=performance.now(),qmp=new Qmp(),decoder=new TextDecoder();
 const report={status:'running',arch:'amd64',events:[],gates:[],stderr:[],serial:'',fixture,fixtureKind,cold,counterKind,
  settings:{ramMiB:512,tbMiB:128,hotLimit,cpu:'max',smp:1,profile:false,admission:!fixture}};
 let mod,port,finish,timer,tail='',pendingGate=null,gateRequest=false,lastCounters=null,gateChain=Promise.resolve();
 const done=new Promise(resolve=>finish=resolve);
 const counterAPI=counterDefinitions[counterKind]??null;
 const readCounters=()=>{
  const pointer=Number(mod[counterAPI[0]](0)),words=new BigUint64Array(mod.pcProfileWords().buffer,pointer,counterAPI[1]);
  return Array.from({length:counterAPI[1]},(_,i)=>Number(Atomics.load(words,i)));
 };
 const args=['-nodefaults','-machine','pc,acpi=off','-cpu','max','-accel','tcg,tb-size=128','-smp','1','-m','512','-display','none','-monitor','none','-qmp','stdio',
  ...(fixture?['-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1','-serial','file:/guest/console.log','-parallel','none']:['-serial','file:/guest/console.log']),
  '-no-reboot','-L','/rom','-kernel','/guest/kernel','-initrd','/guest/initramfs','-append',
  `console=${fixture?'ttyS1':'ttyS0'} rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on`+
  (fixture?' replay_gate=1':'')+(fixtureKind===null?'':` ${fixture}_kind=${fixtureKind}`)+(cold?' replay_cold=1':'')];
 report.arguments=args;
 const checkGate=(kind,delta)=>{if(counterAPI)checkFixtureCounters(fixture,counterKind,kind,delta,cold);};
 const matchGate=()=>{
  // COM1 and COM2 are independent UARTs: either the token or marker may arrive first.
  if(!gateRequest||pendingGate===null)return;
  const kind=pendingGate;pendingGate=null;gateRequest=false;
  gateChain=gateChain.then(async()=>{
   await qmp.send('stop');
   const expected=report.gates.length===0?-1:(fixtureKind??report.gates.length-1);
   if(kind!==expected)throw Error('Unexpected gate sequence: '+kind+' expected '+expected);
   const counters=counterAPI?readCounters():null;
   const gate={kind,pool:mod.pcJitPool?.(),counters};report.gates.push(gate);
   if(kind>=0&&counterAPI){if(!lastCounters)throw Error('Missing initial counter gate');gate.delta=counters.map((n,i)=>n-lastCounters[i]);checkGate(kind,gate.delta);}
   lastCounters=counters;
   port.write('K');await qmp.send('cont');gate.passed=true;
  }).catch(error=>finish(String(error.stack||error)));
 };
 const onGate=data=>{
  if(data.length!==1||data[0]!==71||gateRequest){finish('Invalid COM1 gate');return;}
  gateRequest=true;matchGate();
 };
 const onLine=line=>{
  const gate=line.match(/^(RNDS2|PMAXUB|SETUP|PSHUFB)_GATE:(-?\d+)$/);
  if(gate){if(pendingGate!==null||gate[1].toLowerCase()!==fixture){finish('Invalid gate marker');return;}pendingGate=Number(gate[2]);matchGate();}
  if(line.includes('FIXTURE_FAIL')||line.includes('Kernel panic')||line.startsWith('BUN_BENCH_FAIL:'))finish(line);
  if(/^(RNDS2|PMAXUB|SETUP|PSHUFB)_FIXTURE_PASS/.test(line))report.fixturePass=line;
  if(line==='FIXTURE_PASS')finish('pass');
  if(line.startsWith('BUN_PROCESS_START'))report.processStartMs=performance.now()-started;
  if(line.startsWith('BUN_BENCH ')){
   try{const event=JSON.parse(line.slice(10));event.hostMs=performance.now()-started;
    if(counterAPI&&['ready','warmup-complete','start','result','complete'].includes(event.event))event.counters=readCounters();
    event.pool=mod.pcJitPool?.();report.events.push(event);
    if(event.event==='failure')finish('Bun failure');
    if(event.event==='ready')report.bunStartupMs=event.hostMs-report.processStartMs;
   }catch(error){finish(String(error));}
  }
  if(line==='BUN_GUEST_DONE')finish('pass');
 };
 const execute=async()=>{
  const {default:factory}=await import(runtimeUrl);
  factory({arguments:args,mainScriptUrlOrBlob:runtimeUrl,printErr:s=>{report.stderr.push(String(s));if(String(s).includes('worker sent an error'))finish(String(s));},onAbort:e=>finish('Abort: '+e),
   onRuntimeInitialized:()=>{if(counterAPI)mod[counterAPI[0]](1);},
   preRun:[m=>{
    mod=m;m._defuss_set_hot_limit(hotLimit);m._defuss46_settings(fixture?2:3);
    m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',new Uint8Array(kernel));m.FS.writeFile('/guest/initramfs',new Uint8Array(initramfs));
    for(const [name,data] of Object.entries(roms))m.FS.writeFile('/rom/'+name,new Uint8Array(data));
    if(fixture)port=attachCom1(m,onGate);
    m.FS.writeFile('/guest/console.log',new Uint8Array());const node=m.FS.lookupPath('/guest/console.log').node,ops=node.stream_ops;
    node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p),text=decoder.decode(new Uint8Array(b.subarray(o,o+count)),{stream:true});report.serial+=text;tail+=text;let end;while((end=tail.indexOf('\n'))>=0){const line=tail.slice(0,end).replace(/\r/g,'');tail=tail.slice(end+1);onLine(line);}return count;}};
    m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
    m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(b.subarray(o,o+n));return n;}return original(s,b,o,n,p);};
   }]}).catch(error=>finish(String(error.stack||error)));
  await Promise.race([qmp.greeting,done.then(reason=>{throw Error(reason);})]);await qmp.send('qmp_capabilities');
  report.cpus=await qmp.send('query-cpus-fast');if(report.cpus[0].target!=='x86_64')throw Error('Wrong guest CPU');
  const outcome=await done;if(outcome!=='pass')throw Error(outcome);
  await gateChain;await qmp.send('stop');
  if(fixture){
   if(!report.fixturePass)throw Error('Missing fixture pass');
   const expected=fixtureKind===null?fixtureDefinitions[fixture].modes:1;
   if(report.gates.length!==expected+1||report.gates[0].kind!==-1||report.gates.some(g=>!g.passed))throw Error('Incomplete gated coverage');
   const checks=Number(report.fixturePass.match(/checks=(\d+)/)?.[1]);
   if(checks!==expected*fixtureDefinitions[fixture].checksPerMode)throw Error('Wrong fixture check count');
  }else{
   const ready=report.events.find(e=>e.event==='ready');if(ready?.bun!=='1.4.4'||ready.arch!=='x64')throw Error('Wrong Bun guest');
   if(!report.events.some(e=>e.event==='complete'))throw Error('Missing completion');
   const results=report.events.filter(e=>e.event==='result');if(results.length!==12)throw Error('Missing workload results');
   const identities=new Set(results.map(e=>e.name+':'+e.sample));
   if(identities.size!==12||['integer','json','sha256','http'].some(name=>[0,1,2].some(sample=>!identities.has(name+':'+sample))))throw Error('Wrong or duplicate workload samples');
   for(const e of results){const starts=report.events.filter(s=>s.event==='start'&&s.name===e.name&&s.sample===e.sample);if(starts.length!==1)throw Error('Missing/duplicate start');e.hostDurationMs=e.hostMs-starts[0].hostMs;}
  }
  report.status='passed';
 };
 try{await Promise.race([execute(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Guest deadline exceeded')),timeoutMs))]);}
 catch(error){report.status='failed';report.failure=String(error.stack||error);}
 clearTimeout(timer);report.seconds=(performance.now()-started)/1000;report.jitPool=mod?.pcJitPool?.();return report;
}
