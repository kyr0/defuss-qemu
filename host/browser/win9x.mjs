import {createHelperProfile,discoverHelperNames} from './hotspots.mjs';
import {configureCandidate} from './candidate.mjs';
import {resolveRuntimeSettings,runtimeFlags} from './runtime-settings.mjs';
import {connectGuestPCM} from './audio/backend.mjs';
import {createGraphicsBus,connectGraphicsCounters} from './graphics.mjs';
import {attachBlockFile} from './share/block-file.mjs';
// Local removable media and a writable IDE disk. QMP stdio is dedicated to
// this machine; no guest serial or monitor traffic crosses the HTML console.
import {countFileIo,stageCD} from './storage.mjs';
import {FrameDecoder,frameFile} from './display.mjs';
import {blockCounters,tcgMonitor} from './trace.mjs';
import {blankIDE,maxDiskMiB} from './fat16.mjs';
import {romNames,serialInput} from './machine.mjs';
const utf8=new TextEncoder();
const MiB=1048576;
export class Qmp {
  constructor(){this.input=serialInput();this.inflight=new Map();this.next=0;this.tail='';this.decoder=new TextDecoder();
    this.greeting=new Promise(resolve=>{this.greet=resolve;});}
  accept(bytes){
    this.tail+=this.decoder.decode(new Uint8Array(bytes),{stream:true});let pos;
    while((pos=this.tail.indexOf('\n'))>=0){
      const line=this.tail.slice(0,pos).trim();this.tail=this.tail.slice(pos+1);
      if(!line||!line.startsWith('{'))continue;
      const msg=JSON.parse(line);
      if(msg.QMP)this.greet(msg);
      const req=this.inflight.get(msg.id);
      if(req){clearTimeout(req.timeout);this.inflight.delete(msg.id);
        if(msg.error)req.reject(Error(msg.error.class+': '+msg.error.desc));else req.resolve(msg.return);}
    }
  }
  send(execute,args){
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.inflight.delete(id);reject(Error('QMP timeout: '+execute));},30000);
      this.inflight.set(id,{resolve,reject,timeout});
      this.input.push(utf8.encode(JSON.stringify({execute,arguments:args,id})+'\n'));
    });
  }
}
// Haswell without TSX, with the three additional features unavailable in
// this TCG build explicitly masked. 'enforce' catches unexpected downgrades.
const haswell='Haswell-noTSX,pcid=off,tsc-deadline=off,invpcid=off,enforce=on';
const profiles=new Map([['auto',haswell],['haswell',haswell],['max','max'],
  ...['core2duo','pentium3','pentium2','pentium'].map(cpu=>[cpu,cpu])]);
function cdSlot(channel,secondary){
  if(!['auto','primary','secondary'].includes(channel))throw Error('Unknown CD channel');
  if(channel==='primary' && secondary)throw Error('Primary IDE slave is occupied by secondary storage. Select Auto or secondary master.');
  return channel==='secondary' || secondary?2:1;
}
export function pcArgs({boot='c',floppy,cdrom,cpu='max',video='cirrus',pointer='auto',secondary=null,cdChannel='auto',tbMiB=512,ramMiB=512,sound='off',audioBus=null}){
  const slot=cdSlot(cdChannel,secondary);
  if(!['off','sb16','ac97','dual'].includes(sound))throw Error('Unknown sound card');
  let audioArgs=[];
  if(sound!=='off'){
    if(!audioBus||!Number.isInteger(audioBus.rate)||audioBus.rate<8000||audioBus.rate>192000)throw Error('Audio bridge missing or invalid');
    const fmt='frequency='+audioBus.rate;
    audioArgs=['-audiodev','none,id=web,timer-period=5000,out.'+fmt+',out.channels=2,out.format=s16,in.'+fmt+',in.channels=2,in.format=s16',
      ...(sound!=='ac97'?['-device','sb16,audiodev=web']:[]),
      ...(sound!=='sb16'?['-device','AC97,audiodev=web']:[])];
  }
  if(![64,128,256,384,512].includes(ramMiB))throw Error('Unsupported RAM size');
  if(![32,64,128,256,384,512].includes(tbMiB))throw Error('Unsupported TCG cache size');
  const profile=profiles.get(cpu);
  if(!profile)throw Error('Unsupported CPU profile');
  if(!['cirrus','std'].includes(video))throw Error('Unsupported video adapter');
  if(!['auto','ps2'].includes(pointer))throw Error('Unsupported pointer interface');
  if(!['a','c','d'].includes(boot)||boot==='a'&&!floppy||boot==='d'&&!cdrom)throw Error('Boot device requires matching local media');
  return ['-nodefaults','-machine','pc,acpi=off','-cpu',profile,'-smp','1','-m',String(ramMiB),'-accel','tcg,tb-size='+tbMiB,
    '-L','/rom','-display','none','-vga',video,'-monitor','none','-serial','none','-parallel','none','-qmp','stdio','-no-shutdown',
    ...audioArgs,
    ...(pointer==='auto'?['-device','piix3-usb-uhci,id=usb','-device','usb-tablet,bus=usb.0,usb_version=1']:[]),
    '-drive','if=ide,index=0,format=raw,file=/guest/disk.raw',
    ...(secondary?['-drive','if=ide,index=1,format=raw,file=/guest/secondary.raw,rerror=report,werror=report']:[]),
    '-drive','if=floppy,index=0,id=floppy0,readonly=on'+(floppy?',format=raw,file=/guest/start.img':''),
    '-drive','if=ide,index='+slot+',id='+(slot===1?'ide0-cd1':'ide1-cd0')+',media=cdrom,readonly=on'+(cdrom?',format=raw,file=/guest/install.iso':''),
    '-boot',boot==='c'?'order=c':'order=c,once='+boot];
}
export function decodePpm(bytes){
  return new FrameDecoder().decode(bytes);
}
export async function startPC({factory,roms,disk,primary=null,diskMiB=512,floppy,cdrom,boot,mainScriptUrlOrBlob,onError,compatibility='default',cpu='max',video='cirrus',pointer='auto',secondary=null,cdChannel='auto',tbMiB=512,ramMiB=512,hotLimit=1500,helperProfiling=false,sound='off',audioBus=null}){
  const runtimeSettings=resolveRuntimeSettings({compatibility,hotLimit});
  const helperBus=helperProfiling?createHelperProfile():null;
  const graphicsBus=video==='cirrus'?createGraphicsBus():null;
  const args=pcArgs({boot,floppy,cdrom,cpu,video,pointer,secondary,cdChannel,tbMiB,ramMiB,sound,audioBus});
  const cdDevice=cdSlot(cdChannel,secondary)===1?'ide0-cd1':'ide1-cd0';
  const io={readOps:0,writeOps:0,readBytes:0,writeBytes:0};
  let cdBackend=cdrom?'memfs':'none';
  if(!primary&&!disk&&(!Number.isInteger(diskMiB)||diskMiB<8||diskMiB>maxDiskMiB))throw Error('Blank IDE disk must be 8–2047 MiB');
  if(disk&&(disk.length<512||disk.length%512||disk.length>maxDiskMiB*MiB))throw Error('Use a sector-aligned raw IDE disk up to 2047 MiB');
  if(disk&&disk[0]===0x51&&disk[1]===0x46&&disk[2]===0x49&&disk[3]===0xfb)throw Error('Convert qcow2 to raw first');
  const qmp=new Qmp();let mod;
  let readFrame;
  let startupError;
  const failed=new Promise((_resolve,reject)=>{startupError=reject;});
  const cfg={pcHelperBus:helperBus,pcAudioBus:audioBus,pcGraphicsBus:graphicsBus,arguments:args,mainScriptUrlOrBlob,onRuntimeInitialized(){
    const m=this;
    mod=m;configureCandidate(m);if(helperBus)helperBus.names=discoverHelperNames(m.pcProfileWords());
    m._defuss_set_hot_limit(runtimeSettings.effectiveHotLimit);
    m._defuss46_settings(runtimeFlags(runtimeSettings));
    if(sound!=='off')connectGuestPCM(m,audioBus);
    if(graphicsBus)connectGraphicsCounters(m,graphicsBus);
    const fs=m.FS;fs.mkdir('/rom');fs.mkdir('/guest');
    readFrame=frameFile(fs,'/guest/frame.ppm');
    for(const n of romNames)fs.writeFile('/rom/'+n,roms[n]);
    if(primary)attachBlockFile(fs,'/guest/disk.raw',primary);
    else fs.writeFile('/guest/disk.raw',disk||blankIDE(diskMiB),{canOwn:true});
    countFileIo(fs,'/guest/disk.raw',io);
    if(secondary){attachBlockFile(fs,'/guest/secondary.raw',secondary);countFileIo(fs,'/guest/secondary.raw',io);}
    if(floppy)fs.writeFile('/guest/start.img',floppy,{canOwn:true});
    if(cdrom){
      if(stageCD(m,cdrom)){
        const i=args.findIndex(s=>s.includes('file=/guest/install.iso'));
        args[i]=args[i].replace('/guest/install.iso','wasmrom:bun');
        cdBackend='wasmrom';
      }else{
        fs.writeFile('/guest/install.iso',cdrom,{canOwn:true});
        countFileIo(fs,'/guest/install.iso',io);
      }
    }
    m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;
    const old=m.TTY.stream_ops.write;
    m.TTY.stream_ops.write=(s,b,o,n,p)=>{
      if(s.tty?.ops===m.TTY.default_tty_ops){
        qmp.accept(new Uint8Array(b.buffer,b.byteOffset+o,n));return n;
      }
      return old(s,b,o,n,p);
    };
  },printErr:s=>onError?.(String(s)),onAbort:e=>startupError(Error(String(e)))};
  Promise.resolve(factory(cfg)).catch(e=>{onError?.(String(e));startupError(e);});
  let timeout;
  try{await Promise.race([qmp.greeting,failed,new Promise((_,rej)=>{timeout=setTimeout(()=>rej(Error('No QMP greeting')),45000);})]);}
  finally{clearTimeout(timeout);}
  await qmp.send('qmp_capabilities');
  let dumping=false, saving=false;
  const display = new FrameDecoder();
  const tcg = tcgMonitor(mod,{helperBus,runtimeSettings});
  const staged=cdBackend==='wasmrom';
  const files={floppy:new Set(floppy?['/guest/start.img']:[]),
    cdrom:new Set(cdBackend==='memfs'?['/guest/install.iso']:[])};
  const changing=new Set();
  let serial=0;
  async function changeMedium(kind,bytes){
    if(kind!=='floppy' && kind!=='cdrom')throw Error('Unknown removable drive');
    if(changing.has(kind))throw Error('A media change is already in progress');
    changing.add(kind);
    try{
      const device=kind==='floppy'?'floppy0':cdDevice;
      const path=bytes?'/guest/'+kind+'-'+(++serial)+(kind==='floppy'?'.img':'.iso'):null;
      let error;
      try{
        if(path){
          files[kind].add(path);mod.FS.writeFile(path,bytes,{canOwn:true});
          countFileIo(mod.FS,path,io);
          await qmp.send('blockdev-change-medium',{device,filename:path,format:'raw','read-only-mode':'read-only'});
        }else await qmp.send('eject',{device});
      }catch(e){error=e.message;}
      // The guest can lock its tray. A failed change may also leave it empty.
      // Only unlink paths after QEMU confirms which backing is still attached.
      const blocks=await qmp.send('query-block'),slot=blocks.find(b=>b.device===device);
      if(!slot)throw Error('Removable drive is missing: '+device);
      const active=slot.inserted?.file??null;
      if(slot.inserted && !active)throw Error('Cannot verify the active media backing');
      for(const f of files[kind])if(f!==active){
        if(mod.FS.analyzePath(f).exists)mod.FS.unlink(f);
        files[kind].delete(f);
      }
      if(kind==='cdrom')cdBackend=active==='wasmrom:bun'?'wasmrom':active?'memfs':'none';
      const changed=active===path;
      return {inserted:Boolean(active),changed,error:error??(changed?null:'Media change was not confirmed')};
    }finally{changing.delete(kind);}
  }
  async function opticalStatus(){
    const [blocks,stats]=await Promise.all([qmp.send('query-block'),qmp.send('query-blockstats')]);
    const slot=blocks.find(b=>b.device===cdDevice);
    const reads=stats.find(b=>b.device===cdDevice)?.stats;
    if(!slot)throw Error('CD-ROM is missing from QEMU hardware inventory');
    return {device:cdDevice,inserted:Boolean(slot.inserted),bytes:slot.inserted?.image?.['virtual-size']??0,
      readBytes:reads?.rd_bytes??null,locked:slot.locked,open:slot.tray_open};
  }
  async function audioHardware(){
    if(sound==='off')return {sb16:false,ac97:false,message:'No sound card attached. Select SB16 before boot.'};
    const tree=await qmp.send('human-monitor-command',{'command-line':'info qtree'});
    const sb16=/dev: sb16,/.test(tree),ac97=/dev: AC97,/.test(tree);
    return {sb16,ac97,message:(sb16?'SB16 attached · A220 IRQ5 DMA1/5':'')+(sb16&&ac97?' · ':'')+
      (ac97?'Intel 82801AA AC’97 attached · PCI 8086:2415':'')+
      (!sb16&&!ac97?'Selected sound card missing from QEMU inventory':' · guest driver detection is separate')};
  }
  return {qmp,model:[...args],runtimeSettings:{...runtimeSettings,msg1Status:mod._defuss_m2_msg1_status?.()??null},tcg,opticalStatus,audioHardware,get cdBackend(){return cdBackend;},changeMedium,
    storageStats(){return {primary:primary?.stats?.()??null,secondary:secondary?.stats?.()??null,fileOperations:{...io}};},
    ioOps(){return io.readOps+io.writeOps+(staged?mod._defuss_rom_counter(0)>>>0:0);},
    async blockStats(){return blockCounters(await qmp.send('query-blockstats'));},
    async frame({reuse=false}={}){
      if(dumping||saving)return null;
      dumping=true;
      try{
        const start=performance.now();
        await qmp.send('screendump',{filename:'/guest/frame.ppm'});
        const captured=performance.now();
        const frame=(reuse ? display : new FrameDecoder()).decode(readFrame());
        frame.captureMs=captured-start;
        frame.decodeMs=performance.now()-captured;
        return frame;
      }finally{dumping=false;}
    },
    async textScreen(){
      const cmd='pmemsave 0xb8000 4000 "/guest/text.bin"';
      const reply=await qmp.send('human-monitor-command',{'command-line':cmd});
      if(reply.trim())throw Error(reply);
      const bytes=mod.FS.readFile('/guest/text.bin'),lines=[];
      for(let row=0;row<25;row++){let text='';for(let x=0;x<80;x++){const c=bytes[2*(row*80+x)];text+=c>=32&&c<127?String.fromCharCode(c):' ';}lines.push(text.trimEnd());}
      return lines.join('\n').trim();
    },
    async events(events){if(events.length)await qmp.send('input-send-event',{events});},
    async diskImage({blob=false}={}){
      if(saving)throw Error('Disk export in progress');saving=true;
      try{const wasRunning=(await qmp.send('query-status')).running;
        if(wasRunning)await qmp.send('stop');
        try{
          const fs=mod.FS,path='/guest/disk.raw';
          if(primary && blob)return primary.snapshot();
          if(!blob)return fs.readFile(path);
          const size=fs.stat(path).size,chunk=new Uint8Array(Math.min(size,8*MiB)),pieces=[];
          const stream=fs.open(path,'r');
          try{
            for(let at=0;at<size;at+=chunk.length){
              const n=Math.min(size-at,chunk.length);
              if(fs.read(stream,chunk,0,n,at)!==n)throw Error('Short read while exporting the system disk');
              pieces.push(new Blob([chunk.subarray(0,n)]));
              if(pieces.length%4===0)await new Promise(resolve=>setTimeout(resolve,0));
            }
          }finally{fs.close(stream);}
          return new Blob(pieces,{type:'application/octet-stream'});
        }finally{if(wasRunning)await qmp.send('cont');}
      }finally{saving=false;}
    }};
}
export const keyEvent=(code,down)=>({type:'key',data:{down,key:{type:'qcode',data:code}}});
const special={Enter:'ret',NumpadEnter:'kp_enter',Escape:'esc',Backspace:'backspace',Space:'spc',Tab:'tab',ShiftLeft:'shift',ShiftRight:'shift_r',ControlLeft:'ctrl',ControlRight:'ctrl_r',AltLeft:'alt',AltRight:'alt_r',ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Home:'home',End:'end',Delete:'delete',Insert:'insert',PageUp:'pgup',PageDown:'pgdn',CapsLock:'caps_lock',NumLock:'num_lock',ScrollLock:'scroll_lock',Minus:'minus',Equal:'equal',BracketLeft:'bracket_left',BracketRight:'bracket_right',Semicolon:'semicolon',Quote:'apostrophe',Backquote:'grave_accent',Backslash:'backslash',IntlBackslash:'less',Comma:'comma',Period:'dot',Slash:'slash',MetaLeft:'meta_l',MetaRight:'meta_r',NumpadSubtract:'kp_subtract',NumpadAdd:'kp_add',NumpadDivide:'kp_divide',NumpadMultiply:'kp_multiply',NumpadDecimal:'kp_decimal'};
export function qcode(code){return special[code]||(/^Key[A-Z]$/.test(code)?code.slice(3).toLowerCase():/^Digit[0-9]$/.test(code)?code.slice(5):/^F(?:[1-9]|1[0-2])$/.test(code)?code.toLowerCase():/^Numpad[0-9]$/.test(code)?'kp_'+code.slice(-1):null);}
