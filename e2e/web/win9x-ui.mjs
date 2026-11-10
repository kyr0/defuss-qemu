import {installFullscreen} from '../../host/browser/fullscreen.mjs';
import {installAudioUI} from '../../host/browser/audio/host.mjs';
import {installDiskGrow} from '../../host/browser/grow-ui.mjs';
import {maxDiskMiB,blankIDEBlob} from '../../host/browser/fat16.mjs';
import {installRemovableUI} from '../../host/browser/removable-ui.mjs';
import {installStorageUI} from '../../host/browser/share/controls.mjs';
import {inputQueue} from '../../host/browser/input-queue.mjs';
import {installPointer} from '../../host/browser/pointer.mjs';
import {DisplayCadence} from '../../host/browser/display-cadence.mjs';
import {FrameScheduler} from '../../host/browser/frame-scheduler.mjs';
import {IoPacer} from '../../host/browser/storage.mjs';
import {Recorder} from '../../host/browser/trace.mjs';
import {resolveRuntimeSettings,runtimeSummary} from '../../host/browser/runtime-settings.mjs';
import {startPC,keyEvent,qcode} from '../../host/browser/win9x.mjs';
import {romNames} from '../../host/browser/machine.mjs';
const el=id=>document.getElementById(id),canvas=el('screen'),ctx=canvas.getContext('2d');
let pc,recorder,metadata,imageData,imagePixels,lastActivity=0,lastInput=-Infinity,ioBusy=false;
installFullscreen(canvas,el('screen-shell'),el('fullscreen'),el('fullscreen-status'));
const cadence=new DisplayCadence(),pacer=new IoPacer();const held=new Set();
const frameScheduler=new FrameScheduler(draw);
const report=e=>{el('error').textContent=String(e).slice(-1500);};
const enqueue=inputQueue(list=>pc.events(list),(kind,s)=>{
  if(!recorder?.running)return;
  if(kind==='arrival')recorder.inputArrival(s);
  else recorder.input(s.ackMs,s.queuedMs,s.ageMs);
},report);
const events=list=>{
  if(!pc||!list.length)return;
  lastInput=lastActivity=performance.now();
  if(!frameScheduler.drawing && !document.hidden && ['auto','responsive'].includes(el('display').value))schedule(0);
  enqueue(list);
};
async function file(id){
  const f=id==='disk'?resizer.source:el(id).files[0];if(!f)return null;
  const limit=id==='disk'?maxDiskMiB:1024;
  if(f.size>limit*1048576)throw Error('Maximum file size is '+limit+' MiB');
  // Chromium can reject a single ~2 GiB Blob read even when the final array fits.
  if(f.size<=32*1048576)return new Uint8Array(await f.arrayBuffer());
  const data=new Uint8Array(f.size);
  for(let at=0;at<f.size;at+=8*1048576){
    const part=await f.slice(at,at+8*1048576).arrayBuffer();
    data.set(new Uint8Array(part),at);
  }
  return data;
}
function schedule(ms){
  const mode=el('display').value;
  if(document.hidden||mode==='paused'){frameScheduler.cancel();return;}
  const hz=Number(el('display-hz').value);
  frameScheduler.schedule(ms,mode==='copy'?500:1000/([20,30,60].includes(hz)?hz:30));
}
async function draw(){
  if(!pc||frameScheduler.drawing||document.hidden)return;
  const mode=el('display').value;
  if(mode==='paused')return;
  if(!frameScheduler.begin())return;
  const start=performance.now();
  try{
    const f=await pc.frame({reuse:true});
    cadence.observe(f);if(f){
      const paintStart=performance.now();
      const resized=canvas.width!==f.w||canvas.height!==f.h;
      if(resized||imagePixels!==f.rgba){
        if(canvas.width!==f.w)canvas.width=f.w;
        if(canvas.height!==f.h)canvas.height=f.h;
        imagePixels=f.rgba;imageData=new ImageData(f.rgba,f.w,f.h);
        el('geometry').textContent=f.w+' × '+f.h+' guest pixels';
      }
      if(resized||f.dirtyH){
        ctx.putImageData(imageData,0,0,0,resized?0:f.dirtyY,f.w,resized?f.h:f.dirtyH);
        lastActivity=performance.now();
      }
      recorder?.frame(f,performance.now()-paintStart);
    }
  }catch(e){report(e);}
  finally{
    frameScheduler.end();
    if(!document.hidden && el('display').value!=='paused'){
      const now=performance.now();
      ioBusy=pacer.update(now,pc.ioOps());
      const display=el('display').value;
      const period=cadence.period(display,ioBusy,now-lastInput,now-lastActivity,Number(el('display-hz').value));
      schedule(Math.max(8,period-(performance.now()-start)));
    }
  }
}
el('display-hz').onchange=()=>schedule(0);
el('display').onchange=()=>{lastActivity=performance.now();schedule(0);};
document.addEventListener('visibilitychange',()=>{frameScheduler.cancel();if(!document.hidden)schedule(0);});

function traceContext(){
  return {frameTransport:pc?.frameTransportStats?.()??null,audio:audioHost.stats(),display:el('display').value,displayHz:Number(el('display-hz').value),ioBusy,hidden:document.hidden,width:canvas.width,height:canvas.height};
}
function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
const audioHost=installAudioUI(el,report);
const removable=installRemovableUI(el,report);
const resizer=installDiskGrow(el,download,()=>storage.refresh());
const storage=installStorageUI(el,report,download,()=>resizer.busy);
recorder=new Recorder(null,traceContext);
function bootSelection(){
  return Object.freeze({cpu:el('cpu').value,video:el('video').value,pointer:el('pointer').value,boot:el('boot').value,
    sound:el('sound-card').value,ramMiB:Number(el('ram').value),helperProfiling:el('helpers').checked,hotLimit:Number(el('hot-limit').value),
    compatibility:el('compat').value,cdChannel:el('cd-channel').value,tbMiB:Number(el('tb-cache').value),
    diskMiB:Number(el('size').value),audioTargetMs:Number(el('sound-target').value)});
}
function bootMetadata(selected=bootSelection(),runtimeSettings=resolveRuntimeSettings(selected)){
  return {...selected,runtimeSettings,requestedHotLimit:runtimeSettings.requestedHotLimit,
    effectiveHotLimit:runtimeSettings.effectiveHotLimit,hotLimit:runtimeSettings.effectiveHotLimit,
    pressureAdmission:runtimeSettings.pressureAdmission,repBatching:runtimeSettings.repBatching,
    crossOriginIsolated:globalThis.crossOriginIsolated,secureContext:globalThis.isSecureContext};
}
function settingsStatus(settings=resolveRuntimeSettings(bootSelection())){
  el('hot-limit').disabled=settings.compatibility==='conservative';
  el('runtime-settings').textContent=runtimeSummary(settings);
  el('runtime-diagnostic').hidden=settings.compatibility!=='conservative';
}
function helperStatus(enabled=el('helpers').checked){
  el('helper-status').textContent=enabled?
    'Named compiled-helper profiling is available with TCG sampling. Leave profiling off for speed comparisons.':
    (pc?'Helper profiling was off at boot; this run cannot attribute compiled-helper costs. Enable it before the next boot.':
    'Enable Helper profiler before boot for named compiled-helper timings. Leave profiling off for speed comparisons.');
}
metadata=bootMetadata();recorder.metadata=metadata;
el('compat').onchange=()=>settingsStatus();el('hot-limit').onchange=()=>settingsStatus();settingsStatus();
el('helpers').onchange=()=>{if(el('helpers').checked)el('deep').checked=true;helperStatus();};
el('sound-card').onchange=()=>{el('sound-hardware').textContent=el('sound-card').value==='off'?'No sound card selected':'Sound card selected · hardware checked after boot';};
el('record').onclick=async()=>{
  const btn=el('record');btn.disabled=true;
  try{
    if(recorder.running){
      el('trace-status').textContent='Finishing…';
      await recorder.stop();btn.textContent='Record trace';el('trace-status').textContent='Stopped';
    }
    else{
      recorder.start(pc?metadata:bootMetadata(),el('deep').checked);
      btn.textContent='Stop trace';el('trace-status').textContent=pc?'Recording':'Recording · waiting for PC';
    }
    btn.setAttribute('aria-pressed',String(recorder.running));
    el('deep').disabled=recorder.running;el('trace-download').disabled=false;
  }catch(e){report(e);}finally{btn.disabled=false;}
};
el('trace-download').onclick=()=>{
  const trace=recorder.export();
  download(new Blob([JSON.stringify(trace)],{type:'application/json'}),
    'qemu-win98-v0.6.8-trace-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
};
el('start').onclick=async()=>{
  if(resizer.busy)return;
  // Capture once before asynchronous media/audio setup. The machine and its
  // trace must describe the same configuration even if controls later change.
  const selected=bootSelection(),chosen=resizer.source,secondary=storage.selected;
  resizer.lock(true);
  el('media').disabled=true;
  el('start').disabled=true;el('error').textContent='';el('status').textContent='Starting PC…';
  storage.lock(true);removable.lock(true);recorder.updateMetadata(bootMetadata(selected));recorder.phaseChange('loading-media-and-runtime');
  try{const url=new URL('/host/browser/runtime/qemu-system-x86_64.js',location.href);
    const {sound,diskMiB:mib}=selected,audioBus=await audioHost.prepare(sound,selected.audioTargetMs);
    const paged=(chosen?.size??mib*1048576)>512*1048576;
    const useWorker=Boolean(secondary)||paged||Boolean(audioBus);
    const [roms,disk,floppy,cdrom,{default:factory}]=await Promise.all([
      Promise.all(romNames.map(async n=>{const r=await fetch('/firmware/'+n);if(!r.ok)throw Error(n);return [n,new Uint8Array(await r.arrayBuffer())];})).then(Object.fromEntries),
      paged?null:file('disk'),removable.initial('floppy'),removable.initial('cdrom'),useWorker?{}:import(url)]);
    recorder.phaseChange('starting-qemu');
    const options={...selected,roms,disk,audioBus,systemFile:paged?(chosen??blankIDEBlob(mib)):null,floppy,cdrom};
    const sizes={diskBytes:chosen?.size??mib*1048576,floppyBytes:floppy?.byteLength??0,cdBytes:cdrom?.byteLength??0};
    pc=useWorker?await storage.start(options,url.href):await startPC({...options,factory,mainScriptUrlOrBlob:url.href,onError:report});
    metadata={...bootMetadata(selected,pc.runtimeSettings),sound,audioRate:audioBus?.rate??0,audioTargetMs:audioBus?selected.audioTargetMs:0,primaryBackend:paged?'paged-file':'memfs',cdDevice:pc.model.some(v=>v.includes('id=ide0-cd1'))?'ide0-cd1':'ide1-cd0',secondary:secondary?{type:secondary.type,size:secondary.size,writable:secondary.writable}:null,cdBackend:pc.cdBackend,cpu:pc.model[pc.model.indexOf('-cpu')+1],requestedCpu:selected.cpu,vcpus:1,
      ...sizes,
      browser:navigator.userAgent.match(/(?:Chrome|Firefox|Version)\/[\d.]+/)?.[0]??'unknown',
      logicalCpus:navigator.hardwareConcurrency??null,platform:navigator.userAgentData?.platform??navigator.platform};
    recorder.attach(pc,metadata);window.probePC=pc;window.probeRecorder=recorder;removable.attach(pc);audioHost.running();
    settingsStatus(pc.runtimeSettings);helperStatus(selected.helperProfiling);
    try{const hardware=await pc.audioHardware();metadata.soundHardware=hardware;recorder.updateMetadata({soundHardware:hardware});el('sound-hardware').textContent=hardware.message;}catch{el('sound-hardware').textContent='Sound hardware inventory unavailable';}
    el('audio-panel').open=sound!=='off';
    if(recorder.running)el('trace-status').textContent='Recording';
    installPointer(canvas,pc,events,el('pointer-status'),selected.pointer==='auto');
    el('media').disabled=true;el('save').disabled=false;el('cad').disabled=false;el('status').textContent='Running';canvas.focus();schedule(0);
  }catch(e){
    await audioHost.close();
    const message=String(e);
    const category=[[/requires matching local media/,'boot-media'],[/crossOriginIsolated|SharedArrayBuffer/,'isolation'],
      [/allocat|out of memory/i,'memory'],[/fetch|network/i,'load'],[/timeout|greeting/i,'qmp-timeout'],
      [/disk|qcow|sector-aligned/i,'disk-format']].find(([pattern])=>pattern.test(message))?.[1]??'unspecified';
    recorder.phaseChange('failed-'+recorder.phase,category);report(e);resizer.lock(false);storage.lock(false);removable.lock(false);el('media').disabled=false;settingsStatus();el('status').textContent='Start failed';el('start').disabled=false;}
};
el('save').onclick=async()=>{el('save').disabled=true;try{
  const blob=await pc.diskImage({blob:true});
  download(blob,'win9x-'+Date.now()+'.img');
} catch(e){report(e);}finally{el('save').disabled=false;}};
for(const type of ['keydown','keyup'])canvas.addEventListener(type,e=>{
  const key=qcode(e.code);if(!key||!pc)return;e.preventDefault();const down=type==='keydown';
  if(down&&held.has(key))return;if(down)held.add(key);else held.delete(key);events([keyEvent(key,down)]);
});
function releaseKeys(){
  const up=[...held].map(k=>keyEvent(k,false));held.clear();if(up.length)events(up);
}
canvas.addEventListener('blur',releaseKeys);
window.addEventListener('blur',releaseKeys);
el('cad').onclick=()=>events(['ctrl','alt','delete'].map(k=>keyEvent(k,true)).concat(['delete','alt','ctrl'].map(k=>keyEvent(k,false))));
