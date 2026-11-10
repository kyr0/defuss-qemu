// Transfer a small buffer pool between the VM worker and UI instead of
// allocating a fresh multi-megabyte RGBA payload for every changed frame.
export class FrameBuffers {
  constructor(limit=2,maxBytes=16*1048576){this.limit=limit;this.maxBytes=maxBytes;this.pool=[];this.allocatedBuffers=0;this.allocatedBytes=0;this.reusedBuffers=0;}
  take(length){
    if(!Number.isSafeInteger(length)||length<=0)throw Error('Invalid frame payload size');
    const i=this.pool.findIndex(b=>b.byteLength>=length);
    let buffer;
    if(i>=0){buffer=this.pool.splice(i,1)[0];this.reusedBuffers++;}
    else{buffer=new ArrayBuffer(length);this.allocatedBuffers++;this.allocatedBytes+=length;}
    return new Uint8ClampedArray(buffer,0,length);
  }
  recycle(buffer){
    if(!(buffer instanceof ArrayBuffer)||!buffer.byteLength||buffer.byteLength>this.maxBytes)return;
    // Keep the largest buffers, allowing small dirty bands to reuse them.
    this.pool.push(buffer);this.pool.sort((a,b)=>b.byteLength-a.byteLength);this.pool.length=Math.min(this.pool.length,this.limit);
  }
  stats(){return {allocatedBuffers:this.allocatedBuffers,allocatedBytes:this.allocatedBytes,reusedBuffers:this.reusedBuffers,
    retainedBuffers:this.pool.length,retainedBytes:this.pool.reduce((n,b)=>n+b.byteLength,0)};}
}
