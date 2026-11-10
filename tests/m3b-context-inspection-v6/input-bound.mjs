import assert from 'node:assert/strict';

export const metadataLimit=128*1024*1024, historicalTraceLimit=512*1024*1024;
// This is an allocation preflight only. The caller must still read and verify
// the entire file against its supplied identity before using it.
export function assertInputBound(path,id,size,max=metadataLimit){
 assert.ok(Number.isSafeInteger(size)&&size>=0);
 assert.ok(Number.isSafeInteger(max)&&max>=0);
 if(size<=max)return;
 assert.equal(max,metadataLimit,'Input byte bound');
 assert.match(path,/^artifacts\/[A-Za-z0-9][A-Za-z0-9_-]*\/native-trace\.log$/,'Historical trace path');
 assert.ok(id&&typeof id.sha256==='string'&&/^[a-f0-9]{64}$/.test(id.sha256),'Historical trace SHA required');
 assert.equal(id.bytes,size,'Historical trace exact bytes required');
 assert.ok(size<=historicalTraceLimit,'Historical trace byte bound');
}
