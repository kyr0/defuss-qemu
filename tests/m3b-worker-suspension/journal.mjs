import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {limits} from './config.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export class ChunkLedger{
 constructor({writeBytes,writeMetadata}){this.writeBytes=writeBytes;this.writeMetadata=writeMetadata;this.count=0;this.totals={trace:0,serial:0,stderr:0};this.prefixes=[{...this.totals}];this.hashes=Object.fromEntries(Object.keys(this.totals).map(k=>[k,createHash('sha256')]));}
 async accept(row){
  assert.deepEqual(Object.keys(row).sort(),['schema','seq','stream','offset','bytes','base64','sha256'].sort());assert.equal(row.schema,2);assert.equal(row.seq,this.count);assert.ok(this.count<100000);
  assert.ok(Object.hasOwn(this.totals,row.stream));assert.equal(row.offset,this.totals[row.stream]);assert.ok(Number.isInteger(row.bytes)&&row.bytes>0&&row.bytes<=limits.chunk);assert.equal(typeof row.base64,'string');assert.ok(row.base64.length<=4*Math.ceil(limits.chunk/3));
  const bytes=Buffer.from(row.base64,'base64');assert.equal(bytes.length,row.bytes);assert.equal(bytes.toString('base64'),row.base64);assert.equal(sha(bytes),row.sha256);assert.ok(row.offset+bytes.length<=limits[row.stream]);
  // Callback contracts require both file writes to be fsynced before return.
  await this.writeBytes(row.stream,bytes,row.offset);await this.writeMetadata({schema:1,seq:row.seq,stream:row.stream,offset:row.offset,bytes:bytes.length,sha256:row.sha256});
  this.hashes[row.stream].update(bytes);this.totals[row.stream]+=bytes.length;this.count++;this.prefixes.push({...this.totals});return {accepted:true,seq:row.seq};
 }
 verifyPrefix(snapshot){
  assert.ok(snapshot&&Number.isInteger(snapshot.chunks)&&snapshot.chunks>=0&&snapshot.chunks<=this.count);assert.deepEqual(Object.keys(snapshot.streams).sort(),Object.keys(this.totals).sort());
  const prefix=this.prefixes[snapshot.chunks];for(const [name,total]of Object.entries(prefix))assert.deepEqual(snapshot.streams[name],{seen:total,queued:total});validateQueue(snapshot,prefix);return prefix;
 }
 summary(){return {chunks:this.count,files:Object.fromEntries(Object.keys(this.totals).map(name=>[name,{bytes:this.totals[name],sha256:this.hashes[name].copy().digest('hex')}]))};}
}
export function validateQueue(snapshot,prefix){
 const q=snapshot.queue,total=Object.values(prefix).reduce((a,b)=>a+b,0);assert.ok(q);assert.deepEqual(Object.keys(q).sort(),['producedBytes','queuedBytes','acknowledgedBytes','acknowledgedChunks','pendingBytes','peakPendingBytes','windowPeakPendingBytes','sampledAtMs','lastAckMs','maxAckMs','maxEnqueueToAckMs','drains','lastDrainMs','maxDrainMs'].sort());
 for(const k of ['producedBytes','queuedBytes','acknowledgedBytes','acknowledgedChunks','pendingBytes','peakPendingBytes','windowPeakPendingBytes','drains'])assert.ok(Number.isSafeInteger(q[k])&&q[k]>=0,k);
 for(const k of ['sampledAtMs','lastAckMs','maxAckMs','maxEnqueueToAckMs','lastDrainMs','maxDrainMs'])assert.ok(typeof q[k]==='number'&&Number.isFinite(q[k])&&q[k]>=0,k);
 for(const k of ['producedBytes','queuedBytes','acknowledgedBytes'])assert.equal(q[k],total);
 assert.equal(q.pendingBytes,0);assert.equal(q.acknowledgedChunks,snapshot.chunks);assert.ok(q.windowPeakPendingBytes<=q.peakPendingBytes&&q.peakPendingBytes<=limits.pending);assert.ok(q.drains>0);assert.ok(q.lastDrainMs<=q.maxDrainMs);assert.ok(q.lastAckMs<=q.sampledAtMs);assert.ok(q.maxAckMs<=q.maxEnqueueToAckMs);
}
