// QEMU's IDE-HD model requires a writable node at realize time. The block
// backend enforces protection on every write; werror=report returns ATA errors.
export function attachBlockFile(fs,path,backend){
  fs.writeFile(path,new Uint8Array());
  const node=fs.lookupPath(path).node,original=node.node_ops;
  node.usedBytes=backend.size;
  node.node_ops={...original,setattr(n,attrs){
    if(attrs.size!==undefined&&attrs.size!==backend.size)throw new fs.ErrnoError(28);
    const {size,...other}=attrs;original.setattr(n,other);
  }};
  function transfer(write,b,off,n,pos){
    if(!Number.isSafeInteger(pos)||pos<0)throw new fs.ErrnoError(28);
    if(!write)n=Math.max(0,Math.min(n,backend.size-pos));
    if(!n)return 0;
    if(write&&!backend.writable)throw new fs.ErrnoError(69); // EROFS in Emscripten
    try{return backend[write?'write':'read'](b.subarray(off,off+n),pos);}
    catch{throw new fs.ErrnoError(29);} // EIO
  }
  node.stream_ops={...node.stream_ops,
    read(s,b,o,n,p){return transfer(false,b,o,n,p);},
    write(s,b,o,n,p){return transfer(true,b,o,n,p);},
    fsync(){try{backend.flush();return 0;}catch{throw new fs.ErrnoError(29);}}
  };
}
