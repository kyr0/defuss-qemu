import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {StoppedWindows,maxWindowBytes} from './windows.mjs';
import {runtimeArguments,traceSpec,argumentsFor} from './config.mjs';
const row=(event,end,extra={})=>({event,streams:{streams:{trace:{seen:end}}},...extra});
test('stopped windows skip only boot and enforce exact ACK boundaries and fixed bound',async()=>{
 const reads=[],saved=[],w=new StoppedWindows({readRange:async(a,b)=>{reads.push([a,b]);return new Uint8Array();},publish:async r=>saved.push(r)});
 await w.accept(row('startup',0));await w.accept(row('gate',123,{gate:{seq:0},status:{running:false,status:'paused'},captureErrors:[],layout:{programs:[]}}));assert.equal(reads.length,0);assert.equal(saved[0].status,'boot-prefix-not-analyzed');
 await assert.rejects(()=>w.accept(row('configured',124,{seq:0})),/No trace execution/);await w.accept(row('configured',123,{seq:0}));await w.accept(row('ack',123,{seq:0}));
 await assert.rejects(()=>w.accept(row('gate',124+maxWindowBytes,{gate:{seq:1},status:{running:false,status:'paused'},captureErrors:[]})),/fixed128MiB/);
 await w.accept(row('gate',123,{gate:{seq:1},status:{running:false,status:'paused'},captureErrors:[]}));assert.deepEqual(reads,[[123,123]]);assert.equal(saved[1].acceptance,false);assert.equal(saved[1].outerEntries,0);
});
test('reported and Emscripten argument arrays have independent ownership',()=>{
 const layout=Array.from({length:11},(_,i)=>({name:'p'+i,a:'0x'+(0x401000+i*4096).toString(16),end:'0x'+(0x401014+i*4096).toString(16)})),spec=traceSpec(layout),copies=runtimeArguments(spec);
 copies.factory.unshift('./this.program');assert.deepEqual(copies.report,argumentsFor(spec));assert.equal(copies.factory.length,copies.report.length+1);assert.notEqual(copies.report,copies.factory);
});


test('v3 context parser preserves every frozen ABI2 rule except the128MiB byte bound',async()=>{
 const original=await readFile(new URL('../m3b-context-accounting-v2/contract.mjs',import.meta.url),'utf8');
 const current=await readFile(new URL('./windows.mjs',import.meta.url),'utf8');
 const section=(source,start,end)=>{const a=source.indexOf(start);assert.ok(a>=0);const b=source.indexOf(end,a);assert.ok(b>a);return source.slice(a,b);};
 assert.equal(section(current,'function segment(','\n\nexport function parseContextTrace('),section(original,'function segment(','\n\n// Native ABI2'));
 const before=section(original,'export function parseContextTrace(','\n\nfunction snapshot(');
 assert.equal((before.match(/bytes\.byteLength<=64\*1024\*1024/g)??[]).length,1);
 assert.equal(section(current,'export function parseContextTrace(','\n\nexport class StoppedWindows{'),before.replace('bytes.byteLength<=64*1024*1024','bytes.byteLength<=128*1024*1024'));
 assert.equal(maxWindowBytes,128*1024*1024);
});
