// Synthetic host fixtures only; never evidence of an actual guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseTrace,classifyRfTransitions} from './trace.mjs';
import {verifyChunkIndex,verifyStreamSnapshot} from './inspect.mjs';
const RF=0x10000,baseFlags=0x00a000b3;
const p32={name:'m3b_add32',a:'0x400000',b:'0x400005',back:'0x40000d',side:'0x40000f',end:'0x400014',ownerBytes:15,codeHex:'83f900740a83c03531d083e901ebf1'};
const p64={name:'m3b_add64',a:'0x410000',b:'0x410006',back:'0x410011',side:'0x410013',end:'0x410018',ownerBytes:19,codeHex:'4983f900740d4d31ea4983c2114983e901ebed'};
const layout={schema:1,programs:[p32,p64]},word=n=>BigInt(n).toString(16).padStart(16,'0'),bytes=s=>new TextEncoder().encode(s);
const names=['rax','rbx','rcx','rdx','rsi','rdi','rbp','rsp','r8','r9','r10','r11','r12','r13','r14','r15'];
const regs=()=>Object.fromEntries(names.map((n,i)=>[n,word(0x12340000n+BigInt(i))]));
function state(p,count,{width=32,rf=true}={}){
 const gpr=regs();gpr[width===32?'rcx':'r9']=word(width===32?0x7139ac4e00000000n|BigInt(count):count);
 return {pc:p.a,pointer:'0x17000',flags:baseFlags|(rf?RF:0),cflags:0x80000,gpr,rflags:0x202|(rf?RF:0),cc:{src:word(0),dst:word(0),op:'EFLAGS'},efer:word(0xd01),cpl:3};
}
function successor(p,before,{width=32,count=3}={}){
 return {...structuredClone(before),pc:count?p.b:p.side,pointer:'0x19000',flags:baseFlags,rflags:count?0x206:0x246,cc:{src:word(0),dst:before.gpr[width===32?'rcx':'r9'],op:width===32?'SUBL':'SUBQ'}};
}
function dump(x){
 const display=[[0x400,'D'],[0x800,'O'],[0x80,'S'],[0x40,'Z'],[0x10,'A'],[4,'P'],[1,'C']].map(([bit,c])=>x.rflags&bit?c:'-').join('');
 const rows=[['rax','rbx','rcx','rdx'],['rsi','rdi','rbp','rsp'],['r8','r9','r10','r11'],['r12','r13','r14','r15']].map(row=>row.map(n=>n.toUpperCase().padEnd(3,' ')+'='+x.gpr[n]).join(' '));
 return `Trace 0: ${x.pointer} [00000000/${word(BigInt(x.pc))}/${x.flags.toString(16).padStart(8,'0')}/${x.cflags.toString(16).padStart(8,'0')}] fixture\n`+rows.join('\n')+`\nRIP=${word(BigInt(x.pc))} RFL=${x.rflags.toString(16).padStart(8,'0')} [${display}] CPL=${x.cpl} II=0 A20=1 SMM=0 HLT=0\nCS =0033 0000000000000000 ffffffff 00a0fb00 DPL=3 CS64 [-RA]\nCCS=${x.cc.src} CCD=${x.cc.dst} CCO=${x.cc.op}\nEFER=${x.efer}\n`;
}
const classify=(text,l=layout,window={})=>{const parsed=parseTrace(bytes(text));return classifyRfTransitions(parsed,{layout:l,...window});};

test('raw exec/cpu parsing binds all registers, flags, lazy state and byte offsets',()=>{
 const a=state(p32,3),b=successor(p32,a),prefix='----------------\nIN: fixture\n0x00400000: 83 f9 00 cmpl $0,%ecx\n';
 const parsed=parseTrace(bytes(prefix+dump(a)+dump(b)));assert.equal(parsed.entries.length,2);assert.equal(parsed.entries[0].start,bytes(prefix).length);assert.equal(parsed.entries[0].end,bytes(prefix+dump(a)).length);
 assert.deepEqual(parsed.entries[0].gpr,a.gpr);assert.equal(parsed.entries[1].cc.dst,'7139ac4e00000003');assert.equal(parsed.entries[0].cpu.rip,p32.a);
 const report=classifyRfTransitions(parsed,{layout});assert.equal(report.rfAToB,1);assert.equal(report.rfAToSide,0);assert.equal(report.acceptance,false);assert.match(report.certificates[0].scope,/B execution.*not inferred/);
});

test('64-bit nonterminal and zero terminal RF exits have distinct exact certificates',()=>{
 for(const count of [3,0]){const a=state(p64,count,{width:64}),b=successor(p64,a,{width:64,count});const r=classify(dump(a)+dump(b));assert.equal(r.rfAToB,count?1:0);assert.equal(r.rfAToSide,count?0:1);assert.equal(r.unclassified.length,0);assert.equal(r.certificates[0].count,'0x'+count.toString(16));}
});

test('RF prelude NOP and MOVABS effects must match the successor exactly',()=>{
 const move='49b8dfb628054eac3971',code='90'+move+p32.codeHex;
 const p={...p32,name:'fixture-with-prefix',b:'0x400010',back:'0x400018',side:'0x40001a',end:'0x40001f',ownerBytes:26,codeHex:code};
 const a=state(p,3),b=successor(p,a);b.gpr.r8='7139ac4e0528b6df';let r=classify(dump(a)+dump(b),{programs:[p]});assert.equal(r.rfAToB,1);
 b.gpr.r8=a.gpr.r8;r=classify(dump(a)+dump(b),{programs:[p]});assert.equal(r.rfAToB,0);assert.match(r.unclassified[0].reason,/GPR/);
});

test('generic stopped-chain refusal cannot count as a completed RF A prelude',()=>{
 const a=state(p32,3),b=successor(p32,a),stop=`Stopped execution of TB chain before ${a.pointer} [${word(BigInt(a.pc))}] fixture\n`;
 const r=classify(dump(a)+stop+dump(a)+dump(b));assert.equal(r.refused.length,1);assert.equal(r.rfAToB,1);assert.equal(r.unclassified.length,0);
 const wrong=classify(dump(a)+stop.replace(a.pointer,'0xdead')+dump(b));assert.equal(wrong.refused.length,0);assert.equal(wrong.rfAToB,0);assert.match(wrong.unclassified[0].reason,/differently attributed/);
});

test('new RF, wrong count/flags/context and narrowed lazy32 dst remain unresolved',()=>{
 const a=state(p32,3),good=successor(p32,a);
 for(const change of [b=>b.gpr.rcx=word(2),b=>b.gpr.r10=word(4),b=>b.rflags^=1,b=>b.rflags|=RF,b=>b.flags|=RF,b=>b.cc.dst=word(3),b=>b.cc.src=word(1),b=>b.cc.op='SUBQ',b=>b.cflags^=1,b=>b.cpl=0,b=>b.pc=p64.b,b=>b.efer=word(0)]){
  const b=structuredClone(good);change(b);const r=classify(dump(a)+dump(b));assert.equal(r.rfAToB,0);assert.equal(r.unclassified.length,1);
 }
});

test('paused byte windows cannot borrow a next-phase successor or split CPU state',()=>{
 const a=state(p32,3),b=successor(p32,a),one=dump(a),between='----------------\nIN: next phase\n';const parsed=parseTrace(bytes(one+between+dump(b)));
 let r=classifyRfTransitions(parsed,{layout,start:0,end:bytes(one).length});assert.equal(r.rfAToB,0);assert.equal(r.unclassified.length,1);
 r=classifyRfTransitions(parsed,{layout,start:bytes(one).length,end:parsed.bytes});assert.equal(r.rfAToB,0);assert.equal(r.outerEntries,1);
 assert.throws(()=>classifyRfTransitions(parsed,{layout,start:1,end:parsed.bytes}),/cuts/);assert.throws(()=>classifyRfTransitions(parsed,{layout,end:bytes(one).length-1}),/cuts/);
});

test('incomplete, reordered, wrong-CPU and corrupt raw frames are rejected',()=>{
 const good=dump(state(p32,3));
 for(const bad of [good.slice(0,-1),good.replace(/^Trace 0/m,'Trace 1'),good.replace(/^RAX=.*\n/m,''),good.replace(/^CCS=.*\n/m,''),good.replace(/^EFER=.*\n/m,''),good.replace('RIP=0000000000400000','RIP=0000000000400001'),good.replace('RAX=','RBX='),good+'Trace malformed\n',good+'\u0000\n',good+'\u00e9\n'])assert.throws(()=>parseTrace(bytes(bad)));
 assert.throws(()=>parseTrace(new Uint8Array([0xc3,0x28,10])));
});

test('non-A RF and unsupported dynamic prelude stay explicit and cannot certify a body',()=>{
 const a=state(p32,3),b=successor(p32,a);a.pc=p32.b;let r=classify(dump(a)+dump(b));assert.equal(r.rfAToB,0);assert.equal(r.otherRfEntries.length,1);
 const p={...p32,b:'0x400002',back:'0x40000a',side:'0x40000c',end:'0x400011',ownerBytes:12,codeHex:'740a83c03531d083e901ebf4'};
 a.pc=p.a;r=classify(dump(a)+dump(b),{programs:[p]});assert.equal(r.rfAToB,0);assert.match(r.unclassified[0].reason,/outside/);
});

test('offline chunk replay binds every stream byte, sequence, offset and digest',()=>{
 const sha=b=>createHash('sha256').update(b).digest('hex'),files={trace:bytes('ab'),serial:bytes('cd'),stderr:bytes('')};
 const rows=[{schema:1,seq:0,stream:'trace',offset:0,bytes:2,sha256:sha(files.trace)},{schema:1,seq:1,stream:'serial',offset:0,bytes:2,sha256:sha(files.serial)}];
 assert.equal(verifyChunkIndex(rows,files).chunks,2);
 for(const change of [r=>r[0].schema=true,r=>r[0].seq=1,r=>r[1].offset=1,r=>r[0].bytes=3,r=>r[0].sha256='0'.repeat(64),r=>r.pop()]){const r=structuredClone(rows);change(r);assert.throws(()=>verifyChunkIndex(r,files));}
 assert.throws(()=>verifyChunkIndex(rows,{...files,trace:bytes('abc')}),/tail/);
 assert.throws(()=>verifyChunkIndex(rows,{...files,trace:bytes('xb')}));
});

test('gate stream prefixes must correspond to one exact acknowledged chunk boundary',()=>{
 const b=bytes('x'),sha=createHash('sha256').update(b).digest('hex'),index=verifyChunkIndex([{schema:1,seq:0,stream:'trace',offset:0,bytes:1,sha256:sha}],{trace:b,serial:bytes(''),stderr:bytes('')});
 const snapshot={chunks:1,streams:{trace:{seen:1,queued:1},serial:{seen:0,queued:0},stderr:{seen:0,queued:0}}};assert.deepEqual(verifyStreamSnapshot(snapshot,index),{trace:1,serial:0,stderr:0});
 for(const change of [s=>s.chunks=true,s=>s.chunks=2,s=>s.chunks=0,s=>s.streams.trace.seen=0,s=>s.streams.trace.queued=2,s=>delete s.streams.stderr]){const s=structuredClone(snapshot);change(s);assert.throws(()=>verifyStreamSnapshot(s,index));}
});

test('fixed post-layout horizon retains original offsets without accepting invalid user frames',()=>{
 const boot=bytes('Trace 0: 0x12000 [00000000/0000000000400000/00000000/00000000]\nEAX=00000000 EIP=00400000\n'),a=state(p32,3),b=successor(p32,a),user=bytes(dump(a)+dump(b));
 const parsed=parseTrace(user,{offsetBase:boot.length});assert.equal(parsed.entries[0].start,boot.length);assert.equal(parsed.endOffset,boot.length+user.length);assert.equal(classifyRfTransitions(parsed,{layout}).rfAToB,1);
 assert.throws(()=>classifyRfTransitions(parsed,{layout,start:0}));assert.throws(()=>parseTrace(bytes(dump(a)+'EAX=00000000\nTrace broken\n'),{offsetBase:boot.length}));
});
