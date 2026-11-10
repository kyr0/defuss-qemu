import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {limits} from './config.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export class ChunkLedger{
 constructor({writeBytes,writeMetadata}){this.writeBytes=writeBytes;this.writeMetadata=writeMetadata;this.count=0;this.totals={trace:0,serial:0,stderr:0};this.prefixes=[{...this.totals}];this.hashes=Object.fromEntries(Object.keys(this.totals).map(k=>[k,createHash('sha256')]));}
 async accept(row){
  assert.deepEqual(Object.keys(row).sort(),['schema','seq','stream','offset','bytes','sha256'].sort());assert.equal(row.schema,1);assert.equal(row.seq,this.count);assert.ok(this.count<100000);
  assert.ok(Object.hasOwn(this.totals,row.stream));assert.equal(row.offset,this.totals[row.stream]);assert.ok(Array.isArray(row.bytes)&&row.bytes.length>0&&row.bytes.length<=limits.chunk&&row.bytes.every(n=>Number.isInteger(n)&&n>=0&&n<=255));
  const bytes=Buffer.from(row.bytes);assert.equal(sha(bytes),row.sha256);assert.ok(row.offset+bytes.length<=limits[row.stream]);
  // Callback contracts require both file writes to be fsynced before return.
  await this.writeBytes(row.stream,bytes,row.offset);await this.writeMetadata({schema:1,seq:row.seq,stream:row.stream,offset:row.offset,bytes:bytes.length,sha256:row.sha256});
  this.hashes[row.stream].update(bytes);this.totals[row.stream]+=bytes.length;this.count++;this.prefixes.push({...this.totals});return {accepted:true,seq:row.seq};
 }
 verifyPrefix(snapshot){
  assert.ok(snapshot&&Number.isInteger(snapshot.chunks)&&snapshot.chunks>=0&&snapshot.chunks<=this.count);assert.deepEqual(Object.keys(snapshot.streams).sort(),Object.keys(this.totals).sort());
  const prefix=this.prefixes[snapshot.chunks];for(const [name,total]of Object.entries(prefix))assert.deepEqual(snapshot.streams[name],{seen:total,queued:total});return prefix;
 }
 summary(){return {chunks:this.count,files:Object.fromEntries(Object.keys(this.totals).map(name=>[name,{bytes:this.totals[name],sha256:this.hashes[name].copy().digest('hex')}]))};}
}
