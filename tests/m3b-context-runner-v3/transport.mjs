// Browser byte transport: copied bytes, bounded queue, ordered acknowledgments.
import {limits} from './config.mjs';
const defaultHash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const encode=bytes=>{const pieces=[];for(let i=0;i<bytes.length;i+=8192)pieces.push(String.fromCharCode(...bytes.subarray(i,i+8192)));return btoa(pieces.join(''));};
export class BytePipe{
 constructor({send,onFailure=()=>{},hash=defaultHash,clock=()=>performance.now()}){
  this.send=send;this.onFailure=onFailure;this.hash=hash;this.seq=0;this.pending=0;this.error=null;this.chain=Promise.resolve();
  this.clock=clock;this.peakPending=0;this.windowPeakPending=0;this.ackChunks=0;this.ackBytes=0;this.lastAckMs=0;this.maxAckMs=0;this.maxEnqueueToAckMs=0;this.lastDrainMs=0;this.maxDrainMs=0;this.drains=0;
  this.streams=Object.fromEntries(['trace','serial','stderr'].map(name=>[name,{seen:0,queued:0,used:0,buffer:new Uint8Array(limits.chunk)}]));
 }
 push(name,bytes,position){
  const s=this.streams[name];if(this.error)throw this.error;
  if(!s||!(bytes instanceof Uint8Array)||!Number.isSafeInteger(position)||position!==s.seen||s.seen+bytes.length>limits[name])throw Error('Stream position/byte bound: '+name);
  s.seen+=bytes.length;let at=0;
  while(at<bytes.length){const n=Math.min(bytes.length-at,limits.chunk-s.used);s.buffer.set(bytes.subarray(at,at+n),s.used);s.used+=n;at+=n;if(s.used===limits.chunk)this.flushOne(name);}
 }
 flushOne(name){
  const s=this.streams[name];if(!s.used)return;
  if(this.pending+s.used>limits.pending)throw Error('Unacknowledged byte bound '+JSON.stringify({pending:this.pending,chunk:s.used,limit:limits.pending,...this.telemetry()}));
  const bytes=s.buffer.slice(0,s.used),offset=s.queued,seq=this.seq++,queuedAt=this.clock();s.queued+=s.used;s.used=0;this.pending+=bytes.length;
  this.peakPending=Math.max(this.peakPending,this.pending);this.windowPeakPending=Math.max(this.windowPeakPending,this.pending);
  const task=this.chain.then(async()=>{
   if(this.error)throw this.error;
   const row={schema:2,seq,stream:name,offset,bytes:bytes.length,base64:encode(bytes),sha256:await this.hash(bytes)},started=this.clock();
   const result=await this.send(row);if(result?.accepted!==true||result.seq!==seq)throw Error('Durable chunk acknowledgment rejected');
   const now=this.clock();this.ackChunks++;this.ackBytes+=bytes.length;this.lastAckMs=now;this.maxAckMs=Math.max(this.maxAckMs,now-started);this.maxEnqueueToAckMs=Math.max(this.maxEnqueueToAckMs,now-queuedAt);
  });
  this.chain=task.catch(e=>{this.error??=e;this.onFailure(e);}).finally(()=>{this.pending-=bytes.length;});
 }
 flush(){for(const name of Object.keys(this.streams))this.flushOne(name);}
 async drain(){const started=this.clock();for(;;){this.flush();const pending=this.chain;await pending;if(this.error)throw this.error;if(pending===this.chain&&Object.values(this.streams).every(s=>s.used===0)){this.drains++;this.lastDrainMs=this.clock()-started;this.maxDrainMs=Math.max(this.maxDrainMs,this.lastDrainMs);const result=this.snapshot();this.windowPeakPending=this.pending;return result;}}}
 telemetry(){return {producedBytes:Object.values(this.streams).reduce((n,s)=>n+s.seen,0),queuedBytes:Object.values(this.streams).reduce((n,s)=>n+s.queued,0),acknowledgedBytes:this.ackBytes,acknowledgedChunks:this.ackChunks,pendingBytes:this.pending,peakPendingBytes:this.peakPending,windowPeakPendingBytes:this.windowPeakPending,sampledAtMs:this.clock(),lastAckMs:this.lastAckMs,maxAckMs:this.maxAckMs,maxEnqueueToAckMs:this.maxEnqueueToAckMs,drains:this.drains,lastDrainMs:this.lastDrainMs,maxDrainMs:this.maxDrainMs};}
 snapshot(){return {chunks:this.seq,streams:Object.fromEntries(Object.entries(this.streams).map(([k,v])=>[k,{seen:v.seen,queued:v.queued}])),queue:this.telemetry()};}
}
export async function recordObservation(pipe,send,row){
 row.streams=await pipe.drain();const result=await send(row);
 if(result?.accepted!==true)throw Error(result?.failure??'Host forensic oracle refused observation');
}
