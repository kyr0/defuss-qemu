import {FatFsDisk,FatFsMode} from './fatfs.mjs';
import {blankIDE} from '../fat16.mjs';

export const limits={entries:4096,depth:24,sourceBytes:192*1048576,imageMiB:256};
export function component(s){
  if(typeof s!=='string'||!s.length||s.length>255||/[<>:"/\\|?*\x00-\x1f\x7f]/.test(s)||
     /[. ]$/.test(s)||/^(CON|PRN|AUX|NUL|CLOCK\$|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s))
    throw Error('Name cannot be represented safely in Windows FAT: '+JSON.stringify(s));
  return s;
}
const folded=s=>s.normalize('NFC').toUpperCase();
export const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function admit(seen,path){
  if(path.length>250||path.split('/').length>limits.depth)throw Error('FAT path too long or deep: '+path);
  const key=folded(path);if(seen.has(key))throw Error('Case or Unicode name collision: '+path);
  if(seen.size>=limits.entries)throw Error('Folder entry limit exceeded');
  seen.add(key);
}
export async function snapshotFolder(dir){
  const source=[],seen=new Set();let bytes=0,rootSlots=0;
  async function walk(handle,prefix){
    for await(const [name,child] of handle.entries()){
      const path=prefix+component(name);admit(seen,path);
      if(!prefix)rootSlots+=1+Math.ceil(name.length/13);
      if(child.kind==='directory'){source.push({path,kind:'directory'});await walk(child,path+'/');}
      else{
        const file=await child.getFile();bytes+=file.size;
        if(bytes>limits.sourceBytes)throw Error('Selected folder exceeds 192 MiB');
        source.push({path,kind:'file',file});
      }
    }
  }
  await walk(dir,'');
  const mib=Math.max(8,Math.ceil((bytes+source.length*8192+4*1048576)*1.12/1048576));
  if(mib>limits.imageMiB)throw Error('Projected FAT16 image exceeds 256 MiB');
  const slots=Math.max(512,Math.ceil((rootSlots+128)/16)*16);
  const image=blankIDE(mib,slots);
  image[446]=0; // Data disk, never mark its partition active.
  const disk=await FatFsDisk.create(image);disk.mount();
  const entries=[];
  try{
    for(const item of source){
      const path='/'+item.path;
      if(item.kind==='directory'){disk.mkdir(path);entries.push({path:item.path,kind:'directory'});continue;}
      const data=new Uint8Array(await item.file.arrayBuffer());
      const f=disk.open(path,FatFsMode.WRITE|FatFsMode.CREATE_NEW);
      try{for(let at=0;at<data.length;at+=65536){
        const part=data.subarray(at,at+65536);if(f.write(part)!==part.length)throw Error('FAT volume full');
      }}finally{f.close();}
      entries.push({path:item.path,kind:'file',size:data.length,sha:await digest(data)});
    }
  }finally{disk.unmount();}
  // Verify the actual FAT names and contents, including VFAT aliases, before publishing.
  const view=await inspectFat(image);
  const verified=new Map(view.map(e=>[e.path,e]));
  if(entries.length!==view.length||entries.some(e=>!same(e,verified.get(e.path))))
    throw Error('FAT round trip changed a filename or file contents');
  return {image,entries};
}
export function same(a,b){
  if(!a||!b)return !a&&!b;
  return a.kind===b.kind&&(a.kind==='directory'||(a.sha===b.sha&&a.size===b.size));
}
export async function inspectFat(source){
  const disk=await FatFsDisk.create(source);disk.mount();
  const rows=[],seen=new Set();let total=0;
  async function inspect(prefix){
    const dir=disk.openDir('/'+prefix),items=[];
    try{for(const item of dir){
      const path=prefix+component(item.name);admit(seen,path);
      items.push({path,kind:item.isDirectory?'directory':'file',size:item.size});
    }}finally{dir.close();}
    for(const e of items){
      if(e.kind==='directory'){rows.push({path:e.path,kind:e.kind});await inspect(e.path+'/');}
      else{
        total+=e.size;if(total>limits.imageMiB*1048576)throw Error('Invalid FAT file sizes');
        rows.push({...e,sha:await digest(readExact(disk,e))});
      }
    }
  }
  try{await inspect('');}finally{disk.unmount();}
  return rows;
}
export function readExact(disk,e){
  const data=new Uint8Array(e.size),f=disk.open('/'+e.path,FatFsMode.READ);
  try{for(let at=0;at<data.length;at+=65536){
    const part=data.subarray(at,at+65536);if(f.read(part)!==part.length)throw Error('Short FAT read: '+e.path);
  }}finally{f.close();}
  return data;
}
export async function hostEntry(root,path){
  const parts=path.split('/').map(component),last=parts.pop();let dir=root;
  try{
    for(const n of parts)dir=await dir.getDirectoryHandle(n);
    const h=await dir.getFileHandle(last);
    const f=await h.getFile();
    if(f.size>limits.imageMiB*1048576)return {path,kind:'file',size:f.size,sha:null};
    return {path,kind:'file',size:f.size,sha:await digest(await f.arrayBuffer())};
  }catch(e){
    if(e.name==='NotFoundError')return null;
    if(e.name==='TypeMismatchError'){
      // Distinguish a non-directory ancestor from a directory at this target.
      let check=root;for(const n of [...parts,last])check=await check.getDirectoryHandle(n);
      return {path,kind:'directory'};
    }
    throw e;
  }
}
export async function planSync(root,baseline,current){
  const old=new Map(baseline.map(e=>[e.path,e])),now=new Map(current.map(e=>[e.path,e])),rows=[];
  const previousNames=new Map(baseline.map(e=>[folded(e.path),e.path]));
  for(const [path,after] of now){
    if(previousNames.has(folded(path))&&previousNames.get(folded(path))!==path){
      rows.push({path,operation:'conflict'});continue;
    }
    const before=old.get(path);
    if(same(before,after))continue;
    let operation;
    try{
      const host=await hostEntry(root,path);
      if(before&&before.kind!==after.kind)operation='conflict';
      else if(same(after,host))operation='already applied';
      else if(!same(before,host))operation='conflict';
      else operation=before?'update':'create';
    }catch(e){if(e.name!=='TypeMismatchError')throw e;operation='conflict';}
    rows.push({path,operation});
  }
  for(const path of old.keys())if(!now.has(path))rows.push({path,operation:'retain host copy'});
  return rows.sort((a,b)=>a.path.split('/').length-b.path.split('/').length||a.path.localeCompare(b.path));
}
export async function applySync(root,baseline,current,source,reviewed){
  const old=new Map(baseline.map(e=>[e.path,e])),now=new Map(current.map(e=>[e.path,e]));
  const plan=await planSync(root,baseline,current);
  if(plan.some(r=>r.operation==='conflict'))throw Error('Host conflict. No write-back started.');
  const approved=new Map(reviewed.map(r=>[r.path,r.operation]));
  if(plan.some(r=>!approved.has(r.path)||(r.operation!=='already applied'&&approved.get(r.path)!==r.operation)))
    throw Error('Host changed since preview; create a fresh preview.');
  const fat=await FatFsDisk.create(source);fat.mount();
  let applied=0;
  try{
    for(const {path,operation} of plan){
      if(operation==='retain host copy')continue;
      const after=now.get(path),before=old.get(path),host=await hostEntry(root,path);
      if(same(host,after)){old.set(path,after);continue;}
      if(!same(host,before))throw Error('Concurrent change: '+path);
      const parts=path.split('/').map(component),name=parts.pop();let parent=root;
      for(const n of parts)parent=await parent.getDirectoryHandle(n);
      if(after.kind==='directory')await parent.getDirectoryHandle(name,{create:true});
      else{
        const bytes=readExact(fat,after);
        if(await digest(bytes)!==after.sha)throw Error('Guest image changed since preview: '+path);
        const handle=await parent.getFileHandle(name,{create:!host});
        const output=await handle.createWritable({mode:'exclusive'});
        try{
          await output.write(bytes);
          const existing=await hostEntry(root,path);
          // A newly created handle initially points at an empty file.
          if(host?!same(existing,host):existing?.kind!=='file'||existing.size!==0)
            throw Error('Host changed before commit: '+path);
          await output.close();
        }catch(e){try{await output.abort();}catch{}throw e;}
      }
      if(!same(await hostEntry(root,path),after))throw Error('Write-back verification failed: '+path);
      old.set(path,after);applied++;
    }
  }catch(e){throw Error(applied+' change(s) committed before stop. Retry from preview. '+e.message);}
  finally{fat.unmount();}
  return {entries:[...old.values()],applied};
}
