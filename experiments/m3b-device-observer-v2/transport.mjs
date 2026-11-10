// Emscripten TTY writes may expose shared Wasm memory. TextDecoder requires
// an owned ArrayBufferView in the browser. Copy once before both consumers.
export function acceptQmpChunk(decoder,qmp,buffer,offset,count,appendRaw){
 const bytes=new Uint8Array(buffer.subarray(offset,offset+count));
 appendRaw(decoder.decode(bytes,{stream:true}));
 qmp.accept(bytes);
}

// FS.readFile normally copies too; make the final serial read's decoder input
// ownership explicit without changing the required empty-serial check.
export function decodeSerialBytes(bytes,decoder=new TextDecoder()){
 return decoder.decode(new Uint8Array(bytes));
}
