// Browser-compatible synchronous component API. No guest pointer is accepted.
export const IV = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
export const LIMITS = Object.freeze({integerIterations:1000000,compressionBlocksPerCall:1024,hashBytes:1048576});
export const hex = bytes => Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
function requireValue(ok,message){if(!ok)throw new RangeError(message);}
function u32(value,name){requireValue(Number.isInteger(value)&&value>=0&&value<=0xffffffff,name+' must be u32');return value;}

export async function createReference(wasmBytes) {
  const start=performance.now(), module=await WebAssembly.compile(wasmBytes), compiled=performance.now();
  requireValue(WebAssembly.Module.imports(module).length===0,'Standalone reference unexpectedly imports host functions');
  const instance=await WebAssembly.instantiate(module,{}), instantiated=performance.now();
  const raw=instance.exports;
  requireValue(raw.ref_abi_version()===1,'Unsupported reference ABI');
  const memory=raw.memory;
  requireValue(memory instanceof WebAssembly.Memory && !(typeof SharedArrayBuffer!=='undefined'&&memory.buffer instanceof SharedArrayBuffer),'Expected unshared WASM memory');
  const base=raw.ref_memory_base()>>>0,capacity=raw.ref_memory_capacity()>>>0,end=base+capacity;
  requireValue(capacity===8*1024*1024&&end<=memory.buffer.byteLength,'Invalid scratch arena');
  const contextBytes=raw.ref_sha256_context_bytes()>>>0;
  requireValue(contextBytes>=108&&contextBytes<=128,'Invalid SHA context layout');
  const bytes=new Uint8Array(memory.buffer),words=new Uint32Array(memory.buffer);
  const layout=Object.freeze({state:base,digest:base+64,context:base+128,input:base+4096});
  const range=(offset,length,name,alignment=1)=>{
    requireValue(memory.buffer===bytes.buffer,'WASM memory buffer identity changed; create a fresh reference');
    requireValue(Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&length>=0,
      name+' offset/length must be nonnegative safe integers');
    requireValue(offset>=base&&offset<=end&&length<=end-offset&&offset%alignment===0,name+' outside arena or misaligned');
  };
  const disjoint=(a,na,b,nb)=>requireValue(na===0||nb===0||a+na<=b||b+nb<=a,'Overlapping ranges are unsupported');
  const external=(view,type,name)=>{
    requireValue(ArrayBuffer.isView(view)&&view instanceof type,name+' has wrong typed-array type');
    requireValue(view.byteLength===view.length*type.BYTES_PER_ELEMENT,name+' typed-array width mismatch');
    requireValue(view.buffer instanceof ArrayBuffer&&!view.buffer.resizable,name+' must have a fixed unshared buffer');
    let attached=true;try{new Uint8Array(view.buffer,0,0);}catch{attached=false;}
    requireValue(attached,name+' buffer is detached');
    requireValue(view.buffer!==memory.buffer,name+' must not alias the scratch arena; use the resident API');
  };
  const checkContext=offset=>range(offset,contextBytes,'context',8);
  const checkStatus=status=>{if(status!==0)throw new RangeError('SHA context rejected operation (status '+status+')');};
  const api={raw,module,memory,bytes,words,base,capacity,layout,contextBytes,
    metadata:{abi:1,memoryModel:'wasm32',shared:false,memoryBytes:memory.buffer.byteLength,
      scratchBytes:capacity,compileMs:compiled-start,instantiateMs:instantiated-compiled,
      totalLoadMs:instantiated-start,imports:[],limitations:'Component ABI only; current VM uses memory64 and separate guest memory semantics'},
    integerChecked(seed,iterations,multiplier,increment){
      u32(seed,'seed');u32(multiplier,'multiplier');u32(increment,'increment');u32(iterations,'iterations');
      requireValue(iterations<=LIMITS.integerIterations,'Integer iteration service budget exceeded');
      return raw.ref_integer(seed,iterations,multiplier,increment)>>>0;
    },
    compressResident(stateOffset,inputOffset,blockCount,{maxBlocks=LIMITS.compressionBlocksPerCall}={}){
      u32(blockCount,'blockCount');u32(maxBlocks,'maxBlocks');
      requireValue(maxBlocks>0&&maxBlocks<=LIMITS.compressionBlocksPerCall,'Invalid compression service budget');
      range(stateOffset,32,'state',4);range(inputOffset,blockCount*64,'input');
      disjoint(stateOffset,32,inputOffset,blockCount*64);
      const completed=Math.min(blockCount,maxBlocks);
      raw.ref_sha256_compress(stateOffset,inputOffset,completed);
      return {blocksCompleted:completed,blocksRemaining:blockCount-completed};
    },
    compressCopied(state,input){
      external(state,Uint32Array,'state');external(input,Uint8Array,'input');
      requireValue(state.length===8,'State requires eight u32 words');
      requireValue(input.length%64===0&&input.length<=LIMITS.compressionBlocksPerCall*64,'Copy compression requires at most 1024 complete blocks');
      words.set(state,layout.state/4);bytes.set(input,layout.input);
      api.compressResident(layout.state,layout.input,input.length/64);
      return words.slice(layout.state/4,layout.state/4+8);
    },
    hashResident(inputOffset,length,outputOffset){
      u32(length,'length');requireValue(length<=LIMITS.hashBytes,'Hash service budget exceeded');
      range(inputOffset,length,'input');range(outputOffset,32,'output');disjoint(inputOffset,length,outputOffset,32);
      checkStatus(raw.ref_sha256_hash(inputOffset,length,outputOffset));
    },
    hashCopied(input){
      external(input,Uint8Array,'input');requireValue(input.length<=LIMITS.hashBytes,'Hash service budget exceeded');
      bytes.set(input,layout.input);api.hashResident(layout.input,input.length,layout.digest);
      return bytes.slice(layout.digest,layout.digest+32);
    },
    initContext(offset){checkContext(offset);raw.ref_sha256_init(offset);},
    updateContext(offset,inputOffset,length){
      checkContext(offset);u32(length,'length');requireValue(length<=LIMITS.hashBytes,'Update service budget exceeded');
      range(inputOffset,length,'input');disjoint(offset,contextBytes,inputOffset,length);
      checkStatus(raw.ref_sha256_update(offset,inputOffset,length));
    },
    finalContext(offset,outputOffset){
      checkContext(offset);range(outputOffset,32,'output');disjoint(offset,contextBytes,outputOffset,32);
      checkStatus(raw.ref_sha256_final(offset,outputOffset));
    }
  };
  return api;
}
