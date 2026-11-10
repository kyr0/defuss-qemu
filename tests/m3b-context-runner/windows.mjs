// Read-only host parsing of an already drained, externally paused prefix.
// This supplies observations only; it cannot relax an execution oracle.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseContextTrace} from '../m3b-context-accounting/contract.mjs';
export const maxWindowBytes=64*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export class StoppedWindows{
 constructor({readRange,publish}){this.readRange=readRange;this.publish=publish;this.phase='startup';this.seq=0;this.start=0;this.gateEnd=0;this.layout=null;this.rows=[];}
 async accept(row){
  const end=row.streams.streams.trace.seen;assert.ok(Number.isSafeInteger(end)&&end>=this.start);
  if(row.event==='startup'){assert.equal(this.phase,'startup');this.phase='gate';this.start=end;return null;}
  if(row.event==='gate'){
   assert.equal(this.phase,'gate');assert.equal(row.gate.seq,this.seq);assert.equal(row.status.running,false);assert.equal(row.status.status,'paused');assert.deepEqual(row.captureErrors,[]);
   const start=this.start,bytes=end-start;assert.ok(bytes<=maxWindowBytes,'Stopped trace window exceeds the fixed64MiB bound');
   this.gateEnd=end;this.phase='configured';
   if(this.seq===0){this.layout=row.layout;const summary={schema:1,seq:0,status:'boot-prefix-not-analyzed',start,end,bytes,acceptance:false};await this.publish(summary);this.rows.push(summary);return {summary,parsed:null};}
   const raw=await this.readRange(start,end);assert.ok(raw instanceof Uint8Array&&raw.byteLength===bytes);
   const parsed=parseContextTrace(raw,{offsetBase:start}),summary={schema:1,seq:this.seq,status:'parsed-only',start,end,bytes,sha256:hash(raw),outerEntries:parsed.entries.length,stoppedMessages:parsed.stops.length,acceptance:false};
   // Persist this derived boundary/hash before the original oracle can refuse.
   await this.publish(summary);this.rows.push(summary);return {summary,parsed,layout:this.layout};
  }
  if(row.event==='configured'){assert.equal(this.phase,'configured');assert.equal(row.seq,this.seq);assert.equal(end,this.gateEnd,'No trace execution while paused');this.phase='ack';return null;}
  if(row.event==='ack'){assert.equal(this.phase,'ack');assert.equal(row.seq,this.seq);assert.equal(end,this.gateEnd,'No trace execution before cont');this.start=end;this.seq++;this.phase=this.seq===45?'complete':'gate';return null;}
  assert.equal(row.event,'complete');assert.equal(this.phase,'complete');assert.equal(end,this.start,'Unexpected post-fixture trace');this.phase='done';return null;
 }
}
