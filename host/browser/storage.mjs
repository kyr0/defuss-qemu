// The input disk and fallback optical media are separate MEMFS files. Count
// completed host file operations for display pacing without sending QMP queries.
export function countFileIo(fs,path,counters) {
  const node=fs.lookupPath(path).node,ops=node.stream_ops;
  node.stream_ops={...ops,
    read(...args){const n=ops.read(...args);if(n>0){counters.readOps++;counters.readBytes+=n;}return n;},
    write(...args){const n=ops.write(...args);if(n>0){counters.writeOps++;counters.writeBytes+=n;}return n;}
  };
}

// Reuse the tuned runtime's native read-only memory block driver. The URL is
// the driver's fixed internal protocol name. The guest still sees an IDE CD.
export function stageCD(mod,bytes) {
  if(!bytes?.length || bytes.length%2048 || bytes.length>256*1048576)return false;
  mod.defussDiskImage=bytes;
  try {return Boolean(mod._defuss_stage_rom(bytes.length));}
  finally {delete mod.defussDiskImage;}
}

export class IoPacer {
  constructor(){this.time=0;this.ops=0;this.busyUntil=0;}
  update(now,ops){
    if(!this.time){this.time=now;this.ops=ops;}
    const ms=now-this.time;
    if(ms>=250){
      if((ops-this.ops)*1000/ms>=96)this.busyUntil=now+850;
      this.time=now;this.ops=ops;
    }
    return now<this.busyUntil;
  }
}
