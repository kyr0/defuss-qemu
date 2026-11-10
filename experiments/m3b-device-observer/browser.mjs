import {Qmp} from '../../host/browser/qmp.mjs';
import {configureM3Region,readM3Region} from '../m3a-region/reader.mjs';
import {observeGraph,validateCommand,limits,prelaunch} from './graph.mjs';
export const argumentsOff=Object.freeze(['-nodefaults','-machine','pc,acpi=off,hpet=off,usb=off','-cpu','max',
 '-accel','tcg,tb-size=128','-smp','cpus=1,maxcpus=1','-m','512','-S','-display','none','-monitor','none','-qmp','stdio',
 '-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1',
 '-serial','file:/guest/console.log','-parallel','none','-no-reboot','-no-shutdown','-L','/rom',
 '-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on']);
export async function observeMachine({runtimeUrl,kernel,initramfs,roms,mode,timeoutMs}){
 if(mode!=='off'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw Error('Explicit bounded OFF-only observation required');
 const report={schema:1,protocol:'defuss-m3b-device-observation-v1',status:'failed',mode:'off',fusionEnabled:false,
  timingEligible:false,eligibilityEstablished:false,arguments:[...argumentsOff],commands:[],stderr:[],rawQmp:''};
 const qmp=new Qmp(),rawDecoder=new TextDecoder();let mod,timer,fail,commandCount=0,responseBytes=0,rawBytes=0;
 const fatal=new Promise((_,reject)=>fail=reject);fatal.catch(()=>{});
 const record=value=>globalThis.__recordM3bDevice(value);
 const send=async(command,args)=>{
  validateCommand(command,args);if(++commandCount>limits.commands)throw Error('QMP command bound');
  const row={sequence:commandCount,command,arguments:args??{}};report.commands.push(row);
  await record({event:'qmp-request',...row});
  try{row.return=await Promise.race([qmp.send(command,args),fatal]);
   const bytes=new TextEncoder().encode(JSON.stringify(row)).length;
   if(bytes>limits.responseBytes||responseBytes+bytes>limits.transcriptBytes)throw Error('QMP response bound');responseBytes+=bytes;
   await record({event:'qmp-response',...row});return row.return;
  }catch(e){row.error=String(e);await record({event:'qmp-failure',...row});throw e;}
 };
 try{
  timer=setTimeout(()=>fail(Error('OFF observer deadline exceeded')),timeoutMs);
  const {default:factory}=await import(runtimeUrl);
  factory({arguments:[...argumentsOff],mainScriptUrlOrBlob:runtimeUrl,
   printErr:text=>{const t=String(text);if(report.stderr.length>=1024||t.length>65536){fail(Error('stderr bound'));return;}
    report.stderr.push(t);void record({event:'runtime-stderr',text:t}).catch(fail);},
   onAbort:e=>{void record({event:'runtime-abort',text:String(e).slice(0,65536)}).catch(()=>{});fail(Error('Runtime abort: '+String(e)));},preRun:[m=>{
    mod=m;configureM3Region(m,false);m._defuss_set_hot_limit(1500);m._defuss46_settings(2);
    report.configuration={phase:'preRun-before-vCPU',m3Enabled:false,hotLimit:1500,flags:2,
     m3bImplementationPresent:false,evidence:'Exact frozen M3a build; no M3b implementation. Native M3 OFF readback follows at prelaunch.'};
    m.FS.mkdir('/guest');m.FS.mkdir('/rom');
    // A regular file is sufficient: -S prevents guest serial activity.
    m.FS.writeFile('/dev/app-com1',new Uint8Array());
    m.FS.writeFile('/guest/kernel',new Uint8Array(kernel));m.FS.writeFile('/guest/initramfs',new Uint8Array(initramfs));
    m.FS.writeFile('/guest/console.log',new Uint8Array());
    for(const [name,data] of Object.entries(roms))m.FS.writeFile('/rom/'+name,new Uint8Array(data));
    m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;const original=m.TTY.stream_ops.write;
    m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops!==m.TTY.default_tty_ops)return original(s,b,o,n,p);
     try{rawBytes+=n;if(rawBytes>limits.transcriptBytes)throw Error('Raw QMP byte bound');
      report.rawQmp+=rawDecoder.decode(b.subarray(o,o+n),{stream:true});qmp.accept(b.subarray(o,o+n));
      if(qmp.tail.length>limits.responseBytes)throw Error('Incomplete QMP line bound');
     }catch(e){fail(e);}return n;};
   }]}).catch(fail);
  report.greeting=await Promise.race([qmp.greeting,fatal]);await record({event:'qmp-greeting',value:report.greeting});
  await send('qmp_capabilities');report.graph=await Promise.race([observeGraph(send),fatal]);
  prelaunch(report.graph.after);report.nativeM3=readM3Region(mod);
  if(report.nativeM3.enabled||report.nativeM3.saturated||Object.values(report.nativeM3.counters).some(n=>n!==0))throw Error('Expected disabled M3 and zero translated/executed TB counters');
  report.serial=mod.FS.readFile('/guest/console.log',{encoding:'utf8'});if(report.serial!=='')throw Error('Unexpected guest serial output under -S');
  report.status='observed';await record({event:'observation-complete',devices:report.graph.devices.length,objects:report.graph.nodes.length});
 }catch(e){report.failure=String(e.stack??e);}
 clearTimeout(timer);report.commandCount=commandCount;report.rawQmpBytes=rawBytes;return report;
}
