// Diagnostic-only parser of QEMU's unchanged exec,cpu text log. No VM actions.
// Outer TB-chain entries are not a trace of every internal Wasm/TCI call.
import assert from 'node:assert/strict';

export const maxTraceBytes=512*1024*1024;
const U64=(1n<<64n)-1n,RF=0x10000n,STATUS=0x8d5n;
const registerRows=[['rax','rbx','rcx','rdx'],['rsi','rdi','rbp','rsp'],['r8','r9','r10','r11'],['r12','r13','r14','r15']];
const encodingRegisters=['rax','rcx','rdx','rbx','rsp','rbp','rsi','rdi','r8','r9','r10','r11','r12','r13','r14','r15'];
const hex=n=>'0x'+n.toString(16),word=n=>(n&U64).toString(16).padStart(16,'0');
const canonical=s=>/^0x[0-9a-f]+$/.test(s)&&BigInt(s)>=0x10000n&&BigInt(s)<(1n<<47n);

/** Input is the complete acknowledged trace prefix, never a guessed line tail.
 * Text is ASCII for this pinned guest/QEMU log; offsets are therefore bytes.
 * Unknown ordinary diagnostic lines are retained in the source file, while
 * malformed Trace/Stopped records or partial mandatory CPU dumps fail closed.
 */
export function parseTrace(bytes,{offsetBase=0}={}){
 assert.ok(bytes instanceof Uint8Array,'Trace bytes required');assert.ok(bytes.byteLength<=maxTraceBytes,'Trace byte bound');
 assert.ok(Number.isSafeInteger(offsetBase)&&offsetBase>=0&&offsetBase+bytes.byteLength<=maxTraceBytes,'Original trace offset bound');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);assert.ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(text),'Non-ASCII/control trace byte');assert.ok(!text.length||text.endsWith('\n'),'Incomplete log line');
 const entries=[],stops=[];let current=null;
 const finish=end=>{assert.ok(current,'CPU dump terminator without Trace');assert.equal(current.gprRows,4,'Missing complete sixteen-GPR dump');assert.ok(current.cpu&&current.cc,'Missing CPU RIP/RFLAGS/lazy-CC dump');assert.equal(current.pc,current.cpu.rip,'Trace/CPU PC mismatch');current.end=end;delete current.gprRows;entries.push(current);current=null;};
 for(let offset=0,lineIndex=0;offset<text.length;lineIndex++){
  const newline=text.indexOf('\n',offset),line={text:text.slice(offset,newline).replace(/\r$/,''),start:offsetBase+offset,end:offsetBase+newline+1};offset=newline+1;
  let match;
  if(line.text.startsWith('Trace')){
   assert.equal(current,null,'Incomplete CPU dump before next Trace');
   match=/^Trace ([0-9]+): (0x[0-9a-f]+) \[([0-9a-f]{8,16})\/([0-9a-f]{16})\/([0-9a-f]{8})\/([0-9a-f]{8})\](?: .*)?$/.exec(line.text);
   assert.ok(match,'Malformed exec trace');assert.equal(Number(match[1]),0,'Only pinned CPU0');
   current={index:entries.length,start:line.start,line:lineIndex+1,pointer:hex(BigInt(match[2])),csBase:hex(BigInt('0x'+match[3])),pc:hex(BigInt('0x'+match[4])),flags:Number.parseInt(match[5],16),cflags:Number.parseInt(match[6],16),gpr:{},gprRows:0,cpu:null};
   continue;
  }
  if(line.text.startsWith('Stopped execution of TB chain')){
   match=/^Stopped execution of TB chain before (0x[0-9a-f]+) \[([0-9a-f]{16})\](?: .*)?$/.exec(line.text);assert.ok(match,'Malformed stopped-chain record');
   assert.equal(current,null,'Stopped-chain message inside CPU dump');stops.push({start:line.start,end:line.end,line:lineIndex+1,pointer:hex(BigInt(match[1])),pc:hex(BigInt('0x'+match[2])),precedingEntry:entries.at(-1)?.index??null});continue;
  }
  if(/^(?:RAX|RSI|R8 |R12)=/.test(line.text)){
   assert.ok(current,'CPU GPR dump without Trace');assert.ok(current.gprRows<4&&!current.cpu,'Duplicate/out-of-order GPR dump');
   const found=[...line.text.matchAll(/(R(?:AX|BX|CX|DX|SI|DI|BP|SP|[89]|1[0-5])) ?=([0-9a-f]{16})/g)];
   assert.equal(found.length,4,'Four registers per dump row');assert.deepEqual(found.map(x=>x[1].toLowerCase()),registerRows[current.gprRows],'Exact register order');
   assert.equal(found.map(x=>x[0]).join(' '),line.text,'Unexpected GPR dump text');for(const item of found)current.gpr[item[1].toLowerCase()]=item[2];current.gprRows++;continue;
  }
  if(line.text.startsWith('RIP=')){
   assert.ok(current&&current.gprRows===4&&!current.cpu,'CPU flags order');
   match=/^RIP=([0-9a-f]{16}) RFL=([0-9a-f]{8}) \[([D-][O-][S-][Z-][A-][P-][C-])\] CPL=([0-3]) II=([01]) A20=([01]) SMM=([01]) HLT=([01])$/.exec(line.text);
   assert.ok(match,'Malformed 64-bit CPU flags');current.cpu={rip:hex(BigInt('0x'+match[1])),rflags:Number.parseInt(match[2],16),display:match[3],cpl:Number(match[4]),interruptShadow:Number(match[5]),a20:Number(match[6]),smm:Number(match[7]),halted:Number(match[8])};continue;
  }
  if(line.text.startsWith('CCS=')){
   assert.ok(current?.cpu&&!current.cc,'Lazy-CC dump order');match=/^CCS=([0-9a-f]{16}) CCD=([0-9a-f]{16}) CCO=([A-Z0-9_]+|\[-?[0-9]+\])$/.exec(line.text);assert.ok(match,'Malformed lazy-CC dump');current.cc={src:match[1],dst:match[2],op:match[3]};continue;
  }
  if(line.text.startsWith('EFER=')){
   match=/^EFER=([0-9a-f]{16})$/.exec(line.text);assert.ok(match&&current,'Malformed CPU dump terminator');current.efer=match[1];finish(line.end);continue;
  }
  assert.ok(!/^(?:EAX|EIP)=/.test(line.text),'32-bit CPU dump inside the fixed 64-bit user-work horizon');
 }
 assert.equal(current,null,'Incomplete final CPU dump');
 return {schema:1,baseOffset:offsetBase,bytes:bytes.byteLength,endOffset:offsetBase+bytes.byteLength,entries,stops,scope:'Outer cpu_tb_exec entries and stopped-chain diagnostics only; no descriptor generation or internal-call completion claim. Line numbers are relative to the parsed prefix; byte offsets refer to the original file.'};
}

// Recognize only the existing fixture's register-only A prelude. This is an
// offline oracle, never a runtime admission rule or a benchmark substitution.
// QEMU's ordinary RF path executes this prelude then DISAS_EOB_ONLY: both the
// taken side exit and fallthrough B return to the outer dispatcher.
function prelude(program){
 assert.ok(program&&['a','b','side','end'].every(k=>canonical(program[k])),'Canonical fixture addresses');
 assert.match(program.codeHex,/^(?:[0-9a-f]{2})+$/);assert.ok(program.codeHex.length<=320,'Bounded fixture bytes');
 const a=BigInt(program.a),b=BigInt(program.b),side=BigInt(program.side),end=BigInt(program.end);
 assert.ok(a<b&&b<side&&side<end&&side-a===BigInt(program.codeHex.length/2),'Fixture label/byte extent');
 const code=Uint8Array.from(program.codeHex.match(/../g),s=>Number.parseInt(s,16));const limit=Number(b-a),moves=[];let at=0,count=0,width,counter;
 while(at<limit){
  assert.ok(++count<=32,'A instruction bound');
  if(code[at]===0x90){at++;continue;}
  if([0x48,0x49].includes(code[at])&&code[at+1]>=0xb8&&code[at+1]<=0xbf&&at+10<=limit){
   let value=0n;for(let i=0;i<8;i++)value|=BigInt(code[at+2+i])<<BigInt(8*i);
   moves.push({register:encodingRegisters[code[at+1]-0xb8+(code[at]===0x49?8:0)],value});at+=10;continue;
  }
  if(code[at]===0x83&&code[at+1]===0xf9&&code[at+2]===0){width=32;counter='rcx';at+=3;break;}
  if(code[at]===0x49&&code[at+1]===0x83&&code[at+2]===0xf9&&code[at+3]===0){width=64;counter='r9';at+=4;break;}
  return null;
 }
 if(!width||at+2!==limit||code[at]!==0x74)return null;
 const displacement=code[at+1]>=128?code[at+1]-256:code[at+1];if(a+BigInt(at+2+displacement)!==side)return null;
 return {moves,width,counter};
}
function cmpFlags(original,value,width){
 const mask=(1n<<BigInt(width))-1n,x=value&mask;let flags=0n;
 if(x===0n)flags|=64n;if(x&(1n<<BigInt(width-1)))flags|=128n;
 let ones=0;for(let low=Number(x&255n);low;low>>=1)ones+=low&1;if(ones%2===0)flags|=4n;
 return Number((BigInt(original)&~(STATUS|RF))|flags);
}
function userContext(entry){return entry.csBase==='0x0'&&entry.cpu.cpl===3&&entry.cpu.interruptShadow===0&&entry.cpu.smm===0&&entry.cpu.halted===0&&entry.cpu.a20===1&&!(entry.cpu.rflags&0x20100);}

/** Classify only adjacent outer entries fully contained within one stopped
 * observation window. A certificate establishes the ordinary RF A prelude's
 * exact transition to B/side; it does NOT establish that B subsequently ran.
 * Missing successor, stops, changed context or state remain unclassified.
 */
export function classifyRfTransitions(parsed,{layout,start=parsed.baseOffset,end=parsed.endOffset}){
 assert.equal(parsed.schema,1);assert.ok(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&parsed.baseOffset<=start&&start<=end&&end<=parsed.endOffset,'Exact byte window');
 assert.ok(layout&&Array.isArray(layout.programs)&&layout.programs.length<=11,'Bounded fixture layout');
 const shapes=layout.programs.map(prelude),entries=parsed.entries.filter(e=>e.start>=start&&e.start<end),stopsByEntry=new Map();
 for(const stop of parsed.stops){const list=stopsByEntry.get(stop.precedingEntry)??[];list.push(stop);stopsByEntry.set(stop.precedingEntry,list);}
 assert.ok(!parsed.entries.some(e=>e.start<start&&e.end>start),'Window cuts an execution record');
 const certificates=[],refused=[],unclassified=[],otherRfEntries=[];
 for(let i=0;i<entries.length;i++){
  const entry=entries[i];assert.ok(entry.end<=end,'Window cuts an execution record');
  const rfFlags=Boolean(entry.flags&Number(RF)),rfState=Boolean(entry.cpu.rflags&Number(RF));
  if(!rfFlags&&!rfState)continue;
  const program=layout.programs.findIndex(p=>p.a===entry.pc);const base={entry:entry.index,offset:entry.start,pointer:entry.pointer,pc:entry.pc,flags:entry.flags,cflags:entry.cflags,program};
  if(program<0){otherRfEntries.push(base);continue;}
  const reason=message=>unclassified.push({...base,reason:message});
  if(!rfFlags||!rfState){reason('RF mismatch between TB flags and architectural RFLAGS');continue;}
  const shape=shapes[program];if(!shape){reason('A prelude outside the offline CMP/JZ oracle');continue;}
  if(!userContext(entry)){reason('Unsupported RF entry context');continue;}
  const next=entries[i+1],stops=(stopsByEntry.get(entry.index)??[]).filter(s=>s.start>=entry.start&&s.end<=(next?.start??end));
  if(stops.length){
   if(stops.length===1&&stops[0].pointer===entry.pointer&&stops[0].pc===entry.pc)refused.push({...base,stop:stops[0],scope:'Stopped-chain message at this RF owner; not counted as a completed RF prelude.'});
   else reason('Intervening or differently attributed stopped-chain message');continue;
  }
  if(!next){reason('No successor outer entry within the same acknowledged window');continue;}
  const expected={...entry.gpr};for(const move of shape.moves)expected[move.register]=word(move.value);
  const value=BigInt('0x'+expected[shape.counter])&((1n<<BigInt(shape.width))-1n),target=layout.programs[program][value===0n?'side':'b'];
  if(!userContext(next)||next.pc!==target||next.flags!==((entry.flags&~Number(RF))>>>0)||next.cflags!==entry.cflags||next.efer!==entry.efer){reason('Successor PC/context/flags do not establish the exact RF-clearing exit');continue;}
  if(!Object.keys(expected).every(k=>next.gpr[k]===expected[k])||next.cpu.rflags!==cmpFlags(entry.cpu.rflags,value,shape.width)||next.cc.src!=='0000000000000000'||next.cc.dst!==expected[shape.counter]||next.cc.op!==(shape.width===32?'SUBL':'SUBQ')){reason('Successor GPR/CMP/lazy flags mismatch');continue;}
  certificates.push({...base,successorEntry:next.index,successorOffset:next.start,target,count:hex(value),width:shape.width,transition:value===0n?'rf-a-to-side':'rf-a-to-b',gprPreservedExceptPreludeMoves:true,cmpFlags:next.cpu.rflags,rfCleared:true,scope:'Completed ordinary RF A prelude only. B execution, elapsed time and descriptor generation are not inferred.'});
 }
 return {schema:1,start,end,outerEntries:entries.length,certificates,refused,unclassified,otherRfEntries,
  rfAToB:certificates.filter(x=>x.transition==='rf-a-to-b').length,rfAToSide:certificates.filter(x=>x.transition==='rf-a-to-side').length,
  acceptance:false,scope:'Source-backed classification of a bounded raw-log prefix. It cannot replace the original failed baseline oracle or certify a whole-body partition.'};
}
