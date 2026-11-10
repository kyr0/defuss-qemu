import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Protocol,protocol,parameters,orders,warmupOrders,balancedOrders,expected,gatePlan} from './protocol.mjs';
import {SnapshotUpload,SNAPSHOT_CHUNK_BYTES} from '../m1/snapshot-upload.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
const identity={protocol,bun:'1.4.4',revision:'38afee6c84fcf48c0edb2466aa4b27d287a59c30',arch:'x64',pid:1,
  nonce:'00000000-0000-0000-0000-000000000000',heap:true,file:true,heapLength:4096,heapChecksum:17,ordinal:1,mode:'cold'};
const prepared={...identity,event:'snapshot-prepared',ordinal:0,parameters,orders,warmupOrders};
const resumed={...identity,event:'resumed',parameters,orders,warmupOrders};
const maps='00400000-00500000 r-xp 00000000 00:01 1 /usr/local/bin/bun\n';
const gates=()=>gatePlan().map((gate,index)=>({...identity,...gate,seq:index+1,
  ...(['initialized','maps'].includes(gate.event)?{maps,mapsBytes:Buffer.byteLength(maps),mapsSha256:sha(maps)}:{}),
  ...(['result','warmup-result'].includes(gate.event)?{value:expected[gate.name],guestMs:1}:{}),
  ...(gate.event==='gate-result'?{guestMs:0}:{}),
  ...(['warmup-complete','complete'].includes(gate.event)?{values:expected}:{})}));
const start=()=>{const p=new Protocol('capture');p.accept(prepared);p.accept(resumed);return p;};
test('fixed operation answers equal the canonical unchanged-workload answers',async()=>{
  assert.deepEqual(expected,JSON.parse(await readFile(new URL('../../expected.json',import.meta.url),'utf8')));
  assert.equal(gatePlan().filter(e=>e.event==='result').length,32);
  assert.equal(gatePlan().filter(e=>e.event==='warmup-result').length,20);
  assert.equal(parameters.warmupCallsPerEndpoint,500);assert.equal(parameters.warmupRounds,5);assert.equal(parameters.batchRepetitions,100);
});
test('complete ordered protocol verifies 148 gates including maps outside batches',()=>{
  const p=start();for(const gate of gates())assert.equal(p.accept(gate),'gate');assert.equal(p.finish(),true);
  assert.equal(p.next,148);
});
test('missing, repeated, reordered and unexpected gates fail closed',()=>{
  const list=gates();for(const index of [0,1,44,68]){
    const p=start();for(const event of list.slice(0,index))p.accept(event);
    assert.throws(()=>p.accept({...list[index],seq:list[index].seq+1}),/sequence/);
  }
  assert.throws(()=>start().finish(),/Missing/);
  const p=start();p.accept(list[0]);assert.throws(()=>p.accept(list[0]),/sequence/);
});
test('wrong workload answer and guest identity are rejected before ACK',()=>{
  const p=start(),list=gates(),index=list.findIndex(e=>e.event==='result');
  for(const event of list.slice(0,index))p.accept(event);
  assert.throws(()=>p.accept({...list[index],value:'wrong'}),/Incorrect/);
  assert.throws(()=>p.accept({...list[index],arch:'arm64'}),/identity/);
  assert.throws(()=>p.accept({...list[index],nonce:'10000000-0000-0000-0000-000000000000'}),/sequence/);
});
test('restored continuation requires captured nonce/checksum and restored mode',()=>{
  const p=new Protocol('restore',prepared);
  assert.throws(()=>p.accept(resumed),/continuation/);
  assert.throws(()=>p.accept({...resumed,mode:'restored',heapChecksum:18}),/continuation/);
  assert.equal(p.accept({...resumed,mode:'restored'}),'resumed');
  assert.throws(()=>p.accept({...resumed,mode:'restored'}),/continuation/);
});
test('configuration and bounded mapping records are mandatory',()=>{
  const p=new Protocol('capture');assert.throws(()=>p.accept({...prepared,parameters:{...parameters,warmupCallsPerEndpoint:0}}),/parameters/);
  assert.throws(()=>start().accept({...gates()[0],mapsBytes:1}),/maps/);
  assert.throws(()=>start().accept({...gates()[0],maps:'x'.repeat(2097153)}),/maps/);
});
test('snapshot upload rejects reordered chunks, corruption and duplicate commits',()=>{
  const bytes=Buffer.alloc(SNAPSHOT_CHUNK_BYTES+7,3),digest=sha(bytes),upload=new SnapshotUpload();
  upload.append(0,bytes.length,digest,bytes.subarray(0,SNAPSHOT_CHUNK_BYTES));
  assert.throws(()=>upload.finish(),/Incomplete/);
  const valid=new SnapshotUpload();valid.append(0,bytes.length,digest,bytes.subarray(0,SNAPSHOT_CHUNK_BYTES));
  valid.append(SNAPSHOT_CHUNK_BYTES,bytes.length,digest,bytes.subarray(SNAPSHOT_CHUNK_BYTES));
  assert.deepEqual(valid.finish(),bytes);assert.throws(()=>valid.finish(),/committed/);
  assert.throws(()=>new SnapshotUpload().append(1,1,sha('x'),Buffer.from('x')),/ordering/);
  const corrupt=new SnapshotUpload();corrupt.append(0,1,sha('x'),Buffer.from('y'));assert.throws(()=>corrupt.finish(),/checksum/);
});

test('balanced four orders cover each position and directed adjacent pair exactly once',()=>{
 for(const name of ['integer','json','sha256','http'])assert.deepEqual(balancedOrders.map(row=>row.indexOf(name)).sort(),[0,1,2,3]);
 const edges=balancedOrders.flatMap(row=>row.slice(1).map((x,i)=>row[i]+'>'+x));assert.equal(new Set(edges).size,12);
 assert.deepEqual(orders.slice(0,4),orders.slice(4));
});
