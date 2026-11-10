import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLayout,validateGate,validatePass,initial,flags,codeAdd} from './guest-contract.mjs';
const layout={schema:1,rx:'0x20000000',a:'0x20000004',b:'0x20000009',back:'0x2000000e',side:'0x20000010',end:'0x20000011',physicalFrame:'0x123',timer:'ITIMER_VIRTUAL',timerUsec:10000,cases:8,codeHex:codeAdd};
const hex=n=>'0x'+n.toString(16);
function gate(seq,off=9){
 const zeros={gpr:Array(16).fill('0x0'),rflags:'0x0'};
 if(!seq)return {seq,stage:'layout',case:-2,iterations:0,step:0,deliveries:0,initial:zeros,observed:structuredClone(zeros),sample:null};
 const model=initial(seq-2,0x100000n),gpr=[...model.state.gpr];gpr[0]=hex(BigInt(model.iterations)*BigInt(model.step)&0xffffffffn);gpr[2]='0x0';let sample=null;
 if(seq>1){const n=BigInt(model.iterations),left=off===16?0n:123n,step=BigInt(model.step);let acc=(n-left)*step&0xffffffffn,ef=flags(left,0n,true);if(off===4||off===14)ef=flags(left+1n,1n,true);if(off===11){ef=flags(acc,step,false);acc=(acc+step)&0xffffffffn;}const regs=[...model.state.gpr];regs[0]=hex(acc);regs[2]=hex(left);regs[7]=hex(0x100000n-8n);sample={signo:26,code:128,error:0,pc:hex(0x20000000n+BigInt(off)),gpr:regs,rflags:hex(ef)};}
 return {seq,stage:seq===1?'warm':'signal',case:seq-2,iterations:model.iterations,step:model.step,deliveries:seq>1?1:0,initial:model.state,observed:{gpr,rflags:'0x246'},sample};
}
test('complete fixed work and all allowed saved instruction boundaries',()=>{
 validateLayout(layout);for(let i=0;i<10;i++)validateGate(gate(i),layout);for(const off of [4,7,9,11,14,16])validateGate(gate(2,off),layout);validatePass({calls:9,signals:8,contexts:8});
});
test('ADD/SUB flags include carry overflow auxiliary carry parity and zero',()=>{
 for(const [a,b,sub,want]of [[0xffffffffn,1n,false,0x257n],[0x7fffffffn,1n,false,0xa96n],[0n,1n,true,0x297n],[0x80000000n,1n,true,0xa16n],[0n,0n,true,0x246n]])assert.equal(flags(a,b,sub),want);
});
test('wrong provenance progress registers flags or resume result reject',()=>{
 const changes=[g=>g.deliveries=0,g=>g.deliveries=2,g=>g.sample.code=0,g=>g.sample.signo=14,g=>g.sample.pc='0x20000005',g=>g.sample.gpr[0]='0x0',g=>g.sample.gpr[2]='0x100000000',g=>g.sample.gpr[7]=g.initial.gpr[7],g=>g.sample.gpr[15]='0x0',g=>g.sample.rflags='0x202',g=>g.observed.gpr[3]='0x0',g=>g.initial.gpr[3]='0x0',g=>g.iterations++,g=>g.sample.extra=1];
 for(const change of changes){const g=gate(2);change(g);assert.throws(()=>validateGate(g,layout));}
 assert.throws(()=>validateLayout({...layout,timerUsec:20000}));assert.throws(()=>validatePass({calls:9,signals:7,contexts:7}));
});
