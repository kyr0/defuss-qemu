import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCode,codeDelta} from './code.mjs';
function bank(compiled=10,tci=3){
 const w=Array(2112).fill(0);w.splice(0,8,0x4d33434f,1,2112,16,128,1,compiled,tci);w[12]=64;const p=(i,n)=>{n=BigInt(n);w[i]=Number(n&0xffffffffn);w[i+1]=Number(n>>32n);};const at=64;
 w[at]=compiled+tci?2:1;w[at+1]=1;p(at+2,0x1000);p(at+4,0x20000004);p(at+6,0x123004);p(at+8,0xffffffffffffffffn);w[at+10]=0x18c0c2b3;w[at+11]=0xff020000;w[at+12]=12;w[at+13]=5;p(at+22,0x234000);
 if(compiled+tci){p(at+14,0x99);p(at+16,0x2000);p(at+18,0x20000004);p(at+20,0x20000004);p(at+24,0x234000);p(at+26,0x234000);w[at+28]=compiled;w[at+29]=tci;p(at+64,0x80050033);p(at+66,0x350eb0);p(at+68,0xd01);w[at+70]=0x18c0c2b3;w[at+71]=0x101;}
 const bytes=Buffer.from('83f900740701f083e901ebf4','hex');for(let i=0;i<bytes.length;i++)w[at+32+(i>>>2)]=(w[at+32+(i>>>2)]|(bytes[i]<<((i%4)*8)))>>>0;return w;
}
const profile=(compiled=10,tci=3)=>({formed:1,compiledEntries:compiled,tciEntries:tci});
test('exact formation bytes and generation counts reconcile to original profile',()=>{
 const before=decodeCode(bank(0,0),profile(0,0)),after=decodeCode(bank(),profile());const d=codeDelta(before,after);assert.equal(d.compiled,10);assert.equal(d.tci,3);assert.equal(d.records[0].bytesHex,'83f900740701f083e901ebf4');assert.equal(d.records[0].generation,'0x99');assert.equal(d.records[0].status,'entered');
});
test('overflow unmatched saturation reserved bytes and missing tier counts reject',()=>{
 for(const [at,value]of [[5,17],[8,1],[9,1],[10,1],[11,1],[63,1],[64+31,1],[64+72,1],[64+28,9],[64+8,0],[64+12,129],[64+13,12],[64+20,0x20000005],[64+26,0x235000],[64+14,0],[64+35,1],[64+128,1]]){const w=bank();w[at]=value;assert.throws(()=>decodeCode(w,profile()));}
});
test('formation and first-entry identities cannot change while counts advance',()=>{
 const before=decodeCode(bank(),profile()),after=decodeCode(bank(11,4),profile(11,4));assert.equal(codeDelta(before,after).compiled,1);
 for(const key of ['owner','translationPC','page0','flags','bytesHex','generation','code','firstCr3','cr0']){const bad=structuredClone(after);bad.records[0][key]=typeof bad.records[0][key]==='number'?0:'0x0';assert.throws(()=>codeDelta(before,bad));}
 assert.throws(()=>codeDelta(after,before));
});
