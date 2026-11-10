// Browser byte transport: copied bytes, bounded queue, ordered acknowledgments.
import {limits} from './config.mjs';
const defaultHash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
export class BytePipe{
 constructor({send,onFailure=()=>{},hash=defaultHash}){
  this.send=send;this.onFailure=onFailure;this.hash=hash;this.seq=0;this.pending=0;this.error=null;this.chain=Promise.resolve();
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
  if(this.pending+s.used>limits.pending)throw Error('Unacknowledged byte bound');
  const bytes=s.buffer.slice(0,s.used),offset=s.queued,seq=this.seq++;s.queued+=s.used;s.used=0;this.pending+=bytes.length;
  const task=this.chain.then(async()=>{
   if(this.error)throw this.error;
   const row={schema:1,seq,stream:name,offset,bytes:Array.from(bytes),sha256:await this.hash(bytes)};
   const result=await this.send(row);if(result?.accepted!==true||result.seq!==seq)throw Error('Durable chunk acknowledgment rejected');
  });
  this.chain=task.catch(e=>{this.error??=e;this.onFailure(e);}).finally(()=>{this.pending-=bytes.length;});
 }
 flush(){for(const name of Object.keys(this.streams))this.flushOne(name);}
 async drain(){for(;;){this.flush();const pending=this.chain;await pending;if(this.error)throw this.error;if(pending===this.chain&&Object.values(this.streams).every(s=>s.used===0))return this.snapshot();}}
 snapshot(){return {chunks:this.seq,streams:Object.fromEntries(Object.entries(this.streams).map(([k,v])=>[k,{seen:v.seen,queued:v.queued}]))};}
}
export async function recordObservation(pipe,send,row){
 row.streams=await pipe.drain();const result=await send(row);
 if(result?.accepted!==true)throw Error(result?.failure??'Host forensic oracle refused observation');
}
