// Standalone Bun fixture: new payloads and streaming partitions, no timed claims.
import {createHash} from 'node:crypto';
import {snapshotReady} from '/snapshot-ready.mjs';

const lengths=[0,1,7,31,55,56,63,64,65,119,120,127,128,129,255,256,1023,1024,4095,4096,65535,65536,65537,1048576];
const chunks=[1,3,7,31,64,127,4093];
const mode=snapshotReady(),results=[];
for(let round=0;round<8;round++)for(let index=0;index<lengths.length;index++){
  const length=lengths[index],seed=(0x9e3779b9^Math.imul(round+1,65537)^Math.imul(index+1,1664525))>>>0;
  let state=seed;const offset=(index+round)%17,storage=Buffer.alloc(length+32,0xa5),bytes=storage.subarray(offset,offset+length);
  for(let i=0;i<length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;bytes[i]=state&255;}
  const before=Buffer.from(storage);
  const direct=createHash('sha256').update(bytes).digest('hex');
  const stream=createHash('sha256');let position=0,chunk=0;
  while(position<length){const end=Math.min(length,position+chunks[chunk++%chunks.length]);stream.update(bytes.subarray(position,end));position=end;}
  stream.update(Buffer.alloc(0));
  const streamed=stream.digest('hex'),inputUnchanged=storage.equals(before);
  if(!inputUnchanged)throw Error('SHA input or guard bytes changed');
  results.push({round,index,length,seed,offset,direct,streamed,inputUnchanged});
}
console.log('MSG2_HELDOUT:'+JSON.stringify({schema:1,mode,bun:Bun.version,results}));
setInterval(()=>{},1000);
