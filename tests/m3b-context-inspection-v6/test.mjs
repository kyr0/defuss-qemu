import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertInputBound,metadataLimit,historicalTraceLimit} from './input-bound.mjs';
const path='artifacts/m3b-context-v2-off-01/native-trace.log',size=139507934,id={sha256:'a'.repeat(64),bytes:size};
test('ordinary metadata retains exact default and explicit bounds',()=>{
 assertInputBound('metadata.json',undefined,metadataLimit);
 assertInputBound('metadata.json',undefined,16,16);
 assert.throws(()=>assertInputBound('metadata.json',id,size));
 assert.throws(()=>assertInputBound(path,id,size,16*1024*1024));
});
test('only canonical identity-bound historical trace can exceed metadata bound',()=>{
 assertInputBound(path,id,size);
 assertInputBound(path,{...id,bytes:historicalTraceLimit},historicalTraceLimit);
 for(const bad of [undefined,{}, {...id,bytes:size-1},{...id,sha256:'A'.repeat(64)},{...id,sha256:''}])assert.throws(()=>assertInputBound(path,bad,size));
 for(const p of ['native-trace.log','tmp/x/native-trace.log','artifacts/../native-trace.log','artifacts/x/other.log','/artifacts/x/native-trace.log','artifacts/x/../x/native-trace.log','artifacts/x/y/native-trace.log'])assert.throws(()=>assertInputBound(p,id,size));
 assert.throws(()=>assertInputBound(path,{...id,bytes:historicalTraceLimit+1},historicalTraceLimit+1));
 for(const n of [-1,NaN,Infinity,1.2])assert.throws(()=>assertInputBound(path,id,n));
});
test('v5 complete replay unchanged except bounded dependency reader and explicit tool provenance',async()=>{
 const original=await readFile(new URL('../m3b-context-runner-v5/inspect.mjs',import.meta.url),'utf8');
 let candidate=await readFile(new URL('./inspect.mjs',import.meta.url),'utf8');
 candidate=candidate.replace("import {assertInputBound} from './input-bound.mjs';\n",'');
 candidate=candidate.replaceAll("from '../m3b-context-runner-v5/","from './");
 candidate=candidate.replace("assertInputBound(path,id,(await stat(p)).size,max);","assert.ok((await stat(p)).size<=max,'Input byte bound');");
 const begin=candidate.indexOf("  const toolManifestPath="),end=candidate.indexOf('  const report=JSON.parse',begin);
 assert.ok(begin>0&&end>begin);candidate=candidate.slice(0,begin)+candidate.slice(end);
 candidate=candidate.replace('const result={schema:1,inspectorTool,kind:','const result={schema:1,kind:');
 assert.equal(candidate,original);
});
