import {FrameBuffers} from './frame-buffers.mjs';
const frameBuffers=new FrameBuffers();
import {PagedDisk} from '../paged-disk.mjs';
import {startPC} from '../win9x.mjs';
import {openSnapshot,createSnapshot,forgetSnapshot,listSnapshots} from './cache.mjs';
import {openBridge} from './native.mjs';

let disk,pc,review,resume=false,started=false,management=Promise.resolve();
const summary=()=>({type:disk.type,id:disk.id??null,label:disk.label??'Native device',size:disk.size,writable:disk.writable});
const notify=message=>postMessage({status:message});
function release(){if(pc||started||review)throw Error('Close the preview or end the current storage session first');disk?.close();disk=null;}
async function resumeAfterReview(){
  review=null;if(resume){await pc.qmp.send('cont');resume=false;}
}
async function manage(cmd,a){
  switch(cmd){
    case 'list':return listSnapshots();
    case 'folder':release();disk=await createSnapshot(a.host,a.write);return summary();
    case 'restore':release();disk=await openSnapshot(a.id,a.write);return summary();
    case 'forget':
      if(disk?.id===a.id)release();
      await forgetSnapshot(a.id);return;
    case 'native':release();disk=await openBridge(a.endpoint,a.write);return summary();
    case 'detach':release();return;
    case 'start':{
      if(started||review||(!disk&&!a.options.systemFile&&!a.options.audioBus))throw Error('Close the preview or end the current storage session before boot');
      started=true;let invoked=false;
      try{
        const {default:factory}=await import(a.url);
        const primary=a.options.systemFile?new PagedDisk(a.options.systemFile):null;
        pc=await startPC({...a.options,primary,factory:cfg=>{invoked=true;return factory(cfg);},secondary:disk,mainScriptUrlOrBlob:a.url,onError:notify});
        return {model:pc.model,cdBackend:pc.cdBackend,runtimeSettings:pc.runtimeSettings};
      }catch(e){started=invoked;if(invoked && disk)throw Error('VM initialization failed. End the storage session before retrying. '+e.message);throw e;}
    }
    case 'preview':
      if(!disk?.preview||review)throw Error('No writable folder available for preview');
      if(pc&&(await pc.qmp.send('query-status')).running){await pc.qmp.send('stop');resume=true;}
      try{review=await disk.preview(a.host);return review.plan;}
      catch(e){await resumeAfterReview();throw e;}
    case 'apply':{
      if(!review)throw Error('Preview required');
      const count=await disk.apply(review);await resumeAfterReview();return count;
    }
    case 'cancel':await resumeAfterReview();return;
    case 'flush':disk?.flush();return;
    case 'end':
      if(pc&&(await pc.qmp.send('query-status')).running)await pc.qmp.send('stop');
      review=null;resume=false;
      disk?.flush();disk?.close();disk=null;return;
    case 'changeMedium':return pc.changeMedium(a.kind,a.bytes);
    case 'diskImage':
      if(review)throw Error('Finish the write-back preview first');
      return pc.diskImage({blob:a.blob});
    case 'exportShare':{
      if(disk?.type!=='folder')throw Error('No folder snapshot');
      const running=pc&&!review&&(await pc.qmp.send('query-status')).running;
      if(running)await pc.qmp.send('stop');
      try{disk.flush();return disk.view().subarray(0,disk.size);}
      finally{if(running)await pc.qmp.send('cont');}
    }
  }
  throw Error('Unknown management request');
}
async function query(cmd,a){
  if(!pc)throw Error('PC not running');
  switch(cmd){
    case 'frame':{
      const f=await pc.frame({reuse:true});
      if(!f)return null;
      let rows=null;if(f.dirtyH){rows=frameBuffers.take(f.dirtyH*f.w*4);rows.set(f.rgba.subarray(f.dirtyY*f.w*4,(f.dirtyY+f.dirtyH)*f.w*4));}
      return {w:f.w,h:f.h,dirtyH:f.dirtyH,dirtyY:f.dirtyY,captureMs:f.captureMs,decodeMs:f.decodeMs,
        rows,frameTransport:frameBuffers.stats(),ops:pc.ioOps()};
    }
    case 'events':return pc.events(a.events);
    case 'qmp':return pc.qmp.send(a.name,a.args);
    case 'tcgEnable':return pc.tcg.enable();
    case 'tcgDisable':return pc.tcg.disable();
    case 'tcgEnableLight':return pc.tcg.enableLight?.();
    case 'tcgDisableLight':return pc.tcg.disableLight?.();
    case 'tcgRead':return pc.tcg.read();
    case 'blockStats':return pc.blockStats();
    case 'storageStats':return pc.storageStats();
    case 'textScreen':return pc.textScreen();
    case 'audioHardware':return pc.audioHardware();
    case 'opticalStatus':return pc.opticalStatus();
  }
}
const queries=new Set(['frame','events','qmp','tcgEnable','tcgDisable','tcgEnableLight','tcgDisableLight','tcgRead','blockStats','storageStats','textScreen','opticalStatus','audioHardware']);
onmessage=async({data:{id,cmd,args={}}})=>{
  try{
    if(cmd==='recycleFrame'){frameBuffers.recycle(args.buffer);return;}
    let value;
    if(queries.has(cmd))value=await query(cmd,args);
    else{const task=management.then(()=>manage(cmd,args));management=task.catch(()=>{});value=await task;}
    const buffer=ArrayBuffer.isView(value)?value.buffer:value?.rows?.buffer;
    postMessage({id,value},buffer?[buffer]:[]);
  }catch(e){postMessage({id,error:String(e.message??e)});}
};
setInterval(()=>{if(disk?.type==='folder')try{disk.flush();}catch{notify('OPFS flush failed; export the working image before closing');}},1000);
