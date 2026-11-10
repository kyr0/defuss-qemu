import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLayout,validateGate,validatePass,expectedValues,stages,codeAdd,codeSub} from './guest-contract.mjs';
const layout=()=>({schema:1,rx:'0x20000000',rw:'0x21000000',a:'0x20000004',b:'0x20000009',back:'0x2000000e',side:'0x20000010',end:'0x20000011',pageBytes:4096,codeBytes:17,physicalFrame:'0x123'});
function gate(seq){const sub=seq===2||seq===3;return {seq,stage:stages[seq],checks:[0,8,8,16,16,24][seq],patches:[0,0,1,1,2,2][seq],rxPagemap:'0xa080000000000123',rwPagemap:'0xa080000000000123',rxHex:sub?codeSub:codeAdd,rwHex:sub?codeSub:codeAdd,values:seq%2===1?expectedValues(sub):[]};}
test('six fixed gates preserve exact ADD/SUB/ADD bytes and arithmetic',()=>{
 const p=validateLayout(layout());for(let i=0;i<6;i++)validateGate(gate(i),p);validatePass({checks:24,calls:24,patches:2});
 assert.equal(codeAdd.length,34);const a=Buffer.from(codeAdd,'hex'),b=Buffer.from(codeSub,'hex');assert.deepEqual([...a.keys()].filter(i=>a[i]!==b[i]),[9]);assert.equal(a[9],1);assert.equal(b[9],41);
 assert.equal(expectedValues(false)[0],0);assert.equal(expectedValues(true)[1],(0-expectedValues(false)[1])>>>0);
});
test('coherent bytes alone cannot replace actual present matching PFNs',()=>{
 for(const change of [g=>g.rxPagemap='0xa080000000000124',g=>g.rwPagemap='0x2080000000000123',g=>g.rwPagemap='0xe080000000000123',g=>g.rxPagemap='0xa080000000000000',g=>g.rxPagemap='0x0a080000000000123']){const g=gate(3);change(g);assert.throws(()=>validateGate(g,layout()));}
});
test('modified non-opcode bytes, stale arithmetic, missing patches and reordered work reject',()=>{
 for(const change of [g=>g.rxHex=codeAdd,g=>g.rwHex=codeAdd,g=>g.values=expectedValues(false),g=>g.values[0]=1,g=>g.patches=0,g=>g.checks=8,g=>g.stage='add-complete',g=>g.extra=1]){const g=gate(3);change(g);assert.throws(()=>validateGate(g,layout()));}
 for(const change of [p=>p.physicalFrame='0x0',p=>p.physicalFrame='0x20000',p=>p.rx=p.rw,p=>p.a='0x20000005',p=>p.codeBytes=18]){const p=layout();change(p);assert.throws(()=>validateLayout(p));}
});
