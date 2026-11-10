import test from 'node:test';
import assert from 'node:assert/strict';
import {StoppedWindows,maxWindowBytes} from './windows.mjs';
import {runtimeArguments,traceSpec,argumentsFor} from './config.mjs';
const row=(event,end,extra={})=>({event,streams:{streams:{trace:{seen:end}}},...extra});
test('stopped windows skip only boot and enforce exact ACK boundaries and fixed bound',async()=>{
 const reads=[],saved=[],w=new StoppedWindows({readRange:async(a,b)=>{reads.push([a,b]);return new Uint8Array();},publish:async r=>saved.push(r)});
 await w.accept(row('startup',0));await w.accept(row('gate',123,{gate:{seq:0},status:{running:false,status:'paused'},captureErrors:[],layout:{programs:[]}}));assert.equal(reads.length,0);assert.equal(saved[0].status,'boot-prefix-not-analyzed');
 await assert.rejects(()=>w.accept(row('configured',124,{seq:0})),/No trace execution/);await w.accept(row('configured',123,{seq:0}));await w.accept(row('ack',123,{seq:0}));
 await assert.rejects(()=>w.accept(row('gate',124+maxWindowBytes,{gate:{seq:1},status:{running:false,status:'paused'},captureErrors:[]})),/fixed64MiB/);
 await w.accept(row('gate',123,{gate:{seq:1},status:{running:false,status:'paused'},captureErrors:[]}));assert.deepEqual(reads,[[123,123]]);assert.equal(saved[1].acceptance,false);assert.equal(saved[1].outerEntries,0);
});
test('reported and Emscripten argument arrays have independent ownership',()=>{
 const layout=Array.from({length:11},(_,i)=>({name:'p'+i,a:'0x'+(0x401000+i*4096).toString(16),end:'0x'+(0x401014+i*4096).toString(16)})),spec=traceSpec(layout),copies=runtimeArguments(spec);
 copies.factory.unshift('./this.program');assert.deepEqual(copies.report,argumentsFor(spec));assert.equal(copies.factory.length,copies.report.length+1);assert.notEqual(copies.report,copies.factory);
});
