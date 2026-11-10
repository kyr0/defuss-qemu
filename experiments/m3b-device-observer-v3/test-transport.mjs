import test from 'node:test';
import assert from 'node:assert/strict';
import {Qmp} from '../../host/browser/qmp.mjs';
import {acceptQmpChunk,decodeSerialBytes} from './transport.mjs';

class BrowserDecoder extends TextDecoder {
 decode(bytes,options){
  // Node may accept shared views that Chrome rejects. Enforce the browser's
  // actual ownership restriction while using the real streaming decoder.
  assert.ok(bytes.buffer instanceof ArrayBuffer,'Decoder received shared memory');
  return super.decode(bytes,options);
 }
}
function shared(text){
 const bytes=new TextEncoder().encode(text),heap=new Uint8Array(new SharedArrayBuffer(bytes.length+11));
 heap.fill(88);heap.set(bytes,5);return {heap,offset:5,count:bytes.length,bytes};
}
test('shared QMP chunks preserve offset and split UTF8 for raw log and actual parser',async()=>{
 const text=JSON.stringify({QMP:{marker:'€-transport'}})+'\n';
 const {heap,offset,count,bytes}=shared(text),qmp=new Qmp(),decoder=new BrowserDecoder();
 const split=bytes.indexOf(0xe2)+1;let raw='';
 for(const [start,end] of [[0,split],[split,split+1],[split+1,count]])
  acceptQmpChunk(decoder,qmp,heap,offset+start,end-start,t=>{raw+=t;});
 assert.equal(raw,text);assert.deepEqual(await qmp.greeting,{QMP:{marker:'€-transport'}});
 assert.equal(qmp.tail,'');assert.equal(heap[0],88);
});
test('raw-log callback cannot mutate the copied QMP message through original heap',async()=>{
 const text=JSON.stringify({QMP:{marker:'before-mutation'}})+'\n',s=shared(text),qmp=new Qmp();let raw='';
 acceptQmpChunk(new BrowserDecoder(),qmp,s.heap,s.offset,s.count,t=>{raw+=t;s.heap.fill(0);});
 assert.equal(raw,text);assert.deepEqual(await qmp.greeting,{QMP:{marker:'before-mutation'}});
});
test('raw bytes remain appended before a QMP JSON parse failure',()=>{
 const s=shared('{broken-json}\n'),qmp=new Qmp();let raw='';
 assert.throws(()=>acceptQmpChunk(new BrowserDecoder(),qmp,s.heap,s.offset,s.count,t=>{raw+=t;}),SyntaxError);
 assert.equal(raw,'{broken-json}\n');
});
test('serial decoding copies exact shared subview including empty file',()=>{
 const s=shared('serial €');
 assert.equal(decodeSerialBytes(s.heap.subarray(s.offset,s.offset+s.count),new BrowserDecoder()),'serial €');
 assert.equal(decodeSerialBytes(s.heap.subarray(5,5),new BrowserDecoder()),'');
});
