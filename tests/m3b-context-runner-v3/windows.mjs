// Read-only host parsing of an already drained, externally paused prefix.
// This supplies observations only; it cannot relax an execution oracle.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseTrace} from './trace.mjs';
export const maxWindowBytes=128*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// The following two functions are exact copies of the frozen ABI2 context
// parser, except its stopped byte guard is128MiB. Source-equivalence is tested;
// no line, frame, context or acceptance rule is removed or split.
function segment(line,prefix){
 const m=new RegExp('^'+prefix+'([0-9a-f]{4}) ([0-9a-f]{16}) ([0-9a-f]{8}) ([0-9a-f]{8})(.*)$').exec(line);assert.ok(m,'Complete raw segment row '+prefix);
 const flags=Number.parseInt(m[4],16);assert.equal((flags&0x00ffff00)>>>0,flags,'Printed descriptor flags mask');let suffix='';
 if(flags&0x8000){
  suffix=' DPL='+((flags>>13)&3)+' ';
  if(flags&0x1000){
   if(flags&0x800)suffix+=(flags&0x200000?'CS64':flags&0x400000?'CS32':'CS16')+' ['+(flags&0x400?'C':'-')+(flags&0x200?'R':'-');
   else suffix+='DS   ['+(flags&0x400?'E':'-')+(flags&0x200?'W':'-');
   suffix+=(flags&0x100?'A':'-')+']';
  }else suffix+=['<hiword>','Reserved','LDT','Reserved','Reserved','Reserved','Reserved','Reserved','Reserved','TSS64-avl','Reserved','TSS64-busy','CallGate64','Reserved','IntGate64','TrapGate64'][(flags>>8)&15];
 }
 assert.equal(m[5],suffix,'Descriptor display must match its exact numeric flags');return {selector:m[1],base:m[2],limit:m[3],flags:m[4]};
}

export function parseContextTrace(bytes,{offsetBase=0}={}){
 assert.ok(bytes instanceof Uint8Array&&bytes.byteLength<=128*1024*1024,'Bounded stopped trace window required');
 const parsed=parseTrace(bytes,{offsetBase}),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 for(const entry of parsed.entries){
  const frame=text.slice(entry.start-offsetBase,entry.end-offsetBase),lines=frame.split('\n');
  const control=lines.filter(x=>x.startsWith('CR0='));assert.equal(control.length,1);
  const m=/^CR0=([0-9a-f]{8}) CR2=([0-9a-f]{16}) CR3=([0-9a-f]{16}) CR4=([0-9a-f]{8})$/.exec(control[0]);assert.ok(m,'Complete raw control register row required');
  const prefixes=['ES =','CS =','SS =','DS =','FS =','GS =','LDT=','TR =','GDT=','IDT=','DR0=','DR6='];
  const segmentsDebug=prefixes.map(prefix=>{const found=lines.filter(x=>x.startsWith(prefix));assert.equal(found.length,1,'Exact raw context line '+prefix);return found[0];});
  const segments=Object.fromEntries(prefixes.slice(0,8).map((prefix,i)=>[prefix.slice(0,-1).trim(),segment(segmentsDebug[i],prefix)]));
  const tables={};for(const [i,name]of [[8,'GDT'],[9,'IDT']]){const row=new RegExp('^'+name+'=     ([0-9a-f]{16}) ([0-9a-f]{8})$').exec(segmentsDebug[i]);assert.ok(row,'Complete descriptor table row');tables[name]={base:row[1],limit:row[2]};}
  const dr03=/^DR0=([0-9a-f]{16}) DR1=([0-9a-f]{16}) DR2=([0-9a-f]{16}) DR3=([0-9a-f]{16}) $/.exec(segmentsDebug[10]);
  const dr67=/^DR6=([0-9a-f]{16}) DR7=([0-9a-f]{16})$/.exec(segmentsDebug[11]);assert.ok(dr03&&dr67,'Complete debug register rows');
  const debug=Object.fromEntries([0,1,2,3].map((n,i)=>['DR'+n,dr03[i+1]]));debug.DR6=dr67[1];debug.DR7=dr67[2];
  entry.fullContext={cr0:m[1],cr2:m[2],cr3:m[3],cr4:m[4],segments,tables,debug,segmentsDebug};
 }
 return {...parsed,contextSchema:1};
}

export class StoppedWindows{
 constructor({readRange,publish}){this.readRange=readRange;this.publish=publish;this.phase='startup';this.seq=0;this.start=0;this.gateEnd=0;this.layout=null;this.rows=[];}
 async accept(row){
  const end=row.streams.streams.trace.seen;assert.ok(Number.isSafeInteger(end)&&end>=this.start);
  if(row.event==='startup'){assert.equal(this.phase,'startup');this.phase='gate';this.start=end;return null;}
  if(row.event==='gate'){
   assert.equal(this.phase,'gate');assert.equal(row.gate.seq,this.seq);assert.equal(row.status.running,false);assert.equal(row.status.status,'paused');assert.deepEqual(row.captureErrors,[]);
   const start=this.start,bytes=end-start;assert.ok(bytes<=maxWindowBytes,'Stopped trace window exceeds the fixed128MiB bound');
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
