import {maxDiskMiB} from './fat16.mjs';
// Dedicated VM worker only. Keep the immutable base as a File/Blob. A bounded
// cache serves repeated reads; only pages written by the guest live in the overlay.
export const diskPageBytes=65536,defaultReadCacheBytes=32*1048576;
const pageSize=diskPageBytes;
export class PagedDisk {
  constructor(file,reader=new FileReaderSync(),{cacheBytes=defaultReadCacheBytes}={}){
    if(file.size<512||file.size%512||file.size>maxDiskMiB*1048576)throw Error('Invalid raw primary disk size');
    if(!Number.isSafeInteger(cacheBytes)||cacheBytes<pageSize||cacheBytes%pageSize||cacheBytes>128*1048576)throw Error('Invalid primary read-cache size');
    this.file=file;this.reader=reader;this.size=file.size;this.writable=true;
    this.clean=new Map();this.dirty=new Map();
    this.cacheBytes=cacheBytes;this.cleanLimit=cacheBytes/pageSize;
    this.cleanBytes=0;this.dirtyBytes=0;this.lastIndex=-1;this.lastData=null;this.lastDirty=false;
    this.counters={readOps:0,writeOps:0,readBytes:0,writeBytes:0,cleanHits:0,dirtyHits:0,
      lastPageHits:0,cacheMisses:0,evictions:0,baseReadOps:0,baseReadBytes:0,baseReadErrors:0,baseReadMs:0,fullPageWrites:0};
    const first=this.readBase(0,4);
    if(first[0]===81&&first[1]===70&&first[2]===73&&first[3]===251)throw Error('Convert qcow2 to raw first');
  }
  readBase(start,end){
    const begin=performance.now();
    try{
      const data=new Uint8Array(this.reader.readAsArrayBuffer(this.file.slice(start,end)));
      if(data.length!==end-start)throw Error('Short primary disk read');
      this.counters.baseReadOps++;this.counters.baseReadBytes+=data.length;return data;
    }catch(error){this.counters.baseReadErrors++;throw error;}
    finally{this.counters.baseReadMs+=performance.now()-begin;}
  }
  remember(index,data,dirty){this.lastIndex=index;this.lastData=data;this.lastDirty=dirty;return data;}
  page(index){
    if(index===this.lastIndex){
      this.counters.lastPageHits++;this.counters[this.lastDirty?'dirtyHits':'cleanHits']++;
      return this.lastData;
    }
    const dirty=this.dirty.get(index);
    if(dirty){this.counters.dirtyHits++;return this.remember(index,dirty,true);}
    let data=this.clean.get(index);
    if(data){this.counters.cleanHits++;this.clean.delete(index);}
    else{
      this.counters.cacheMisses++;
      const at=index*pageSize,end=Math.min(this.size,at+pageSize);
      data=this.readBase(at,end);this.cleanBytes+=data.length;
    }
    this.clean.set(index,data);
    if(this.clean.size>this.cleanLimit){
      const oldest=this.clean.keys().next().value;
      this.cleanBytes-=this.clean.get(oldest).length;this.clean.delete(oldest);this.counters.evictions++;
    }
    return this.remember(index,data,false);
  }
  writablePage(index,inside,n){
    const entire=inside===0 && n===Math.min(pageSize,this.size-index*pageSize);
    const data=entire?(this.dirty.get(index)??new Uint8Array(n)):this.page(index);
    if(entire)this.counters.fullPageWrites++;
    if(!this.dirty.has(index)){this.dirty.set(index,data);this.dirtyBytes+=data.length;}
    const clean=this.clean.get(index);
    if(clean){this.clean.delete(index);this.cleanBytes-=clean.length;}
    return this.remember(index,data,true);
  }
  access(buf,pos,write){
    if(!Number.isSafeInteger(pos)||pos<0||pos+buf.length>this.size)throw Error('Primary disk I/O out of range');
    if(!buf.length)return 0;
    const first=Math.floor(pos/pageSize),inside=pos%pageSize;
    // ATA commonly requests one 512-byte sector. Avoid generic page walking
    // and repeated LRU mutations while its sectors stay in the same page.
    if(buf.length<=pageSize-inside){
      if(write)this.writablePage(first,inside,buf.length).set(buf,inside);
      else buf.set(this.page(first).subarray(inside,inside+buf.length));
      this.counters[write?'writeOps':'readOps']++;this.counters[write?'writeBytes':'readBytes']+=buf.length;
      return buf.length;
    }
    for(let off=0;off<buf.length;){
      const index=Math.floor(pos/pageSize),inside=pos%pageSize;
      const n=Math.min(buf.length-off,pageSize-inside);
      if(write){
        this.writablePage(index,inside,n).set(buf.subarray(off,off+n),inside);
      }else buf.set(this.page(index).subarray(inside,inside+n),off);
      off+=n;pos+=n;
    }
    this.counters[write?'writeOps':'readOps']++;this.counters[write?'writeBytes':'readBytes']+=buf.length;
    return buf.length;
  }
  read(buf,pos){return this.access(buf,pos,false);}
  write(buf,pos){return this.access(buf,pos,true);}
  flush(){} // Same session lifetime as the normal in-memory IDE disk.
  stats(){return {pageBytes:pageSize,cleanCacheMaxBytes:this.cacheBytes,
    cleanResidentBytes:this.cleanBytes,cleanPages:this.clean.size,dirtyResidentBytes:this.dirtyBytes,dirtyPages:this.dirty.size,
    ...this.counters};}
  snapshot(){
    const parts=[];let at=0;
    for(const index of [...this.dirty.keys()].sort((a,b)=>a-b)){
      const pos=index*pageSize,page=this.dirty.get(index);
      if(at<pos)parts.push(this.file.slice(at,pos));
      parts.push(new Blob([page]));at=pos+page.length;
    }
    if(at<this.size)parts.push(this.file.slice(at));
    return new Blob(parts,{type:'application/octet-stream'});
  }
}
