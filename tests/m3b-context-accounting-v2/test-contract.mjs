// Synthetic source fixtures, not guest evidence. Execution is root-coordinated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContextTrace,classifyContextWindow,normalKey,validateContextWindow} from './contract.mjs';
import {classifyRfTransitions} from '../m3b-forensic-v2/trace.mjs';

const RF=0x10000,U32=0xffffffffn,word=n=>(BigInt(n)&((1n<<64n)-1n)).toString(16).padStart(16,'0');
const p32={name:'m3b_add32',a:'0x400000',b:'0x400005',back:'0x40000d',side:'0x40000f',end:'0x400014',ownerBytes:15,codeHex:'83f900740a83c03531d083e901ebf1'};
const p64={name:'m3b_add64',a:'0x410000',b:'0x410006',back:'0x410011',side:'0x410013',end:'0x410018',ownerBytes:19,codeHex:'4983f900740d4d31ea4983c2114983e901ebed'};
const layout={schema:1,programs:[p32,p64]},names=['rax','rbx','rcx','rdx','rsi','rdi','rbp','rsp','r8','r9','r10','r11','r12','r13','r14','r15'];
function initial(program=0){
 const p=layout.programs[program],gpr=Object.fromEntries(names.map((n,i)=>[n,word(0x71230000n+BigInt(i))]));gpr[program?'r9':'rcx']=word(program?3n:0x1234567800000003n);
 return {pc:p.a,pointer:'0x10000',flags:normalKey.flags|RF,cflags:normalKey.cflags,gpr,rflags:0x10202,cc:{src:word(0),dst:word(0),op:'EFLAGS'},cr3:'0000000001234000',fs:'0000000000450000'};
}
function prelude(a,program=0){return {...structuredClone(a),pc:layout.programs[program].b,pointer:'0x12000',flags:normalKey.flags,rflags:0x206,cc:{src:word(0),dst:a.gpr[program?'r9':'rcx'],op:program?'SUBQ':'SUBL'}};}
function body(b,program=0){
 const a={...structuredClone(b),pc:layout.programs[program].a,pointer:'0x13000',flags:normalKey.flags,rflags:0x202};
 if(program){a.gpr.r10=word((BigInt('0x'+b.gpr.r10)^BigInt('0x'+b.gpr.r13))+17n);a.gpr.r9=word(BigInt('0x'+b.gpr.r9)-1n);}
 else{a.gpr.rax=word(((BigInt('0x'+b.gpr.rax)+53n)&U32)^(BigInt('0x'+b.gpr.rdx)&U32));a.gpr.rcx=word((BigInt('0x'+b.gpr.rcx)-1n)&U32);}
 a.cc={src:word(1),dst:word(BigInt('0x'+b.gpr[program?'r9':'rcx'])-1n),op:program?'SUBQ':'SUBL'};return a;
}
function dump(x){
 const rows=[['rax','rbx','rcx','rdx'],['rsi','rdi','rbp','rsp'],['r8','r9','r10','r11'],['r12','r13','r14','r15']].map(row=>row.map(n=>n.toUpperCase().padEnd(3,' ')+'='+x.gpr[n]).join(' '));
 const display=[[0x400,'D'],[0x800,'O'],[0x80,'S'],[0x40,'Z'],[0x10,'A'],[4,'P'],[1,'C']].map(([bit,c])=>x.rflags&bit?c:'-').join('');
 return `Trace 0: ${x.pointer} [00000000/${word(BigInt(x.pc))}/${x.flags.toString(16).padStart(8,'0')}/${x.cflags.toString(16).padStart(8,'0')}] \n${rows.join('\n')}\nRIP=${word(BigInt(x.pc))} RFL=${x.rflags.toString(16).padStart(8,'0')} [${display}] CPL=3 II=0 A20=1 SMM=0 HLT=0\nES =0000 0000000000000000 00000000 00000000\nCS =0033 0000000000000000 ffffffff 00affb00 DPL=3 CS64 [-RA]\nSS =002b 0000000000000000 ffffffff 00cff300 DPL=3 DS   [-WA]\nDS =0000 0000000000000000 00000000 00000000\nFS =0000 ${x.fs} 00000000 00000000\nGS =0000 0000000000000000 00000000 00000000\nLDT=0000 0000000000000000 00000000 00008200 DPL=0 LDT\nTR =0040 fffffe111cfb3000 00004087 00008900 DPL=0 TSS64-avl\nGDT=     fffffe111cfb1000 0000007f\nIDT=     fffffe0000000000 00000fff\nCR0=80050033 CR2=00000000004c4f58 CR3=${x.cr3} CR4=00350eb0\nDR0=0000000000000000 DR1=0000000000000000 DR2=0000000000000000 DR3=0000000000000000 \nDR6=00000000ffff0ff0 DR7=0000000000000400\nCCS=${x.cc.src} CCD=${x.cc.dst} CCO=${x.cc.op}\nEFER=${normalKey.efer}\n`;
}
const stop=x=>`Stopped execution of TB chain before ${x.pointer} [${word(BigInt(x.pc))}] \n`;
function evaluate(text,program=0){const parsed=parseContextTrace(new TextEncoder().encode(text),{offsetBase:101});return classifyContextWindow({parsed,layout,window:{start:101,end:parsed.endOffset},program});}
function chain(program=0,refusals=0){const a=initial(program),b=prelude(a,program),rf={...structuredClone(b),pointer:'0x14000',flags:normalKey.flags|RF,rflags:b.rflags|RF},next=body(rf,program);return {a,b,rf,next,text:dump(a)+dump(b)+stop(b)+(dump(rf)+stop(rf)).repeat(refusals)+dump(rf)+dump(next)};}

test('RF B body completion belongs to its existing RF A route and adds no new term',()=>{
 for(const program of [0,1]){const x=chain(program),r=evaluate(x.text,program);assert.equal(r.classification.rfAToB,1);assert.equal(r.rfBCompletions.length,1);assert.equal(r.rfBCompletions[0].addsLogicalBodyTerm,false);assert.equal(r.hiddenChainCoverage,false);}
});
test('repeated generic RF B refusals remain attempts within the same continuation',()=>{
 const r=evaluate(chain(0,3).text);assert.equal(r.classification.rfAToB,1);assert.equal(r.refusedRfB.length,3);assert.equal(r.rfBCompletions.length,1);
 assert.equal(new Set([...r.refusedRfB,...r.rfBCompletions].map(x=>x.originCertificate)).size,1);
});
test('complete control/segment context is required although the frozen RF classifier omits it',()=>{
 const x=chain();for(const bad of [x.text.replace(/^CR0=.*\n/m,''),x.text.replace(/^FS =.*\n/m,''),x.text.replace('CR3=0000000001234000','CR3=short')])assert.throws(()=>evaluate(bad));
 for(const change of [b=>b.cr3='0000000009876000',b=>b.fs='0000000000990000']){
  const b=structuredClone(x.b);change(b);const text=dump(x.a)+dump(b),parsed=parseContextTrace(new TextEncoder().encode(text));
  assert.equal(classifyRfTransitions(parsed,{layout}).rfAToB,1);assert.throws(()=>classifyContextWindow({parsed,layout,window:{start:0,end:parsed.endOffset},program:0}),/context changed/);
 }
});
test('raw descriptor limit encodings may differ while decoded segment semantics remain exact',()=>{
 const x=chain(),changed=dump(x.a)+dump(x.b).replace('00affb00','00a0fb00').replace('00cff300','00c0f300')+stop(x.b)+dump(x.rf)+dump(x.next);
 const result=evaluate(changed);assert.equal(result.classification.rfAToB,1);assert.equal(result.semanticRecordedContext.segments.CS.flags,'00a0fb00');assert.equal(result.recordedContext.segments.CS.flags,'00affb00');
 const bytes=new TextEncoder().encode(changed),parsed=parseContextTrace(bytes);assert.notEqual(parsed.entries[0].fullContext.segments.CS.flags,parsed.entries[1].fullContext.segments.CS.flags);assert.ok(parsed.entries[1].fullContext.segmentsDebug[1].includes('00a0fb00'));
 for(const replacement of [['ffffffff 00a0fb00','fffffffe 00a0fb00'],['CS =0033','CS =0032'],['0000000000450000','0000000000450001']]){
  const bad=dump(x.a)+dump(x.b).replace('00affb00','00a0fb00').replace(...replacement)+stop(x.b)+dump(x.rf)+dump(x.next);assert.throws(()=>evaluate(bad),/context changed/);
 }
 const accessed=dump(x.a)+dump(x.b).replace('00affb00 DPL=3 CS64 [-RA]','00affa00 DPL=3 CS64 [-R-]')+stop(x.b)+dump(x.rf)+dump(x.next);assert.throws(()=>evaluate(accessed),/context changed/);
});
test('repeated malformed or duplicate context rows fail even when every frame agrees',()=>{
 const text=chain().text;
 for(const prefix of ['ES =','CS =','SS =','DS =','FS =','GS =','LDT=','TR =','GDT=','IDT=','DR0=','DR6=']){
  const pattern=new RegExp('^'+prefix+'.*$','gm');
  for(const bad of [text.replace(pattern,prefix),text.replace(pattern,line=>line+' extra'),text.replace(pattern,line=>line+'\n'+line)])assert.throws(()=>evaluate(bad));
 }
 assert.throws(()=>evaluate(text.replaceAll('DPL=3 CS64 [-RA]','DPL=3 CS64 [CRA]')),/Descriptor display/);
});
test('normal cflags count and cluster changes are never silently masked',()=>{
 const x=chain();for(const cflags of [(normalKey.cflags|1)>>>0,0x20000,0xff080000]){const a=structuredClone(x.a),b=structuredClone(x.b);a.cflags=b.cflags=cflags;assert.throws(()=>evaluate(dump(a)+dump(b)),/cflags/);}
});
test('RF B body oracle rejects wrong register, narrowed lazy32 state and incomplete continuation',()=>{
 const x=chain();for(const change of [n=>n.gpr.rax=word(1),n=>n.gpr.rbx=word(1),n=>n.gpr.rcx=word(0),n=>n.cc.dst=word(2),n=>n.cc.src=word(0),n=>n.gpr.r10=word(0),n=>n.rflags^=1]){
  const next=structuredClone(x.next);change(next);assert.throws(()=>evaluate(dump(x.a)+dump(x.b)+stop(x.b)+dump(x.rf)+dump(next)));
 }
 assert.throws(()=>evaluate(dump(x.a)+dump(x.b)+stop(x.b)+dump(x.rf)),/Unclosed/);
});
test('RF B and stopped-chain evidence cannot be borrowed from a different route',()=>{
 const x=chain();assert.throws(()=>evaluate(dump(x.b)+stop(x.b)+dump(x.rf)+dump(x.next)),/preceding certified/);
 assert.throws(()=>evaluate(dump(x.a)+dump(x.b)+dump(x.rf)+dump(x.next)),/refusal/);
 assert.throws(()=>evaluate(dump(x.a)+dump(x.b)+stop({...x.b,pointer:'0xdead'})+dump(x.rf)+dump(x.next)),/refusal/);
 for(const successor of [x.next,{...x.next,pc:p32.side}])assert.throws(()=>evaluate(dump(x.a)+dump(x.b)+stop(x.b)+dump(x.rf)+stop(x.rf)+dump(successor)),/refusal/);
});
test('interior PCs, unresolved RF exits and changed visible owner pointers fail closed',()=>{
 const x=chain(),bad={...structuredClone(x.next),pc:'0x400001'};assert.throws(()=>evaluate(dump(x.a)+dump(x.b)+dump(bad)),/interior/);
 assert.throws(()=>evaluate(dump(x.a)),/Unclassified/);
 const normal={...structuredClone(x.next),pointer:'0xdead'};assert.throws(()=>evaluate(x.text+dump(normal)),/Multiple pointers/);
});
test('a caller-supplied completeness or acceptance boolean cannot unlock the draft',()=>{
 for(const field of ['acceptance','coverageComplete','ownerContinuityProven'])assert.throws(()=>validateContextWindow({parsed:{},layout,window:{},gate:{},before:{},after:{},ownerBaseline:{},[field]:true}));
});
test('new bounded parser retains late offsets without lifting the per-window bound',()=>{
 const bytes=new TextEncoder().encode(chain().text),offsetBase=300*1024*1024,parsed=parseContextTrace(bytes,{offsetBase});assert.equal(parsed.baseOffset,offsetBase);assert.equal(parsed.entries[0].start,offsetBase);assert.equal(parsed.endOffset,offsetBase+bytes.length);
 assert.throws(()=>parseContextTrace(bytes,{offsetBase:512*1024*1024}));
});
