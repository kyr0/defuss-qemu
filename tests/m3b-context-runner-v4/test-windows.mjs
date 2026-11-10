import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {StoppedWindows,maxWindowBytes,maxTerminalBytes,parseTerminalTrace,terminalSourceSite} from './windows.mjs';
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


test('v4 context parser preserves every frozen ABI2 rule except the inherited128MiB byte bound',async()=>{
 const original=await readFile(new URL('../m3b-context-accounting-v2/contract.mjs',import.meta.url),'utf8');
 const current=await readFile(new URL('./windows.mjs',import.meta.url),'utf8');
 const section=(source,start,end)=>{const a=source.indexOf(start);assert.ok(a>=0);const b=source.indexOf(end,a);assert.ok(b>a);return source.slice(a,b);};
 assert.equal(section(current,'function segment(','\n\nexport function parseContextTrace('),section(original,'function segment(','\n\n// Native ABI2'));
 const before=section(original,'export function parseContextTrace(','\n\nfunction snapshot(');
 assert.equal((before.match(/bytes\.byteLength<=64\*1024\*1024/g)??[]).length,1);
 assert.equal(section(current,'export function parseContextTrace(','\n\nexport class StoppedWindows{'),before.replace('bytes.byteLength<=64*1024*1024','bytes.byteLength<=128*1024*1024'));
 assert.equal(maxWindowBytes,128*1024*1024);
 const v3=await readFile(new URL('../m3b-context-runner-v3/windows.mjs',import.meta.url),'utf8');
 assert.equal(section(current,' async accept(row){',"  assert.equal(row.event,'complete');"),section(v3,' async accept(row){',"  assert.equal(row.event,'complete');"),'All45 gate-window rules are unchanged');
});

const link='Linking TBs 0x96c1140 index 1 -> 0x9766980\n';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('terminal parser retains an exact linking-only suffix and an empty suffix',()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from(link),Buffer.from(link+'Linking TBs 0x1 index 0 -> 0xffffffffffffffff\n')]){
  const r=parseTerminalTrace(bytes,{offsetBase:123});assert.equal(r.start,123);assert.equal(r.end,123+bytes.length);assert.equal(r.bytes,bytes.length);assert.equal(r.sha256,sha(bytes));assert.equal(r.linkingRecords,bytes.toString().split('\n').length-1);assert.equal(r.executionRecords,0);assert.equal(r.acceptance,false);assert.deepEqual(r.sourceSite,terminalSourceSite);
 }
});
test('terminal parser accepts exactly64KiB and rejects larger or inexact bounds',()=>{
 const short='Linking TBs 0x1 index 0 -> 0x1\n',count=Math.floor(maxTerminalBytes/short.length),extra=maxTerminalBytes-count*short.length;
 const last='Linking TBs 0x1'+'0'.repeat(Math.min(extra,15))+' index 0 -> 0x1'+'0'.repeat(Math.max(0,extra-15))+'\n';
 const exact=Buffer.from(short.repeat(count-1)+last);assert.equal(exact.length,maxTerminalBytes);assert.equal(parseTerminalTrace(exact).linkingRecords,count);
 assert.throws(()=>parseTerminalTrace(Buffer.concat([exact,Buffer.from('\n')])),/fixed64KiB/);
 for(const offsetBase of [-1,0.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>parseTerminalTrace(Buffer.from(link),{offsetBase}));
 assert.throws(()=>parseTerminalTrace(link));
});
test('terminal parser rejects partial, blank, malformed pointer/index and non-ASCII records',()=>{
 const invalid=[link.slice(0,-1),'\n',link+'\n',link.replace('\n','\r\n'),' '+link,link.replace('\n',' \n'),link.replace('index 1','index 2'),link.replace('index 1','index -1'),link.replace('index 1','index 01'),link.replace('0x96c1140','0x0'),link.replace('0x9766980','0x0000'),link.replace('0x96c1140','(nil)'),link.replace('0x96c1140','0x10000000000000000'),link.replace('0x96c1140','0xABC'),link.replace('Linking','Línking'),'\ufeff'+link,link+'\0\n'];
 for(const text of invalid)assert.throws(()=>parseTerminalTrace(Buffer.from(text)),text);
 assert.throws(()=>parseTerminalTrace(Uint8Array.of(0xff,10)));
});
test('terminal parser rejects every execution-record family even among valid links',()=>{
 for(const line of ['Trace 0: 0x1 [0000000000000000/0000000000405000/18c0c2b3/ff020000]','Stopped execution of TB chain before 0x1','RAX=0000000000000000','RIP=0000000000405000 RFL=00000246','IN: ','0x00405000: 83 f9 00 cmpl $0, %ecx','----------------','unknown']){
  for(const text of [line+'\n',link+line+'\n',line+'\n'+link])assert.throws(()=>parseTerminalTrace(Buffer.from(text)),line);
 }
});
test('complete writes a separately bound summary before returning and preserves45 gate summaries',async()=>{
 const raw=Buffer.from(link),gateRows=Array.from({length:45},(_,seq)=>({seq})),nativeSource={path:'artifacts/m3b-context-v2-source-01/source/accel/tcg/cpu-exec.c',sha256:'b'.repeat(64),bytes:12345};
 let release,started;const ready=new Promise(r=>started=r),blocked=new Promise(r=>release=r),saved=[];
 const w=new StoppedWindows({sourceFingerprint:'a'.repeat(64),terminalNativeSource:nativeSource,readRange:async(a,b)=>{assert.equal(a,999);assert.equal(b,999+raw.length);return raw;},publish:()=>assert.fail('Terminal must not use gate publisher'),publishTerminal:async r=>{saved.push(r);started();await blocked;}});
 // Fabricated complete state tests the publication boundary, not45 guest gates.
 Object.assign(w,{phase:'complete',seq:45,start:999,rows:gateRows});const done=w.accept(row('complete',999+raw.length,{status:{running:false,status:'paused'},captureErrors:[]}));await ready;
 assert.equal(w.phase,'complete');assert.equal(w.terminalSummary,null);assert.equal(saved.length,1);release();const result=await done;assert.equal(w.phase,'done');assert.deepEqual(result.terminalSummary,saved[0]);assert.deepEqual(w.rows,gateRows);assert.deepEqual(saved[0].nativeSource,nativeSource);assert.equal(saved[0].runtimeSourceFingerprint,'a'.repeat(64));
 await assert.rejects(()=>w.accept(row('complete',999+raw.length,{status:{running:false,status:'paused'},captureErrors:[]})));
});
test('complete refuses running, partial and oversized tails without publishing or skipping',async()=>{
 for(const [bytes,status]of [[Buffer.from(link),{running:true,status:'running'}],[Buffer.from(link.slice(0,-1)),{running:false,status:'paused'}],[new Uint8Array(maxTerminalBytes+1),{running:false,status:'paused'}]]){
  let reads=0,publishes=0;const w=new StoppedWindows({sourceFingerprint:'a'.repeat(64),terminalNativeSource:{path:'artifacts/m3b-context-v2-source-01/source/accel/tcg/cpu-exec.c',sha256:'b'.repeat(64),bytes:1},readRange:async()=>{reads++;return bytes;},publishTerminal:async()=>publishes++});Object.assign(w,{phase:'complete',seq:45,start:0});
  await assert.rejects(()=>w.accept(row('complete',bytes.length,{status,captureErrors:[]})));assert.equal(publishes,0);assert.equal(w.terminalSummary,null);if(status.running||bytes.length>maxTerminalBytes)assert.equal(reads,0);
 }
});
