// Offline, copy-only growth for Win9x raw system images. Source payload ranges
// remain Blob slices. Only metadata and bounded verification windows enter RAM.
import {maxDiskMiB,zeroPadding} from './fat16.mjs';
const sector=512,MiB=1048576;
const fat16Types=[0x04,0x06,0x0e],fat32Types=[0x0b,0x0c];
const bytes=(blob,a,b)=>blob.slice(a,b).arrayBuffer().then(v=>new Uint8Array(v));
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const u16=(b,i)=>view(b).getUint16(i,true),u32=(b,i)=>view(b).getUint32(i,true);
const set16=(b,i,n)=>view(b).setUint16(i,n,true),set32=(b,i,n)=>view(b).setUint32(i,n,true);
function check(ok,message){if(!ok)throw Error(message);}
function equal(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
function indexedFat(bits,data){return bits===16?new Uint16Array(data.buffer):new Uint32Array(data.buffer);}
const littleEndian=new Uint8Array(Uint16Array.of(1).buffer)[0]===1;

async function volume(file){
  check(littleEndian,'This runtime requires little-endian typed arrays');
  check(file.size>=sector && file.size%sector===0 && file.size<=maxDiskMiB*MiB,'Select a sector-aligned raw image within the primary disk limit');
  const mbr=await bytes(file,0,sector);
  check(u16(mbr,510)===0xaa55,'Missing MBR boot signature');
  const entries=[446,462,478,494].filter(i=>mbr.subarray(i,i+16).some(Boolean));
  check(entries.length===1,'Resize supports one primary MBR partition. Multi-partition, unpartitioned and GPT images are unsupported.');
  const entry=entries[0],type=mbr[entry+4],start=u32(mbr,entry+8),partition=u32(mbr,entry+12);
  check([0,128].includes(mbr[entry]) && [...fat16Types,...fat32Types].includes(type),'Expected a primary FAT16 or FAT32 MBR partition');
  check(start>0 && partition>0 && (start+partition)*sector<=file.size,'Partition extends beyond the disk image');
  const boot=await bytes(file,start*sector,(start+1)*sector);
  check(u16(boot,510)===0xaa55 && u16(boot,11)===sector,'Expected a 512-byte FAT boot sector');
  const spc=boot[13],reserved=u16(boot,14),copies=boot[16],rootEntries=u16(boot,17);
  const total=u16(boot,19)||u32(boot,32),fat16=u16(boot,22),fatSize=fat16||u32(boot,36);
  const rootSectors=Math.ceil(rootEntries*32/sector),headers=reserved+copies*fatSize+rootSectors;
  check(spc>0 && spc<=64 && (spc&(spc-1))===0 && reserved>0 && [1,2].includes(copies) && fatSize>0 && total<=partition && total>headers,'Unsupported or inconsistent FAT layout (maximum cluster size 32 KiB)');
  check(!(u16(boot,19)&&u32(boot,32)) && u32(boot,28)===start,'Partition start or sector count disagrees with the FAT boot sector');
  const count=Math.floor((total-headers)/spc),bits=count<4085?12:count<65525?16:32;
  check(bits!==12,'FAT12 resizing is unsupported');
  check(bits===16?fat16Types.includes(type)&&fat16&&rootEntries&&rootEntries%16===0:
    fat32Types.includes(type)&&!fat16&&!rootEntries&&!u16(boot,42),'Partition type disagrees with FAT cluster count or version');
  const width=bits/8,mask=bits===16?0xffff:0x0fffffff;
  check((count+2)*width<=fatSize*sector,'Allocation table is too short for the volume');
  check(!(boot[bits===16?37:65]&3),'FAT boot sector indicates a dirty volume. Check it with ScanDisk and shut down cleanly first.');
  const flags=bits===32?u16(boot,40):0,active=flags&128?flags&15:0;
  check(active<copies,'Invalid active FAT index');
  const fatPos=(start+reserved+active*fatSize)*sector;
  const rawFat=await bytes(file,fatPos,fatPos+(count+2)*width);
  const fat=indexedFat(bits,rawFat);
  check((fat[0]&mask)===(mask-255+boot[21]) && (fat[1]&mask)===mask,'Invalid or dirty allocation table. Check the volume with ScanDisk, then shut down cleanly.');
  if(!(flags&128)&&copies===2){
    const other=await bytes(file,fatPos+fatSize*sector,fatPos+fatSize*sector+rawFat.length);
    check(equal(rawFat,other),'The mirrored FATs disagree. Repair the source volume before growing it.');
  }
  const spt=u16(boot,24),heads=u16(boot,26);
  check(spt>0&&spt<=63&&heads>0&&heads<=255,'Invalid BIOS disk geometry');
  const root=bits===32?u32(boot,44):0;
  check(!root || root>=2 && root<=count+1,'Invalid FAT32 root cluster');
  check(bits===16||root,'Missing FAT32 root cluster');
  const reservedData=await bytes(file,start*sector,(start+reserved)*sector);
  let backup=0,info=0,infoCopies=[];
  if(bits===32){
    info=u16(boot,48);backup=u16(boot,50);
    if(info===65535)info=0;if(backup===65535)backup=0;
    check(info<reserved && backup<reserved && (!info||info!==backup),'Invalid FAT32 reserved-sector pointers');
    if(backup){
      const copy=reservedData.subarray(backup*sector,(backup+1)*sector);
      check(u16(copy,510)===0xaa55 && equal(boot.subarray(11,52),copy.subarray(11,52)),'FAT32 primary and backup boot parameters disagree');
    }
    const infoOK=i=>u32(reservedData,i*sector)===0x41615252&&u32(reservedData,i*sector+484)===0x61417272&&u32(reservedData,i*sector+508)===0xaa550000;
    if(info){check(infoOK(info),'Invalid primary FAT32 FSInfo sector');infoCopies.push(info);}
    if(info&&backup&&backup+info<reserved && infoOK(backup+info))infoCopies.push(backup+info);
  }
  const rootAt=(start+reserved+copies*fatSize)*sector,dataAt=(start+headers)*sector;
  let free=0;
  for(let n=2;n<count+2;n++)if(!(fat[n]&mask))free++;
  return {file,mbr,entry,type,start,partition,spc,reserved,copies,rootEntries,rootSectors,total,fatSize,count,
    bits,width,mask,fat,spt,heads,root,reservedData,backup,infoCopies,rootAt,dataAt,free};
}
function describe(v){return {diskBytes:v.file.size,fat:'FAT'+v.bits,volumeBytes:v.total*sector,clusterBytes:v.spc*sector,freeBytes:v.free*v.spc*sector};}
export async function inspectFatDisk(file){return describe(await volume(file));}
function layout(v,target){
  check(Number.isInteger(target)&&target>=8&&target<=maxDiskMiB && target*MiB>v.file.size,
    'Choose a larger whole-MiB disk size, up to '+maxDiskMiB+' MiB');
  const sectors=target*MiB/sector;
  let heads=v.heads;
  while(heads<255 && Math.ceil(sectors/(heads*v.spt))>1024)heads=Math.min(255,2*heads);
  const end=Math.floor(sectors/(heads*v.spt))*heads*v.spt,total=end-v.start;
  check(total>v.total,'The new size must add at least one usable BIOS cylinder');
  check(end<=1024*heads*v.spt||[0x0c,0x0e].includes(v.type),'Target exceeds the CHS range of the partition');
  for(let spc=v.spc;spc<=64;spc*=2){
    // Smallest FAT that can address all clusters, accounting for its own size.
    let lo=1,hi=Math.ceil((total/spc+2)*v.width/sector);
    while(lo<hi){
      const mid=Math.floor((lo+hi)/2),clusters=Math.floor((total-v.reserved-v.copies*mid-v.rootSectors)/spc);
      if(mid*sector>=(clusters+2)*v.width)hi=mid;else lo=mid+1;
    }
    const fatSize=Math.max(lo,v.spc===spc?v.fatSize:0);
    const count=Math.floor((total-v.reserved-v.copies*fatSize-v.rootSectors)/spc);
    if(v.bits===16 && count>65508)continue;
    check(count>=(v.bits===16?4085:65525),'New cluster count would change FAT type');
    return {total,end,heads,spc,count,fatSize};
  }
  throw Error('Requested size exceeds the FAT16 cluster limit for this Win9x volume');
}
function chainBytes(v,chain){
  const pieces=[];
  for(let i=0;i<chain.length;){
    let end=i+1;
    while(end<chain.length && chain[end]===chain[end-1]+1)end++;
    const pos=v.dataAt+(chain[i]-2)*v.spc*sector;
    pieces.push(v.file.slice(pos,pos+(end-i)*v.spc*sector));i=end;
  }
  return new Blob(pieces);
}
const firstCluster=(a,i,bits)=>u16(a,i+26)+(bits===32?(u16(a,i+20)&4095)*65536:0);
const dirName=(a,i)=>String.fromCharCode(...a.subarray(i,i+11));
function putCluster(a,i,bits,c){
  set16(a,i+26,c&65535);
  if(bits===32)set16(a,i+20,(u16(a,i+20)&0xf000)|(c>>>16));
}
// One ownership map catches cycles, cross-links and unreachable allocations.
// Every live directory entry is preserved byte-for-byte except relocated cluster references.
async function scan(v){
  const objects=[],seen=new Uint8Array(v.count+2);
  const eoc=v.mask-7,reserved=v.mask-15;
  function chain(c){
    const list=[];
    while(c){
      check(c>=2 && c<reserved && c<v.count+2 && !seen[c],'Invalid, overlapping or cyclic FAT chain');
      seen[c]=1;list.push(c);
      const next=v.fat[c]&v.mask;
      if(next>=eoc)break;
      check(next>=2&&next<reserved,'Broken FAT chain or bad cluster');
      c=next;
    }
    return list;
  }
  const root={dir:true,first:v.root,chain:chain(v.root),parent:null};
  objects.push(root);let directoryBytes=0;
  for(let idx=0;idx<objects.length;idx++){
    const d=objects[idx];if(!d.dir)continue;
    const blob=d===root&&v.bits===16?v.file.slice(v.rootAt,v.rootAt+v.rootSectors*sector):chainBytes(v,d.chain);
    directoryBytes+=blob.size;
    check(blob.size<=65536*32 && directoryBytes<=128*MiB,'Directory metadata exceeds supported limits');
    const a=new Uint8Array(await blob.arrayBuffer());d.bytes=a;d.refs=[];
    for(let i=0;i<a.length&&a[i];i+=32){
      const attr=a[i+11];
      if(a[i]===229||attr===15||attr&8)continue;
      const c=firstCluster(a,i,v.bits),name=dirName(a,i),size=u32(a,i+28),dir=Boolean(attr&16);
      if(name==='.          '||name==='..         '){
        const owner=name==='.          '?d:d.parent;
        check(dir && owner && (c===owner.first||owner===root && !c),'Invalid FAT directory parent link');
        if(c)d.refs.push([i,owner]);
        continue;
      }
      check((!dir||size===0) && (c||(!dir&&!size)),'Invalid file or directory entry');
      const list=chain(c);
      check(size<=list.length*v.spc*sector,'File chain is shorter than its file length');
      const o={dir,size,first:c,chain:list,parent:d};
      objects.push(o);d.refs.push([i,o]);
      check(objects.length<=1000000,'Image has too many entries for the in-browser resizer');
    }
  }
  for(let c=2;c<=v.count+1;c++){
    if(!seen[c])check(!(v.fat[c]&v.mask),'Orphaned allocation or bad cluster. Repair the source before resizing.');
  }
  return objects;
}
function chs(a,i,lba,spt,heads){
  const c=Math.floor(lba/(spt*heads));
  if(c>1023){a.set([254,255,255],i);return;}
  a.set([Math.floor(lba/spt)%heads,(lba%spt+1)|((c>>>2)&192),c&255],i);
}
function bootMetadata(v,g,newRoot,free,nextFree){
  const mbr=v.mbr.slice(),p=v.entry;
  chs(mbr,p+1,v.start,v.spt,g.heads);chs(mbr,p+5,g.end-1,v.spt,g.heads);
  if(v.type===4 && g.total>=65536)mbr[p+4]=6;
  set32(mbr,p+12,g.total);
  const reserved=v.reservedData.slice();
  for(const s of v.backup?[0,v.backup]:[0]){
    const b=reserved.subarray(s*sector,(s+1)*sector),short=v.bits===16&&g.total<65536;
    b[13]=g.spc;set16(b,19,short?g.total:0);set32(b,32,short?0:g.total);set16(b,26,g.heads);
    if(v.bits===16)set16(b,22,g.fatSize);
    else{set32(b,36,g.fatSize);set32(b,44,newRoot);}
  }
  for(const s of v.infoCopies){set32(reserved,s*sector+488,free);set32(reserved,s*sector+492,nextFree);}
  return [mbr,v.file.slice(sector,v.start*sector),reserved];
}
async function verifyFiles(src,old,dst,fresh,progress){
  check(old.length===fresh.length,'Verification failed: entry count changed');
  for(let i=0;i<old.length;i++){
    const a=old[i],b=fresh[i];
    check(a.dir===b.dir&&a.size===b.size,'Verification failed: directory structure changed');
    if(a.dir){
      const adjusted=a.bytes.slice();
      for(const [off,ref] of a.refs)putCluster(adjusted,off,src.bits,ref.dest);
      check(equal(adjusted,b.bytes.subarray(0,adjusted.length))&&!b.bytes.subarray(adjusted.length).some(Boolean),'Verification failed: directory metadata changed');
    }else if(a.size){
      const before=chainBytes(src,a.chain),after=chainBytes(dst,b.chain);
      for(let off=0;off<a.size;off+=MiB){
        const end=Math.min(a.size,off+MiB);
        const [x,y]=await Promise.all([bytes(before,off,end),bytes(after,off,end)]);
        check(equal(x,y),'Verification failed: file contents changed');
      }
    }
    if(i%256===0)progress('Verifying files',i,old.length);
  }
}
export async function growFatDisk(file,target,progress=()=>{}){
  progress('Checking FAT and directories');
  const src=await volume(file),g=layout(src,target),old=await scan(src);
  // Keep hidden data after the original volume out of the resize path.
  for(let off=(src.start+src.total)*sector;off<file.size;off+=MiB)
    check(!(await bytes(file,off,Math.min(file.size,off+MiB))).some(Boolean),'Nonempty data follows the FAT volume. This layout is unsupported.');
  const dstFat=new Uint8Array(g.fatSize*sector),table=indexedFat(src.bits,dstFat);
  const repack=g.spc!==src.spc,root=old[0];let data=[],fixedRoot=null;
  progress('Building enlarged volume');
  if(!repack){
    table.set(src.fat);for(const o of old)o.dest=o.first;
    if(src.bits===16)fixedRoot=src.file.slice(src.rootAt,src.dataAt);
    data.push(file.slice(src.dataAt,src.dataAt+src.count*src.spc*sector));
  }else{
    table[0]=src.fat[0];table[1]=src.fat[1];
    const allocated=old.filter(o=>o.chain.length).sort((a,b)=>a.first-b.first);
    let at=2;
    for(const o of old)o.dest=0;
    for(const o of allocated){
      o.dest=at;o.slots=Math.ceil(o.chain.length*src.spc/g.spc);
      check(at+o.slots<=g.count+2,'Too little space for the resized cluster chains');
      for(let j=0;j<o.slots;j++,at++)table[at]=j===o.slots-1?src.mask:at+1;
    }
    function directory(o){
      const a=o.bytes.slice();for(const [off,ref] of o.refs)putCluster(a,off,src.bits,ref.dest);
      return new Blob([a]);
    }
    if(src.bits===16)fixedRoot=directory(root);
    for(const o of allocated){
      const blob=o.dir?directory(o):chainBytes(src,o.chain);
      data.push(blob,zeroPadding(o.slots*g.spc*sector-blob.size));
    }
  }
  let free=0,nextFree=0xffffffff;
  for(let n=2;n<g.count+2;n++)if(!(table[n]&src.mask)){free++;if(nextFree===0xffffffff)nextFree=n;}
  check(free*g.spc>src.free*src.spc,'Growth did not increase usable free space');
  const parts=bootMetadata(src,g,root.dest,free,nextFree),fatBlob=new Blob([dstFat]);
  for(let i=0;i<src.copies;i++)parts.push(fatBlob);
  if(fixedRoot)parts.push(fixedRoot);
  const body=new Blob([...parts,...data]);
  const image=new Blob([body,zeroPadding(target*MiB-body.size)],{type:'application/octet-stream'});
  const dst=await volume(image),fresh=await scan(dst);
  check(dst.total===g.total && dst.free===free && dst.spc===g.spc,'Verification failed: target geometry disagrees');
  await verifyFiles(src,old,dst,fresh,progress);
  return {image,before:describe(src),after:describe(dst),files:old.filter(o=>!o.dir).length};
}
