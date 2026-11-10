import {snapshotFolder,inspectFat,planSync,applySync} from './projection.mjs';

const PAGE=4096;
const openFile=(dir,name)=>dir.getFileHandle(name,{create:true}).then(f=>f.createSyncAccessHandle());
async function writeJson(dir,name,data){
  const f=await dir.getFileHandle(name,{create:true}),out=await f.createWritable();
  try{await out.write(JSON.stringify(data));await out.close();}catch(e){try{await out.abort();}catch{}throw e;}
}
const readJson=async(dir,name)=>JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
const parent=async()=> (await navigator.storage.getDirectory()).getDirectoryHandle('qemu-win9x-folders-v1',{create:true});
function exact(handle,method,buf,at){
  if(handle[method](buf,{at})!==buf.length)throw Error('Short OPFS '+method);
}
export function bounds(size,at,n){
  if(!Number.isSafeInteger(at)||!Number.isSafeInteger(n)||at<0||n<0||at>size-n)throw Error('Block access outside device');
}
function requireId(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid snapshot ID');return id;}

// Store the granted host handle separately from image data. Structured cloning
// preserves identity for isSameEntry after a reload, even if permission expired.
async function identity(id,action,value){
  const db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('win9x-folder-handles-v1',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('folders');
    r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);
  });
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('folders',action==='get'?'readonly':'readwrite'),store=tx.objectStore('folders');
    const req=action==='put'?store.put(value,id):action==='delete'?store.delete(id):store.get(id);
    tx.oncomplete=()=>resolve(req.result);tx.onabort=tx.onerror=()=>reject(tx.error||req.error);
  });}finally{db.close();}
}

export async function listSnapshots(){
  const root=await parent(),list=[];
  for await(const [id,d] of root.entries()){
    if(d.kind!=='directory')continue;
    try{const m=await readJson(d,'meta.json');list.push({id,label:m.label,size:m.size,created:m.created});}
    catch(e){if(e.name!=='NotFoundError')throw e;}
  }
  return list.sort((a,b)=>b.created.localeCompare(a.created));
}
export async function createSnapshot(host,writable){
  const {image,entries}=await snapshotFolder(host),root=await parent(),id=crypto.randomUUID();
  const dir=await root.getDirectoryHandle(id,{create:true});
  try{
    const base=await openFile(dir,'base.raw');
    try{exact(base,'write',image,0);base.flush();}finally{base.close();}
    const meta={version:1,id,label:host.name,size:image.length,created:new Date().toISOString(),entries};
    await identity(id,'put',host);await writeJson(dir,'meta.json',meta);
    return await openSnapshot(id,writable);
  }catch(e){await root.removeEntry(id,{recursive:true});await identity(id,'delete');throw e;}
}
export async function forgetSnapshot(id){
  // Acquiring the same exclusive base handle prevents deleting an active mount.
  const root=await parent(),dir=await root.getDirectoryHandle(requireId(id));
  const lock=await (await dir.getFileHandle('base.raw')).createSyncAccessHandle();
  try{
    const meta=await readJson(dir,'meta.json');meta.discarding=true;await writeJson(dir,'meta.json',meta);
  }finally{lock.close();}
  await root.removeEntry(id,{recursive:true});await identity(id,'delete');
}
export async function openSnapshot(id,writable){
  const root=await parent(),dir=await root.getDirectoryHandle(requireId(id)),opened=[];
  try{
    for(const name of ['base.raw','overlay.raw','present.bin'])opened.push(await openFile(dir,name));
    const [base,overlay,map]=opened,meta=await readJson(dir,'meta.json'),size=base.getSize();
    if(meta.discarding||meta.id!==id||meta.version!==1||size!==meta.size||size%PAGE||size>256*1048576)throw Error('Invalid snapshot metadata');
    const bits=new Uint8Array(Math.ceil(size/PAGE/8)),scratch=new Uint8Array(PAGE);
    if(map.getSize()){
      if(map.getSize()!==bits.length)throw Error('Invalid overlay bitmap');
      exact(map,'read',bits,0);
    }else{exact(map,'write',bits,0);map.flush();}
    let changed=false;
    const has=p=>Boolean(bits[p>>3]&(1<<(p%8)));
    const overlaySize=overlay.getSize();
    for(let p=0;p<size/PAGE;p++)if(has(p)&&overlaySize<(p+1)*PAGE)throw Error('Truncated overlay');
    const backend={
      type:'folder',id,label:meta.label,size,writable:Boolean(writable),
      read(buf,at){
        bounds(size,at,buf.length);let n=0;
        while(n<buf.length){
          const pos=at+n,page=Math.floor(pos/PAGE),take=Math.min(PAGE-pos%PAGE,buf.length-n);
          exact(has(page)?overlay:base,'read',buf.subarray(n,n+take),pos);n+=take;
        }
        return n;
      },
      write(buf,at){
        if(!writable)throw Error('Read-only folder');bounds(size,at,buf.length);let n=0;
        while(n<buf.length){
          const pos=at+n,page=Math.floor(pos/PAGE),start=page*PAGE,take=Math.min(PAGE-pos%PAGE,buf.length-n);
          if(!has(page)){
            exact(base,'read',scratch,start);scratch.set(buf.subarray(n,n+take),pos-start);
            exact(overlay,'write',scratch,start);bits[page>>3]|=1<<(page%8);
          }else exact(overlay,'write',buf.subarray(n,n+take),pos);
          n+=take;changed=true;
        }
        return n;
      },
      flush(){
        if(!changed)return;
        overlay.flush();exact(map,'write',bits,0);map.flush();changed=false;
      },
      close(){try{this.flush();}finally{for(const h of opened)h.close();}},
      view(){return {byteLength:size,subarray:(start,end)=>{
        bounds(size,start,end-start);const b=new Uint8Array(end-start);this.read(b,start);return b;
      },set(){throw Error('Unexpected FAT parser write');}};},
      async preview(host){
        if(!writable)throw Error('Mount is read-only');
        const original=await identity(id,'get');
        if(!original||!await original.isSameEntry(host))throw Error('Select the original folder');
        this.flush();const src=this.view();validateFat16(src);
        const current=await inspectFat(src),plan=await planSync(host,meta.entries,current);
        return {host,current,plan};
      },
      async apply(review){
        const result=await applySync(review.host,meta.entries,review.current,this.view(),review.plan);
        const next={...meta,entries:result.entries};await writeJson(dir,'meta.json',next);
        meta.entries=next.entries;return result.applied;
      }
    };
    return backend;
  }catch(e){for(const h of opened)h.close();throw e;}
}

// Refuse ambiguous/corrupt FATs before interpreting any guest names for
// write-back. The guest can damage its private working disk without changing
// the immutable base or any host file.
export function validateFat16(src){
  const view=(start,n)=>new DataView(src.subarray(start,start+n).buffer);
  const m=view(0,512),start=m.getUint32(454,true),sectors=m.getUint32(458,true);
  if(m.getUint16(510,true)!==0xaa55||start!==63||m.getUint8(450)!==6||(start+sectors)*512>src.byteLength)throw Error('Unsupported partition layout');
  const b=view(start*512,512),spc=b.getUint8(13),reserved=b.getUint16(14,true),fats=b.getUint8(16);
  const roots=b.getUint16(17,true),fs=b.getUint16(22,true),vol=b.getUint16(19,true)||b.getUint32(32,true);
  if(b.getUint16(510,true)!==0xaa55||b.getUint16(11,true)!==512||!spc||(spc&(spc-1))||!reserved||fats!==2||!roots||!fs||vol!==sectors)throw Error('Invalid FAT16 BPB');
  const clusters=Math.floor((vol-reserved-2*fs-Math.ceil(roots/16))/spc),end=clusters+2,where=(start+reserved)*512;
  if(clusters<4085||clusters>65524||end>fs*256)throw Error('Invalid FAT16 cluster count');
  const a=src.subarray(where,where+fs*512),copy=src.subarray(where+fs*512,where+2*fs*512);
  if(a.some((v,i)=>v!==copy[i]))throw Error('FAT copies disagree; close guest files and flush before sync');
  const fat=new DataView(a.buffer,a.byteOffset,a.byteLength),state=new Uint8Array(end);
  for(let c=2;c<end;c++){
    if(state[c])continue;let n=c;const route=[];
    while(n>=2&&n<end&&!state[n]){
      state[n]=1;route.push(n);const next=fat.getUint16(n*2,true);
      if(next===0||next>=0xfff7){n=0;break;}
      if(next<2||next>=end)throw Error('Invalid FAT chain');
      n=next;
    }
    if(state[n]===1)throw Error('Cyclic FAT chain');
    for(const k of route)state[k]=2;
  }
}
