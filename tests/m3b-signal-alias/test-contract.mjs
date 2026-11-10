import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLayout,validateGate,validatePass,initial,flags,codeAdd,codeSub} from './guest-contract.mjs';
export const layout={schema:1,rx:'0x20000000',rw:'0x21000000',a:'0x20000004',b:'0x20000009',back:'0x2000000e',side:'0x20000010',end:'0x20000011',physicalFrame:'0x123',timer:'ITIMER_VIRTUAL',timerUsec:10000,cases:8,codeHex:codeAdd};
const hex=n=>'0x'+n.toString(16),mask=0xffffffffn;
export function gate(seq,off=9){
 const patches=Math.max(0,seq-1),current=patches%2?codeSub:codeAdd,alias={patches,rxPagemap:'0x8000000000000123',rwPagemap:'0x8000000000000123',rxHex:current,rwHex:current},zeros={gpr:Array(16).fill('0x0'),rflags:'0x0'};
 if(!seq)return {seq,stage:'layout',case:-2,iterations:0,step:0,deliveries:0,initial:zeros,observed:structuredClone(zeros),sample:null,...alias};
 const model=initial(seq-2,0x100000n),n=BigInt(model.iterations),step=BigInt(model.step),gpr=[...model.state.gpr];gpr[0]=hex(n*step&mask);gpr[2]='0x0';let sample=null;
 if(seq>1){
  const left=500003n,oldSub=(seq-2)%2===1,old=oldSub?codeSub:codeAdd;let acc=(oldSub?-1n:1n)*(n-left)*step&mask,ef=flags(left,0n,true);
  if(off===4||off===14)ef=flags(left+1n,1n,true);if(off===11){ef=flags(acc,step,oldSub);acc=(acc+(oldSub?-step:step))&mask;}
  const saved=[...model.state.gpr];saved[0]=hex(acc);saved[2]=hex(left);saved[7]=hex(0x100000n-8n);
  sample={signo:26,code:128,error:0,pc:hex(0x20000000n+BigInt(off)),gpr:saved,rflags:hex(ef|0x10000n),beforeRxHex:old,beforeRwHex:old,afterRxHex:current,afterRwHex:current};
  gpr[0]=hex((acc+(oldSub?1n:-1n)*(left-(off===11?1n:0n))*step)&mask);
 }
 return {seq,stage:seq===1?'warm':'signal',case:seq-2,iterations:model.iterations,step:model.step,deliveries:seq>1?1:0,initial:model.state,observed:{gpr,rflags:'0x246'},sample,...alias};
}
test('all ten gates and every active instruction boundary in ADD and SUB calls',()=>{
 validateLayout(layout);for(let seq=0;seq<10;seq++)validateGate(gate(seq),layout);for(const seq of [2,3])for(const off of [4,7,9,11,14])validateGate(gate(seq,off),layout);validatePass({calls:9,signals:8,contexts:8,patches:8});
});
test('known flag edge cases remain exact',()=>{for(const [a,b,sub,want] of [[0xffffffffn,1n,false,0x257n],[0x7fffffffn,1n,false,0xa96n],[0n,1n,true,0x297n],[0x80000000n,1n,true,0xa16n],[0n,0n,true,0x246n]])assert.equal(flags(a,b,sub),want);});
test('provenance, alias identity, precise progress, patch and return corruptions reject',()=>{
 const changes=[g=>g.patches++,g=>g.rxPagemap='0x8000000000000124',g=>g.rwPagemap='0xc000000000000123',g=>g.rxHex=codeAdd,g=>g.sample.beforeRxHex=codeSub,g=>g.sample.afterRwHex=codeAdd,g=>g.deliveries=2,g=>g.sample.code=0,g=>g.sample.signo=14,g=>g.sample.pc='0x20000010',g=>g.sample.gpr[0]='0x0',g=>g.sample.gpr[2]='0xfff',g=>g.sample.gpr[7]=g.initial.gpr[7],g=>g.sample.gpr[15]='0x0',g=>g.sample.rflags='0x202',g=>g.observed.gpr[3]='0x0',g=>g.observed.gpr[0]=hex(BigInt(g.iterations)*BigInt(g.step)&mask),g=>g.initial.gpr[3]='0x0',g=>g.iterations++,g=>g.sample.extra=1];
 for(const change of changes){const g=gate(2);change(g);assert.throws(()=>validateGate(g,layout));}
 for(const bits of [0x10000n,0x100n,0x200n,1n]){const g=gate(2);g.sample.rflags=hex(BigInt(g.sample.rflags)^bits);assert.throws(()=>validateGate(g,layout));}
 assert.throws(()=>validateLayout({...layout,rw:layout.rx}));assert.throws(()=>validatePass({calls:9,signals:8,contexts:8,patches:7}));
});
